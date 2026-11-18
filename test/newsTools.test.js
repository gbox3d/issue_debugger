import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.js";
import { searchNaverNewsDetailed } from "../src/services/web/naverSearch.js";
import { searchWebDetailed } from "../src/services/web/tavilySearch.js";
import { createNewsTools, NEWS_TOOL_SCHEMAS } from "../src/services/web/newsTools.js";

function credentials(t) {
  const old = { naver: { ...config.naver }, web: { ...config.web } };
  Object.assign(config.naver, { clientId: "test-id", clientSecret: "test-secret" });
  Object.assign(config.web, { enabled: true, tavilyApiKey: "test-key" });
  t.after(() => { Object.assign(config.naver, old.naver); Object.assign(config.web, old.web); });
}

test("news search requests relevance ordering and reports HTTP failure separately from zero results", async t => {
  credentials(t);
  let requestUrl;
  const result = await searchNaverNewsDetailed({ query: "가온 나래", count: 8, request: async url => {
    requestUrl = new URL(url);
    return { ok: true, json: async () => ({ items: [] }) };
  } });
  assert.equal(requestUrl.searchParams.get("sort"), "sim");
  assert.equal(result.status, "no_results");
  const failure = await searchNaverNewsDetailed({ query: "가온", request: async () => ({ ok: false, status: 429, text: () => { throw new Error("Never log response bodies"); } }) });
  assert.equal(failure.status, "error");
  assert.equal(failure.error_code, "http_429");
  config.naver.clientId = "";
  const disabled = await searchNaverNewsDetailed({ query: "가온", request: () => { throw new Error("must not call"); } });
  assert.equal(disabled.status, "disabled");
});

test("web search preserves relevance order and marks inferred dates only as discovery metadata", async t => {
  credentials(t);
  const result = await searchWebDetailed({ query: "Gaon Nara", request: async () => ({ ok: true, json: async () => ({ results: [
    { url: "https://older.example/20200101/report", title: "Relevant", score: 0.99 },
    { url: "https://new.example/20260101/report", title: "Unrelated recent", score: 0.2 },
  ] }) }) });
  assert.deepEqual(result.results.map(item => item.title), ["Relevant", "Unrelated recent"]);
  assert.equal(result.results[0].published_at_source, "url_inferred");
  const malformed = await searchWebDetailed({ query: "Gaon", request: async () => ({ ok: true, json: async () => ({ error: "hidden detail" }) }) });
  assert.equal(malformed.error_code, "invalid_response");
});

test("agent-facing tools validate query and URL inputs before invoking providers", async t => {
  credentials(t);
  let calls = 0;
  const forbidden = async () => { calls++; throw new Error("secret must never be returned"); };
  const tools = createNewsTools({ searchNews: forbidden, searchWeb: forbidden, fetchArticle: forbidden });
  assert.deepEqual(NEWS_TOOL_SCHEMAS.map(item => item.name), ["search_news", "search_web", "fetch_article"]);
  for (const input of [{}, { query: "" }, { query: "x".repeat(161) }, { query: "hello\nworld" }, { query: "valid", count: 11 }, { query: "valid", token: "bad" }]) {
    assert.equal((await tools.search_news(input)).error_code, "invalid_input");
    assert.equal((await tools.search_web(input)).error_code, "invalid_input");
  }
  for (const input of [{}, { url: "file:///etc/passwd" }, { url: "https://user:password@example.com/" }, { url: "https://example.com", extra: true }]) {
    assert.ok(["invalid_input", "invalid_url"].includes((await tools.fetch_article(input)).error_code));
  }
  assert.equal((await tools.fetch_article({ url: "https://www.youtube.com/watch?v=example" })).error_code, "unsupported_video");
  assert.equal(calls, 0);
  assert.deepEqual(await tools.search_news({ query: "valid" }), { provider: "naver", status: "error", error_code: "network_error", results: [] });
});

test("article tool keeps the URL fetcher's private-address protections", async () => {
  const tools = createNewsTools();
  const result = await tools.fetch_article({ url: "http://127.0.0.1/private" });
  assert.equal(result.status, "blocked");
  assert.equal(result.error_code, "blocked_url");
});
