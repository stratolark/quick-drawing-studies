/* Browser client for the optional AI coach backend. Uploads happen only when the learner has opted in,
   and every response is re-validated here so a misbehaving server cannot inject measurements either. */
import { ERROR_CODE, sanitizeFeedback } from './schema.js';

export const COACH_BASE = (import.meta.env && import.meta.env.VITE_COACH_URL) || './api/coach';
const HEALTH_TIMEOUT_MS = 3000;
export const FEEDBACK_TIMEOUT_MS = 70000;
const ACCESS_KEY = 'qs.v2.coachAccess';

const STATUS_CODE = {
  400: ERROR_CODE.badRequest,
  401: ERROR_CODE.unauthorized,
  403: ERROR_CODE.unauthorized,
  413: ERROR_CODE.tooLarge,
  429: ERROR_CODE.rateLimited,
  402: ERROR_CODE.budgetExhausted,
  502: ERROR_CODE.providerError,
  503: ERROR_CODE.unavailable,
  504: ERROR_CODE.timeout,
};

export const ERROR_TEXT = {
  [ERROR_CODE.badRequest]: 'The coach could not read this request.',
  [ERROR_CODE.unauthorized]: 'The coach needs an access code. Add it in the coach settings.',
  [ERROR_CODE.tooLarge]: 'The images were too large to send.',
  [ERROR_CODE.rateLimited]: 'Too many requests right now. Wait a minute, then try again.',
  [ERROR_CODE.budgetExhausted]: 'The coach has reached its usage limit for today.',
  [ERROR_CODE.timeout]: 'The coach took too long to answer. Try again.',
  [ERROR_CODE.cancelled]: '',
  [ERROR_CODE.unavailable]: 'The coach is not available. Everything else still works.',
  [ERROR_CODE.refused]: 'The coach declined to review this one.',
  [ERROR_CODE.invalidResponse]: 'The coach sent an answer that could not be checked, so it is not shown.',
  [ERROR_CODE.providerError]: 'The coach service had a problem. Try again later.',
};

export function getAccessCode() {
  try {
    return localStorage.getItem(ACCESS_KEY) || '';
  } catch (e) {
    return '';
  }
}
export function setAccessCode(v) {
  try {
    if (v) {
      localStorage.setItem(ACCESS_KEY, v);
    } else {
      localStorage.removeItem(ACCESS_KEY);
    }
  } catch (e) {
    /* storage unavailable: the code lasts for this page only */
  }
}

function withTimeoutSignal(signal, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(t);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

export async function coachHealth(fetchImpl) {
  const f = fetchImpl || fetch;
  const { signal, done } = withTimeoutSignal(null, HEALTH_TIMEOUT_MS);
  try {
    const r = await f(COACH_BASE + '/health', { signal, headers: { accept: 'application/json' } });
    if (!r.ok) {
      return { available: false };
    }
    const j = await r.json();
    return {
      available: j && j.ok === true,
      provider: j.provider || null,
      model: j.model || null,
      needsAccess: !!j.needsAccess,
    };
  } catch (e) {
    return { available: false };
  } finally {
    done();
  }
}

/* Returns { feedback, flags } or throws { code }. */
export async function requestCoachFeedback(payload, opts) {
  const o = opts || {};
  const f = o.fetchImpl || fetch;
  const { signal, done } = withTimeoutSignal(o.signal, o.timeoutMs || FEEDBACK_TIMEOUT_MS);
  let r;
  try {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    const code = o.accessCode != null ? o.accessCode : getAccessCode();
    if (code) {
      headers['x-qs-access'] = code;
    }
    r = await f(COACH_BASE + '/feedback', { method: 'POST', headers, body: JSON.stringify(payload), signal });
  } catch (e) {
    done();
    if (o.signal && o.signal.aborted) {
      throw { code: ERROR_CODE.cancelled };
    }
    if ((e && e.name === 'TimeoutError') || (signal.reason && signal.reason.name === 'TimeoutError')) {
      throw { code: ERROR_CODE.timeout };
    }
    throw { code: ERROR_CODE.unavailable };
  }
  try {
    if (!r.ok) {
      let code = STATUS_CODE[r.status] || ERROR_CODE.providerError;
      try {
        const j = await r.json();
        if (j && j.error && Object.values(ERROR_CODE).includes(j.error.code)) {
          code = j.error.code;
        }
      } catch (e) {
        /* non-JSON error body */
      }
      throw { code };
    }
    let body;
    try {
      body = await r.json();
    } catch (e) {
      throw { code: ERROR_CODE.invalidResponse };
    }
    const clean = sanitizeFeedback(body && body.feedback, payload.evidence || []);
    return {
      feedback: clean.feedback,
      flags: [...new Set(clean.flags.concat(body.flags || []))],
      model: body.model || null,
    };
  } finally {
    done();
  }
}
