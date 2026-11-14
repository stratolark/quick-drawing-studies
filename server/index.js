/* Optional AI coach backend. Start with `npm run server` (real provider) or `npm run server:mock`. */
import http from 'node:http';
import { loadConfig, PROVIDER } from './config.js';
import { createCoachHandler } from './app.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createMockProvider } from './providers/mock.js';

const PROVIDERS = {
  [PROVIDER.anthropic]: createAnthropicProvider,
  [PROVIDER.mock]: createMockProvider,
  [PROVIDER.off]: () => null,
};

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error('[coach] ' + e.message);
  process.exit(1);
}

const provider = PROVIDERS[cfg.provider](cfg);
const handler = createCoachHandler({ cfg, provider });
const server = http.createServer((req, res) => {
  handler(req, res).catch(err => {
    console.error('[coach] unhandled error: ' + (err && err.message));
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"code":"internal"}}'); }
  });
});
server.requestTimeout = cfg.timeoutMs + 15000;
server.listen(cfg.port, cfg.host, () => {
  console.log(`[coach] listening on http://${cfg.host}:${cfg.port} provider=${provider ? provider.name : 'off'}${provider ? ' model=' + provider.model : ''}${cfg.accessToken ? ' (access code required)' : ''}${cfg.staticDir ? ' static=' + cfg.staticDir : ''}`);
  console.log(`[coach] limits: ${cfg.ratePerMinute}/min, ${cfg.ratePerDay}/day per client, $${cfg.dailyBudgetUsd}/day budget, ${cfg.timeoutMs}ms timeout`);
});
