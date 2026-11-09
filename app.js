/* Quick Studies: timed drawing practice with overlay review and coach feedback. */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, root) => (root || document).querySelector(s);
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'style') n.style.cssText = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const k of kids.flat()) {
      if (k == null || k === false) continue;
      n.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return n;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = n => String(n).padStart(2, '0');
  const todayKey = d => { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  function fmtDate(key) {
    const p = String(key || '').split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return '';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function withTimeout(p, ms) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej({ code: 'timeout' }), ms); })]).finally(() => clearTimeout(t));
  }
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function loadImg(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image'));
      i.src = src;
    });
  }
  function toBlob(canvas, type, q) { return new Promise(res => canvas.toBlob(b => res(b), type || 'image/jpeg', q || 0.88)); }
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  /* ---------- constants ---------- */
  const INK = '#1d1f24';
  const SHAPE = '#33363d';
  const MID = '#9a9da3';
  const DARK = '#3a3d44';
  const RED = [255, 59, 40];

  const SVG = inner => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  const ICON = {
    pen: SVG('<path d="M4 20l1.2-4.2L16.5 4.5a2.1 2.1 0 0 1 3 3L8.2 18.8z"/><path d="M14.5 6.5l3 3"/>'),
    lasso: SVG('<ellipse cx="12" cy="9.5" rx="8" ry="5.5" stroke-dasharray="3 2.4"/><path d="M7.5 14c-1.2 1.6-.8 3.6 1.2 4 1.6.3 2.3 1.3 1.8 2.6"/>'),
    cut: SVG('<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6L20 18M8.2 16.4L20 6"/>'),
    brush: SVG('<path d="M14 4.5l5.5 5.5-6.8 6.8-5.5-5.5z"/><path d="M7.2 11.3c-2.2.4-3.4 2-3.4 4.2 0 1.6-.6 2.8-1.6 3.6 3.6.6 7.3-.3 8.5-3.3"/>'),
    undo: SVG('<path d="M9 7H4V2"/><path d="M4.5 7.5A8 8 0 1 1 6 18"/>'),
    clear: SVG('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    close: SVG('<path d="M6 6l12 12M18 6L6 18"/>'),
  };
  const MODE_ART = {
    gesture: '<svg viewBox="0 0 120 48" fill="none" stroke-linecap="round" aria-hidden="true"><path d="M10 40C28 36 40 8 62 8s32 28 48 30" stroke="currentColor" stroke-width="3.4"/><path d="M60 13c-5 8-7 16-5 27" stroke="#ff5b3a" stroke-width="3.4"/></svg>',
    shapes: '<svg viewBox="0 0 120 48" aria-hidden="true"><path d="M40 6c8 0 12 5 11 11l14 3c4 1 5 5 3 8l-9 2 4 16H49l1-14-12 14-7-3 9-15-5-10c-3-6 1-12 5-12z" fill="currentColor"/><path d="M80 10h28v28H80z" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 4"/></svg>',
    values: '<svg viewBox="0 0 120 48" aria-hidden="true"><rect x="6" y="8" width="32" height="32" rx="3" fill="#ffffff"/><rect x="44" y="8" width="32" height="32" rx="3" fill="#9a9da3"/><rect x="82" y="8" width="32" height="32" rx="3" fill="#3a3d44" stroke="#5c626c"/></svg>',
  };

  const MODES = {
    gesture: {
      name: 'Gesture', secs: 15, tools: ['pen'], tool: 'pen', size: [2, 14, 5],
      toolsLabel: 'Lines only', trains: 'Line of action, flow and movement.',
      tip: 'One long line for the whole pose first. Skip hands, faces and outlines.',
      criteria: ['line of action', 'rhythm', 'proportion'],
      judge: 'Look for one clear line of action through the whole pose or form, the curve and direction of the main axis, the tilt of the shoulders and hips (or of the main planes, for objects and scenes), and where the weight sits. Ignore line quality, anatomy and outlines.',
      selfCheck: ['Does your main line lean and curve the same way as the reference?', 'Do the shoulders and hips tilt the same way?', 'Is the weight over the same foot?'],
    },
    shapes: {
      name: 'Shapes', secs: 30, tools: ['lasso', 'cut', 'pen'], tool: 'lasso', size: [2, 14, 4],
      toolsLabel: 'Lasso shapes and lines', trains: 'Primary shapes and negative space.',
      tip: 'Lasso the big silhouette, then cut out the gaps. Two or three shapes, not ten.',
      criteria: ['big shapes', 'negative space', 'proportion'],
      judge: 'Look for the silhouette read as two or three big simple shapes, correct big proportions, and the negative spaces: gaps between limbs, between objects, and between the subject and the edges of the frame.',
      selfCheck: ['Does your silhouette have the same big masses?', 'Do the gaps match the reference in size and angle?', 'Is the height-to-width ratio close?'],
    },
    values: {
      name: 'Values', secs: 60, tools: ['lasso', 'brush'], tool: 'lasso', swatches: true, size: [12, 90, 36],
      toolsLabel: 'Three values, no lines', trains: 'Big shapes, flow and basic light and dark.',
      tip: 'Squint. The paper is your light. Block in the darks first, then the mids.',
      criteria: ['value grouping', 'light logic', 'big shapes'],
      judge: 'Look for how well the image is grouped into three values (the white paper as the light, a mid grey and a dark), whether the light comes from one consistent direction, and whether the big shapes hold up. Ignore edges, texture and detail.',
      selfCheck: ['Did the darkest areas land in the same places?', 'Does all the light come from one side?', 'Did you keep it to three values?'],
    },
  };
  const TOOLS = { pen: { label: 'Pen', key: 'p' }, lasso: { label: 'Lasso', key: 'l' }, cut: { label: 'Cut', key: 'x' }, brush: { label: 'Brush', key: 'b' } };
  const VALUES = [
    { id: 'light', label: 'Light', color: '#ffffff', key: '1' },
    { id: 'mid', label: 'Mid', color: MID, key: '2' },
    { id: 'dark', label: 'Dark', color: DARK, key: '3' },
  ];
  const SUBJECTS = [['movement', 'Movement'], ['perspective', 'Perspective'], ['mixed', 'Mixed']];
  const SOURCES = [['generated', 'Generated'], ['mine', 'Mine'], ['both', 'Both']];
  const ROUND_OPTS = [[5, '5'], [10, '10'], [15, '15']];
  const subjectLabel = id => (SUBJECTS.find(s => s[0] === id) || [0, id])[1];

  /* ---------- state ---------- */
  const DEFAULTS = { mode: 'gesture', subject: 'movement', source: 'generated', rounds: 5, reviewEach: true, autoFeedback: false, secs: { gesture: 15, shapes: 30, values: 60 } };
  const S = {
    settings: Object.assign({}, DEFAULTS, lsGet('qs.settings', {})),
    profile: normProfile(lsGet('qs.profile', null)),
    history: lsGet('qs.sessions', []),
    refs: [],
    session: null,
    view: null,
    toolState: {},
  };
  S.settings.secs = Object.assign({}, DEFAULTS.secs, S.settings.secs || {});
  if (!MODES[S.settings.mode]) S.settings.mode = 'gesture';
  if (!SUBJECTS.some(s => s[0] === S.settings.subject)) S.settings.subject = 'movement';
  if (!SOURCES.some(s => s[0] === S.settings.source)) S.settings.source = 'generated';
  const saveSettings = () => lsSet('qs.settings', S.settings);

  function normProfile(p) {
    p = p && typeof p === 'object' ? p : {};
    return {
      focus: typeof p.focus === 'string' ? p.focus : '',
      focusMode: MODES[p.focusMode] ? p.focusMode : '',
      focusDate: typeof p.focusDate === 'string' ? p.focusDate : '',
      days: p.days && typeof p.days === 'object' ? Object.assign({}, p.days) : {},
      total: Number(p.total) || 0,
    };
  }
  function streak(days) {
    let n = 0;
    const d = new Date();
    if (!days[todayKey(d)]) d.setDate(d.getDate() - 1);
    while (days[todayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const AI = { sample: null, maxImages: 0, off: false };
  const canGenerate = () => !!(window.QSRefs && window.QSRefs.supported());

  /* ---------- storage: this browser, or a remote store when Store.db is set ---------- */
  let writeChain = Promise.resolve();
  function queueWrite(fn) {
    const p = writeChain.then(fn, fn);
    writeChain = p.catch(() => {});
    return p;
  }
  const Store = {
    db: null, uid: null, assets: null,
    get remote() { return !!(this.db && this.uid); },
    profileRef() { return this.db.doc('data/users/' + this.uid + '/profile'); },
    async loadProfile() {
      if (!this.remote) return lsGet('qs.profile', null);
      const snap = await withTimeout(this.profileRef().get(), 10000);
      return snap.exists ? snap.data() : null;
    },
    async saveProfile(p) {
      lsSet('qs.profile', p);
      if (this.remote) await this.profileRef().set(JSON.parse(JSON.stringify(p)));
    },
    async saveSession(rec) {
      const all = lsGet('qs.sessions', []).filter(s => s.id !== rec.id);
      all.unshift(rec);
      lsSet('qs.sessions', all.slice(0, 30));
      if (this.remote) await this.profileRef().collection('sessions').doc(String(rec.id)).set(JSON.parse(JSON.stringify(rec)));
    },
    async listSessions() {
      if (!this.remote) return lsGet('qs.sessions', []);
      const q = await withTimeout(this.profileRef().collection('sessions').orderBy('id', 'desc').limit(12).get(), 10000);
      return q.docs.map(d => d.data());
    },
    async listRefs() {
      if (!this.remote || !this.assets) return [];
      const q = await withTimeout(this.profileRef().collection('refs').orderBy('addedAt', 'asc').get(), 10000);
      return q.docs.map(d => Object.assign({ docId: d.id }, d.data()));
    },
    async addRef(rec) { const ref = this.profileRef().collection('refs').doc(); await ref.set(rec); return ref.id; },
    async updateRef(id, patch) { await this.profileRef().collection('refs').doc(id).update(patch); },
    async deleteRef(id) { await this.profileRef().collection('refs').doc(id).delete(); },
  };

  /* ---------- home ---------- */
  function chip(n, label) { return el('span', { class: 'chip' }, el('b', { text: n }), label); }
  function renderStats() {
    const st = streak(S.profile.days);
    const today = S.profile.days[todayKey()] || 0;
    $('#stats').replaceChildren(
      chip(st, 'day streak'),
      chip(today, today === 1 ? 'drawing today' : 'drawings today'),
      chip(S.profile.total || 0, 'all time')
    );
  }
  function renderFocus() {
    const p = S.profile;
    const f = p.focus;
    const suggest = f && p.focusMode && p.focusMode !== S.settings.mode;
    const kids = [
      el('span', { class: 'label', text: f ? "Today's focus" : 'Start here' }),
      el('span', { class: 'text', text: f || 'Do one Gesture session: 15 seconds per pose, one line of action before anything else.' }),
      el('span', { class: 'src', text: f ? 'Set by the coach after your session' + (p.focusDate ? ' on ' + fmtDate(p.focusDate) : '') + '.' : 'After each session the coach can set a focus for the next one.' }),
    ];
    if (suggest) kids.push(el('button', { class: 'btn', type: 'button', text: 'Switch to ' + MODES[p.focusMode].name, onclick: () => { S.settings.mode = p.focusMode; saveSettings(); renderSetup(); renderFocus(); } }));
    $('#focusCard').replaceChildren(...kids);
  }
  function seg(box, opts, cur, onPick) {
    box.replaceChildren(...opts.map(([v, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === cur), text: label, onclick: () => onPick(v) })));
  }
  function matchingRefs(subject) { return S.refs.filter(r => subject === 'mixed' || r.category === subject); }
  function renderSetup() {
    const st = S.settings;
    $('#modeCards').replaceChildren(...Object.entries(MODES).map(([id, M]) => el('button', {
      class: 'mode-card', type: 'button', role: 'radio', 'aria-checked': String(id === st.mode),
      onclick: () => { st.mode = id; saveSettings(); renderSetup(); renderFocus(); },
    },
    el('span', { class: 'm-name', text: M.name }),
    el('span', { class: 'm-time', text: st.secs[id] + ' s' }),
    el('span', { class: 'm-icon', html: MODE_ART[id] }),
    el('span', { class: 'm-tools', text: M.toolsLabel }),
    el('span', { class: 'm-trains', text: M.trains }))));
    $('#timeOut').textContent = st.secs[st.mode] + ' s';
    seg($('#segSubject'), SUBJECTS, st.subject, v => { st.subject = v; saveSettings(); renderSetup(); });
    const gen = canGenerate();
    seg($('#segSource'), SOURCES, gen ? st.source : 'mine', v => { st.source = v; saveSettings(); renderSetup(); });
    seg($('#segRounds'), ROUND_OPTS, st.rounds, v => { st.rounds = v; saveSettings(); renderSetup(); });
    $('#reviewEach').checked = !!st.reviewEach;
    const n = matchingRefs(st.subject).length;
    let note;
    if (!gen) note = n ? 'This browser cannot draw generated references, so your images are used.' : 'This browser cannot draw generated references. Add your own images below to start.';
    else if (st.source === 'generated') note = st.subject === 'perspective' ? 'Boxes, streets, still lifes and colonnades from new angles every time.' : st.subject === 'movement' ? 'A posed 3D mannequin, new pose and camera angle every time.' : 'Mannequin poses and perspective scenes, mixed.';
    else if (n === 0) note = 'You have no images tagged for this subject yet, so generated ones fill in.';
    else note = (st.source === 'mine' ? 'Uses your ' : 'Mixes generated references with your ') + n + (n === 1 ? ' image.' : ' images.');
    $('#sourceNote').textContent = note;
    $('#startBtn').disabled = !gen && S.refs.length === 0;
    $('#startNote').textContent = AI.sample && AI.maxImages && !AI.off
      ? 'The coach runs only when you ask for feedback.'
      : 'When the time runs out, your drawing is laid over the reference.';
  }
  function renderHistory() {
    const list = $('#historyList');
    if (!S.history.length) { list.replaceChildren(el('li', { class: 'empty', text: 'Finished sessions show up here with their scores.' })); return; }
    list.replaceChildren(...S.history.slice(0, 8).map(h => el('li', null,
      el('span', { class: 'h-main', text: (MODES[h.mode] ? MODES[h.mode].name : 'Session') + ', ' + h.count + ' × ' + h.secs + ' s' }),
      el('span', { class: 'h-sub', text: [fmtDate(h.date), subjectLabel(h.subject), h.review && h.review.tomorrow ? 'Next: ' + h.review.tomorrow : ''].filter(Boolean).join(' · ') }),
      el('span', { class: 'h-score', title: 'Average coach score out of 5', text: typeof h.avg === 'number' ? h.avg.toFixed(1) : '' })
    )));
  }
  function renderHome() { renderStats(); renderFocus(); renderSetup(); renderRefs(); renderHistory(); }

  /* ---------- my references ---------- */
  function setRefStatus(msg, isErr) { const s = $('#refStatus'); s.textContent = msg || ''; s.classList.toggle('is-error', !!isErr); }
  const persistRefs = () => !!(Store.remote && Store.assets);
  function renderRefs() {
    const grid = $('#refGrid');
    const n = S.refs.length;
    $('#refCount').textContent = n ? n + (n === 1 ? ' image' : ' images') : '';
    if (!persistRefs() && !$('#refStatus').textContent) setRefStatus('Images added here last until you close this page.');
    grid.replaceChildren(...S.refs.map(r => {
      const sel = el('select', { 'aria-label': 'Tag for this reference', onchange: e => setRefCategory(r, e.target.value) },
        ...[['movement', 'Movement'], ['perspective', 'Perspective'], ['other', 'Other']].map(([v, l]) => { const o = el('option', { value: v, text: l }); o.selected = r.category === v; return o; }));
      return el('div', { class: 'ref-item' },
        el('img', { src: r.url, alt: 'Reference tagged ' + r.category, loading: 'lazy' }),
        sel,
        el('button', { class: 'del', type: 'button', 'aria-label': 'Remove this reference', html: ICON.close, onclick: () => removeRef(r) }));
    }));
  }
  async function normalizeImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k));
      const h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = mkCanvas(w, h);
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      const blob = await toBlob(c, 'image/jpeg', 0.88);
      return { blob, w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  function uploadError(e) {
    switch (e && e.code) {
      case 'too_large': return 'That image is too large to store.';
      case 'unsupported_type': return 'That file type is not supported. Use JPEG, PNG or WebP.';
      case 'quota_or_state': return 'Storage for this page is full. Remove some references first.';
      case 'rate_limited': return 'Too many uploads at once. Wait a moment and add the rest.';
      default: return 'Could not add that image. Try again.';
    }
  }
  async function handleFiles(files) {
    const cat = $('#uploadCat').value;
    const list = [...files].filter(f => /^image\//.test(f.type));
    if (!list.length) { setRefStatus('Those files are not images.', true); return; }
    let added = 0;
    for (const f of list) {
      setRefStatus('Adding ' + (added + 1) + ' of ' + list.length + '…');
      try {
        const { blob, w, h } = await normalizeImage(f);
        if (persistRefs()) {
          const up = await Store.assets.upload(blob, { type: 'image/jpeg' });
          const rec = { assetId: up.id, category: cat, w, h, addedAt: Date.now() };
          const docId = await queueWrite(() => Store.addRef(rec));
          S.refs.push(Object.assign({ docId, url: up.url || '/_blob/' + up.id }, rec));
        } else {
          S.refs.push({ key: 'local-' + Date.now() + '-' + added, local: true, category: cat, w, h, url: URL.createObjectURL(blob) });
        }
        added++;
        renderRefs();
      } catch (e) {
        setRefStatus(uploadError(e), true);
        renderSetup();
        return;
      }
    }
    setRefStatus(added === 1 ? 'Added 1 image.' : 'Added ' + added + ' images.');
    renderRefs();
    renderSetup();
  }
  async function setRefCategory(r, cat) {
    r.category = cat;
    renderSetup();
    if (r.docId && persistRefs()) {
      try { await queueWrite(() => Store.updateRef(r.docId, { category: cat })); } catch (e) { setRefStatus('Could not save the new tag. Try again.', true); }
    }
  }
  async function removeRef(r) {
    const ok = await confirmDialog('Remove this reference?', 'It will no longer appear in sessions. This cannot be undone.', 'Remove');
    if (!ok) return;
    try {
      if (r.docId && persistRefs()) {
        await queueWrite(() => Store.deleteRef(r.docId));
        try { await Store.assets.delete(r.assetId); } catch (e) { /* the row is gone; the file is orphaned but harmless */ }
      } else if (r.local) URL.revokeObjectURL(r.url);
      S.refs = S.refs.filter(x => x !== r);
      setRefStatus('Removed.');
      renderRefs();
      renderSetup();
    } catch (e) { setRefStatus('Could not remove it. Try again.', true); }
  }

  /* ---------- sketch canvas ---------- */
  class Sketch {
    constructor(canvas, preview) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.p = preview; this.pctx = preview.getContext('2d');
      this.strokes = []; this.cur = null; this.activeId = null; this.rect = null;
      this.locked = true; this.penSeen = false;
      this.mode = 'gesture'; this.tool = 'pen'; this.size = 5; this.value = 'dark';
      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      canvas.addEventListener('pointerup', e => this.up(e));
      canvas.addEventListener('pointercancel', e => this.up(e));
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    setup(w, h, mode) {
      this.c.width = this.p.width = w;
      this.c.height = this.p.height = h;
      this.strokes = []; this.cur = null; this.activeId = null;
      this.mode = mode;
      this.ctx.clearRect(0, 0, w, h);
      this.pctx.clearRect(0, 0, w, h);
    }
    lock(v) { if (v) this.finishStroke(); this.locked = v; }
    pt(e) {
      const r = this.rect || this.c.getBoundingClientRect();
      let pr = e.pressure;
      if (e.pointerType === 'mouse') pr = 0.7;
      else if (!pr) pr = 0.6;
      return { x: (e.clientX - r.left) * this.c.width / r.width, y: (e.clientY - r.top) * this.c.height / r.height, p: pr };
    }
    colorFor(t) {
      if (this.mode === 'values') return this.value === 'mid' ? MID : this.value === 'dark' ? DARK : '#000000';
      return t === 'lasso' ? SHAPE : INK;
    }
    isErase(t) { return t === 'cut' || (this.mode === 'values' && this.value === 'light'); }
    down(e) {
      if (this.locked) return;
      if (e.pointerType === 'pen') this.penSeen = true;
      if (e.pointerType === 'touch' && this.penSeen) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.activeId !== null) return;
      e.preventDefault();
      this.activeId = e.pointerId;
      this.rect = this.c.getBoundingClientRect();
      try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const t = this.tool;
      this.cur = { tool: t, size: this.size, color: this.colorFor(t), erase: this.isErase(t), pts: [this.pt(e)] };
      if (t === 'pen' || t === 'brush') this.drawSeg(this.ctx, this.cur, 0);
    }
    move(e) {
      if (!this.cur || e.pointerId !== this.activeId) return;
      e.preventDefault();
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (list.length ? list : [e])) {
        this.cur.pts.push(this.pt(ev));
        if (this.cur.tool === 'pen' || this.cur.tool === 'brush') this.drawSeg(this.ctx, this.cur, this.cur.pts.length - 1);
      }
      if (this.cur.tool === 'lasso' || this.cur.tool === 'cut') this.drawLassoPreview();
    }
    up(e) {
      if (!this.cur || (e && e.pointerId !== this.activeId)) return;
      this.commit();
    }
    finishStroke() { if (this.cur) this.commit(); }
    commit() {
      const st = this.cur;
      this.cur = null; this.activeId = null; this.rect = null;
      if (!st) return;
      if (st.tool === 'lasso' || st.tool === 'cut') {
        this.pctx.clearRect(0, 0, this.p.width, this.p.height);
        if (st.pts.length < 3) return;
        this.fillLasso(this.ctx, st);
      } else this.finishSeg(this.ctx, st);
      this.strokes.push(st);
    }
    width(st, p) {
      const pr = Math.pow(clamp(p, 0.05, 1), 0.9);
      return st.tool === 'pen' ? st.size * (0.35 + 0.85 * pr) : st.size * (0.6 + 0.45 * pr);
    }
    begin(ctx, st) {
      ctx.save();
      ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = st.color; ctx.fillStyle = st.color;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    }
    drawSeg(ctx, st, i) {
      const P = st.pts;
      this.begin(ctx, st);
      if (i === 0) {
        const p = P[0];
        ctx.beginPath(); ctx.arc(p.x, p.y, this.width(st, p.p) / 2, 0, Math.PI * 2); ctx.fill();
      } else if (i === 1) {
        const a = P[0], b = P[1], m = mid(a, b);
        ctx.lineWidth = this.width(st, (a.p + b.p) / 2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
      } else {
        const a = P[i - 2], b = P[i - 1], c = P[i];
        const m1 = mid(a, b), m2 = mid(b, c);
        ctx.lineWidth = this.width(st, b.p);
        ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y); ctx.stroke();
      }
      ctx.restore();
    }
    finishSeg(ctx, st) {
      const P = st.pts;
      if (P.length < 2) return;
      const a = P[P.length - 2], b = P[P.length - 1], m = mid(a, b);
      this.begin(ctx, st);
      ctx.lineWidth = this.width(st, b.p);
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
    path(ctx, P) { ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
    fillLasso(ctx, st) { this.begin(ctx, st); this.path(ctx, st.pts); ctx.fill(); ctx.restore(); }
    drawLassoPreview() {
      const g = this.pctx, st = this.cur;
      const k = this.c.width / (this.rect ? this.rect.width : this.c.width);
      g.clearRect(0, 0, this.p.width, this.p.height);
      g.save();
      this.path(g, st.pts);
      g.fillStyle = st.erase ? 'rgba(130, 187, 255, 0.25)' : (this.mode === 'values' ? (this.value === 'mid' ? 'rgba(154,157,163,0.55)' : 'rgba(58,61,68,0.5)') : 'rgba(51,54,61,0.45)');
      g.fill();
      g.setLineDash([8 * k, 6 * k]);
      g.lineWidth = 2 * k;
      g.strokeStyle = st.erase ? '#2f7de1' : '#ff5b3a';
      g.stroke();
      g.restore();
    }
    redraw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.c.width, this.c.height);
      for (const st of this.strokes) {
        if (st.tool === 'clear') { ctx.clearRect(0, 0, this.c.width, this.c.height); continue; }
        if (st.tool === 'lasso' || st.tool === 'cut') { this.fillLasso(ctx, st); continue; }
        for (let i = 0; i < st.pts.length; i++) this.drawSeg(ctx, st, i);
        this.finishSeg(ctx, st);
      }
    }
    undo() { if (this.cur || this.locked) return; this.strokes.pop(); this.redraw(); }
    clear() { if (this.cur || this.locked || !this.strokes.length) return; this.strokes.push({ tool: 'clear' }); this.redraw(); }
    isEmpty() {
      for (let i = this.strokes.length - 1; i >= 0; i--) {
        if (this.strokes[i].tool === 'clear') return true;
        if (!this.strokes[i].erase) return false;
      }
      return true;
    }
    snapshot() { const c = mkCanvas(this.c.width, this.c.height); c.getContext('2d').drawImage(this.c, 0, 0); return c; }
  }

  const sketch = new Sketch($('#sketch'), $('#preview'));
  const stage = $('#stage'), refPane = $('#refPane'), canvasPane = $('#canvasPane'), refImgEl = $('#refImg');
  const readyEl = $('#ready'), timerEl = $('#timer'), timebarFill = $('#timebarFill'), toolbar = $('#toolbar');

  /* ---------- timer ---------- */
  const Timer = {
    raf: 0, end: 0, dur: 0, left: 0, tick: null, done: null, paused: false,
    start(dur, tick, done) { this.stop(); this.dur = dur; this.left = dur; this.end = performance.now() + dur; this.tick = tick; this.done = done; this.loop(); },
    loop() {
      const f = now => {
        const left = Math.max(0, this.end - now);
        this.left = left;
        if (this.tick) this.tick(left, this.dur);
        if (left <= 0) { this.raf = 0; const d = this.done; this.done = null; if (d) d(); return; }
        this.raf = requestAnimationFrame(f);
      };
      this.raf = requestAnimationFrame(f);
    },
    pause() { if (!this.raf) return; cancelAnimationFrame(this.raf); this.raf = 0; this.paused = true; },
    resume() { if (!this.paused) return; this.paused = false; this.end = performance.now() + this.left; this.loop(); },
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.paused = false; this.done = null; },
  };
  function setTimerDisplay(left, dur) {
    const s = Math.ceil(left / 1000);
    timerEl.textContent = s >= 60 ? Math.floor(s / 60) + ':' + pad2(s % 60) : String(s);
    timerEl.classList.toggle('is-low', left > 0 && left <= Math.min(5000, dur * 0.3));
    timebarFill.style.transform = 'scaleX(' + (dur ? left / dur : 0) + ')';
  }

  /* ---------- screens ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('is-active', s.id === id));
    if (id === 'draw') requestAnimationFrame(layoutStage);
    if (id === 'review') requestAnimationFrame(renderReviewCanvas);
    if (id === 'home' || id === 'summary') { const s = $('#' + id); s.scrollTop = 0; }
  }
  function layoutStage() {
    const ss = S.session;
    const r = ss && ss.cur;
    if (!r) return;
    const aspect = r.cw / r.ch;
    const box = stage.getBoundingClientRect();
    const padX = 32, gap = 16;
    const W = box.width - padX, H = box.height - padX;
    if (W <= 0 || H <= 0) return;
    const fit = (w, h) => { let fw = w, fh = w / aspect; if (fh > h) { fh = h; fw = h * aspect; } return [Math.floor(fw), Math.floor(fh)]; };
    const side = fit((W - gap) / 2, H);
    const col = fit(W, (H - gap) / 2);
    const useCol = col[0] * col[1] > side[0] * side[1] * 1.05;
    stage.classList.toggle('is-col', useCol);
    const [w, h] = useCol ? col : side;
    for (const p of [refPane, canvasPane]) { p.style.width = w + 'px'; p.style.height = h + 'px'; }
    updateSizeDot();
  }

  /* ---------- toolbar ---------- */
  function toolState(mode) {
    if (!S.toolState[mode]) { const M = MODES[mode]; S.toolState[mode] = { tool: M.tool, size: M.size[2], value: 'dark' }; }
    return S.toolState[mode];
  }
  function setupToolbar(mode) {
    const M = MODES[mode];
    const ts = toolState(mode);
    const parts = [];
    parts.push(el('div', { class: 'tool-group', role: 'group', 'aria-label': 'Tools' }, M.tools.map(t => el('button', {
      type: 'button', class: 'tool', 'data-tool': t, 'aria-pressed': 'false', title: TOOLS[t].label + ' (' + TOOLS[t].key.toUpperCase() + ')',
      html: ICON[t] + '<span>' + TOOLS[t].label + '</span>', onclick: () => setTool(t),
    }))));
    if (M.swatches) {
      parts.push(el('div', { class: 'tool-group', role: 'group', 'aria-label': 'Value', style: 'padding-bottom:14px' }, VALUES.map(v => el('button', {
        type: 'button', class: 'swatch', 'data-value': v.id, style: 'background:' + v.color, 'aria-pressed': 'false',
        'aria-label': v.label + ' value (' + v.key + ')', title: v.label + ' (' + v.key + ')', onclick: () => setValue(v.id),
      }, el('span', { text: v.label })))));
    }
    const range = el('input', { type: 'range', id: 'sizeRange', min: M.size[0], max: M.size[1], value: ts.size, oninput: e => { toolState(mode).size = sketch.size = Number(e.target.value); updateSizeDot(); } });
    parts.push(el('label', { class: 'size-ctl', for: 'sizeRange', id: 'sizeCtl' }, mode === 'values' ? 'Brush' : 'Pen', range, el('span', { class: 'size-dot' }, el('i', { id: 'sizeDot' }))));
    parts.push(el('div', { class: 'tool-group' },
      el('button', { type: 'button', class: 'tool', title: 'Undo (Ctrl+Z)', html: ICON.undo + '<span>Undo</span>', onclick: () => sketch.undo() }),
      el('button', { type: 'button', class: 'tool', title: 'Clear the canvas', html: ICON.clear + '<span>Clear</span>', onclick: () => sketch.clear() })));
    toolbar.replaceChildren(...parts);
    applyToolState(mode);
  }
  function applyToolState(mode) {
    const ts = toolState(mode);
    sketch.tool = ts.tool; sketch.size = ts.size; sketch.value = ts.value;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === ts.tool)));
    toolbar.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === ts.value)));
    const sc = $('#sizeCtl');
    if (sc) sc.style.opacity = (ts.tool === 'pen' || ts.tool === 'brush') ? '1' : '0.45';
    updateSizeDot();
  }
  function setTool(t) { const ss = S.session; if (!ss) return; toolState(ss.mode).tool = t; applyToolState(ss.mode); }
  function setValue(v) { const ss = S.session; if (!ss) return; toolState(ss.mode).value = v; applyToolState(ss.mode); }
  function changeSize(dir) {
    const ss = S.session; if (!ss) return;
    const M = MODES[ss.mode], ts = toolState(ss.mode);
    const step = Math.max(1, Math.round((M.size[1] - M.size[0]) / 12));
    ts.size = clamp(ts.size + dir * step, M.size[0], M.size[1]);
    const r = $('#sizeRange'); if (r) r.value = ts.size;
    sketch.size = ts.size; updateSizeDot();
  }
  function updateSizeDot() {
    const d = $('#sizeDot');
    if (!d || !sketch.c.width) return;
    const k = (canvasPane.getBoundingClientRect().width || sketch.c.width) / sketch.c.width;
    const px = clamp(sketch.size * k, 2, 30);
    d.style.width = d.style.height = px + 'px';
  }

  /* ---------- session flow ---------- */
  function cleanupSession(ss) {
    if (!ss) return;
    for (const r of ss.rounds) {
      if (r && r.ctl) r.ctl.abort();
      if (r && r.ref && r.ref.objectUrl && !r.ref.revoked) { URL.revokeObjectURL(r.ref.url); r.ref.revoked = true; }
    }
    if (ss.reviewCtl) ss.reviewCtl.abort();
  }
  function startSession() {
    const st = S.settings;
    if (S.session) cleanupSession(S.session);
    const gen = canGenerate();
    S.session = {
      id: Date.now(), mode: st.mode, secs: st.secs[st.mode], subject: st.subject,
      source: gen ? st.source : 'mine', total: st.rounds, reviewEach: !!st.reviewEach,
      rounds: [], idx: -1, focus: S.profile.focus || '', repeatRef: null, saved: false, bags: {}, ended: false,
    };
    setupToolbar(st.mode);
    show('draw');
    nextRound();
  }
  function userPool(subject) { return S.refs.filter(r => subject === 'mixed' || r.category === subject); }
  function takeMine(ss, subject) {
    let bag = ss.bags[subject];
    if (!bag || !bag.length) {
      const pool = userPool(subject);
      if (!pool.length) return null;
      bag = ss.bags[subject] = shuffle(pool.slice());
    }
    const r = bag.pop();
    const tag = r.category === 'other' ? 'untagged' : r.category;
    return { source: 'mine', url: r.url, w: r.w, h: r.h, label: 'Your own reference image (' + tag + ')' };
  }
  async function pickRef(ss) {
    const subj = ss.subject === 'mixed' ? (Math.random() < 0.5 ? 'movement' : 'perspective') : ss.subject;
    const gen = canGenerate();
    const wantMine = ss.source === 'mine' || (ss.source === 'both' && Math.random() < 0.5) || !gen;
    if (wantMine) {
      const r = takeMine(ss, ss.subject);
      if (r) return r;
      if (!gen) { const any = takeMine(ss, 'mixed'); if (any) return any; throw new Error('no-refs'); }
    }
    const seed = (Math.random() * 4294967296) >>> 0;
    const g = await window.QSRefs.generate(subj, seed);
    return { source: 'generated', url: g.url, w: g.w, h: g.h, label: 'Generated ' + g.label.charAt(0).toLowerCase() + g.label.slice(1), objectUrl: true };
  }
  function showReady(ss, round, loading) {
    $('#readyRound').textContent = 'Drawing ' + (ss.idx + 1) + ' of ' + ss.total;
    $('#readyMode').textContent = MODES[ss.mode].name + ', ' + ss.secs + ' s';
    const focus = (round && round.focus) || ss.focus;
    $('#readyFocus').replaceChildren(...(focus ? [el('b', { text: 'Focus: ' }), focus] : [MODES[ss.mode].tip]));
    $('#readyCount').textContent = '';
    $('#readyHint').textContent = loading ? 'Preparing the reference…' : 'Tap to start now';
    readyEl.hidden = false;
  }
  function countdown(ss) {
    return new Promise(resolve => {
      let n = 3, t = 0;
      const done = () => {
        clearTimeout(t);
        readyEl.removeEventListener('click', done);
        readyEl.hidden = true;
        resolve();
      };
      const tick = () => {
        if (S.session !== ss || ss.ended) { readyEl.removeEventListener('click', done); resolve(); return; }
        if (n <= 0) { done(); return; }
        $('#readyCount').textContent = n;
        n--;
        t = setTimeout(tick, 800);
      };
      readyEl.addEventListener('click', done);
      tick();
    });
  }
  async function nextRound() {
    const ss = S.session;
    if (!ss || ss.ended) return;
    ss.idx++;
    if (ss.idx >= ss.total) { finishSession(); return; }
    show('draw');
    $('#drawMode').textContent = MODES[ss.mode].name;
    $('#drawRound').textContent = 'Drawing ' + (ss.idx + 1) + ' of ' + ss.total;
    setTimerDisplay(ss.secs * 1000, ss.secs * 1000);
    sketch.lock(true);
    canvasPane.classList.add('is-locked');
    showReady(ss, null, true);
    let ref, img;
    try {
      ref = ss.repeatRef || await pickRef(ss);
      img = await loadImg(ref.url);
    } catch (e) {
      toast(e && e.message === 'no-refs' ? 'Add some references first.' : 'Could not prepare a reference. Try again.');
      if (ss.rounds.some(r => r && r.drawing)) finishSession(); else { S.session = null; show('home'); renderHome(); }
      return;
    }
    ss.repeatRef = null;
    if (S.session !== ss || ss.ended) return;
    const L = 1000;
    const cw = ref.w >= ref.h ? L : Math.round(L * ref.w / ref.h);
    const ch = ref.w >= ref.h ? Math.round(L * ref.h / ref.w) : L;
    const round = { n: ss.idx + 1, mode: ss.mode, secs: ss.secs, ref, refImg: img, cw, ch, drawing: null, tinted: null, align: { dx: 0, dy: 0, s: 1 }, feedback: null, focus: ss.focus, used: 0, empty: true };
    ss.rounds[ss.idx] = round;
    ss.cur = round;
    refImgEl.src = ref.url;
    refImgEl.alt = 'Reference: ' + ref.label;
    sketch.setup(cw, ch, ss.mode);
    applyToolState(ss.mode);
    layoutStage();
    showReady(ss, round, false);
    await countdown(ss);
    if (S.session !== ss || ss.ended) return;
    beginDrawing(ss, round);
  }
  function beginDrawing(ss, round) {
    sketch.lock(false);
    canvasPane.classList.remove('is-locked');
    round.startedAt = performance.now();
    Timer.start(ss.secs * 1000, setTimerDisplay, () => endRound(ss, round));
  }
  function endRound(ss, round) {
    if (S.session !== ss || !round || round.drawing) return;
    Timer.stop();
    sketch.lock(true);
    canvasPane.classList.add('is-locked');
    round.drawing = sketch.snapshot();
    round.empty = sketch.isEmpty();
    round.used = Math.min(ss.secs, (performance.now() - (round.startedAt || performance.now())) / 1000);
    if (ss.reviewEach) openReview(round, 'session');
    else {
      timerEl.textContent = 'Time';
      setTimeout(() => { if (S.session === ss && !ss.ended) nextRound(); }, 650);
    }
  }
  async function quitPrompt() {
    const ss = S.session;
    if (!ss) { show('home'); return; }
    const drawing = $('#draw').classList.contains('is-active') && ss.cur && !ss.cur.drawing && readyEl.hidden;
    if (drawing) { Timer.pause(); sketch.lock(true); }
    const done = ss.rounds.filter(r => r && r.drawing).length;
    const ok = await confirmDialog('End this session?', done ? 'Your ' + done + (done === 1 ? ' finished drawing is' : ' finished drawings are') + ' kept. The one in progress is dropped.' : 'Nothing has been finished yet, so nothing will be saved.', 'End session');
    if (!ok) {
      if (drawing && S.session === ss) { sketch.lock(false); Timer.resume(); }
      return;
    }
    Timer.stop();
    if (ss.cur && !ss.cur.drawing) ss.rounds[ss.idx] = null;
    ss.endedEarly = true;
    if (done) finishSession();
    else { ss.ended = true; cleanupSession(ss); S.session = null; readyEl.hidden = true; show('home'); renderHome(); }
  }

  /* ---------- review ---------- */
  const rc = $('#reviewCanvas'), viewerBox = $('#viewerBox');
  const OVERLAY_OPTS = { view: 'overlay', tint: 'red', opacity: 0.95, fade: false };
  function tinted(r) {
    if (r.tinted) return r.tinted;
    const w = r.drawing.width, h = r.drawing.height;
    const c = mkCanvas(w, h);
    const g = c.getContext('2d');
    g.drawImage(r.drawing, 0, 0);
    const id = g.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (!a) continue;
      const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = RED[0]; d[i + 1] = RED[1]; d[i + 2] = RED[2];
      d[i + 3] = a * (1 - L * 0.62);
    }
    g.putImageData(id, 0, 0);
    r.tinted = c;
    return c;
  }
  function compose(ctx, r, o, layout, gap) {
    const cw = r.cw, ch = r.ch;
    ctx.save();
    if (layout) {
      const W = layout === 'h' ? cw * 2 + gap : cw, H = layout === 'h' ? ch : ch * 2 + gap;
      ctx.fillStyle = '#1c1f24'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(r.refImg, 0, 0, cw, ch);
      const x = layout === 'h' ? cw + gap : 0, y = layout === 'h' ? 0 : ch + gap;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, cw, ch);
      ctx.drawImage(r.drawing, x, y);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = o.fade ? 0.4 : 1;
      ctx.drawImage(r.refImg, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
      const a = r.align;
      ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.clip();
      ctx.translate(cw / 2 + a.dx, ch / 2 + a.dy);
      ctx.scale(a.s, a.s);
      ctx.translate(-cw / 2, -ch / 2);
      ctx.globalAlpha = o.opacity;
      ctx.drawImage(o.tint === 'red' ? tinted(r) : r.drawing, 0, 0);
    }
    ctx.restore();
  }
  function renderReviewCanvas() {
    const v = S.view;
    if (!v || !$('#review').classList.contains('is-active')) return;
    const r = v.round, o = v.o;
    const box = viewerBox.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    let W = r.cw, H = r.ch, layout = null;
    const gap = Math.round(r.cw * 0.03);
    if (o.view === 'side') {
      const sc = d => Math.min(box.width / d[0], box.height / d[1]);
      const horiz = [r.cw * 2 + gap, r.ch], vert = [r.cw, r.ch * 2 + gap];
      layout = sc(horiz) >= sc(vert) ? 'h' : 'v';
      [W, H] = layout === 'h' ? horiz : vert;
    }
    v.layout = layout; v.gap = gap;
    rc.width = W; rc.height = H;
    const scale = Math.min(box.width / W, box.height / H);
    rc.style.width = Math.floor(W * scale) + 'px';
    rc.style.height = Math.floor(H * scale) + 'px';
    rc.classList.toggle('is-draggable', o.view === 'overlay');
    compose(rc.getContext('2d'), r, o, layout, gap);
  }
  function recompose() {
    const v = S.view; if (!v) return;
    const g = rc.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    compose(g, v.round, v.o, v.layout, v.gap);
  }
  let drag = null;
  rc.addEventListener('pointerdown', e => {
    const v = S.view;
    if (!v || v.o.view !== 'overlay') return;
    e.preventDefault();
    const a = v.round.align;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: a.dx, dy: a.dy, k: rc.width / rc.getBoundingClientRect().width };
    try { rc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  rc.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = S.view.round.align;
    a.dx = drag.dx + (e.clientX - drag.x) * drag.k;
    a.dy = drag.dy + (e.clientY - drag.y) * drag.k;
    recompose();
  });
  const endDrag = () => { drag = null; };
  rc.addEventListener('pointerup', endDrag);
  rc.addEventListener('pointercancel', endDrag);

  function renderViewControls() {
    const v = S.view, o = v.o;
    seg($('#segView'), [['overlay', 'Overlay'], ['side', 'Side by side']], o.view, x => { o.view = x; renderViewControls(); renderReviewCanvas(); });
    seg($('#segTint'), [['red', 'Red'], ['drawn', 'As drawn']], o.tint, x => { o.tint = x; renderViewControls(); recompose(); });
    const overlayOnly = o.view === 'overlay';
    for (const id of ['segTint', 'opacity', 'fadeRef', 'alignScale', 'alignReset']) {
      const n = $('#' + id);
      const wrap = n.closest('.ctl') || n;
      wrap.style.display = overlayOnly ? '' : 'none';
    }
    $('#alignHint').style.display = overlayOnly ? '' : 'none';
    $('#opacity').value = Math.round(o.opacity * 100);
    $('#fadeRef').checked = o.fade;
    $('#alignScale').value = Math.round(v.round.align.s * 100);
  }
  $('#opacity').addEventListener('input', e => { if (S.view) { S.view.o.opacity = Number(e.target.value) / 100; recompose(); } });
  $('#fadeRef').addEventListener('change', e => { if (S.view) { S.view.o.fade = e.target.checked; recompose(); } });
  $('#alignScale').addEventListener('input', e => { if (S.view) { S.view.round.align.s = Number(e.target.value) / 100; recompose(); } });
  $('#alignReset').addEventListener('click', () => { if (!S.view) return; S.view.round.align = { dx: 0, dy: 0, s: 1 }; $('#alignScale').value = 100; recompose(); });

  function openReview(round, from) {
    const prev = S.view && S.view.o;
    S.view = { round, from, o: prev ? Object.assign({}, prev) : Object.assign({}, OVERLAY_OPTS, { opacity: 0.9 }) };
    const ss = S.session;
    $('#reviewTitle').textContent = round.empty ? 'Nothing drawn' : from === 'summary' ? 'Drawing ' + round.n : "Time's up";
    $('#reviewSub').textContent = MODES[round.mode].name + ' · ' + round.ref.label;
    const last = ss && ss.idx + 1 >= ss.total;
    $('#nextBtn').textContent = from === 'summary' ? 'Back to results' : last ? 'See results' : 'Next drawing';
    $('#reviewQuit').hidden = from === 'summary';
    renderViewControls();
    show('review');
    renderCoach(round);
    if (from === 'session' && S.settings.autoFeedback && aiReady() && !round.empty && !round.feedback && !round.fbPending) requestFeedback(round);
  }
  $('#nextBtn').addEventListener('click', () => {
    const v = S.view;
    if (v && v.round.ctl && v.from === 'session') { /* let a running request finish in the background */ }
    if (v && v.from === 'summary') { show('summary'); renderSummary(); return; }
    nextRound();
  });

  /* ---------- coach ---------- */
  const aiReady = () => !!(AI.sample && AI.maxImages > 0 && !AI.off);
  function aiError(e) {
    switch (e && e.code) {
      case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed': case 'images_unavailable':
        return { hide: true, text: 'Coach feedback is turned off for this page.' };
      case 'rate_limited': return { text: 'Too many requests right now. Wait a minute, then try again.' };
      case 'session_expired': return { text: 'Your session expired. Sign in again, then try again.' };
      case 'invalid_json': case 'empty_completion': return { text: 'The coach sent an answer that could not be read. Try again.' };
      case 'refused': return { text: 'The coach could not review this one.' };
      case 'image_rejected': return { text: 'The images could not be sent. Try again.' };
      case 'cancelled': return { text: '' };
      default: return { text: 'Feedback did not load. Try again.' };
    }
  }
  function describeImages(names) {
    const desc = {
      reference: 'the reference',
      study: 'the study, drawn from scratch on a blank canvas with the same proportions as the reference',
      overlay: 'the study in red laid on top of the reference. The artist may have drawn at a different size or position, so judge angles, proportions, shapes and rhythm rather than exact placement',
    };
    return names.map((n, i) => 'Image ' + (i + 1) + ' is ' + desc[n] + '.').join(' ');
  }
  async function feedbackImages(r) {
    const ref = mkCanvas(r.cw, r.ch);
    ref.getContext('2d').drawImage(r.refImg, 0, 0, r.cw, r.ch);
    const study = mkCanvas(r.cw, r.ch);
    const g = study.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, r.cw, r.ch); g.drawImage(r.drawing, 0, 0);
    const ov = mkCanvas(r.cw, r.ch);
    compose(ov.getContext('2d'), r, OVERLAY_OPTS, null, 0);
    const all = [['reference', ref], ['study', study], ['overlay', ov]];
    const chosen = AI.maxImages >= 3 ? all : AI.maxImages === 2 ? [all[0], all[2]] : [all[2]];
    const blobs = await Promise.all(chosen.map(c => toBlob(c[1], 'image/jpeg', 0.86)));
    return { blobs, names: chosen.map(c => c[0]) };
  }
  function roundPrompt(r, names) {
    const M = MODES[r.mode];
    const example = '{"score": 3, "scores": {' + M.criteria.map(c => '"' + c + '": 3').join(', ') + '}, "worked": "one sentence", "fix": "the single most important fix, one or two sentences", "drill": "one short exercise for the next drawing, one sentence", "nextFocus": "under 10 words, imperative"}';
    return [
      'You are a drawing coach. A digital artist who wants to draw characters and concept art is doing timed practice studies.',
      'Mode: ' + M.name + '. Time limit: ' + r.secs + ' seconds (they used about ' + Math.max(1, Math.round(r.used)) + '). Tools allowed: ' + M.toolsLabel.toLowerCase() + '. This mode trains: ' + M.trains.toLowerCase(),
      'Reference: ' + r.ref.label + '.',
      describeImages(names),
      'Judge only what this mode trains. A ' + r.secs + '-second study should be simple: never ask for detail, rendering, hands, faces or finish.',
      M.judge,
      r.focus ? 'Before this drawing the artist was working on: "' + r.focus + '". Mention whether that showed up.' : '',
      'Talk to the artist as "you". Point to specific places in the image (for example "the torso", "the gap under the left arm", "the shadow side of the box").',
      'Reply with only JSON in this shape: ' + example,
      'Scores are integers from 1 (missed it) to 5 (nailed it for a study this short). Criteria: ' + M.criteria.join(', ') + '.',
    ].filter(Boolean).join('\n');
  }
  function cleanFeedback(fb, M) {
    if (!fb || typeof fb !== 'object') throw { code: 'invalid_json' };
    const num = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null; };
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 600) : '');
    const scores = {};
    if (fb.scores && typeof fb.scores === 'object') for (const c of M.criteria) { const n = num(fb.scores[c]); if (n) scores[c] = n; }
    const out = { score: num(fb.score), scores, worked: str(fb.worked), fix: str(fb.fix), drill: str(fb.drill), nextFocus: str(fb.nextFocus, 120) };
    if (!out.score && !out.fix) throw { code: 'invalid_json' };
    return out;
  }
  async function requestFeedback(round) {
    if (!aiReady() || round.fbPending || round.empty) return;
    round.fbPending = true;
    round.fbError = '';
    round.ctl = new AbortController();
    refreshCoach(round);
    try {
      const imgs = await feedbackImages(round);
      const fb = await AI.sample.json(roundPrompt(round, imgs.names), { images: imgs.blobs, modelTier: 'default', signal: round.ctl.signal });
      round.feedback = cleanFeedback(fb, MODES[round.mode]);
      const ss = S.session;
      if (ss && ss.rounds.includes(round) && round.feedback.nextFocus) ss.focus = round.feedback.nextFocus;
      if (ss && ss.saved && ss.rounds.includes(round)) persistSession(ss);
    } catch (e) {
      const t = aiError(e);
      if (t.hide) AI.off = true;
      round.fbError = t.text;
    } finally {
      round.fbPending = false;
      round.ctl = null;
      refreshCoach(round);
      if ($('#summary').classList.contains('is-active')) renderSummary();
    }
  }
  function refreshCoach(round) { if (S.view && S.view.round === round && $('#review').classList.contains('is-active')) renderCoach(round); }
  function renderCoach(r) {
    const box = $('#coach');
    const M = MODES[r.mode];
    const kids = [el('h2', { text: 'Coach' })];
    const from = S.view && S.view.from;
    if (r.empty) {
      kids.push(el('p', { text: 'The canvas was empty when time ran out. Next time, put down one big line in the first two seconds, even if it is rough.' }));
    } else if (r.feedback) {
      const f = r.feedback;
      if (f.score) kids.push(el('div', { class: 'score-row' }, el('div', { class: 'score-big' }, String(f.score), el('small', { text: '/5' })),
        el('div', { class: 'crit' }, ...M.criteria.filter(c => f.scores[c]).map(c => el('span', { class: f.scores[c] <= 2 ? 'lo' : null }, c, el('b', { text: f.scores[c] }))))));
      if (f.worked) kids.push(el('div', { class: 'fb-block' }, el('h3', { text: 'What worked' }), el('p', { text: f.worked })));
      if (f.fix) kids.push(el('div', { class: 'fb-block fix' }, el('h3', { text: 'Fix next' }), el('p', { text: f.fix })));
      if (f.drill) kids.push(el('div', { class: 'fb-block' }, el('h3', { text: 'Try this' }), el('p', { text: f.drill })));
      if (f.nextFocus && from === 'session') kids.push(el('div', { class: 'fb-block fb-next' }, el('h3', { text: 'Focus for the next drawing' }), el('p', { text: f.nextFocus })));
    } else if (r.fbPending) {
      kids.push(el('div', { class: 'thinking' }, el('i'), 'Looking at your drawing…'));
      kids.push(el('p', { class: 'coach-note', text: 'This usually takes 10 to 40 seconds. You can keep comparing while you wait.' }));
      kids.push(el('div', null, el('button', { class: 'btn', type: 'button', text: 'Stop', onclick: () => { if (r.ctl) r.ctl.abort(); } })));
    } else if (aiReady()) {
      if (r.fbError) kids.push(el('p', { class: 'status is-error', text: r.fbError }));
      kids.push(el('p', { text: 'Compare first: where does your drawing drift from the red overlay? Then ask the coach.' }));
      kids.push(el('div', null, el('button', { class: 'btn btn-primary', type: 'button', text: r.fbError ? 'Try again' : 'Get feedback', onclick: () => requestFeedback(r) })));
      kids.push(el('p', { class: 'coach-note', text: 'Sends the reference, your drawing and the overlay to the coach.' }));
    } else {
      if (r.fbError) kids.push(el('p', { class: 'status is-error', text: r.fbError }));
      kids.push(el('p', { text: 'Check it yourself against the overlay:' }));
      kids.push(el('ul', { style: 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px' }, ...M.selfCheck.map(q => el('li', { text: q }))));
    }
    if (aiReady() && from === 'session') {
      const cb = el('input', { type: 'checkbox', id: 'autoFb', onchange: e => { S.settings.autoFeedback = e.target.checked; saveSettings(); if (e.target.checked && !r.feedback && !r.fbPending && !r.empty) requestFeedback(r); } });
      cb.checked = !!S.settings.autoFeedback;
      kids.push(el('label', { class: 'toggle', for: 'autoFb' }, cb, el('span', { text: 'Ask the coach after every drawing' })));
    }
    const actions = el('div', { class: 'coach-actions' });
    if (from === 'session' && S.session && !S.session.ended) actions.append(el('button', { class: 'btn', type: 'button', text: 'Draw this one again', onclick: drawAgain }));
    if (actions.childNodes.length) kids.push(actions);
    box.replaceChildren(...kids);
  }
  function drawAgain() {
    const ss = S.session, v = S.view;
    if (!ss || !v) return;
    ss.repeatRef = v.round.ref;
    ss.total += 1;
    nextRound();
  }

  /* ---------- summary ---------- */
  function doneRounds(ss) { return ss.rounds.filter(r => r && r.drawing); }
  function sessionRecord(ss) {
    const done = doneRounds(ss);
    const sc = done.map(r => r.feedback && r.feedback.score).filter(Boolean);
    return {
      id: ss.id, date: todayKey(new Date(ss.id)), mode: ss.mode, secs: ss.secs, subject: ss.subject, count: done.length,
      avg: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10 : null,
      notes: done.filter(r => r.feedback).slice(0, 20).map(r => ({ n: r.n, score: r.feedback.score, fix: (r.feedback.fix || '').slice(0, 240) })),
      review: ss.review || null,
    };
  }
  function persistSession(ss) {
    ss.record = sessionRecord(ss);
    S.history = [ss.record].concat(S.history.filter(h => h.id !== ss.id)).slice(0, 12);
    return queueWrite(() => Store.saveSession(ss.record)).catch(() => toast('Could not save this session. It is still on screen.'));
  }
  function finishSession() {
    const ss = S.session;
    if (!ss) return;
    Timer.stop();
    ss.ended = true;
    readyEl.hidden = true;
    const done = doneRounds(ss);
    if (!done.length) { cleanupSession(ss); S.session = null; show('home'); renderHome(); return; }
    if (!ss.saved) {
      ss.saved = true;
      const day = todayKey();
      S.profile.days[day] = (S.profile.days[day] || 0) + done.length;
      S.profile.total = (S.profile.total || 0) + done.length;
      persistSession(ss);
      queueWrite(() => Store.saveProfile(S.profile)).catch(() => {});
    }
    show('summary');
    renderSummary();
  }
  function thumbCanvas(r) {
    const W = 360, k = W / r.cw;
    const c = mkCanvas(W, Math.round(r.ch * k));
    const g = c.getContext('2d');
    g.scale(k, k);
    compose(g, r, OVERLAY_OPTS, null, 0);
    return c;
  }
  function renderSummary() {
    const ss = S.session;
    if (!ss) return;
    const done = doneRounds(ss);
    const M = MODES[ss.mode];
    const sc = done.map(r => r.feedback && r.feedback.score).filter(Boolean);
    $('#sumTitle').textContent = ss.endedEarly ? 'Session ended' : 'Session done';
    $('#sumSub').textContent = done.length + ' ' + M.name.toLowerCase() + (done.length === 1 ? ' drawing' : ' drawings') + ', ' + ss.secs + ' s each, ' + subjectLabel(ss.subject).toLowerCase() + (sc.length ? '. Average coach score ' + (Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10).toFixed(1) + ' out of 5.' : '.');
    $('#thumbs').replaceChildren(...done.map(r => el('button', { class: 'thumb', type: 'button', 'aria-label': 'Open drawing ' + r.n, onclick: () => openReview(r, 'summary') },
      thumbCanvas(r),
      el('span', { class: 't-cap' }, el('span', null, 'Drawing ' + r.n), r.feedback && r.feedback.score ? el('b', { text: r.feedback.score + '/5' }) : el('span', { text: r.empty ? 'empty' : r.fbPending ? 'reviewing…' : 'no feedback' })))));
    renderSessionReview();
  }
  function renderSessionReview() {
    const ss = S.session;
    const box = $('#sessionReview');
    const kids = [el('h2', { text: 'Session review' })];
    if (ss.review) {
      const v = ss.review;
      if (v.summary) kids.push(el('p', { text: v.summary }));
      if (v.strength) kids.push(el('div', { class: 'fb-block' }, el('h3', { text: 'Strength' }), el('p', { text: v.strength })));
      if (v.pattern) kids.push(el('div', { class: 'fb-block fix' }, el('h3', { text: 'Keeps coming up' }), el('p', { text: v.pattern })));
      if (v.tomorrow) kids.push(el('div', { class: 'fb-block fb-next' }, el('h3', { text: 'Focus for your next session' + (v.suggestMode ? ' (' + MODES[v.suggestMode].name + ' mode)' : '') }), el('p', { text: v.tomorrow })));
      kids.push(el('p', { class: 'coach-note', text: 'This focus now shows on the start screen.' }));
    } else if (ss.reviewPending) {
      kids.push(el('div', { class: 'thinking' }, el('i'), 'Reviewing the whole session…'));
      kids.push(el('div', null, el('button', { class: 'btn', type: 'button', text: 'Stop', onclick: () => { if (ss.reviewCtl) ss.reviewCtl.abort(); } })));
    } else if (aiReady()) {
      if (ss.reviewError) kids.push(el('p', { class: 'status is-error', text: ss.reviewError }));
      kids.push(el('p', { text: 'Get the pattern across all your drawings and one focus for next time. Open any drawing below to compare it or get feedback on it.' }));
      kids.push(el('div', null, el('button', { class: 'btn btn-primary', type: 'button', text: ss.reviewError ? 'Try again' : 'Review my session', onclick: requestSessionReview })));
    } else {
      kids.push(el('p', { text: 'Open any drawing below to compare it with its reference.' }));
    }
    box.replaceChildren(...kids);
  }
  function evenly(n, k) {
    if (k <= 0) return [];
    if (n <= k) return [...Array(n).keys()];
    return [...Array(k).keys()].map(i => Math.round(i * (n - 1) / (k - 1 || 1)));
  }
  async function requestSessionReview() {
    const ss = S.session;
    if (!ss || !aiReady() || ss.reviewPending) return;
    ss.reviewPending = true;
    ss.reviewError = '';
    ss.reviewCtl = new AbortController();
    renderSessionReview();
    try {
      const done = doneRounds(ss);
      const M = MODES[ss.mode];
      const picks = evenly(done.length, Math.min(AI.maxImages, 6));
      const blobs = await Promise.all(picks.map(i => { const r = done[i]; const c = mkCanvas(r.cw, r.ch); compose(c.getContext('2d'), r, OVERLAY_OPTS, null, 0); return toBlob(c, 'image/jpeg', 0.82); }));
      const notes = done.map(r => ({ drawing: r.n, reference: r.ref.label, secondsUsed: Math.round(r.used), empty: r.empty, score: r.feedback ? r.feedback.score : null, worked: r.feedback ? r.feedback.worked : null, fix: r.feedback ? r.feedback.fix : null }));
      const prompt = [
        'You are a drawing coach. A digital artist who wants to draw characters and concept art just finished a timed practice session.',
        'Session: ' + done.length + ' ' + M.name + ' studies, ' + ss.secs + ' seconds each, subject: ' + subjectLabel(ss.subject).toLowerCase() + '. This mode trains: ' + M.trains.toLowerCase(),
        'Notes per drawing (null where no feedback was asked for): ' + JSON.stringify(notes),
        blobs.length ? 'The ' + blobs.length + ' images show studies in red on top of their references, for drawings ' + picks.map(i => done[i].n).join(', ') + ', in that order. The artist may have drawn at a different size or position.' : '',
        'Write a short review of the whole session. Reply with only JSON in this shape: {"summary": "two sentences on how the session went", "strength": "one sentence", "pattern": "the issue that repeated most, one sentence", "tomorrow": "one goal for the next session, under 12 words, imperative", "suggestMode": "gesture"}',
        'suggestMode must be "gesture", "shapes" or "values": whichever mode would help most next.',
      ].filter(Boolean).join('\n');
      const opts = { modelTier: 'default', signal: ss.reviewCtl.signal };
      if (blobs.length) opts.images = blobs;
      const res = await AI.sample.json(prompt, opts);
      const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const review = { summary: str(res && res.summary, 500), strength: str(res && res.strength, 300), pattern: str(res && res.pattern, 300), tomorrow: str(res && res.tomorrow, 120), suggestMode: res && MODES[res.suggestMode] ? res.suggestMode : '' };
      if (!review.summary && !review.tomorrow) throw { code: 'invalid_json' };
      ss.review = review;
      if (review.tomorrow) {
        S.profile.focus = review.tomorrow;
        S.profile.focusMode = review.suggestMode;
        S.profile.focusDate = todayKey();
        queueWrite(() => Store.saveProfile(S.profile)).catch(() => {});
      }
      persistSession(ss);
    } catch (e) {
      const t = aiError(e);
      if (t.hide) AI.off = true;
      ss.reviewError = t.text;
    } finally {
      ss.reviewPending = false;
      ss.reviewCtl = null;
      if ($('#summary').classList.contains('is-active') && S.session === ss) renderSessionReview();
    }
  }

  /* ---------- dialog & toast ---------- */
  let dialogResolve = null;
  function confirmDialog(title, body, okLabel) {
    return new Promise(res => {
      $('#dlgTitle').textContent = title;
      $('#dlgBody').textContent = body;
      $('#dlgOk').textContent = okLabel || 'OK';
      $('#dialog').hidden = false;
      dialogResolve = res;
      $('#dlgCancel').focus();
    });
  }
  function closeDialog(v) { $('#dialog').hidden = true; const r = dialogResolve; dialogResolve = null; if (r) r(v); }
  $('#dlgOk').addEventListener('click', () => closeDialog(true));
  $('#dlgCancel').addEventListener('click', () => closeDialog(false));
  $('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') closeDialog(false); });
  let toastT = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000); }

  /* ---------- hero ---------- */
  function drawCurve(g, pts, color, w) {
    g.save();
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
      g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    const last = pts[pts.length - 1];
    g.lineTo(last[0], last[1]);
    g.stroke();
    g.restore();
  }
  async function heroDemo() {
    const c = $('#heroCanvas');
    const g = c.getContext('2d');
    if (!canGenerate()) { $('#heroCap').textContent = 'This browser cannot draw generated references. Your own images still work.'; return; }
    try {
      const day = Math.floor(Date.now() / 86400000);
      const ref = await window.QSRefs.generate('movement', day * 7919 + 11, { aspect: 'portrait' });
      const img = await loadImg(ref.url);
      c.width = ref.w; c.height = ref.h;
      g.drawImage(img, 0, 0);
      if (ref.actionLine) drawCurve(g, ref.actionLine, '#ff5b3a', 10);
      URL.revokeObjectURL(ref.url);
    } catch (e) {
      $('#heroCap').textContent = 'The sample pose could not be drawn here. Sessions can still use your own images.';
    }
  }

  /* ---------- wiring ---------- */
  $('#startBtn').addEventListener('click', startSession);
  $('#sumAgain').addEventListener('click', startSession);
  $('#sumHome').addEventListener('click', () => { if (S.session) cleanupSession(S.session); S.session = null; show('home'); renderHome(); });
  $('#quitBtn').addEventListener('click', quitPrompt);
  $('#reviewQuit').addEventListener('click', quitPrompt);
  $('#finishBtn').addEventListener('click', () => { const ss = S.session; if (ss && ss.cur && readyEl.hidden) endRound(ss, ss.cur); });
  $('#timeDown').addEventListener('click', () => { const st = S.settings; st.secs[st.mode] = clamp(st.secs[st.mode] - 5, 5, 300); saveSettings(); renderSetup(); });
  $('#timeUp').addEventListener('click', () => { const st = S.settings; st.secs[st.mode] = clamp(st.secs[st.mode] + 5, 5, 300); saveSettings(); renderSetup(); });
  $('#reviewEach').addEventListener('change', e => { S.settings.reviewEach = e.target.checked; saveSettings(); });
  $('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { const f = e.target.files; if (f && f.length) handleFiles(f); e.target.value = ''; });
  const drop = $('#dropZone');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-over'); if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  document.addEventListener('keydown', e => {
    if (!$('#dialog').hidden) { if (e.key === 'Escape') closeDialog(false); return; }
    if (!$('#draw').classList.contains('is-active') || !S.session) return;
    if (!readyEl.hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); readyEl.click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); sketch.undo(); return; }
    if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
    const M = MODES[S.session.mode];
    const k = e.key.toLowerCase();
    for (const t of M.tools) if (TOOLS[t].key === k) setTool(t);
    if (M.swatches) for (const v of VALUES) if (v.key === e.key) setValue(v.id);
    if (e.key === '[') changeSize(-1);
    if (e.key === ']') changeSize(1);
    if (e.key === 'Enter' && readyEl.hidden && S.session.cur && !S.session.cur.drawing) endRound(S.session, S.session.cur);
  });
  let resizeT = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeT);
    resizeT = requestAnimationFrame(() => {
      if ($('#draw').classList.contains('is-active')) layoutStage();
      if ($('#review').classList.contains('is-active')) renderReviewCanvas();
    });
  });

  renderHome();
  heroDemo();
})();
