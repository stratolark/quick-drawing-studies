/* Generated reference images for Quick Studies.
   Movement: a posed artist's mannequin. Perspective: boxes, a street, a still life or a colonnade.
   Everything is rendered in the page with three.js and returned as a JPEG blob. */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) { window.QSRefs = { supported: () => false, generate: () => Promise.reject(new Error('three')) }; return; }
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;

  const D = Math.PI / 180;
  const DOWN = new T.Vector3(0, -1, 0);
  const UP = new T.Vector3(0, 1, 0);
  const XAX = new T.Vector3(1, 0, 0);
  const SPHERE = new T.SphereGeometry(1, 32, 20);

  function rngFrom(seed) {
    let a = (seed >>> 0) ^ 0x9E3779B9;
    a = Math.imul(a ^ (a >>> 16), 0x85EBCA6B); a = Math.imul(a ^ (a >>> 13), 0xC2B2AE35); a ^= a >>> 16;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = (rng, a, b) => a + (b - a) * rng();
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  let renderer = null;
  let glFailed = false;
  function getRenderer() {
    if (renderer || glFailed) return renderer;
    try {
      const canvas = document.createElement('canvas');
      renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputEncoding = T.sRGBEncoding;
    } catch (e) {
      glFailed = true;
      renderer = null;
    }
    return renderer;
  }

  /* ---------- mannequin ---------- */
  function grp(parent, x, y, z) { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; }
  function blob(parent, mat, rx, ry, rz, x, y, z) {
    const m = new T.Mesh(SPHERE, mat);
    m.scale.set(rx, ry, rz);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function buildFigure(mat, jmat) {
    const J = {};
    const root = new T.Group();
    J.root = root;
    blob(root, mat, 0.165, 0.11, 0.115, 0, -0.02, 0);            // pelvis
    J.spine = grp(root, 0, 0.06, 0);
    blob(J.spine, mat, 0.13, 0.12, 0.1, 0, 0.09, 0);              // abdomen
    J.chest = grp(J.spine, 0, 0.17, 0);
    blob(J.chest, mat, 0.185, 0.17, 0.12, 0, 0.14, 0);            // ribcage
    J.neck = grp(J.chest, 0, 0.31, 0);
    blob(J.neck, jmat, 0.045, 0.065, 0.045, 0, 0.035, 0);
    J.head = grp(J.neck, 0, 0.075, 0);
    blob(J.head, mat, 0.085, 0.112, 0.1, 0, 0.11, 0.008);
    blob(J.head, jmat, 0.022, 0.03, 0.03, 0, 0.095, 0.098);       // nose: shows which way the head faces
    for (const s of [1, -1]) {
      const k = s > 0 ? 'L' : 'R';
      const sh = grp(J.chest, 0.19 * s, 0.25, 0);
      blob(sh, jmat, 0.055, 0.055, 0.055, 0, 0, 0);
      blob(sh, mat, 0.052, 0.15, 0.055, 0, -0.145, 0);            // upper arm
      const el = grp(sh, 0, -0.29, 0);
      blob(el, jmat, 0.042, 0.042, 0.042, 0, 0, 0);
      blob(el, mat, 0.042, 0.135, 0.045, 0, -0.13, 0);            // forearm
      const wr = grp(el, 0, -0.265, 0);
      blob(wr, mat, 0.03, 0.065, 0.05, 0, -0.06, 0.005);          // hand
      J['sh' + k] = sh; J['el' + k] = el; J['wr' + k] = wr;
      const hp = grp(root, 0.095 * s, -0.07, 0);
      blob(hp, jmat, 0.07, 0.07, 0.07, 0, 0, 0);
      blob(hp, mat, 0.075, 0.23, 0.08, 0, -0.22, 0);              // thigh
      const kn = grp(hp, 0, -0.44, 0);
      blob(kn, jmat, 0.055, 0.055, 0.055, 0, 0, 0);
      blob(kn, mat, 0.056, 0.22, 0.06, 0, -0.215, 0);             // shin
      const an = grp(kn, 0, -0.43, 0);
      blob(an, mat, 0.045, 0.035, 0.12, 0, -0.035, 0.055);        // foot
      J['hp' + k] = hp; J['kn' + k] = kn; J['an' + k] = an;
    }
    return J;
  }

  /* Poses. Euler angles in degrees (x bends forward, y turns toward the figure's left, z tilts toward its right).
     Limb d = [out, up, forward] direction of the upper segment in its parent's frame, b = elbow/knee bend, f = toe point. */
  const POSES = [
    { name: 'sprint', root: [14, 0, 0], spine: [6, 0, 0], chest: [4, 12, 0], neck: [-6, 0, 0], head: [-8, -8, 0], lift: 0.04,
      aL: { d: [0.15, -0.55, -0.8], b: 70 }, aR: { d: [0.12, -0.35, 0.9], b: 95 },
      lL: { d: [0.04, -0.7, 0.72], b: 75, f: 5 }, lR: { d: [0.04, -0.8, -0.6], b: 105, f: 35 } },
    { name: 'jump', lift: 0.35, spine: [-10, 0, 0], chest: [-6, 0, 0], head: [-18, 0, 0],
      aL: { d: [0.55, 0.82, 0.12], b: 15 }, aR: { d: [0.55, 0.82, 0.12], b: 15 },
      lL: { d: [0.3, -0.92, -0.1], b: 25, f: 45 }, lR: { d: [0.3, -0.92, -0.1], b: 25, f: 45 } },
    { name: 'leap', lift: 0.5, root: [8, 0, 0], spine: [-6, 0, 0], head: [-10, 0, 0],
      aL: { d: [0.55, 0.65, 0.5], b: 12 }, aR: { d: [0.85, 0.35, -0.35], b: 12 },
      lL: { d: [0.02, -0.08, 1], b: 6, f: 45 }, lR: { d: [0.02, -0.12, -1], b: 18, f: 45 } },
    { name: 'reach', spine: [-4, 0, 12], chest: [-4, 0, 10], head: [-22, 0, 6],
      aL: { d: [0.12, 1, 0.12], b: 6 }, aR: { d: [0.3, -0.92, 0.12], b: 25 },
      lL: { d: [0.04, -1, 0.02], b: 0, f: 50 }, lR: { d: [0.16, -0.96, -0.08], b: 14, f: 50 } },
    { name: 'throw', root: [0, -20, 0], spine: [8, 0, -8], chest: [4, -38, -6], head: [0, 30, 0],
      aL: { d: [0.3, 0.25, 0.9], b: 25 }, aR: { d: [0.65, 0.5, -0.55], b: 100 },
      lL: { d: [0.25, -0.8, 0.5], b: 32 }, lR: { d: [0.22, -0.9, -0.35], b: 25 } },
    { name: 'kick', root: [-10, 0, 0], spine: [-12, 0, 0], head: [12, 0, 0],
      aL: { d: [0.9, 0.15, 0.25], b: 30 }, aR: { d: [0.6, -0.2, -0.7], b: 35 },
      lL: { d: [0.05, -1, -0.06], b: 14 }, lR: { d: [0.08, 0.15, 1], b: 12, f: 30 } },
    { name: 'crouch', spine: [32, 0, 0], chest: [12, 0, 0], neck: [-20, 0, 0], head: [-18, 0, 0],
      aL: { d: [0.2, -0.25, 0.95], b: 30 }, aR: { d: [0.2, -0.25, 0.95], b: 30 },
      lL: { d: [0.3, -0.38, 0.88], b: 135 }, lR: { d: [0.3, -0.38, 0.88], b: 135 } },
    { name: 'lunge', spine: [6, 0, 0], head: [-8, 0, 0],
      aL: { d: [0.1, 0.12, 1], b: 6 }, aR: { d: [0.3, 0.35, -0.9], b: 25 },
      lL: { d: [0.1, -0.5, 0.86], b: 88 }, lR: { d: [0.1, -0.62, -0.78], b: 8 } },
    { name: 'look back', root: [0, 0, 6], spine: [0, 12, 0], chest: [-4, 38, -8], neck: [0, 15, 0], head: [-6, 32, 0],
      aL: { d: [0.35, -0.9, 0.1], b: 20 }, aR: { d: [0.15, -1, 0.1], b: 15 },
      lL: { d: [0.22, -0.95, 0.18], b: 28 }, lR: { d: [-0.04, -1, 0], b: 0 } },
    { name: 'arabesque', spine: [28, 0, 0], chest: [-6, 0, 0], neck: [-18, 0, 0], head: [-20, 0, 0],
      aL: { d: [0.12, 0.45, 0.88], b: 6 }, aR: { d: [0.9, 0.3, -0.25], b: 10 },
      lL: { d: [0, -1, 0.04], b: 0, f: 20 }, lR: { d: [0.04, 0.35, -0.94], b: 2, f: 50 } },
    { name: 'stumble', root: [-24, 0, 0], lift: 0.12, spine: [-8, 0, 6], head: [18, 0, 0],
      aL: { d: [0.6, 0.78, 0.18], b: 40 }, aR: { d: [0.85, 0.45, -0.3], b: 60 },
      lL: { d: [0.1, -0.35, 0.92], b: 35 }, lR: { d: [0.12, -0.92, 0.3], b: 55 } },
    { name: 'pull', root: [-24, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [6, 0, 0], head: [8, 0, 0],
      aL: { d: [0.08, -0.15, 1], b: 25 }, aR: { d: [0.12, -0.25, 0.97], b: 35 },
      lL: { d: [0.15, -0.82, 0.55], b: 22 }, lR: { d: [0.15, -0.92, 0.3], b: 12 } },
    { name: 'push', root: [34, 0, 0], spine: [4, 0, 0], neck: [-24, 0, 0], head: [-14, 0, 0],
      aL: { d: [0.15, 0.25, 0.96], b: 45 }, aR: { d: [0.15, 0.3, 0.95], b: 40 },
      lL: { d: [0.1, -0.88, 0.45], b: 70 }, lR: { d: [0.1, -0.8, -0.6], b: 4, f: 30 } },
    { name: 'punch', root: [4, 20, 0], chest: [0, -32, 0], head: [8, 10, 0],
      aL: { d: [0.02, 0.12, 1], b: 4 }, aR: { d: [0.35, -0.35, 0.6], b: 135 },
      lL: { d: [0.15, -0.92, 0.35], b: 30 }, lR: { d: [0.18, -0.9, -0.38], b: 30 } },
    { name: 'sit', root: [-18, 0, 0], spine: [6, 0, 0], head: [10, 0, 0],
      aL: { d: [0.3, -0.85, -0.45], b: 8 }, aR: { d: [0.35, -0.85, -0.4], b: 8 },
      lL: { d: [0.18, -0.05, 1], b: 115 }, lR: { d: [0.12, 0.2, 1], b: 60 } },
  ];

  function aim(g, d, s, rng, jit) {
    const v = new T.Vector3(
      (d[0] + R(rng, -jit, jit)) * s,
      d[1] + R(rng, -jit, jit),
      d[2] + R(rng, -jit, jit) + 0.002
    ).normalize();
    g.quaternion.setFromUnitVectors(DOWN, v);
  }

  function applyPose(J, P, rng, mirror) {
    const jit = (v, a) => v + R(rng, -a, a);
    const m = mirror ? -1 : 1;
    const eul = (g, e, a) => { e = e || [0, 0, 0]; g.rotation.set(jit(e[0], a) * D, jit(e[1], a) * m * D, jit(e[2], a) * m * D); };
    eul(J.root, P.root, 4);
    eul(J.spine, P.spine, 6);
    eul(J.chest, P.chest, 6);
    eul(J.neck, P.neck, 5);
    eul(J.head, P.head, 8);
    for (const k of ['L', 'R']) {
      const s = k === 'L' ? 1 : -1;
      const src = mirror ? (k === 'L' ? 'R' : 'L') : k;
      const a = P['a' + src];
      const l = P['l' + src];
      aim(J['sh' + k], a.d, s, rng, 0.16);
      J['el' + k].rotation.set(-Math.max(0, jit(a.b, 12)) * D, 0, 0);
      aim(J['hp' + k], l.d, s, rng, 0.1);
      J['kn' + k].rotation.set(Math.max(0, jit(l.b, 10)) * D, 0, 0);
      J['an' + k].userData.pitch = (l.f || 0) + R(rng, -5, 5);
      J['an' + k].rotation.set(J['an' + k].userData.pitch * D, 0, 0);
    }
  }

  function levelFoot(J, k) {
    const an = J['an' + k];
    const kn = J['kn' + k];
    const qRoot = new T.Quaternion();
    J.root.getWorldQuaternion(qRoot);
    const f = new T.Vector3(0, 0, 1).applyQuaternion(qRoot);
    f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
    f.normalize();
    const out = (k === 'L' ? 1 : -1) * 10 * D;
    const yaw = Math.atan2(f.x, f.z) + out;
    const qd = new T.Quaternion().setFromAxisAngle(UP, yaw)
      .multiply(new T.Quaternion().setFromAxisAngle(XAX, an.userData.pitch * D));
    const qp = new T.Quaternion();
    kn.getWorldQuaternion(qp);
    an.quaternion.copy(qp.invert().multiply(qd));
  }

  function groundFigure(J, lift) {
    const box = new T.Box3();
    J.root.position.set(0, 0, 0);
    J.root.updateMatrixWorld(true);
    box.setFromObject(J.root, true);
    J.root.position.y = -box.min.y;
    J.root.updateMatrixWorld(true);
    let leveled = false;
    const p = new T.Vector3();
    for (const k of ['L', 'R']) {
      J['an' + k].getWorldPosition(p);
      if (p.y < 0.22) { levelFoot(J, k); leveled = true; }
    }
    if (leveled) {
      J.root.updateMatrixWorld(true);
      box.setFromObject(J.root, true);
      J.root.position.y += -box.min.y;
    }
    J.root.position.y += lift;
    J.root.updateMatrixWorld(true);
    box.setFromObject(J.root, true);
    return box;
  }

  function boxCorners(box) {
    const a = box.min, b = box.max, out = [];
    for (const x of [a.x, b.x]) for (const y of [a.y, b.y]) for (const z of [a.z, b.z]) out.push(new T.Vector3(x, y, z));
    return out;
  }

  /* Move the camera along its view direction until the points fill the frame. */
  function fitCamera(cam, pts, target, dir, fill) {
    let dist = 4;
    const v = new T.Vector3();
    for (let i = 0; i < 4; i++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        v.copy(p).project(cam);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      const ext = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const halfH = Math.tan(cam.fov * D / 2) * dist;
      target.addScaledVector(right, cx * halfH * cam.aspect).addScaledVector(up, cy * halfH);
      dist *= ext / fill;
    }
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
  }

  function projectedExtent(cam, pts) {
    const v = new T.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { w: (maxX - minX) * cam.aspect, h: maxY - minY };
  }

  function keyLight(scene, rng, target, az, opts) {
    const o = Object.assign({ intensity: 1.3, el: [40, 65], spread: 3, dist: 8, map: 2048 }, opts || {});
    const el = R(rng, o.el[0], o.el[1]) * D;
    const key = new T.DirectionalLight(0xffffff, o.intensity);
    key.position.set(
      target.x + Math.sin(az) * Math.cos(el) * o.dist,
      target.y + Math.sin(el) * o.dist,
      target.z + Math.cos(az) * Math.cos(el) * o.dist
    );
    key.target.position.copy(target);
    scene.add(key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(o.map, o.map);
    const sc = key.shadow.camera;
    sc.left = -o.spread; sc.right = o.spread; sc.top = o.spread; sc.bottom = -o.spread;
    sc.near = 0.1; sc.far = o.dist * 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    return key;
  }

  function figureScene(rng, opts) {
    const BG = 0xc9ced5;
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    const mat = new T.MeshStandardMaterial({ color: 0xbab1a6, roughness: 0.62, metalness: 0 });
    const jmat = new T.MeshStandardMaterial({ color: 0x8b837a, roughness: 0.55, metalness: 0 });
    const J = buildFigure(mat, jmat);
    scene.add(J.root);
    const P = pick(rng, POSES);
    const mirror = rng() < 0.5;
    applyPose(J, P, rng, mirror);
    const box = groundFigure(J, (P.lift || 0) * R(rng, 0.85, 1.15));

    const ground = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: 0.24 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new T.HemisphereLight(0xffffff, 0x80868f, 0.4));

    const center = box.getCenter(new T.Vector3());
    const az = R(rng, -150, 150) * D;
    const el = (rng() < 0.15 ? R(rng, -14, -4) : R(rng, -4, 28)) * D;
    const dir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const cam = new T.PerspectiveCamera(34, 1, 0.05, 100);
    const pts = boxCorners(box);
    fitCamera(cam, pts, center.clone(), dir, 0.8);
    const ext = projectedExtent(cam, pts);
    let w = 900, h = 900;
    if (opts && opts.aspect === 'portrait') { w = 750; h = 1000; }
    else if (ext.h > ext.w * 1.15) { w = 750; h = 1000; }
    else if (ext.w > ext.h * 1.15) { w = 1000; h = 750; }
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    fitCamera(cam, pts, center.clone(), dir, 0.82);

    const side = rng() < 0.5 ? -1 : 1;
    keyLight(scene, rng, center, az + side * R(rng, 35, 80) * D, { intensity: 1.45, spread: 2.6, dist: 7 });

    const after = () => {
      // Line of action: head, chest, pelvis, then the leg that reaches farthest.
      const wp = (g, x, y, z) => g.localToWorld(new T.Vector3(x, y, z));
      const chainTop = [wp(J.head, 0, 0.2, 0), wp(J.neck, 0, 0, 0), wp(J.chest, 0, 0.12, 0), wp(J.root, 0, -0.02, 0)];
      const legs = ['L', 'R'].map(k => [wp(J['kn' + k], 0, 0, 0), wp(J['an' + k], 0, -0.03, 0.04)]);
      const toPx = p => { const v = p.clone().project(cam); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h]; };
      const top2 = chainTop.map(toPx);
      const pelvis = top2[3];
      const reach = legs.map(L => { const a = toPx(L[1]); return Math.hypot(a[0] - pelvis[0], a[1] - pelvis[1]); });
      const leg = legs[reach[0] >= reach[1] ? 0 : 1].map(toPx);
      return { actionLine: top2.concat(leg) };
    };
    return { scene, camera: cam, w, h, label: 'Mannequin, ' + P.name + ' pose', after };
  }

  /* ---------- perspective scenes ---------- */
  function stdMat(color, rough) { return new T.MeshStandardMaterial({ color, roughness: rough == null ? 0.88 : rough, metalness: 0 }); }
  function addBox(scene, mat, w, h, d, x, y, z, ry) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry || 0;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  function groundPlane(scene, color, size) {
    const g = new T.Mesh(new T.PlaneGeometry(size, size), stdMat(color, 1));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
    return g;
  }
  function camAt(fov, pos, target) {
    const cam = new T.PerspectiveCamera(fov, 4 / 3, 0.1, 400);
    cam.position.copy(pos);
    cam.lookAt(target);
    return cam;
  }

  function boxesScene(rng) {
    const BG = 0xd3d7dc;
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    scene.fog = new T.Fog(BG, 20, 55);
    groundPlane(scene, 0x9fa4ab, 300);
    const mat = stdMat(0xd9d8d4, 0.85);
    const n = 3 + Math.floor(rng() * 4);
    const aligned = rng() < 0.55;
    const baseYaw = R(rng, 0.15, 1.4);
    const placed = [];
    for (let i = 0; i < n; i++) {
      let w = R(rng, 0.6, 2.2), h = R(rng, 0.5, 2.4), d = R(rng, 0.6, 2.2);
      const yaw = aligned ? baseYaw : R(rng, 0, Math.PI);
      if (placed.length && rng() < 0.3) {
        const p = pick(rng, placed);
        w = Math.min(w, p.w * 0.8); d = Math.min(d, p.d * 0.8); h = Math.min(h, 1.4);
        addBox(scene, mat, w, h, d, p.x + R(rng, -0.15, 0.15), p.top + h / 2, p.z + R(rng, -0.15, 0.15), aligned ? yaw : R(rng, 0, Math.PI));
        p.top += h;
        continue;
      }
      let x = 0, z = 0, ok = false;
      const r = Math.max(w, d) * 0.72;
      for (let t = 0; t < 30 && !ok; t++) {
        x = R(rng, -3, 3); z = R(rng, -3, 3);
        ok = placed.every(p => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.95);
      }
      if (!ok) continue;
      addBox(scene, mat, w, h, d, x, h / 2, z, yaw);
      placed.push({ x, z, w, d, r, top: h });
    }
    const view = pick(rng, ['worm', 'eye', 'eye', 'high']);
    const fov = view === 'worm' ? 62 : view === 'eye' ? 54 : 48;
    const az = R(rng, 0, Math.PI * 2);
    const dist = view === 'high' ? R(rng, 7, 9) : R(rng, 6.5, 8.5);
    const y = view === 'worm' ? 0.35 : view === 'eye' ? 1.6 : R(rng, 5, 8);
    const target = new T.Vector3(0, view === 'worm' ? 1.3 : view === 'eye' ? 0.8 : 0.3, 0);
    const cam = camAt(fov, new T.Vector3(Math.sin(az) * dist, y, Math.cos(az) * dist), target);
    scene.add(new T.HemisphereLight(0xffffff, 0x6f757e, 0.38));
    keyLight(scene, rng, new T.Vector3(0, 0, 0), az + (rng() < 0.5 ? -1 : 1) * R(rng, 40, 90) * D, { intensity: 1.0, spread: 7, dist: 14, el: [35, 60] });
    const names = { worm: "worm's-eye view", eye: 'eye level', high: "bird's-eye view" };
    return { scene, camera: cam, w: 1000, h: 750, label: 'Boxes, ' + names[view] + (aligned ? ', two-point perspective' : ', mixed angles') };
  }

  function streetScene(rng) {
    const BG = 0xcfd5dc;
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    scene.fog = new T.Fog(BG, 30, 170);
    groundPlane(scene, 0x70757d, 500);
    const walk = stdMat(0x9ea3aa, 1);
    for (const s of [-1, 1]) addBox(scene, walk, 3, 0.16, 400, s * 7.5, 0.08, -150, 0);
    const mats = [0xcfcdc8, 0xb7bbc0, 0xd6d1ca, 0xadb2b8, 0xc2bfb9].map(c => stdMat(c, 0.92));
    const winMat = stdMat(0x5f656e, 0.6);
    const wins = [];
    for (const s of [-1, 1]) {
      let z = 14;
      while (z > -190) {
        const bw = R(rng, 4, 10), bh = R(rng, 4.5, 20), bd = R(rng, 6, 11);
        const x = s * (9 + bd / 2);
        const zc = z - bw / 2;
        addBox(scene, pick(rng, mats), bd, bh, bw, x, bh / 2, zc, 0);
        const face = s * 9 - s * 0.02;
        for (let fy = 2.6; fy < bh - 1; fy += 3.2) {
          for (let fz = z - 1.2; fz > z - bw + 0.9; fz -= 2.2) wins.push([face, fy, fz]);
        }
        z -= bw + (rng() < 0.3 ? R(rng, 0.5, 3) : 0);
      }
    }
    const winGeo = new T.BoxGeometry(0.14, 1.5, 1.0);
    const inst = new T.InstancedMesh(winGeo, winMat, wins.length);
    const m4 = new T.Matrix4();
    wins.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); inst.setMatrixAt(i, m4); });
    inst.receiveShadow = true;
    scene.add(inst);
    const pole = stdMat(0x4d525a, 0.6);
    for (const s of [-1, 1]) for (let z = 8; z > -120; z -= 14) {
      const c = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 5, 10), pole);
      c.position.set(s * 6.4, 2.5, z); c.castShadow = true; scene.add(c);
      addBox(scene, pole, 0.9, 0.18, 0.3, s * 6.0, 5.0, z, 0);
    }
    const view = pick(rng, ['eye', 'eye', 'low', 'high']);
    const x = R(rng, -3, 3);
    const y = view === 'eye' ? 1.7 : view === 'low' ? 0.45 : R(rng, 18, 30);
    const tx = x * 0.2 + R(rng, -9, 9);
    const ty = view === 'high' ? 0 : y + R(rng, -1, 3);
    const cam = camAt(view === 'high' ? 50 : 56, new T.Vector3(x, y, 16), new T.Vector3(tx, ty, -60));
    scene.add(new T.HemisphereLight(0xffffff, 0x6f757e, 0.42));
    const sunAz = (rng() < 0.5 ? 1 : -1) * R(rng, 50, 120) * D;
    keyLight(scene, rng, new T.Vector3(0, 0, -25), sunAz, { intensity: 1.0, spread: 45, dist: 70, el: [30, 55], map: 2048 });
    const names = { eye: 'eye level', low: 'low angle', high: 'high angle' };
    return { scene, camera: cam, w: 1000, h: 750, label: 'City street, ' + names[view] };
  }

  function stillLifeScene(rng) {
    const BG = 0xcfd3d8;
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    groundPlane(scene, 0x9ea3aa, 40);
    const wall = new T.Mesh(new T.PlaneGeometry(40, 20), stdMat(0xb4b9bf, 1));
    wall.position.set(0, 10, -1.7);
    wall.receiveShadow = true;
    scene.add(wall);
    const light = stdMat(0xdcdbd7, 0.8);
    const darker = stdMat(0x6d737a, 0.75);
    const kinds = ['box', 'cyl', 'sphere', 'cone', 'tall', 'cyl'];
    const n = 3 + Math.floor(rng() * 2);
    const placed = [];
    for (let i = 0; i < n; i++) {
      const kind = pick(rng, kinds);
      const mat = i === 1 && rng() < 0.6 ? darker : light;
      let mesh, r;
      if (kind === 'box' || kind === 'tall') {
        const w = R(rng, 0.45, 0.8), hh = kind === 'tall' ? R(rng, 0.9, 1.4) : R(rng, 0.4, 0.75), d = R(rng, 0.45, 0.8);
        mesh = new T.Mesh(new T.BoxGeometry(w, hh, d), mat); mesh.position.y = hh / 2; r = Math.max(w, d) * 0.7;
      } else if (kind === 'cyl') {
        const rr = R(rng, 0.2, 0.36), hh = R(rng, 0.6, 1.2);
        mesh = new T.Mesh(new T.CylinderGeometry(rr, rr, hh, 48), mat); mesh.position.y = hh / 2; r = rr;
      } else if (kind === 'sphere') {
        const rr = R(rng, 0.25, 0.4);
        mesh = new T.Mesh(new T.SphereGeometry(rr, 48, 32), mat); mesh.position.y = rr; r = rr;
      } else {
        const rr = R(rng, 0.25, 0.38), hh = R(rng, 0.6, 1.0);
        mesh = new T.Mesh(new T.ConeGeometry(rr, hh, 48), mat); mesh.position.y = hh / 2; r = rr;
      }
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 40 && !ok; t++) {
        x = R(rng, -1.2, 1.2); z = R(rng, -0.9, 0.7);
        ok = placed.every(p => Math.hypot(p.x - x, p.z - z) > p.r + r + 0.08);
      }
      if (!ok) continue;
      mesh.position.x = x; mesh.position.z = z;
      mesh.rotation.y = R(rng, 0, Math.PI);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      placed.push({ x, z, r });
    }
    const az = R(rng, -35, 35) * D;
    const el = R(rng, 14, 36) * D;
    const dist = R(rng, 4.3, 5.3);
    const target = new T.Vector3(0, 0.4, -0.1);
    const cam = camAt(35, new T.Vector3(Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist), target);
    scene.add(new T.HemisphereLight(0xffffff, 0x666c75, 0.3));
    const lAz = Math.max(-75 * D, Math.min(75 * D, az + (rng() < 0.5 ? -1 : 1) * R(rng, 40, 70) * D));
    keyLight(scene, rng, new T.Vector3(0, 0.3, 0), lAz, { intensity: 1.1, spread: 3, dist: 8, el: [35, 60] });
    return { scene, camera: cam, w: 1000, h: 750, label: 'Still life of simple forms, strong side light' };
  }

  function colonnadeScene(rng) {
    const BG = 0xd5d9de;
    const scene = new T.Scene();
    scene.background = new T.Color(BG);
    scene.fog = new T.Fog(BG, 22, 95);
    groundPlane(scene, 0xa7acb3, 400);
    const grid = new T.GridHelper(400, 200, 0x80868e, 0x80868e);
    grid.position.y = 0.006;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
    const stone = stdMat(0xd6d4cf, 0.9);
    const half = R(rng, 2.6, 3.6);
    const step = R(rng, 2.4, 3.2);
    const count = 14;
    for (const s of [-1, 1]) {
      for (let i = 0; i < count; i++) {
        const z = 4 - i * step;
        addBox(scene, stone, 0.8, 0.3, 0.8, s * half, 0.15, z, 0);
        const shaft = new T.Mesh(new T.CylinderGeometry(0.22, 0.25, 3.4, 32), stone);
        shaft.position.set(s * half, 0.3 + 1.7, z); shaft.castShadow = true; shaft.receiveShadow = true; scene.add(shaft);
        addBox(scene, stone, 0.8, 0.25, 0.8, s * half, 3.825, z, 0);
      }
      const len = (count - 1) * step + 1;
      addBox(scene, stone, 0.6, 0.45, len, s * half, 4.17, 4 - (count - 1) * step / 2, 0);
    }
    const view = pick(rng, ['center', 'center', 'diagonal', 'high']);
    let cam;
    if (view === 'center') cam = camAt(56, new T.Vector3(R(rng, -1.4, 1.4), 1.6, 8), new T.Vector3(R(rng, -2.5, 2.5), R(rng, 1.2, 2.6), -30));
    else if (view === 'diagonal') cam = camAt(54, new T.Vector3((rng() < 0.5 ? -1 : 1) * R(rng, 7, 10), 1.7, R(rng, 4, 8)), new T.Vector3(0, 1.8, R(rng, -12, -6)));
    else cam = camAt(50, new T.Vector3(R(rng, -4, 4), R(rng, 8, 12), 10), new T.Vector3(0, 0, -14));
    scene.add(new T.HemisphereLight(0xffffff, 0x6f757e, 0.4));
    keyLight(scene, rng, new T.Vector3(0, 0, -14), (rng() < 0.5 ? 1 : -1) * R(rng, 60, 110) * D, { intensity: 1.05, spread: 30, dist: 50, el: [22, 42] });
    const names = { center: 'one-point perspective', diagonal: 'two-point perspective', high: 'high angle' };
    return { scene, camera: cam, w: 1000, h: 750, label: 'Colonnade, ' + names[view] };
  }

  /* ---------- render ---------- */
  function disposeScene(scene) {
    scene.traverse(o => {
      if (o.geometry && o.geometry !== SPHERE) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(m => m.dispose());
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.dispose();
    });
  }

  async function generate(kind, seed, opts) {
    const r = getRenderer();
    if (!r) throw new Error('webgl');
    const rng = rngFrom(seed);
    let built;
    let scene = 'figure';
    if (kind === 'movement') built = figureScene(rng, opts);
    else {
      scene = pick(rng, ['boxes', 'street', 'still', 'colonnade']);
      built = scene === 'boxes' ? boxesScene(rng) : scene === 'street' ? streetScene(rng) : scene === 'still' ? stillLifeScene(rng) : colonnadeScene(rng);
    }
    const cam = built.camera;
    cam.aspect = built.w / built.h;
    cam.updateProjectionMatrix();
    r.setSize(built.w, built.h, false);
    r.render(built.scene, cam);
    const blob = await new Promise(res => r.domElement.toBlob(b => res(b), 'image/jpeg', 0.9));
    const extra = built.after ? built.after() : {};
    disposeScene(built.scene);
    if (!blob) throw new Error('render');
    return Object.assign({ kind, scene, seed, label: built.label, blob, url: URL.createObjectURL(blob), w: built.w, h: built.h }, extra);
  }

  window.QSRefs = { supported: () => !!getRenderer(), generate };
})();
