/* AI coach contract shared by the browser client and the Node backend: request limits and validation,
   image inspection, the structured-output schema, and response sanitizing.
   The model never supplies measurements. Evidence it cites must name a measurement the app sent, and
   numbers with units that do not match a sent measurement are removed before anyone sees them. */
import { OBJECTIVES, GUIDANCE_LEVELS } from '../learning/curriculum.js';
import { ATTEMPT_TYPE } from '../learning/session-engine.js';
import { metricRows } from '../analysis/metrics.js';
import { ISSUE_LABEL } from '../analysis/issues.js';

export const COACH_API_VERSION = 1;

export const LIMITS = Object.freeze({
  maxImages: 3,
  maxImageBytes: 1_500_000,
  maxImageSide: 2048,
  maxBodyBytes: 6_500_000,
  maxEvidence: 8,
  text: 300,
  shortText: 40,
});

export const IMAGE_ROLE = Object.freeze({ reference: 'reference', drawing: 'drawing', overlay: 'overlay' });
export const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png']);
export const STYLE = Object.freeze({ normal: 'normal', simpler: 'simpler' });

export const ERROR_CODE = Object.freeze({
  badRequest: 'bad_request',
  unauthorized: 'unauthorized',
  tooLarge: 'too_large',
  rateLimited: 'rate_limited',
  budgetExhausted: 'budget_exhausted',
  timeout: 'timeout',
  cancelled: 'cancelled',
  unavailable: 'unavailable',
  refused: 'refused',
  invalidResponse: 'invalid_response',
  providerError: 'provider_error',
});

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* Read the real format and pixel size from the file header. Never trust the declared media type. */
export function inspectImage(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const u32 = o => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { type: 'image/png', width: u32(16), height: u32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      const len = (b[o + 2] << 8) | b[o + 3];
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'image/jpeg', height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8] };
      }
      if (len < 2) {
        break;
      }
      o += 2 + len;
    }
    return { type: 'image/jpeg', width: 0, height: 0 };
  }
  return null;
}

export function decodeBase64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    return null;
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function validateImage(img) {
  if (!img || typeof img !== 'object') {
    return 'image must be an object';
  }
  if (!Object.values(IMAGE_ROLE).includes(img.role)) {
    return 'unknown image role';
  }
  if (!IMAGE_TYPES.includes(img.mediaType)) {
    return 'unsupported image type';
  }
  if (typeof img.data !== 'string' || img.data.length > Math.ceil((LIMITS.maxImageBytes * 4) / 3) + 4) {
    return 'image too large';
  }
  const bytes = decodeBase64(img.data);
  if (!bytes) {
    return 'image is not base64';
  }
  if (bytes.length > LIMITS.maxImageBytes) {
    return 'image too large';
  }
  const info = inspectImage(bytes);
  if (!info || info.type !== img.mediaType) {
    return 'image content does not match its type';
  }
  if (!info.width || !info.height || info.width > LIMITS.maxImageSide || info.height > LIMITS.maxImageSide) {
    return 'image dimensions out of range';
  }
  return null;
}

/* Validate an untrusted request body. Returns { ok, value } or { ok: false, error }. */
export function validateRequest(body) {
  const fail = error => ({ ok: false, error });
  if (!body || typeof body !== 'object') {
    return fail('body must be an object');
  }
  const O = OBJECTIVES[body.objectiveId];
  if (!O) {
    return fail('unknown objective');
  }
  if (!Object.values(ATTEMPT_TYPE).includes(body.attemptType)) {
    return fail('unknown attempt type');
  }
  if (!(body.guidance in GUIDANCE_LEVELS)) {
    return fail('unknown guidance level');
  }
  if (typeof body.secs !== 'number' || !(body.secs > 0) || body.secs > 3600) {
    return fail('secs out of range');
  }
  const style = body.style == null ? STYLE.normal : body.style;
  if (!Object.values(STYLE).includes(style)) {
    return fail('unknown style');
  }

  const keys = new Set(metricRows(O.evaluator).map(r => r.key));
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  if (evidence.length > LIMITS.maxEvidence) {
    return fail('too much evidence');
  }
  for (const e of evidence) {
    if (!e || !keys.has(e.key)) {
      return fail('evidence key not measured by this exercise');
    }
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) {
      return fail('evidence value must be a number');
    }
    if (!isStr(e.display, LIMITS.shortText) || !isStr(e.label, LIMITS.text)) {
      return fail('evidence text invalid');
    }
  }
  let issue = null;
  if (body.measuredIssue != null) {
    const i = body.measuredIssue;
    if (!i || !(i.id in ISSUE_LABEL) || !isStr(i.measured, LIMITS.text)) {
      return fail('measured issue invalid');
    }
    issue = { id: i.id, measured: i.measured };
  }
  let previous = null;
  if (body.previousFeedback != null) {
    if (!isStr(body.previousFeedback.mainIssue, LIMITS.text)) {
      return fail('previous feedback invalid');
    }
    previous = { mainIssue: body.previousFeedback.mainIssue };
  }
  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length || images.length > LIMITS.maxImages) {
    return fail('send one to three images');
  }
  const roles = new Set();
  for (const img of images) {
    const err = validateImage(img);
    if (err) {
      return fail(err);
    }
    if (roles.has(img.role)) {
      return fail('duplicate image role');
    }
    roles.add(img.role);
  }
  if (!roles.has(IMAGE_ROLE.drawing) && !roles.has(IMAGE_ROLE.overlay)) {
    return fail('the drawing must be included');
  }
  return {
    ok: true,
    value: {
      objectiveId: body.objectiveId,
      attemptType: body.attemptType,
      guidance: body.guidance,
      secs: body.secs,
      style,
      evidence: evidence.map(e => ({
        key: e.key,
        label: e.label,
        value: e.value,
        display: e.display,
        within: e.within === true ? true : e.within === false ? false : null,
      })),
      measuredIssue: issue,
      previousFeedback: previous,
      images: images.map(i => ({ role: i.role, mediaType: i.mediaType, data: i.data })),
    },
  };
}

export const FEEDBACK_FIELDS = [
  'whatWorked',
  'mainIssue',
  'whyItMatters',
  'howToCorrect',
  'nextExercise',
  'uncertainty',
];
export const VISUAL_EVIDENCE = 'visual';

/* JSON schema for structured output. Evidence may only cite the metric keys sent with this request. */
export function feedbackJsonSchema(evidenceKeys) {
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: FEEDBACK_FIELDS.concat('evidence'),
    properties: Object.assign(Object.fromEntries(FEEDBACK_FIELDS.map(f => [f, str])), {
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'observation'],
          properties: {
            source: { type: 'string', enum: [...new Set(evidenceKeys.concat(VISUAL_EVIDENCE))] },
            observation: str,
          },
        },
      },
    }),
  };
}

const UNIT_NUMBER = /(\d+(?:[.,]\d+)?)\s*(°|degrees?|%|percent|px|pixels?)/gi;
export const UNVERIFIED = '(unmeasured)';

/* Numbers the app actually measured, as they may appear in text. */
function allowedNumbers(evidence) {
  const out = new Set();
  for (const e of evidence) {
    for (const m of String(e.display).matchAll(/\d+(?:\.\d+)?/g)) {
      out.add(Number(m[0]));
    }
  }
  return out;
}

function scrub(text, allowed, flags) {
  return text.replace(UNIT_NUMBER, (whole, num) => {
    const n = Number(num.replace(',', '.'));
    for (const a of allowed) {
      if (Math.abs(a - n) <= 1) {
        return whole;
      }
    }
    flags.add('unverified-number');
    return UNVERIFIED;
  });
}

/* Validate and clean a model response. Throws { code: invalid_response } when the shape is wrong. */
export function sanitizeFeedback(raw, evidence) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw { code: ERROR_CODE.invalidResponse, message: 'response is not an object' };
  }
  const flags = new Set();
  const allowed = allowedNumbers(evidence || []);
  const keys = new Set((evidence || []).map(e => e.key).concat(VISUAL_EVIDENCE));
  const out = {};
  for (const f of FEEDBACK_FIELDS) {
    if (typeof raw[f] !== 'string') {
      throw { code: ERROR_CODE.invalidResponse, message: 'missing ' + f };
    }
    out[f] = scrub(clip(raw[f], 600), allowed, flags);
  }
  if (!out.mainIssue || !out.howToCorrect) {
    throw { code: ERROR_CODE.invalidResponse, message: 'empty main issue' };
  }
  const ev = Array.isArray(raw.evidence) ? raw.evidence : [];
  out.evidence = [];
  for (const e of ev.slice(0, LIMITS.maxEvidence)) {
    if (!e || typeof e.observation !== 'string' || !keys.has(e.source)) {
      flags.add('dropped-evidence');
      continue;
    }
    out.evidence.push({ source: e.source, observation: scrub(clip(e.observation, 300), allowed, flags) });
  }
  return { feedback: out, flags: [...flags] };
}
