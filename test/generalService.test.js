import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { test } from "node:test";
import { createVerificationService } from "../src/services/verification/service.js";
import { createVerifyRouter } from "../src/routes/verify.js";
import { createGeneralFactChecker } from "../src/modules/agents/generalFactcheck.js";

// Synthetic integration fixtures. These test date/evidence plumbing, not real-world model accuracy.
const CLOCK = "2026-11-15T01:00:00.000Z";
const CASES = [
  { domain: "인사", text: "가온은 가상도서관 관장이다.", url: "https://personnel.example/record", body: "가상도서관 관장 가온의 재임기간은 2020-01-01부터 2020-12-31까지다. 2021-01-01부터 2021-12-31까지는 관장 나래가 재임했다." },
  { domain: "제품", text: "가상기기 Aurora는 USB-C를 지원한다.", url: "https://product.example/specs", body: "가상기기 Aurora의 2020-01-01부터 2020-12-31까지 공급 사양은 USB-C 지원이다. 2021-01-01부터 2021-12-31까지는 USB-A 전용으로 USB-C를 지원하지 않았다." },
  { domain: "서비스", text: "가상서비스 하루는 무료이다.", url: "https://service.example/pricing", body: "가상서비스 하루의 무료 제공기간은 2020-01-01부터 2020-12-31까지였다. 2021-01-01부터 2021-12-31까지는 월 1000원의 유료 서비스였다." },
].map(example => ({ ...example, body: `${example.body}\n\n이 자료는 실제 인물이나 상품이 아닌 자동 테스트용 합성 기록입니다. 날짜가 명시된 원문을 보관하고 검증 대상 날짜와 기록의 적용 기간을 대조하는 기능을 확인하기 위해 작성했습니다. 본문의 서술과 발행 시각은 서로 다른 정보이며, 발행 당시의 상태나 현재 상태를 임의로 추정하는 데 사용하지 않습니다.` }));
const knownByUrl = new Map(CASES.map(item => [item.url, item]));

const fixtureChecker = createGeneralFactChecker({ chat: async ({ messages }) => {
  const { claim, sources, time } = JSON.parse(messages[1].content);
  const source = sources.find(item => item.snippet.includes("2020-01-01"));
  const supported = time.subject_date >= "2020-01-01" && time.subject_date <= "2020-12-31";
  const refuted = time.subject_date >= "2021-01-01" && time.subject_date <= "2021-12-31";
  const verdict = source && (supported || refuted) ? supported ? "supported" : "refuted" : "unknown";
  return {
    claim_id: claim.claim_id, verdict, confidence: verdict === "unknown" ? 0 : 0.95,
    scope_complete: true, has_unresolved_conflict: false, claim_preserved: true,
    assessment_basis: verdict === "unknown" ? "insufficient" : "direct",
    findings: source ? [{ kind: "direct_record", text: "합성 원문의 적용 기간 대조", evidence_ids: [source.evidence_id], quote: source.snippet }] : [],
    evidence: verdict === "unknown" ? [] : [{
      evidence_id: source.evidence_id, snippet: source.snippet,
      stance: supported ? "support" : "refute", applies_on: time.subject_date,
      time_basis: "dated_record", time_quote: source.snippet,
      time_reasoning: "이 테스트의 명시된 종료 기간에 대상 날짜가 포함되는지 대조했습니다.",
    }],
    reasoning_bullets: ["합성 회귀 자료의 상태 기간 대조"], missing_info: [],
  };
} });

async function fixture(t, overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "marbas-general-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir, now: () => new Date(CLOCK), search: async () => [],
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, title: "합성 공식 이력", text: knownByUrl.get(url)?.body ?? "수집된 원문이 있으나 적용 시점은 확인되지 않습니다.", published_at: "2022-01-01" }),
    extract: async ({ text }) => ({ claims: [{ claim_id: "c1", type: "fact", claim_text: text, is_time_sensitive: true, needs_verification: true, entities: [text.split(" ")[0]], search_query: text }] }),
    checkFacts: fixtureChecker,
    origin: async ({ claim }) => ({ claim_id: claim.claim_id, confidence: 0.8, origin_candidates: [{ source_reliability: 0.8 }], timeline: [] }),
    framing: async ({ claim }) => ({ claim_id: claim.claim_id, confidence: 0, propaganda_score: 0, bias_score: 0, emotion_trigger_score: 0, manipulation_flags: [] }),
    ...overrides,
  };
  return { service: createVerificationService(options), options, dataDir };
}

async function httpFixture(t, overrides = {}) {
  const setup = await fixture(t, overrides);
  const app = express();
  app.use(express.json());
  app.use("/api", createVerifyRouter(setup.options));
  const server = await new Promise(resolve => { const result = app.listen(0, "127.0.0.1", () => resolve(result)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async input => {
    const response = await fetch(`${base}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return { response, body: await response.json() };
  };
  return { ...setup, base, post };
}

test("three domains use the same general path and change verdict with the subject date", async t => {
  const { service } = await fixture(t);
  for (const example of CASES) {
    const request = { text: example.text, source_urls: [example.url], mode: "retrospective" };
    for (const [subject_date, verdict] of [["2020-01-01", "true"], ["2020-12-31", "true"], ["2021-01-01", "false"], ["2019-12-31", "hold"]]) {
      const report = await service.verify({ ...request, subject_date });
      assert.equal(report.results[0].agg.final_verdict, verdict, `${example.domain} ${subject_date}`);
      assert.equal(report.time.subject_date, subject_date);
      assert.equal(report.evidence_sources[0].source_kind, "original_text");
      assert.equal(report.evidence_sources[0].captured_at, CLOCK);
      assert.equal(report.evidence_sources[0].snippet, undefined);
    }
  }
});

test("HTTP reports retain server provenance and replay without another model call", async t => {
  let checks = 0;
  const { base, post, dataDir } = await httpFixture(t, { checkFacts: async args => { checks++; return fixtureChecker(args); } });
  const { response, body } = await post({ text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.results[0].agg.final_verdict, "true");
  assert.equal(body.versions.rule, "general-news-v3");
  assert.deepEqual(await (await fetch(`${base}/reports/${body.id}`)).json(), body);
  assert.equal(checks, 1);
  const stat = await fs.stat(path.join(dataDir, "reports", `${body.id}.json`));
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal((await fetch(`${base}/reports/bad-id`)).status, 400);
  assert.equal((await fetch(`${base}/reports/00000000-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await fetch(`${base}/reports`)).status, 404);
});

test("as-known never calls current search or fetch and cannot backdate a present snapshot", async t => {
  let fetches = 0;
  let searches = 0;
  const { service } = await fixture(t, {
    fetchSource: async ({ url }) => { fetches++; return { ok: true, final_url: url, text: CASES[0].body, published_at: "2019-01-01" }; },
    search: async () => { searches++; return []; },
  });
  const request = { text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" };
  await service.verify(request);
  const before = { fetches, searches };
  const report = await service.verify({ ...request, mode: "as_known", knowledge_cutoff: "2025-01-01T00:00:00Z" });
  assert.equal(report.results[0].agg.final_verdict, "hold");
  assert.deepEqual(report.reason_codes, ["snapshot_unavailable"]);
  assert.deepEqual({ fetches, searches }, before);
});

test("as-known selects the latest saved version at or before cutoff and detects tampering", async t => {
  let clock = CLOCK;
  let body = CASES[0].body;
  const { service, dataDir } = await fixture(t, {
    now: () => new Date(clock),
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: body, published_at: "2022-01-01" }),
  });
  const request = { text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" };
  const initial = await service.verify(request);
  clock = "2026-11-15T02:00:00.000Z";
  body = "정정: 기존 재임기간은 확인할 수 없으므로 추가 검토가 필요합니다.";
  const correction = await service.verify(request);
  assert.equal(correction.results[0].agg.final_verdict, "hold");
  const historical = await service.verify({ ...request, mode: "as_known", knowledge_cutoff: CLOCK });
  assert.equal(historical.results[0].agg.final_verdict, "true");
  assert.equal(historical.evidence_sources[0].snapshot_id, initial.evidence_sources[0].snapshot_id);
  const corrected = await service.verify({ ...request, mode: "as_known", knowledge_cutoff: clock });
  assert.equal(corrected.results[0].agg.final_verdict, "hold");
  const snapshotPath = path.join(dataDir, "snapshots", `${initial.evidence_sources[0].snapshot_id}.json`);
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  snapshot.text += "tampered";
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot));
  await assert.rejects(service.verify({ ...request, mode: "as_known", knowledge_cutoff: CLOCK }), /integrity/);
});

test("reverification refreshes evidence while preserving the previous report", async t => {
  let clock = CLOCK;
  const { service } = await fixture(t, { now: () => new Date(clock) });
  const input = { text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" };
  const first = await service.verify(input);
  clock = "2026-11-15T02:00:00.000Z";
  const next = await service.verify({ ...first.request, previous_id: first.id });
  assert.notEqual(first.id, next.id);
  assert.equal(next.previous_id, first.id);
  assert.notEqual(first.evidence_sources[0].snapshot_id, next.evidence_sources[0].snapshot_id);
  assert.deepEqual(await service.readReport(first.id), first);
  await assert.rejects(service.verify({ ...first.request, subject_date: "2021-01-01", previous_id: first.id }), /같은 입력/);
});

test("invalid inputs are rejected before external work, including invalid calendar and offset dates", async t => {
  let calls = 0;
  const { post } = await httpFixture(t, { extract: async () => { calls++; return { claims: [] }; } });
  const base = { text: CASES[0].text, subject_date: "2020-01-01" };
  for (const input of [
    {}, [], { ...base, text: {} }, { ...base, text: "x".repeat(20001) },
    { ...base, subject_date: "2025-02-29" }, { ...base, subject_date: "2026-11-16" },
    { ...base, mode: "unknown" }, { ...base, source_urls: "https://example.org" },
    { ...base, source_urls: Array(4).fill("https://example.org") }, { ...base, url: "file:///etc/passwd" },
    { ...base, url: "https://user:password@example.org" }, { ...base, url: "https://example.org:3001/" },
    { ...base, mode: "as_known", knowledge_cutoff: "2020-01-01" },
    { ...base, mode: "as_known", knowledge_cutoff: "2020-02-30T00:00:00Z" },
    { ...base, mode: "as_known", knowledge_cutoff: "2020-01-01T00:00:00+14:30" },
    { ...base, mode: "as_known", knowledge_cutoff: "2027-01-01T00:00:00Z" },
    { ...base, knowledge_cutoff: CLOCK }, { ...base, previous_id: "../.env" },
    { ...base, as_of: "2020-01-01" },
  ]) assert.equal((await post(input)).response.status, 400, JSON.stringify(input).slice(0, 100));
  assert.equal(calls, 0);
});

test("legacy as_of is explicit archive mode and cannot silently fetch today's page", async t => {
  let fetches = 0;
  const { service } = await fixture(t, { fetchSource: async () => { fetches++; throw new Error("should not fetch"); } });
  const report = await service.verify({ text: CASES[0].text, url: CASES[0].url, as_of: "2020-06-01" });
  assert.equal(report.request.mode, "as_known");
  assert.equal(report.request.subject_date, "2020-06-01");
  assert.equal(report.request.knowledge_cutoff, "2020-05-31T15:00:00.000Z");
  assert.equal(report.results[0].agg.final_verdict, "hold");
  assert.equal(fetches, 0);
});

test("URL-only historical requests without a snapshot store a clear hold without model or network calls", async t => {
  const forbidden = async () => { throw new Error("unexpected external work"); };
  const { service } = await fixture(t, { extract: forbidden, search: forbidden, fetchSource: forbidden });
  const report = await service.verify({ url: CASES[0].url, subject_date: "2020-06-01", mode: "as_known", knowledge_cutoff: "2025-01-01T00:00:00Z" });
  assert.equal(report.status, "hold");
  assert.deepEqual(report.results, []);
  assert.deepEqual(report.reason_codes, ["snapshot_unavailable"]);
  assert.deepEqual(await service.readReport(report.id), report);
});

test("source requests are capped and duplicates share one fetch; snippets cannot become evidence", async t => {
  const seen = [];
  const { service } = await fixture(t, {
    search: async () => [...Array(12)].map((_, i) => ({ url: i === 0 ? CASES[0].url : `https://source.example/${i}`, title: CASES[0].text, snippet: "invented search summary" })),
    fetchSource: async ({ url }) => { seen.push(url); return { ok: true, final_url: url, text: CASES[0].body, published_at: "2022-01-01" }; },
  });
  const report = await service.verify({ text: CASES[0].text, url: CASES[0].url, source_urls: [CASES[0].url], subject_date: "2020-06-01" });
  assert.equal(seen.length, 6);
  assert.equal(new Set(seen).size, 6);
  assert.equal(report.evidence_sources.length, 6);
  assert.ok(report.results[0].agentB.evidence.every(item => !item.snippet.includes("invented")));
});

test("truncated or future-dated sources cannot confirm claims and model outages become holds", async t => {
  for (const change of [
    { text_truncated: true }, { text: CASES[0].body + "x".repeat(12000) }, { published_at: "2027-01-01" },
  ]) {
    const { service } = await fixture(t, { fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: CASES[0].body, ...change }) });
    assert.equal((await service.verify({ text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-01-01" })).results[0].agg.final_verdict, "hold");
  }
  const { service } = await fixture(t, { checkFacts: async () => { throw new Error("model offline"); } });
  const report = await service.verify({ text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-01-01" });
  assert.equal(report.results[0].agg.final_verdict, "hold");
  assert.deepEqual(report.results[0].agentB.reason_codes, ["factcheck_unavailable"]);
});

test("a short article shell is preserved as context and cannot confirm a claim", async t => {
  const stub = "가온 관장 재임 이력 기사 제목과 안내만 표시되어 있습니다.";
  const { service } = await fixture(t, {
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: stub, extraction_scope: "article", published_at: "2022-01-01" }),
  });
  const report = await service.verify({ text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" });
  assert.equal(report.results[0].agg.final_verdict, "hold");
  assert.equal(report.evidence_sources.length, 1);
  assert.equal(report.evidence_sources[0].body_quality, "insufficient_text");
  assert.equal(report.evidence_sources[0].text_truncated, true);
  assert.equal(report.retrieval.usable, 0);
});

test("invented extraction quotes are held before additional search, source fetch or analysis", async t => {
  const calls = { search: 0, fetch: 0, check: 0, origin: 0, framing: 0 };
  const { service } = await fixture(t, {
    extract: async () => ({ claims: [{ claim_id: "c1", type: "fact", is_time_sensitive: true,
      claim_text: "가온은 가상도서관 관장이다.", original_quote: "나래는 가상도서관 관장이다." }] }),
    search: async () => { calls.search++; return []; },
    fetchSource: async () => { calls.fetch++; return { ok: false }; },
    checkFacts: async () => { calls.check++; throw new Error("must not run"); },
    origin: async () => { calls.origin++; return {}; },
    framing: async () => { calls.framing++; return {}; },
  });
  const report = await service.verify({ text: CASES[0].text, source_urls: [CASES[0].url], subject_date: "2020-06-01" });
  assert.equal(report.results[0].agg.final_verdict, "hold");
  assert.equal(report.claims[0].extraction_integrity, false);
  assert.deepEqual(report.results[0].agentB.reason_codes, ["extraction_mismatch"]);
  assert.deepEqual(report.reason_codes, ["extraction_mismatch"]);
  assert.deepEqual(calls, { search: 0, fetch: 0, check: 0, origin: 0, framing: 0 });
});

test("verbatim extraction and exact claim fallback carry original context to both fact checks", async t => {
  for (const explicitQuote of [false, true]) {
    let checked = null;
    const text = `검증할 내용: ${CASES[0].text} 추가 설명은 없습니다.`;
    const { service } = await fixture(t, {
      extract: async () => ({ claims: [{ claim_id: "c1", type: "fact", is_time_sensitive: true,
        claim_text: CASES[0].text, ...(explicitQuote ? { original_quote: CASES[0].text } : {}) }] }),
      checkFacts: async input => { checked = input.claim; return fixtureChecker(input); },
    });
    const report = await service.verify({ text, source_urls: [CASES[0].url], subject_date: "2020-06-01" });
    assert.equal(report.results[0].agg.final_verdict, "true");
    assert.equal(checked.extraction_integrity, true);
    assert.equal(checked.original_quote, CASES[0].text);
    assert.equal(checked.input_context, text);
  }
});

test("retrieval outages report not-run checks with null scores and preserve the provider diagnosis", async t => {
  let checks = 0;
  const { service } = await fixture(t, {
    search: async () => ({ batches: [{ provider: "naver", status: "error", error_code: "http_429", results: [] }] }),
    checkFacts: async () => { checks++; throw new Error("must not call"); },
    origin: async () => { checks++; throw new Error("must not call"); },
    framing: async () => { checks++; throw new Error("must not call"); },
  });
  const report = await service.verify({ text: CASES[0].text });
  assert.equal(checks, 0);
  assert.equal(report.verification_status, "not_run");
  assert.equal(report.failure_reason, "search_failed");
  assert.equal(report.results[0].agentB.confidence, null);
  assert.equal(report.results[0].agentB.model_calls, 0);
  assert.equal(report.coverage.reviewed, 0);
  assert.equal(report.coverage.decided, 0);
  assert.equal(report.retrieval.queries[0].error_code, "http_429");
});

test("URL-only input extracts article text and keeps input and external-original roles separate", async t => {
  let extractionInput, checkedSources;
  const { service } = await fixture(t, {
    extract: async ({ text }) => { extractionInput = text; return { claims: [{ claim_id: "c1", type: "fact", claim_text: CASES[0].text, original_quote: CASES[0].text, search_queries: ["가온 관장"] }] }; },
    fetchSource: async ({ url }) => ({ ok: true, final_url: url, text: url === CASES[0].url ? CASES[0].text : CASES[0].body, published_at: "2022-01-01", published_at_source: "page_metadata" }),
    search: async () => [{ url: CASES[0].url, title: CASES[0].text }, { url: "https://external.example/record", title: CASES[0].text }],
    checkFacts: async args => { checkedSources = args.sources; return fixtureChecker(args); },
  });
  const report = await service.verify({ url: CASES[0].url, subject_date: "2020-06-01" });
  assert.ok(extractionInput.includes(CASES[0].text));
  assert.equal(checkedSources[0].source_role, "input_article");
  assert.equal(checkedSources[1].source_role, "discovered_source");
  assert.equal(report.evidence_sources[0].published_at_source, "page_metadata");
  assert.equal(report.retrieval.attempted, 2);
});

test("fresh identical sources reuse two reviews, changed evidence and forced rechecks do not", async t => {
  let checks = 0, fetches = 0, optional = 0;
  let body = CASES[0].body;
  const { service } = await fixture(t, {
    checkFacts: async args => { checks++; return fixtureChecker(args); },
    fetchSource: async ({url}) => { fetches++; return {ok:true,final_url:url,title:'Stable history',text:body,published_at:'2022-01-01'}; },
    origin: async () => { optional++; throw new Error('optional should not run'); },
    framing: async () => { optional++; throw new Error('optional should not run'); },
  });
  const request = { text:CASES[0].text,source_urls:[CASES[0].url],subject_date:'2020-06-01' };
  const first = await service.verify(request);
  const warm = await service.verify(request);
  assert.equal(checks, 1);
  assert.equal(fetches, 2, 'fresh retrieval still precedes cache reuse');
  assert.equal(optional, 0);
  assert.equal(warm.resource_usage.verified_cache_hits, 1);
  assert.equal(warm.resource_usage.skipped_call_count, 4);
  assert.equal(warm.results[0].agg.score_breakdown.source_reliability, null);
  assert.notEqual(warm.results[0].agg.citations[0].snapshot_id, first.results[0].agg.citations[0].snapshot_id);
  await service.verify({...request,previous_id:warm.id});
  assert.equal(checks, 2, 'explicit recheck bypasses cache');
  body += ' 새 정정 자료는 이전 주장의 적용 범위를 재검토하도록 요청한다.';
  await service.verify(request);
  assert.equal(checks, 3, 'changed body invalidates cache');
  assert.deepEqual(await service.readReport(first.id), first);
});
