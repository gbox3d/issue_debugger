import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "../src/config.js";
import { anthropicAdapter } from "../src/services/llm/anthropicAdapter.js";
import { getAdapter, getLlmInfo } from "../src/services/llm/index.js";

config.llm.provider = "anthropic";
config.anthropic.apiKey = "test-api-key";
config.anthropic.model = "claude-opus-5-5";
config.anthropic.maxTokens = 8192;

const originalFetch = globalThis.fetch;
let response;
let request;
globalThis.fetch = async (url, init) => {
  request = { url: String(url), body: JSON.parse(init.body) };
  return new Response(JSON.stringify(response.body), {
    status: response.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};
after(() => { globalThis.fetch = originalFetch; });

const messages = [
  { role: "system", content: "Return a JSON object." },
  { role: "system", content: "Use the provided evidence." },
  { role: "user", content: "Extract a claim." },
];
const call = () => anthropicAdapter.chatJson({ messages, schemaName: "Test", temperature: 0.2 });
const reply = (content, stop_reason = "end_turn") => ({
  body: {
    id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
    content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  },
});

test("Opus request separates system messages and parses text after thinking", async () => {
  response = reply([
    { type: "thinking", thinking: "Ignored reasoning", signature: "test" },
    { type: "text", text: '{"claims":[]}' },
  ]);
  assert.deepEqual(await call(), { claims: [] });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.body.model, "claude-opus-5-5");
  assert.equal(request.body.max_tokens, 8192);
  assert.equal(request.body.system, "Return a JSON object.\n\nUse the provided evidence.");
  assert.deepEqual(request.body.messages, [messages[2]]);
  assert.deepEqual(request.body.output_config, { effort: "medium" });
  for (const field of ["thinking", "temperature", "top_p", "top_k"]) {
    assert.equal(field in request.body, false, `${field} must be omitted`);
  }
});

test("fenced JSON remains compatible with existing prompts", async () => {
  response = reply([{ type: "text", text: '```json\n{"claims":[]}\n```' }]);
  assert.deepEqual(await call(), { claims: [] });
});

test("refusal is rejected even if the response contains JSON", async () => {
  response = reply([{ type: "text", text: '{"claims":[]}' }], "refusal");
  await assert.rejects(call, /Claude refused the request/);
});

test("token-limited responses are rejected before parsing a valid partial object", async () => {
  response = reply([{ type: "text", text: '{"claims":[]}' }], "max_tokens");
  await assert.rejects(call, /max_tokens|token limit|truncat/i);
});

test("API errors preserve the provider and status", async () => {
  response = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Invalid model" } } };
  await assert.rejects(call, /Anthropic error: 400/);
});

test("router reports Opus and preserves the explicit OpenAI option", async () => {
  assert.equal(getAdapter(), anthropicAdapter);
  assert.equal(getAdapter("openai").name, "openai");
  const info = await getLlmInfo();
  assert.equal(info.provider, "anthropic");
  assert.equal(info.model, "claude-opus-5-5");
  assert.equal(info.ok, true);
});
