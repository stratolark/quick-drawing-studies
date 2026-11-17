/* Claude provider: one Messages API call with structured JSON output and server-side refusal fallback. */
import Anthropic, {
  APIUserAbortError,
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError,
  AuthenticationError,
  PermissionDeniedError,
  BadRequestError,
  InternalServerError,
  APIError,
} from '@anthropic-ai/sdk';
import { ERROR_CODE, feedbackJsonSchema } from '../../src/coach/schema.js';
import { SYSTEM_PROMPT, buildUserContent } from '../prompt.js';

/* USD per million tokens (input, output), from the published price list on 2026-11-14.
   Unknown models are charged at the highest listed rate so the budget errs on the safe side. */
const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-2': [8, 40],
};
const FALLBACK_PRICE = [8, 40];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/* Thinking counts toward max_tokens; the JSON answer itself is short. */
const MAX_TOKENS = 16000;

export function costUsd(model, usage) {
  // With fallback, top-level usage covers only the serving model.
  const attempts = usage.iterations?.length ? usage.iterations : [usage];
  return attempts.reduce(
    (total, attempt) => total + priceUsage(PRICES[attempt.model ?? model] ?? FALLBACK_PRICE, attempt),
    0,
  );
}

function priceUsage([pin, pout], usage) {
  return ((usage.input_tokens || 0) * pin + (usage.output_tokens || 0) * pout) / 1e6;
}

function mapError(e, signal) {
  if (e instanceof APIUserAbortError) {
    return { code: signal && signal.reason === 'timeout' ? ERROR_CODE.timeout : ERROR_CODE.cancelled };
  }
  if (e instanceof APIConnectionTimeoutError) {
    return { code: ERROR_CODE.timeout };
  }
  if (e instanceof RateLimitError) {
    return { code: ERROR_CODE.rateLimited, costUsd: 0 };
  }
  if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
    return { code: ERROR_CODE.providerError, costUsd: 0, log: 'provider rejected the API key' };
  }
  if (e instanceof BadRequestError) {
    return { code: ERROR_CODE.providerError, costUsd: 0, log: 'provider rejected the request: ' + e.message };
  }
  if (e instanceof InternalServerError) {
    return { code: ERROR_CODE.unavailable };
  }
  if (e instanceof APIConnectionError) {
    return { code: ERROR_CODE.unavailable };
  }
  if (e instanceof APIError) {
    return { code: ERROR_CODE.providerError, log: 'provider error ' + e.status };
  }
  return null;
}

export function createAnthropicProvider(cfg) {
  const client = new Anthropic({ timeout: cfg.timeoutMs, maxRetries: 0 });
  const promptParams = req => ({
    model: cfg.model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(req) }],
    output_config: {
      effort: cfg.effort,
      format: { type: 'json_schema', schema: feedbackJsonSchema(req.evidence.map(e => e.key)) },
    },
  });
  return {
    name: 'anthropic',
    model: cfg.model,
    async maxCostUsd(req, { signal }) {
      try {
        const { input_tokens } = await client.beta.messages.countTokens(promptParams(req), { signal });
        const maxUsage = { input_tokens, output_tokens: MAX_TOKENS };
        const primaryCost = costUsd(cfg.model, maxUsage);
        return cfg.fallbacks ? primaryCost + priceUsage(FALLBACK_PRICE, maxUsage) : primaryCost;
      } catch (e) {
        throw mapError(e, signal) || e;
      }
    },
    async review(req, { signal }) {
      const params = {
        ...promptParams(req),
        max_tokens: MAX_TOKENS,
      };
      if (cfg.fallbacks) {
        params.betas = [FALLBACK_BETA];
        params.fallbacks = 'default';
      }
      let resp;
      try {
        resp = await client.beta.messages.create(params, { signal });
      } catch (e) {
        const m = mapError(e, signal);
        if (m) {
          throw m;
        }
        throw e;
      }
      if (!resp.usage) {
        // Without reported usage the budget keeps the reservation.
        throw { code: ERROR_CODE.invalidResponse, log: 'provider returned no usage' };
      }
      const usage = resp.usage;
      const cost = costUsd(resp.model || cfg.model, usage);
      if (resp.stop_reason === 'refusal') {
        throw { code: ERROR_CODE.refused, costUsd: cost };
      }
      if (resp.stop_reason === 'max_tokens') {
        throw { code: ERROR_CODE.invalidResponse, costUsd: cost, log: 'response hit max_tokens' };
      }
      const text = (resp.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        throw { code: ERROR_CODE.invalidResponse, costUsd: cost, log: 'response was not JSON' };
      }
      return {
        raw,
        model: resp.model || cfg.model,
        usage: { inputTokens: usage.input_tokens || 0, outputTokens: usage.output_tokens || 0 },
        costUsd: cost,
      };
    },
  };
}
