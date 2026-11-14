/* Server configuration from environment variables and command-line flags. Secrets stay in the environment. */
import fs from 'node:fs';

export const PROVIDER = Object.freeze({ anthropic: 'anthropic', mock: 'mock', off: 'off' });
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function flag(argv, name) {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
}
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  if (env === process.env && fs.existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
  const provider = flag(argv, 'provider') || env.QS_COACH_PROVIDER || (env.ANTHROPIC_API_KEY ? PROVIDER.anthropic : PROVIDER.off);
  const cfg = {
    host: env.QS_SERVER_HOST || '127.0.0.1',
    port: num(flag(argv, 'port') || env.QS_SERVER_PORT, 8787),
    provider,
    model: env.QS_MODEL || 'claude-opus-5-5',
    effort: env.QS_EFFORT || 'medium',
    fallbacks: env.QS_FALLBACKS !== 'off',
    accessToken: env.QS_ACCESS_TOKEN || '',
    timeoutMs: num(env.QS_TIMEOUT_MS, 60000),
    ratePerMinute: num(env.QS_RATE_PER_MINUTE, 6),
    ratePerDay: num(env.QS_RATE_PER_DAY, 100),
    dailyBudgetUsd: num(env.QS_DAILY_BUDGET_USD, 2),
    staticDir: env.QS_STATIC_DIR || (fs.existsSync('dist') ? 'dist' : ''),
    mockMode: env.QS_MOCK_MODE || 'ok',
    hasApiKey: !!env.ANTHROPIC_API_KEY,
  };
  if (!Object.values(PROVIDER).includes(cfg.provider)) throw new Error('QS_COACH_PROVIDER must be anthropic, mock or off');
  // A paid endpoint reachable from other machines must not be anonymous.
  if (!LOOPBACK.has(cfg.host) && cfg.provider === PROVIDER.anthropic && !cfg.accessToken) {
    throw new Error('Refusing to listen on ' + cfg.host + ' with a paid provider and no QS_ACCESS_TOKEN.');
  }
  if (cfg.provider === PROVIDER.anthropic && !cfg.hasApiKey) throw new Error('QS_COACH_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment.');
  return cfg;
}
