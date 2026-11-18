import { AsyncLocalStorage } from "node:async_hooks";

const contexts = new AsyncLocalStorage();
const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
const emptyTokens = () => Object.fromEntries(TOKEN_FIELDS.map(field => [field, null]));
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const code = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : "unspecified";
const elapsed = started => Math.max(0, Math.round(performance.now() - started));

// The callback's return value and errors remain unchanged. Each invocation,
// including nested invocations, owns a separate context across async work.
export function withUsageMetrics(callback) {
  return contexts.run({ started: performance.now(), calls: [], skipped: [], cacheHits: 0 }, callback);
}

function normalizeUsage(provider, usage) {
  if (!usage || typeof usage !== "object") return emptyTokens();
  return provider === "openai" ? {
    input_tokens: tokenCount(usage.prompt_tokens),
    output_tokens: tokenCount(usage.completion_tokens),
    cache_read_input_tokens: tokenCount(usage.prompt_tokens_details?.cached_tokens),
    cache_creation_input_tokens: null, // Chat Completions does not report this field.
  } : {
    input_tokens: tokenCount(usage.input_tokens),
    output_tokens: tokenCount(usage.output_tokens),
    cache_read_input_tokens: tokenCount(usage.cache_read_input_tokens),
    cache_creation_input_tokens: tokenCount(usage.cache_creation_input_tokens),
  };
}

// Adapters report usage immediately after receiving a response, before parsing
// content. A billed response can still fail JSON parsing, refuse or truncate.
// SDK transport retries are not separately observable: one record is one
// adapter invocation, not a claim about the number of HTTP attempts.
export async function trackLlmCall({ provider, model, stage }, callback) {
  const context = contexts.getStore();
  if (!context) return callback(() => {});
  const started = performance.now();
  const call = {
    provider: code(provider), model: code(model), stage: code(stage), status: "pending",
    duration_ms: null,
    input_tokens_include_cache: provider === "openai",
    tokens: emptyTokens(),
  };
  context.calls.push(call);
  const capture = (usage, responseModel) => {
    call.tokens = normalizeUsage(provider, usage);
    if (typeof responseModel === "string") call.model = code(responseModel);
  };
  try {
    const result = await callback(capture);
    call.status = "succeeded";
    return result;
  } catch (error) {
    call.status = "failed";
    throw error;
  } finally {
    call.duration_ms = elapsed(started);
  }
}

export function recordSkippedLlmCall({ stage, reason, count = 1 } = {}) {
  const context = contexts.getStore();
  if (!context || !Number.isSafeInteger(count) || count <= 0) return;
  context.skipped.push({ stage: code(stage), reason: code(reason), count });
}

export function recordVerifiedCacheHit({ count = 1 } = {}) {
  const context = contexts.getStore();
  if (context && Number.isSafeInteger(count) && count > 0) context.cacheHits += count;
}

// Only numeric usage and bounded metadata are retained. No messages, keys,
// response bodies or exception text enter this collector. Totals preserve each
// provider's input-token convention (see input_tokens_include_cache per call);
// they must not be interpreted as billable tokens or used to invent a price.
export function getUsageMetrics() {
  const context = contexts.getStore();
  if (!context) return null;
  const calls = structuredClone(context.calls);
  const token_totals = {};
  const measured_token_totals = {};
  const unmeasured_calls = {};
  for (const field of TOKEN_FIELDS) {
    const measured = calls.filter(call => call.tokens[field] !== null);
    unmeasured_calls[field] = calls.length - measured.length;
    const sum = measured.reduce((total, call) => total + call.tokens[field], 0);
    // Zero means known zero work. Missing provider measurements remain null.
    measured_token_totals[field] = measured.length || !calls.length ? sum : null;
    token_totals[field] = unmeasured_calls[field] ? null : sum;
  }
  return {
    version: "llm-usage-v1",
    call_count_semantics: "adapter_invocations",
    duration_ms: elapsed(context.started),
    call_count: calls.length,
    success_count: calls.filter(call => call.status === "succeeded").length,
    failure_count: calls.filter(call => call.status === "failed").length,
    pending_count: calls.filter(call => call.status === "pending").length,
    skipped_call_count: context.skipped.reduce((total, item) => total + item.count, 0),
    verified_cache_hits: context.cacheHits,
    token_totals,
    measured_token_totals,
    unmeasured_calls,
    calls,
    skipped: structuredClone(context.skipped),
  };
}
