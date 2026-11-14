import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { validateRequest, sanitizeFeedback, inspectImage, feedbackJsonSchema, ERROR_CODE, UNVERIFIED, LIMITS } from '../src/coach/schema.js';
import { requestCoachFeedback, coachHealth } from '../src/coach/client.js';
import { createCoachHandler } from '../server/app.js';
import { createMockProvider, mockFeedback } from '../server/providers/mock.js';
import { costUsd } from '../server/providers/anthropic.js';
import { createRateLimiter, createBudget, accessAllowed } from '../server/guards.js';
import { loadConfig } from '../server/config.js';
import { SYSTEM_PROMPT, buildUserContent } from '../server/prompt.js';

/* Minimal PNG header: signature + IHDR with the given size. Only headers are inspected. */
function pngB64(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b.toString('base64');
}
function jpegB64(w, h) {
  const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0]);
  return b.toString('base64');
}

const EVIDENCE = [
  { key: 'orientationErrorDeg', label: 'Main-line tilt error', value: 14.2, display: '14°', within: false },
  { key: 'bowError', label: 'Bend difference', value: 0.02, display: '2%', within: true },
];
function body(extra) {
  return Object.assign({
    objectiveId: 'gesture.line-of-action', attemptType: 'initial', guidance: 1, secs: 90, style: 'normal',
    evidence: EVIDENCE,
    measuredIssue: { id: 'gesture.orientation', measured: 'Your main line is tilted about 14° clockwise compared with the reference.' },
    images: [{ role: 'reference', mediaType: 'image/jpeg', data: jpegB64(750, 1000) }, { role: 'overlay', mediaType: 'image/png', data: pngB64(750, 1000) }],
  }, extra);
}

describe('request validation', () => {
  it('accepts a well-formed request', () => {
    const v = validateRequest(body());
    expect(v.ok).toBe(true);
    expect(v.value.images).toHaveLength(2);
  });
  it.each([
    ['unknown objective', { objectiveId: 'x' }],
    ['unknown attempt type', { attemptType: 'cheat' }],
    ['evidence key not measured by this exercise', { evidence: [{ key: 'overlap', label: 'x', value: 1, display: '1' }] }],
    ['evidence value must be a number', { evidence: [{ key: 'bowError', label: 'x', value: '3', display: '3' }] }],
    ['send one to three images', { images: [] }],
    ['the drawing must be included', { images: [{ role: 'reference', mediaType: 'image/jpeg', data: jpegB64(10, 10) }] }],
    ['image content does not match its type', { images: [{ role: 'overlay', mediaType: 'image/jpeg', data: pngB64(10, 10) }] }],
    ['image dimensions out of range', { images: [{ role: 'overlay', mediaType: 'image/png', data: pngB64(5000, 10) }] }],
    ['image is not base64', { images: [{ role: 'overlay', mediaType: 'image/png', data: 'not base64!' }] }],
    ['unsupported image type', { images: [{ role: 'overlay', mediaType: 'image/gif', data: pngB64(10, 10) }] }],
    ['duplicate image role', { images: [{ role: 'overlay', mediaType: 'image/png', data: pngB64(10, 10) }, { role: 'overlay', mediaType: 'image/png', data: pngB64(10, 10) }] }],
  ])('rejects: %s', (msg, patch) => {
    const v = validateRequest(body(patch));
    expect(v.ok).toBe(false);
    expect(v.error).toBe(msg);
  });
  it('reads real image sizes from headers', () => {
    expect(inspectImage(Buffer.from(pngB64(640, 480), 'base64'))).toEqual({ type: 'image/png', width: 640, height: 480 });
    expect(inspectImage(Buffer.from(jpegB64(800, 600), 'base64'))).toEqual({ type: 'image/jpeg', width: 800, height: 600 });
    expect(inspectImage(Buffer.from('GIF89a........'))).toBe(null);
  });
});

describe('response sanitizing', () => {
  const good = () => mockFeedback(validateRequest(body()).value);

  it('passes a correct structured response', () => {
    const r = sanitizeFeedback(good(), EVIDENCE);
    expect(r.flags).toEqual([]);
    expect(r.feedback.mainIssue).toMatch(/14°/);
  });
  it('rejects missing fields and wrong types', () => {
    const missing = good(); delete missing.howToCorrect;
    expect(() => sanitizeFeedback(missing, EVIDENCE)).toThrow();
    expect(() => sanitizeFeedback(Object.assign(good(), { mainIssue: 42 }), EVIDENCE)).toThrow();
    expect(() => sanitizeFeedback('not an object', EVIDENCE)).toThrow();
    expect(() => sanitizeFeedback([], EVIDENCE)).toThrow();
    try { sanitizeFeedback(null, EVIDENCE); } catch (e) { expect(e.code).toBe(ERROR_CODE.invalidResponse); }
  });
  it('removes numbers the app never measured', () => {
    const r = sanitizeFeedback(Object.assign(good(), { mainIssue: 'Your torso is 37° off and the legs are 58% too long, but the 14° tilt is the key.' }), EVIDENCE);
    expect(r.feedback.mainIssue).not.toMatch(/37°|58%/);
    expect(r.feedback.mainIssue).toContain(UNVERIFIED);
    expect(r.feedback.mainIssue).toMatch(/14°/);
    expect(r.flags).toContain('unverified-number');
  });
  it('drops evidence that cites a measurement that was not sent', () => {
    const r = sanitizeFeedback(Object.assign(good(), { evidence: [{ source: 'overlap', observation: 'made up' }, { source: 'visual', observation: 'the head is small' }] }), EVIDENCE);
    expect(r.feedback.evidence).toEqual([{ source: 'visual', observation: 'the head is small' }]);
    expect(r.flags).toContain('dropped-evidence');
  });
  it('limits structured-output evidence sources to the sent keys', () => {
    const s = feedbackJsonSchema(['bowError']);
    expect(s.properties.evidence.items.properties.source.enum).toEqual(['bowError', 'visual']);
    expect(s.additionalProperties).toBe(false);
  });
});

describe('prompt construction', () => {
  it('builds the prompt from validated fields and marks measurements as verified', () => {
    const content = buildUserContent(validateRequest(body()).value);
    const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text).toMatch(/Verified measurements/);
    expect(text).toMatch(/\[orientationErrorDeg\] Main-line tilt error: 14°/);
    expect(content.filter(c => c.type === 'image')).toHaveLength(2);
    expect(SYSTEM_PROMPT).toMatch(/Never state a number/);
  });
  it('prices usage conservatively for unknown models', () => {
    expect(costUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 0 })).toBe(4);
    expect(costUsd('mystery', { input_tokens: 0, output_tokens: 1e6 })).toBe(40);
  });
});

describe('guards and configuration', () => {
  it('limits requests per minute and per day', () => {
    const rl = createRateLimiter({ perMinute: 2, perDay: 3 });
    expect(rl.check('a', 0)).toBe(null);
    expect(rl.check('a', 1)).toBe(null);
    expect(rl.check('a', 2)).toBeGreaterThan(0);
    expect(rl.check('b', 2)).toBe(null);
    expect(rl.check('a', 61000)).toBe(null);
    expect(rl.check('a', 122000)).toBeGreaterThan(0); // daily cap of 3 reached
  });
  it('stops spending at the daily budget', () => {
    const b = createBudget({ dailyUsd: 0.05 });
    expect(b.allows(0)).toBe(true);
    b.record(0.06, 0);
    expect(b.allows(0)).toBe(false);
    expect(b.allows(86400000)).toBe(true);
  });
  it('checks access codes', () => {
    expect(accessAllowed('', undefined)).toBe(true);
    expect(accessAllowed('secret', 'secret')).toBe(true);
    expect(accessAllowed('secret', 'Secret')).toBe(false);
    expect(accessAllowed('secret', undefined)).toBe(false);
  });
  it('refuses to expose a paid provider without an access code', () => {
    expect(() => loadConfig({ QS_COACH_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', QS_SERVER_HOST: '0.0.0.0' }, [])).toThrow(/QS_ACCESS_TOKEN/);
    expect(() => loadConfig({ QS_COACH_PROVIDER: 'anthropic' }, [])).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({}, []).provider).toBe('off');
    expect(loadConfig({}, ['--provider=mock']).provider).toBe('mock');
  });
});

/* End-to-end through the HTTP handler with the mock provider. No network, no paid calls. */
describe('coach server', () => {
  let server, base;
  const baseCfg = { accessToken: '', timeoutMs: 400, ratePerMinute: 100, ratePerDay: 1000, dailyBudgetUsd: 1, staticDir: '', mockMode: 'ok' };
  const handlers = {};
  function handlerFor(name, cfgPatch, provider) {
    const cfg = Object.assign({}, baseCfg, cfgPatch);
    handlers[name] = createCoachHandler({ cfg, provider: provider === undefined ? createMockProvider(cfg) : provider, log: () => {} });
  }
  beforeAll(async () => {
    handlerFor('ok', {});
    handlerFor('malformed', { mockMode: 'malformed' });
    handlerFor('hallucinate', { mockMode: 'hallucinate' });
    handlerFor('refuse', { mockMode: 'refuse' });
    handlerFor('timeout', { mockMode: 'timeout' });
    handlerFor('off', {}, null);
    handlerFor('locked', { accessToken: 'letmein' });
    handlerFor('limited', { ratePerMinute: 1 });
    handlerFor('broke', { dailyBudgetUsd: 0.0001 }, { name: 'mock', model: 'm', review: async () => ({ raw: mockFeedback(validateRequest(body()).value), model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 1 }) });
    server = http.createServer((req, res) => {
      const name = req.url.split('/')[1];
      req.url = req.url.slice(name.length + 1);
      handlers[name](req, res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = name => `http://127.0.0.1:${server.address().port}/${name}`;
  });
  afterAll(() => new Promise(r => server.close(r)));

  const post = (name, payload, headers) => fetch(base(name) + '/api/coach/feedback', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

  it('returns validated feedback', async () => {
    const r = await post('ok', body());
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.feedback.mainIssue).toMatch(/14°/);
    expect(j.flags).toEqual([]);
  });
  it('reports health and turns off cleanly', async () => {
    expect(await (await fetch(base('ok') + '/api/coach/health')).json()).toMatchObject({ ok: true, provider: 'mock' });
    expect(await (await fetch(base('off') + '/api/coach/health')).json()).toMatchObject({ ok: false });
    expect((await post('off', body())).status).toBe(503);
  });
  it('rejects malformed JSON and invalid bodies with 400', async () => {
    expect((await post('ok', '{oops')).status).toBe(400);
    const r = await post('ok', body({ objectiveId: 'nope' }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toBe('unknown objective');
  });
  it('rejects oversized bodies with 413', async () => {
    const r = await post('ok', JSON.stringify({ pad: 'x'.repeat(LIMITS.maxBodyBytes + 10) }));
    expect(r.status).toBe(413);
  });
  it('turns a malformed model answer into 502 invalid_response', async () => {
    const r = await post('malformed', body());
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe(ERROR_CODE.invalidResponse);
  });
  it('scrubs hallucinated measurements before sending', async () => {
    const j = await (await post('hallucinate', body())).json();
    expect(j.feedback.mainIssue).not.toMatch(/37°|58%/);
    expect(j.flags).toContain('unverified-number');
  });
  it('maps refusals and timeouts', async () => {
    expect((await (await post('refuse', body())).json()).error.code).toBe(ERROR_CODE.refused);
    const t = await post('timeout', body());
    expect(t.status).toBe(504);
  });
  it('requires the access code when one is configured', async () => {
    expect((await post('locked', body())).status).toBe(401);
    expect((await post('locked', body(), { 'x-qs-access': 'wrong' })).status).toBe(401);
    expect((await post('locked', body(), { 'x-qs-access': 'letmein' })).status).toBe(200);
  });
  it('rate limits per client', async () => {
    expect((await post('limited', body())).status).toBe(200);
    const r = await post('limited', body());
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
  it('stops at the spending budget', async () => {
    expect((await post('broke', body())).status).toBe(200);
    expect((await post('broke', body())).status).toBe(402);
  });
});

describe('browser client', () => {
  const ok = feedback => async () => new Response(JSON.stringify({ feedback, flags: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const payload = validateRequest(body()).value;

  it('returns re-validated feedback', async () => {
    const r = await requestCoachFeedback(payload, { fetchImpl: ok(mockFeedback(payload)), accessCode: '' });
    expect(r.feedback.howToCorrect).toBeTruthy();
  });
  it('re-scrubs hallucinated numbers even if the server let them through', async () => {
    const bad = Object.assign(mockFeedback(payload), { whyItMatters: 'Because the arm is 80% too long.' });
    const r = await requestCoachFeedback(payload, { fetchImpl: ok(bad), accessCode: '' });
    expect(r.feedback.whyItMatters).not.toMatch(/80%/);
  });
  it.each([
    [429, ERROR_CODE.rateLimited],
    [401, ERROR_CODE.unauthorized],
    [503, ERROR_CODE.unavailable],
    [504, ERROR_CODE.timeout],
  ])('maps HTTP %i to %s', async (status, code) => {
    const f = async () => new Response('{}', { status });
    await expect(requestCoachFeedback(payload, { fetchImpl: f, accessCode: '' })).rejects.toMatchObject({ code });
  });
  it('maps network errors to unavailable', async () => {
    await expect(requestCoachFeedback(payload, { fetchImpl: async () => { throw new TypeError('fetch failed'); }, accessCode: '' })).rejects.toMatchObject({ code: ERROR_CODE.unavailable });
  });
  it('maps malformed bodies to invalid_response', async () => {
    const f = async () => new Response('not json', { status: 200 });
    await expect(requestCoachFeedback(payload, { fetchImpl: f, accessCode: '' })).rejects.toMatchObject({ code: ERROR_CODE.invalidResponse });
  });
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  it('times out', async () => {
    await expect(requestCoachFeedback(payload, { fetchImpl: hang, timeoutMs: 30, accessCode: '' })).rejects.toMatchObject({ code: ERROR_CODE.timeout });
  });
  it('can be cancelled by the learner', async () => {
    const ctl = new AbortController();
    const p = requestCoachFeedback(payload, { fetchImpl: hang, signal: ctl.signal, accessCode: '' });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: ERROR_CODE.cancelled });
  });
  it('reports an unreachable coach as unavailable', async () => {
    expect(await coachHealth(async () => { throw new TypeError('down'); })).toEqual({ available: false });
  });
});
