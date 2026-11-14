/* Abuse controls for the coach endpoint: per-client rate limits, a daily spending budget and access checks.
   State is in memory; restarting the server resets it, which is acceptable for a single local instance. */
import crypto from 'node:crypto';

const MINUTE_MS = 60000;
const dayKey = now => new Date(now).toISOString().slice(0, 10);

export function createRateLimiter({ perMinute, perDay }) {
  const clients = new Map();
  return {
    /* Returns null when allowed, or the number of seconds to wait. */
    check(id, now = Date.now()) {
      const day = dayKey(now);
      let c = clients.get(id);
      if (!c || c.day !== day) { c = { day, total: 0, recent: [] }; clients.set(id, c); }
      c.recent = c.recent.filter(t => now - t < MINUTE_MS);
      if (c.total >= perDay) return Math.ceil((Date.parse(day + 'T00:00:00Z') + 86400000 - now) / 1000);
      if (c.recent.length >= perMinute) return Math.ceil((MINUTE_MS - (now - c.recent[0])) / 1000);
      c.recent.push(now);
      c.total++;
      return null;
    },
  };
}

export function createBudget({ dailyUsd }) {
  let day = null, spent = 0;
  const roll = now => { const d = dayKey(now); if (d !== day) { day = d; spent = 0; } };
  return {
    allows(now = Date.now()) { roll(now); return spent < dailyUsd; },
    record(usd, now = Date.now()) { roll(now); spent += Math.max(0, usd || 0); },
    get spent() { return spent; },
  };
}

/* Constant-time comparison so the access code cannot be guessed byte by byte. */
export function accessAllowed(expected, given) {
  if (!expected) return true;
  if (typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}
