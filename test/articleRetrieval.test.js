import assert from "node:assert/strict";
import { test } from "node:test";
import { claimQueries, counterQuery, createArticleRetrieval, retrievalFailure } from "../src/services/verification/retrieval.js";

const claim = { claim_id: "c1", type: "fact", claim_text: "가온과 나래가 계약을 발표했다.", entities: ["가온", "나래", "Gaon", "Nara"], search_queries: ["가온 나래 계약", "Gaon Nara contract", "가온 나래 발언 정정"] };
const ORIGINAL_TEXT = "가온과 나래의 계약 발표를 취재한 합성 기사 원문입니다. 공개된 설명과 당사자 발언을 비교하며 추가 확인이 필요한 내용도 본문에 기록했습니다. ".repeat(4);
const result = (url, title = "가온 나래 계약 발표") => ({ url, title, snippet: "Discovery text only", published_at: "2020-01-01" });
const batches = (naver, tavily) => ({ batches: [
  { provider: "naver", status: naver.length ? "ok" : "no_results", results: naver },
  { provider: "tavily", status: tavily.length ? "ok" : "no_results", results: tavily },
] });
function fixture(overrides = {}) {
  const fetched = [], saved = [], queries = [];
  const session = createArticleRetrieval({
    knowledgeCutoff: "2026-11-15T00:00:00Z", now: () => new Date("2026-11-15T00:00:00Z"),
    saveSnapshot: async snapshot => { saved.push(snapshot); },
    fetchSource: async ({ url }) => { fetched.push(url); return { ok: true, final_url: url, title: "원문", text: ORIGINAL_TEXT, published_at: "2026-11-14", published_at_source: "page_metadata" }; },
    search: async ({ query }) => { queries.push(query); return []; },
    ...overrides,
  });
  return { session, fetched, saved, queries };
}

test("failed first six originals do not exhaust the successful-source target", async () => {
  const fetched = [];
  const { session } = fixture({
    search: async () => batches(Array.from({ length: 8 }, (_, i) => result(`https://n${i}.example/article`)), Array.from({ length: 8 }, (_, i) => result(`https://t${i}.example/article`))),
    fetchSource: async ({ url }) => { fetched.push(url); return fetched.length <= 6 ? { ok: false, warning: "HTTP 403" } : { ok: true, final_url: url, text: ORIGINAL_TEXT }; },
  });
  const sources = await session.discover([claim]);
  assert.equal(sources.length, 6);
  assert.equal(fetched.length, 12);
  assert.equal(session.report().usable, 6);
  assert.equal(session.report().status, "complete");
  assert.equal(session.report().candidates.filter(item => item.state === "fetch_failed").length, 6);
  assert.deepEqual(new Set(fetched.slice(0, 2).map(url => new URL(url).hostname[0])), new Set(["n", "t"]));
  assert.ok(sources.every(source => source.text === ORIGINAL_TEXT));
});

test("relevance, provider fairness and domain diversity choose originals ahead of unrelated duplicates", async () => {
  const { session, fetched } = fixture({ search: async () => batches([
    result("https://same.example/unrelated", "오늘 주식 시황"), result("https://same.example/one"), result("https://same.example/two"), result("https://other.example/article"),
  ], [result("https://web.example/one"), result("https://web.example/two"), result("https://web2.example/article")]) });
  await session.discover([claim]);
  assert.deepEqual(new Set(fetched.slice(0, 4)), new Set(["https://same.example/one", "https://web.example/one", "https://other.example/article", "https://web2.example/article"]));
  assert.ok(!fetched.includes("https://same.example/unrelated"));
});

test("unsupported videos and duplicate URLs consume no fetch budget; source roles and date provenance survive", async () => {
  const inputUrl = "https://input.example/article";
  const { session, fetched } = fixture({ search: async () => batches([
    result("https://www.youtube.com/watch?v=example"), result(inputUrl), result("https://external.example/article"),
  ], [result("https://external.example/article")]) });
  await session.collectReferences([{ url: inputUrl, role: "input_article" }]);
  await session.collectReferences([{ url: inputUrl, role: "user_reference" }]);
  const sources = await session.discover([claim]);
  assert.equal(fetched.length, 2);
  assert.equal(session.report().attempted, 2);
  assert.ok(session.report().candidates.some(item => item.reason === "unsupported_video"));
  assert.ok(session.report().candidates.some(item => item.state === "duplicate"));
  assert.equal(sources[0].source_role, "input_article");
  assert.deepEqual(sources[0].collection_roles, ["input_article", "user_reference", "discovered_source"]);
  assert.equal(sources[1].source_role, "discovered_source");
  assert.equal(sources[1].published_at_source, "page_metadata");
  assert.equal(sources[1].published_at, "2026-11-14");
  assert.equal(sources[1].indexed_published_at, "2020-01-01");
});

test("counter queries run before optional variants when original acquisition is insufficient", async () => {
  const queries = [];
  const { session } = fixture({ search: async ({ query }) => {
    queries.push(query);
    return query === claim.search_queries[0] ? batches([], []) : batches([result("https://second.example/article")], []);
  }, limits: { target: 1 } });
  await session.discover([claim]);
  assert.deepEqual(queries, [claim.search_queries[0], counterQuery(claim)]);
  const fallback = claimQueries({ ...claim, search_queries: null, search_query: "가온 나래 계약 Gaon Nara contract" });
  assert.equal(fallback[0], "가온 나래 계약을 발표했다");
  assert.equal(fallback[1], "Gaon Nara");
  assert.ok(fallback[2].includes("발언 정정"));
  assert.ok(fallback.every(query => !query.includes("2026")));
});

test("failed acquisition stops at eighteen attempts and bounds concurrent fetches to three", async () => {
  let active = 0, peak = 0;
  const { session } = fixture({ search: async () => batches(
    Array.from({ length: 12 }, (_, i) => result(`https://n${i}.example/article`)),
    Array.from({ length: 12 }, (_, i) => result(`https://t${i}.example/article`))),
  fetchSource: async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { ok: false, warning: "HTTP 403" }; } });
  await session.discover([claim]);
  assert.equal(session.report().attempted, 18);
  assert.equal(session.report().stop_reason, "attempt_limit");
  assert.equal(peak, 3);
  assert.equal(retrievalFailure(session.report()), "source_fetch_failed");
});

test("provider budgets cover more than three claims and explicitly identify unsearched claims", async () => {
  const { session } = fixture();
  await session.discover(Array.from({ length: 8 }, (_, i) => ({ ...claim, claim_id: `c${i}` })));
  assert.equal(session.report().queries.length, 12); // Six primary/counter pairs share providers under the same call budget.
  assert.deepEqual(session.report().unsearched_claim_ids, ["c6", "c7"]);
  assert.deepEqual(session.report().unchecked_claim_ids, ["c6", "c7"]);
  assert.equal(session.report().counter_search_complete, false);
  assert.equal(session.report().stop_reason, "search_budget");
});

test("disabled providers, provider outages and no matches are distinct from fact-check outcomes", async () => {
  for (const [status, reason] of [["disabled", "search_disabled"], ["error", "search_failed"], ["no_results", "search_no_results"]]) {
    const { session } = fixture({ search: async () => ({ batches: [{ provider: "naver", status, results: [], ...(status === "error" ? { error_code: "http_429" } : {}) }] }) });
    await session.discover([claim]);
    assert.equal(retrievalFailure(session.report()), reason);
    assert.equal(session.report().attempted, 0);
    assert.equal(session.report().usable, 0);
    assert.equal(session.report().status, "failed");
  }
});

test("partial originals do not satisfy the target or turn discovery dates into publication evidence", async () => {
  const { session } = fixture({ search: async () => batches([result("https://partial.example/article")], []),
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: "Partial", text_truncated: true }) });
  const sources = await session.discover([claim]);
  assert.equal(session.report().captured, 1);
  assert.equal(session.report().usable, 0);
  assert.equal(session.report().status, "partial");
  assert.equal(retrievalFailure(session.report()), "source_unusable");
  assert.equal(sources[0].published_at, null);
  assert.equal(sources[0].indexed_published_at, "2020-01-01");
});

test("idle claim-extraction time does not consume the article retrieval deadline", async () => {
  const { session } = fixture({ limits: { milliseconds: 50, target: 1 }, search: async () => batches([result("https://record.example/article")], []) });
  await session.collectReferences([]);
  await new Promise(resolve => setTimeout(resolve, 70));
  await session.discover([claim]);
  assert.equal(session.report().usable, 1);
  assert.equal(session.report().stop_reason, "target_reached");
});

test("six available primary hits cannot skip counter search or starve a new correction of capture slots", async () => {
  const primary = Array.from({ length: 8 }, (_, i) => result(`https://primary${i}.example/article`));
  const correction = "https://correction.example/article";
  const { session, fetched } = fixture({ search: async ({ purpose }) => purpose === "counterevidence"
    ? batches([primary[5], result(correction, "가온 나래 계약 발표 보도 정정")], [])
    : batches(primary, []) });
  const sources = await session.discover([claim]);
  assert.equal(sources.length, 6);
  assert.equal(fetched.length, 6);
  assert.equal(fetched[4], correction);
  assert.ok(sources.some(source => source.url === correction));
  assert.ok(session.report().queries.some(query => query.purpose === "counterevidence"));
  assert.equal(session.report().counter_search_complete, true);
  assert.deepEqual(session.report().unchecked_claim_ids, []);
});

test("three claims reserve provider calls and original slots for each counter search", async () => {
  let calls = 0;
  const claims = Array.from({ length: 3 }, (_, i) => ({ ...claim, claim_id: `c${i}` }));
  const { session, fetched } = fixture({ search: async ({ claim: current, purpose, providers }) => {
    calls += providers.length;
    return batches(Array.from({ length: 8 }, (_, i) => result(`https://${current.claim_id}-${purpose}-${i}.example/article`)), []);
  } });
  await session.discover(claims);
  assert.equal(calls, 12);
  assert.equal(fetched.length, 6);
  for (const current of claims) assert.ok(fetched.some(url => url.includes(`${current.claim_id}-counterevidence`)));
  assert.equal(session.report().counter_search_complete, true);
});

test("partial correction text is retained and failed counter acquisition is explicitly incomplete", async () => {
  for (const fails of [false, true]) {
    const primary = Array.from({ length: 6 }, (_, i) => result(`https://primary${i}.example/article`));
    const { session } = fixture({ search: async ({ purpose }) => purpose === "counterevidence"
      ? batches([result("https://correction.example/article", "가온 나래 계약 정정")], []) : batches(primary, []),
    fetchSource: async ({ url }) => url.includes("correction")
      ? fails ? { ok: false, warning: "HTTP 403" } : { ok: true, final_url: url, text: ORIGINAL_TEXT, text_truncated: true }
      : { ok: true, final_url: url, text: ORIGINAL_TEXT },
    });
    const sources = await session.discover([claim]);
    assert.equal(session.report().counter_search_complete, !fails);
    assert.deepEqual(session.report().unchecked_claim_ids, fails ? ["c1"] : []);
    if (!fails) assert.ok(sources.some(source => source.url.includes("correction") && source.text_truncated));
  }
});

test("unrelated and unsupported media candidates never consume original acquisition slots", async () => {
  const { session, fetched } = fixture({ search: async () => batches([
    result("https://news.example/video/2018/03/15/search-and-rescue.html", "Miami search rescue news"),
    result("https://podcasts.apple.com/us/podcast/interview/id123", "가온 나래 인터뷰"),
    result("https://www.facebook.com/person/videos/123", "가온 나래 계약 발표"),
    result("https://unrelated.example/article", "오늘 해외 주식 시황"),
    result("https://related.example/article"),
  ], []) });
  await session.discover([claim]);
  assert.deepEqual(fetched, ["https://related.example/article"]);
  assert.equal(session.report().attempted, 1);
  assert.ok(session.report().candidates.some(candidate => candidate.reason === "irrelevant_candidate" && candidate.state === "not_attempted"));
  assert.ok(session.report().candidates.some(candidate => candidate.reason === "unsupported_audio"));
});

test("entity-free candidates need multiple relation terms rather than one generic word", async () => {
  const noEntities = { ...claim, entities: [], claim_text: "solar battery recycling mandate", search_queries: ["solar battery recycling mandate"] };
  const { session, fetched } = fixture({ search: async () => batches([
    result("https://unrelated.example/article", "Battery stocks rise today"),
    result("https://related.example/article", "Solar battery recycling mandate announced"),
  ], []) });
  await session.discover([noEntities]);
  assert.deepEqual(fetched, ["https://related.example/article"]);
});

test("counter searches with only unsupported videos stay unchecked", async () => {
  const { session } = fixture({ search: async ({ purpose }) => purpose === "counterevidence"
    ? batches([result("https://news.example/video/correction", "가온 나래 계약 정정")], [])
    : batches([result("https://original.example/article")], []) });
  await session.discover([claim]);
  assert.equal(session.report().counter_search_complete, false);
  assert.deepEqual(session.report().unchecked_claim_ids, ["c1"]);
});

test("a blocked first counter search uses an alternate-language counter query before filling the source target", async () => {
  const primary = Array.from({ length: 8 }, (_, i) => result(`https://primary${i}.example/article`));
  const queries = [];
  const { session, fetched } = fixture({ search: async ({ query, purpose }) => {
    queries.push({ query, purpose });
    if (purpose === "primary") return batches(primary, []);
    if (/[가-힣]/.test(query)) return batches([primary[0]], [result("https://news.example/video/correction")]);
    return batches([], [result("https://correction.example/article", "Gaon Nara contract denial correction")]);
  } });
  const sources = await session.discover([claim]);
  assert.equal(queries.length, 3);
  assert.equal(queries[2].purpose, "counterevidence");
  assert.equal(queries[2].query, "Gaon Nara contract denial correction");
  assert.ok(fetched.indexOf("https://correction.example/article") >= 0);
  assert.ok(fetched.indexOf("https://correction.example/article") <= 4);
  assert.equal(sources.length, 6);
  assert.equal(session.report().counter_search_complete, true);
});

test("a title-length article stub is retained as partial context and cannot satisfy the original target", async () => {
  const stub = "가온과 나래의 계약 발표를 다루는 기사 제목만 표시되어 있습니다.";
  const { session } = fixture({ search: async () => batches([result("https://stub.example/article")], []),
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: stub, extraction_scope: "article" }) });
  const sources = await session.discover([claim]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].text, stub);
  assert.equal(sources[0].text_truncated, true);
  assert.equal(sources[0].body_quality, "insufficient_text");
  assert.equal(session.report().usable, 0);
  assert.equal(session.report().captured, 1);
  assert.ok(session.report().candidates.some(candidate => candidate.reason === "insufficient_body"));
  assert.equal(session.report().counter_search_complete, false);
});

test("foreign-language subject aliases in planned queries admit related originals without generic-term or profile matches", async () => {
  const korean = { ...claim, entities: ["가온", "나래"], search_queries: ["가온 나래 계약", "Gaon Nara contract denial correction"] };
  const { session, fetched } = fixture({ search: async () => batches([], [
    result("https://foreign.example/article", "Gaon and Nara announce contract details"),
    result("https://unrelated.example/article", "Miami search and rescue report correction"),
    result("https://generic.example/article", "Relationship rumor denial correction confirmed"),
    result("https://foreign.example/profile/gaon-nara", "Gaon Nara profile and biography"),
    result("https://foreign.example/video/gaon-nara", "Gaon Nara contract details"),
  ]) });
  await session.discover([korean]);
  assert.deepEqual(fetched, ["https://foreign.example/article"]);
  assert.ok(session.report().candidates.some(candidate => candidate.url.includes("/profile/") && candidate.reason === "irrelevant_candidate"));
});
