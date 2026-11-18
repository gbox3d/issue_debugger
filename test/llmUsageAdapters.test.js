import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "../src/config.js";
import { chatJson, withUsageMetrics, getUsageMetrics } from "../src/services/llm/index.js";
import { anthropicAdapter } from "../src/services/llm/anthropicAdapter.js";
import { openaiAdapter } from "../src/services/llm/openaiAdapter.js";

config.anthropic.apiKey = "test-only-key";
config.openai.apiKey = "test-only-key";
const originalFetch = globalThis.fetch;
let response;
globalThis.fetch = async () => {
  if (response.error) throw response.error;
  return new Response(JSON.stringify(response.body), {
    status: response.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};
after(() => { globalThis.fetch = originalFetch; });

const input = { messages: [{ role: "user", content: "private prompt" }], schemaName: "UsageFixture" };
const anthropicReply = (usage, stop_reason = "end_turn") => ({ body: {
  id: "msg_test", type: "message", role: "assistant", model: "claude-fixture-model",
  content: [{ type: "text", text: '{"valid":true}' }], stop_reason, usage,
} });
const openaiReply = (usage, content = '{"valid":true}') => ({ body: {
  model: "gpt-fixture-model", choices: [{ message: { content } }], usage,
} });

test("Anthropic reports actual input/output/cache tokens without changing the JSON contract", async () => {
  const tokens = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 };
  response = anthropicReply(tokens);
  await withUsageMetrics(async () => {
    assert.deepEqual(await chatJson({ ...input, provider: "anthropic" }), { valid: true });
    const usage = getUsageMetrics();
    assert.equal(usage.call_count, 1);
    assert.equal(usage.success_count, 1);
    assert.deepEqual(usage.token_totals, tokens);
    assert.equal(usage.calls[0].model, "claude-fixture-model");
    assert.equal(usage.calls[0].input_tokens_include_cache, false);
    assert.equal(JSON.stringify(usage).includes("private prompt"), false);
    assert.equal(JSON.stringify(usage).includes("test-only-key"), false);
    assert.equal(JSON.stringify(usage).includes('"valid":true'), false);
  });
});

test("OpenAI maps cache reads from usage details and preserves unavailable cache creation", async () => {
  response = openaiReply({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } });
  await withUsageMetrics(async () => {
    assert.deepEqual(await chatJson({ ...input, provider: "openai" }), { valid: true });
    const usage = getUsageMetrics();
    assert.equal(usage.call_count, 1);
    assert.deepEqual(usage.calls[0].tokens, {
      input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 64, cache_creation_input_tokens: null,
    });
    assert.equal(usage.calls[0].input_tokens_include_cache, true);
    assert.equal(usage.calls[0].model, "gpt-fixture-model");
  });
});

test("refusal, truncation and invalid output still record received billable usage as failed calls", async () => {
  for (const stop of ["refusal", "max_tokens"]) {
    response = anthropicReply({ input_tokens: 12, output_tokens: 6 }, stop);
    await withUsageMetrics(async () => {
      await assert.rejects(anthropicAdapter.chatJson(input));
      assert.equal(getUsageMetrics().failure_count, 1);
      assert.equal(getUsageMetrics().token_totals.output_tokens, 6);
    });
  }
  response = openaiReply({ prompt_tokens: 10, completion_tokens: 2 }, "[]");
  await withUsageMetrics(async () => {
    await assert.rejects(openaiAdapter.chatJson(input), /non-JSON/);
    assert.equal(getUsageMetrics().failure_count, 1);
    assert.equal(getUsageMetrics().token_totals.input_tokens, 10);
  });
});

test("HTTP/network failures and successful responses without usage remain explicitly unmeasured", async () => {
  for (const [adapter, fixture] of [
    [anthropicAdapter, { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Invalid model" } } }],
    [openaiAdapter, { status: 400, body: { error: { message: "Invalid model" } } }],
    [openaiAdapter, { error: new Error("mock network failure") }],
  ]) {
    response = fixture;
    await withUsageMetrics(async () => {
      await assert.rejects(adapter.chatJson(input));
      const usage = getUsageMetrics();
      assert.equal(usage.failure_count, 1);
      assert.equal(usage.token_totals.input_tokens, null);
      assert.equal(usage.measured_token_totals.input_tokens, null);
      assert.equal(usage.unmeasured_calls.input_tokens, 1);
    });
  }
  for (const [adapter, fixture] of [[anthropicAdapter, anthropicReply(undefined)], [openaiAdapter, openaiReply(undefined)]]) {
    response = fixture;
    await withUsageMetrics(async () => {
      assert.deepEqual(await adapter.chatJson(input), { valid: true });
      assert.equal(getUsageMetrics().success_count, 1);
      assert.equal(getUsageMetrics().token_totals.output_tokens, null);
    });
  }
});

test("malformed response envelopes preserve the existing invalid-output failure", async () => {
  response = { body: null };
  await withUsageMetrics(async () => {
    await assert.rejects(openaiAdapter.chatJson(input), /non-JSON output/);
    assert.equal(getUsageMetrics().failure_count, 1);
    assert.equal(getUsageMetrics().token_totals.input_tokens, null);
  });
});
