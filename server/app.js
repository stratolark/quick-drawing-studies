/* HTTP handler for the coach API (and, optionally, the built static site). Built as a factory so tests can
   drive it without opening a port. Request bodies and images are never logged. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COACH_API_VERSION, ERROR_CODE, LIMITS, validateRequest, sanitizeFeedback } from '../src/coach/schema.js';
import { createRateLimiter, createBudget, accessAllowed } from './guards.js';

export const ROUTES = Object.freeze({ health: '/api/coach/health', feedback: '/api/coach/feedback' });

const STATUS_FOR = {
  [ERROR_CODE.badRequest]: 400,
  [ERROR_CODE.unauthorized]: 401,
  [ERROR_CODE.budgetExhausted]: 402,
  [ERROR_CODE.tooLarge]: 413,
  [ERROR_CODE.refused]: 422,
  [ERROR_CODE.rateLimited]: 429,
  [ERROR_CODE.cancelled]: 499,
  [ERROR_CODE.invalidResponse]: 502,
  [ERROR_CODE.providerError]: 502,
  [ERROR_CODE.unavailable]: 503,
  [ERROR_CODE.timeout]: 504,
};

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, status, body, extra) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }, extra));
  res.end(data);
}

const sendError = (res, code, message, extra) => send(res, STATUS_FOR[code] || 500, { error: { code, message: message || code } }, extra);

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > max) { reject({ code: ERROR_CODE.tooLarge }); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject({ code: ERROR_CODE.tooLarge }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject({ code: ERROR_CODE.cancelled }));
  });
}

function serveStatic(root, req, res) {
  const base = path.resolve(root);
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.resolve(base, '.' + (urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath));
  if (!file.startsWith(base + path.sep) && file !== base) { send(res, 404, { error: { code: 'not_found' } }); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
  res.writeHead(200, { 'content-type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

export function createCoachHandler({ cfg, provider, log = console.log }) {
  const limiter = createRateLimiter({ perMinute: cfg.ratePerMinute, perDay: cfg.ratePerDay });
  const budget = createBudget({ dailyUsd: cfg.dailyBudgetUsd });

  async function feedback(req, res) {
    const id = crypto.randomUUID().slice(0, 8);
    const started = Date.now();
    const done = (status, code, extra) => log(`[coach] ${id} ${status} ${Date.now() - started}ms ${code || 'ok'}${extra ? ' ' + extra : ''}`);
    if (!provider) { sendError(res, ERROR_CODE.unavailable, 'coach is turned off'); done(503, ERROR_CODE.unavailable); return; }
    if (!accessAllowed(cfg.accessToken, req.headers['x-qs-access'])) { sendError(res, ERROR_CODE.unauthorized); done(401, ERROR_CODE.unauthorized); return; }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) { sendError(res, ERROR_CODE.badRequest, 'expected application/json'); done(400, 'content-type'); return; }
    const wait = limiter.check(req.socket.remoteAddress || 'unknown');
    if (wait != null) { sendError(res, ERROR_CODE.rateLimited, null, { 'retry-after': String(wait) }); done(429, ERROR_CODE.rateLimited); return; }
    if (!budget.allows()) { sendError(res, ERROR_CODE.budgetExhausted); done(402, ERROR_CODE.budgetExhausted); return; }

    let parsed;
    try {
      const text = await readBody(req, LIMITS.maxBodyBytes);
      parsed = JSON.parse(text);
    } catch (e) {
      const code = e && e.code ? e.code : ERROR_CODE.badRequest;
      sendError(res, code, code === ERROR_CODE.badRequest ? 'body is not valid JSON' : null);
      done(STATUS_FOR[code], code);
      return;
    }
    const v = validateRequest(parsed);
    if (!v.ok) { sendError(res, ERROR_CODE.badRequest, v.error); done(400, 'invalid', v.error); return; }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort('timeout'), cfg.timeoutMs);
    res.on('close', () => { if (!res.writableEnded) ctl.abort('cancelled'); });
    try {
      const out = await provider.review(v.value, { signal: ctl.signal });
      budget.record(out.costUsd);
      const clean = sanitizeFeedback(out.raw, v.value.evidence);
      send(res, 200, { apiVersion: COACH_API_VERSION, feedback: clean.feedback, flags: clean.flags, model: out.model });
      done(200, null, `in=${out.usage.inputTokens} out=${out.usage.outputTokens} usd=${out.costUsd.toFixed(4)}`);
    } catch (e) {
      if (e && e.costUsd) budget.record(e.costUsd);
      const code = e && e.code && STATUS_FOR[e.code] ? e.code : ERROR_CODE.providerError;
      if (!res.writableEnded && !res.destroyed) sendError(res, code);
      done(STATUS_FOR[code], code, e && e.log ? e.log : (e && !e.code ? String(e.message || e) : ''));
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === ROUTES.health && req.method === 'GET') {
      send(res, 200, { ok: !!provider, apiVersion: COACH_API_VERSION, provider: provider ? provider.name : 'off', model: provider ? provider.model : null, needsAccess: !!cfg.accessToken });
      return;
    }
    if (url.pathname === ROUTES.feedback) {
      if (req.method !== 'POST') { send(res, 405, { error: { code: 'method_not_allowed' } }, { allow: 'POST' }); return; }
      await feedback(req, res);
      return;
    }
    if (cfg.staticDir && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) { serveStatic(cfg.staticDir, req, res); return; }
    send(res, 404, { error: { code: 'not_found' } });
  };
}
