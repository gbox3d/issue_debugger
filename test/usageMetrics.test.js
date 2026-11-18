import assert from "node:assert/strict";
import { test } from "node:test";
import {
  withUsageMetrics, getUsageMetrics, trackLlmCall,
  recordSkippedLlmCall, recordVerifiedCacheHit,
} from "../src/services/llm/usageMetrics.js";

const metadata = { provider: "anthropic", model: "test-model", stage: "FactCheck" };
const fullUsage = { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("unused scopes report known zero work and explicit skipped calls/cache hits", async () => {
  assert.equal(getUsageMetrics(), null);
  recordSkippedLlmCall({ stage: "outside", reason: "outside" });
  recordVerifiedCacheHit();
  const result = await withUsageMetrics(async () => {
    recordSkippedLlmCall({ stage: "AgentA_Origin", reason: "no_sources" });
    recordSkippedLlmCall({ stage: "FactCheck", reason: "verified_cache_hit", count: 2 });
    recordVerifiedCacheHit();
    recordSkippedLlmCall({ count: -1 });
    recordVerifiedCacheHit({ count: NaN });
    const usage = getUsageMetrics();
    assert.equal(usage.call_count, 0);
    assert.equal(usage.skipped_call_count, 3);
    assert.equal(usage.verified_cache_hits, 1);
    assert.deepEqual(usage.token_totals, {
      input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    });
    return "original callback result";
  });
  assert.equal(result, "original callback result");
  assert.equal(getUsageMetrics(), null);
});

test("overlapping asynchronous requests isolate calls, usage, skips and cache hits", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const first = withUsageMetrics(async () => {
    await trackLlmCall({ ...metadata, stage: "first" }, async capture => {
      await firstGate.promise;
      capture(fullUsage);
      recordSkippedLlmCall({ stage: "first", reason: "no_sources" });
    });
    secondGate.resolve();
    return getUsageMetrics();
  });
  const second = withUsageMetrics(async () => {
    await trackLlmCall({ provider: "openai", model: "second-model", stage: "second" }, async capture => {
      capture({ prompt_tokens: 100, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 80 } });
      recordVerifiedCacheHit();
      firstGate.resolve();
      await secondGate.promise;
    });
    return getUsageMetrics();
  });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.call_count, 1);
  assert.equal(b.call_count, 1);
  assert.equal(a.calls[0].stage, "first");
  assert.equal(b.calls[0].stage, "second");
  assert.equal(a.token_totals.input_tokens, 10);
  assert.equal(b.token_totals.input_tokens, 100);
  assert.equal(a.skipped_call_count, 1);
  assert.equal(b.skipped_call_count, 0);
  assert.equal(a.verified_cache_hits, 0);
  assert.equal(b.verified_cache_hits, 1);
  assert.equal(b.token_totals.output_tokens, 0);
  assert.equal(b.token_totals.cache_creation_input_tokens, null);
  assert.equal(getUsageMetrics(), null);
});

test("failed calls retain received usage but unknown usage never becomes zero", async () => {
  const originalError = new Error("private provider error and response body");
  await withUsageMetrics(async () => {
    await assert.rejects(trackLlmCall(metadata, async capture => {
      capture(fullUsage);
      throw originalError;
    }), error => error === originalError);
    await assert.rejects(trackLlmCall(metadata, async () => { throw originalError; }), error => error === originalError);
    await trackLlmCall(metadata, async capture => capture({ input_tokens: 0, output_tokens: 0 }));
    const usage = getUsageMetrics();
    assert.equal(usage.call_count, 3);
    assert.equal(usage.failure_count, 2);
    assert.equal(usage.success_count, 1);
    assert.equal(usage.pending_count, 0);
    assert.equal(usage.token_totals.input_tokens, null);
    assert.equal(usage.measured_token_totals.input_tokens, 10);
    assert.equal(usage.unmeasured_calls.input_tokens, 1);
    assert.equal(usage.unmeasured_calls.cache_read_input_tokens, 2);
    assert.deepEqual(usage.calls[0].tokens, fullUsage);
    assert.equal(usage.calls[1].tokens.input_tokens, null);
    assert.equal(JSON.stringify(usage).includes(originalError.message), false);
    assert.ok(usage.calls.every(call => call.duration_ms >= 0));
  });
});

test("nested scopes restore their parent, snapshots cannot mutate live metrics, and thrown callbacks exit cleanly", async () => {
  await withUsageMetrics(async () => {
    recordVerifiedCacheHit();
    await withUsageMetrics(async () => {
      assert.equal(getUsageMetrics().verified_cache_hits, 0);
      await trackLlmCall(metadata, async capture => capture(fullUsage));
      const snapshot = getUsageMetrics();
      snapshot.calls[0].tokens.input_tokens = 999;
      assert.equal(getUsageMetrics().calls[0].tokens.input_tokens, 10);
    });
    assert.equal(getUsageMetrics().verified_cache_hits, 1);
    assert.equal(getUsageMetrics().call_count, 0);
  });
  const error = new Error("request failed");
  await assert.rejects(withUsageMetrics(async () => { throw error; }), caught => caught === error);
  assert.equal(getUsageMetrics(), null);
});

test("invalid measurements and free-form metadata are not persisted as usage", async () => {
  await withUsageMetrics(async () => {
    await trackLlmCall({ ...metadata, stage: "a private prompt with spaces", messages: [{ content: "private prompt" }], apiKey: "private-key" }, async capture => {
      capture({ input_tokens: -1, output_tokens: "10", cache_read_input_tokens: NaN, cache_creation_input_tokens: Infinity });
    });
    recordSkippedLlmCall({ stage: "FactCheck", reason: "a private response body" });
    const usage = getUsageMetrics();
    assert.equal(usage.calls[0].stage, "unspecified");
    assert.ok(Object.values(usage.calls[0].tokens).every(value => value === null));
    assert.ok(Object.values(usage.measured_token_totals).every(value => value === null));
    assert.equal(usage.skipped[0].reason, "unspecified");
    assert.equal(JSON.stringify(usage).includes("private"), false);
  });
});
