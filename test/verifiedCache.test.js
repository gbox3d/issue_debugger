import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createVerifiedCache } from "../src/services/verification/verifiedCache.js";
import { contentHash } from "../src/services/verification/store.js";
import { createGeneralFactChecker } from "../src/modules/agents/generalFactcheck.js";

const CLOCK = "2026-11-15T01:00:00.000Z";
const BODY = "합성기기 다온은 2020-01-01부터 2020-12-31까지 USB-C를 지원했다.";
const CLAIM = "합성기기 다온은 USB-C를 지원한다.";

function source(body = BODY, changes = {}) {
  const snapshot_id = randomUUID();
  return {
    evidence_id: contentHash(snapshot_id), snapshot_id, url: "https://record.example/specification",
    requested_url: "https://record.example/specification", title: "합성 사양 이력",
    published_at: "2022-01-01", published_at_source: "json_ld", captured_at: CLOCK,
    snippet: body, content_hash: contentHash(body), source_kind: "original_text", source_role: "discovered_source",
    extraction_scope: "article", text_truncated: false, original_text_length: body.length, supplied_text_length: body.length,
    ...changes,
  };
}

function input(changes = {}) {
  return {
    claim: { claim_id: "claim-1", claim_text: CLAIM, original_quote: CLAIM, input_context: CLAIM,
      type: "fact", is_time_sensitive: true, needs_verification: true, extraction_integrity: true },
    sources: [source()],
    time: { subject_date: "2020-06-01", mode: "retrospective", knowledge_cutoff: CLOCK, evaluated_at: CLOCK },
    versions: { rule: "test-rule-v1", provider: "local-fixture", model: "test-model-v1" },
    ...changes,
  };
}

async function passingResult(args, changes = {}) {
  const check = createGeneralFactChecker({ chat: async ({ messages }) => {
    const { claim, sources, time } = JSON.parse(messages[1].content);
    return {
      claim_id: claim.claim_id, verdict: "supported", confidence: 0.95,
      scope_complete: true, has_unresolved_conflict: false, claim_preserved: true,
      assessment_basis: "direct", verification_status: "verified", answer_summary: "합성 날짜 구간에서 지원했다.",
      findings: [{ kind: "direct_record", text: "명시된 기간에 사양이 적용됐다.", evidence_ids: [sources[0].evidence_id], quote: sources[0].snippet }],
      evidence: [{ evidence_id: sources[0].evidence_id, snippet: sources[0].snippet, stance: "support",
        applies_on: time.subject_date, time_basis: "dated_record", time_quote: sources[0].snippet,
        time_reasoning: "합성 기록의 적용 기간에 요청한 날짜가 포함됩니다." }],
      reasoning_bullets: ["합성 기록의 적용 기간 확인"], missing_info: [],
      ...changes,
    };
  } });
  const result = await check(args);
  // Preserve findings in each review section too, exercising future-compatible
  // remapping even when the checker only exposes them on the main assessment.
  result.assessment.findings = structuredClone(result.findings);
  result.review.findings = structuredClone(result.findings);
  return result;
}

async function fixture(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "marbas-result-reuse-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const cache = createVerifiedCache({ dataDir, now: () => new Date(CLOCK), ...options });
  return { cache, dataDir };
}

test("identical newly fetched content reuses passed reviews and remaps every citation and finding", async t => {
  const { cache, dataDir } = await fixture(t);
  const first = input();
  const result = await passingResult(first);
  assert.equal(result.review_passed, true, "the fixture must pass the actual grounding gates");
  assert.equal(await cache.set(first, result), true);
  const fresh = structuredClone(first);
  fresh.claim.claim_id = "claim-2";
  fresh.sources = [source(BODY, { captured_at: "2026-11-15T01:01:00.000Z" })];
  fresh.time.knowledge_cutoff = fresh.time.evaluated_at = "2026-11-15T01:01:00.000Z";
  const hit = await cache.get(fresh);
  assert.equal(hit.claim_id, "claim-2");
  assert.deepEqual(hit.time_context, fresh.time);
  assert.equal(hit.as_of, fresh.time.knowledge_cutoff);
  for (const part of [hit, hit.assessment, hit.review]) {
    for (const citation of part.evidence) {
      for (const [key, value] of Object.entries(fresh.sources[0])) assert.deepEqual(citation[key], value, key);
    }
    assert.deepEqual(part.findings[0].evidence_ids, [fresh.sources[0].evidence_id]);
    assert.equal(part.findings[0].quote, BODY);
  }
  assert.ok(!JSON.stringify(hit).includes(first.sources[0].snapshot_id));
  assert.ok(!JSON.stringify(hit).includes(first.sources[0].evidence_id));
  assert.deepEqual(result.time_context, first.time, "reuse never mutates the previous result");
  const entries = await fs.readdir(path.join(dataDir, "reviewed-results"));
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^[a-f0-9]{64}\.json$/);
  assert.equal((await fs.stat(path.join(dataDir, "reviewed-results", entries[0]))).mode & 0o777, 0o600);
  const reopened = createVerifiedCache({ dataDir, now: () => new Date(CLOCK) });
  assert.deepEqual(await reopened.get(fresh), hit, "reuse persists across process-local cache objects");
});

test("every semantic input, source version, role and partial counterevidence participates in the key", async t => {
  const { cache } = await fixture(t);
  const first = input();
  first.sources.push(source("일부 정정 내용은 추가 확인이 필요하다.", {
    url: "https://correction.example/article", text_truncated: true, source_role: "user_reference",
  }));
  assert.equal(await cache.set(first, await passingResult(first)), true);
  const cases = {
    claim: value => { value.claim.claim_text += " 매년"; },
    original_quote: value => { value.claim.original_quote = "USB-C를 지원한다."; },
    input_context: value => { value.claim.input_context += " 추후 정정이 있다."; },
    subject_date: value => { value.time.subject_date = "2020-06-02"; },
    mode: value => { value.time.mode = "as_known"; },
    model: value => { value.versions.model = "test-model-v2"; },
    rule: value => { value.versions.rule = "test-rule-v2"; },
    provider: value => { value.versions.provider = "other-fixture"; },
    prompt_version: value => { value.versions.prompt = "prompt-v2"; },
    original_url: value => { value.sources[0].url = "https://record.example/other"; },
    content_hash: value => { value.sources[1].content_hash = contentHash("corrected version"); },
    supplied_body: value => { value.sources[1].snippet += " 주장과 모순된다."; value.sources[1].supplied_text_length = value.sources[1].original_text_length = value.sources[1].snippet.length; },
    source_role: value => { value.sources[0].source_role = "input_article"; },
    collection_roles: value => { value.sources[0].collection_roles = ["input_article", "discovered_source"]; },
    publication_provenance: value => { value.sources[0].published_at_source = "html_meta"; },
    extraction_scope: value => { value.sources[0].extraction_scope = "page_text"; },
    publication_date: value => { value.sources[0].published_at = "2023-01-01"; },
    source_order: value => { value.sources.reverse(); },
    truncated: value => { value.sources[0].text_truncated = true; },
  };
  for (const [name, change] of Object.entries(cases)) {
    const next = structuredClone(first);
    change(next);
    assert.equal(await cache.get(next), null, name);
  }
  assert.ok(await cache.get(first));
});

test("archive cutoff and capture eligibility cannot be bypassed by a matching original", async t => {
  const { cache } = await fixture(t);
  const archived = input();
  archived.time.mode = "as_known";
  assert.equal(await cache.set(archived, await passingResult(archived)), true);
  const changed = structuredClone(archived);
  changed.time.knowledge_cutoff = "2026-11-15T02:00:00.000Z";
  assert.equal(await cache.get(changed), null);
  const future = structuredClone(archived);
  future.sources[0].captured_at = "2026-11-15T01:00:01.000Z";
  assert.equal(await cache.get(future), null);
  assert.equal(await cache.set(future, await passingResult(archived)), false);
});

test("expired, forced, unavailable-original and malformed entries are misses", async t => {
  let clock = Date.parse(CLOCK);
  const { cache, dataDir } = await fixture(t, { now: () => new Date(clock), ttlMs: 1000 });
  const args = input();
  const result = await passingResult(args);
  assert.equal(await cache.set(args, result), true);
  assert.equal(await cache.get({ ...args, force: true }), null);
  assert.equal(await cache.set({ ...args, force: true }, result), false);
  assert.equal(await cache.get({ ...args, sources: [] }), null);
  assert.equal(await cache.get({ ...args, sources: [source(BODY, { text_truncated: true })] }), null);
  clock += 1000;
  assert.equal(await cache.get(args), null);
  clock -= 1000;
  const file = path.join(dataDir, "reviewed-results", (await fs.readdir(path.join(dataDir, "reviewed-results")))[0]);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  for (const corrupt of ["{", "null", "{}", JSON.stringify({ ...saved, key: "wrong-key" }),
    JSON.stringify({ ...saved, result: { ...saved.result, review_passed: false } }),
    JSON.stringify({ ...saved, input: { ...saved.input, sources: [] } })]) {
    await fs.writeFile(file, corrupt);
    assert.equal(await cache.get(args), null);
  }
  assert.equal(await cache.set(args, result), true, "a corrupt entry can be atomically replaced");
  assert.ok(await cache.get(args));
});

test("failed, incomplete, forged or non-remappable review results are never reused", async t => {
  const { cache, dataDir } = await fixture(t);
  const args = input();
  const result = await passingResult(args);
  const cases = {
    unknown: value => { value.verdict = "unknown"; },
    failed_review: value => { value.review_passed = false; },
    citation_integrity: value => { value.evidence_integrity = false; },
    temporal_integrity: value => { value.temporal_verified = false; },
    incomplete_context: value => { value.scope_complete = false; },
    unresolved_conflict: value => { value.has_unresolved_conflict = true; },
    changed_claim: value => { value.claim_preserved = false; },
    low_confidence: value => { value.confidence = 0.3; },
    missing_info: value => { value.missing_info = ["추가 원문 필요"]; },
    absent_review: value => { delete value.review; },
    absent_assessment: value => { delete value.assessment; },
    review_disagreement: value => { value.review.verdict = "refuted"; },
    absent_evidence: value => { value.evidence = []; },
    invented_quote: value => { value.review.evidence[0].snippet = "원문에 없는 허위 인용문입니다."; },
    invented_date: value => { value.evidence[0].time_quote = "1990-01-01부터"; },
    stale_metadata: value => { value.assessment.evidence[0].snapshot_id = randomUUID(); },
    missing_reference: value => { value.findings[0].evidence_ids = ["unknown-evidence"]; },
    empty_references: value => { value.findings[0].evidence_ids = []; },
    empty_finding_quote: value => { value.findings[0].quote = ""; },
    short_finding_quote: value => { value.findings[0].quote = BODY.slice(0, 9); },
  };
  for (const [name, change] of Object.entries(cases)) {
    const invalid = structuredClone(result);
    change(invalid);
    assert.equal(await cache.set(args, invalid), false, name);
  }
  assert.deepEqual(await fs.readdir(dataDir), []);
  result.reasoning_bullets.push(`근거 ID: ${args.sources[0].evidence_id}`);
  assert.equal(await cache.set(args, result), true);
  assert.equal(await cache.get({ ...args, sources: [source()] }), null,
    "an old identifier in unstructured prose is not silently rewritten");
});

test("completed-event reporting reuses both review citations with their event dates and scopes intact", async t => {
  const { cache } = await fixture(t);
  const body = "담당자는 어제 합성 시설이 영구 폐쇄됐다고 밝혔다.";
  const args = input();
  args.claim.claim_text = args.claim.original_quote = args.claim.input_context = "합성 시설이 폐쇄됐다고 보도했다.";
  args.time.subject_date = "2024-06-01";
  args.sources = [source(body, { published_at: "2024-05-20T01:00:00+09:00", published_at_source: "page_metadata" })];
  const changes = {
    assessment_basis: "reporting",
    findings: [{ kind: "reported_statement", text: "시설 폐쇄 발언을 인용한 보도가 있다.", evidence_ids: [args.sources[0].evidence_id], quote: body }],
    evidence: [{ evidence_id: args.sources[0].evidence_id, snippet: body, stance: "support", applies_on: args.time.subject_date,
      time_basis: "dated_report", temporal_scope: "completed_event", event_date: "2024-05-19", time_quote: body,
      time_reasoning: "기사의 현지 게시일 기준으로 어제는 2024-05-19입니다." }],
  };
  const result = await passingResult(args, changes);
  assert.equal(result.review_passed, true);
  assert.equal(await cache.set(args, result), true);
  const fresh = structuredClone(args);
  fresh.sources[0] = { ...fresh.sources[0], evidence_id: contentHash(randomUUID()), snapshot_id: randomUUID(), captured_at: "2026-11-15T01:01:00.000Z" };
  const hit = await cache.get(fresh);
  assert.ok(hit);
  for (const part of [hit, hit.assessment, hit.review]) {
    assert.equal(part.evidence[0].event_date, "2024-05-19");
    assert.equal(part.evidence[0].temporal_scope, "completed_event");
    assert.equal(part.evidence[0].evidence_id, fresh.sources[0].evidence_id);
    assert.equal(part.evidence[0].snapshot_id, fresh.sources[0].snapshot_id);
    assert.deepEqual(part.findings[0].evidence_ids, [fresh.sources[0].evidence_id]);
  }
  for (const invalid of [
    { event_date: "2024-02-30" }, { event_date: "2024-05-21" }, { event_date: null },
    { temporal_scope: "ongoing_status" }, { time_quote: body.slice(0, 7) }, { time_reasoning: "짧음" },
  ]) {
    const changed = structuredClone(result);
    Object.assign(changed.review.evidence[0], invalid);
    assert.equal(await cache.set(args, changed), false, JSON.stringify(invalid));
  }
  for (const basis of ["direct", "insufficient", undefined]) {
    const changed = structuredClone(result);
    changed.review.assessment_basis = basis;
    assert.equal(await cache.set(args, changed), false, String(basis));
  }
  for (const metadata of [
    { published_at_source: "search_index" },
    { published_at: "2024-06-02T00:00:00+09:00" },
  ]) {
    const changedInput = structuredClone(args);
    const changedResult = structuredClone(result);
    Object.assign(changedInput.sources[0], metadata);
    for (const part of [changedResult, changedResult.assessment, changedResult.review]) Object.assign(part.evidence[0], metadata);
    assert.equal(await cache.set(changedInput, changedResult), false, JSON.stringify(metadata));
  }
  // Publication provenance accepted by the checker is also accepted by reuse.
  const timeElementInput = structuredClone(args);
  const timeElementResult = structuredClone(result);
  timeElementInput.sources[0].published_at_source = "page_time_element";
  for (const part of [timeElementResult, timeElementResult.assessment, timeElementResult.review]) {
    part.assessment_basis = "mixed";
    part.evidence[0].published_at_source = "page_time_element";
  }
  assert.equal(await cache.set(timeElementInput, timeElementResult), true);
  assert.ok(await cache.get(timeElementInput));
});

test("concurrent replacements leave complete private JSON files and no temporary artifacts", async t => {
  const { cache, dataDir } = await fixture(t);
  const args = input();
  const result = await passingResult(args);
  assert.ok((await Promise.all(Array.from({ length: 8 }, () => cache.set(args, result)))).every(Boolean));
  assert.ok(await cache.get(args));
  const files = await fs.readdir(path.join(dataDir, "reviewed-results"));
  assert.equal(files.length, 1);
  assert.equal((await fs.stat(path.join(dataDir, "reviewed-results", files[0]))).mode & 0o777, 0o600);
});

test("forced invalidation prevents a previous pass from resurfacing after an unknown review", async t => {
  const { cache, dataDir } = await fixture(t);
  const args = input();
  const passed = await passingResult(args);
  const otherInput = structuredClone(args);
  otherInput.time.subject_date = "2020-06-02";
  assert.equal(await cache.set(args, passed), true);
  assert.equal(await cache.set(otherInput, await passingResult(otherInput)), true);
  const forced = structuredClone(args);
  forced.force = true;
  forced.sources = [source(BODY, { captured_at: "2026-11-15T01:01:00.000Z" })];
  forced.time.knowledge_cutoff = forced.time.evaluated_at = "2026-11-15T01:01:00.000Z";
  assert.equal(await cache.invalidate(forced), true);
  const unknown = { ...passed, verdict: "unknown", review_passed: false };
  assert.equal(await cache.set({ ...forced, force: false }, unknown), false);
  assert.equal(await cache.get(args), null);
  const reopened = createVerifiedCache({ dataDir, now: () => new Date(CLOCK) });
  assert.equal(await reopened.get({ ...forced, force: false }), null, "invalidation persists across cache instances");
  assert.ok(await reopened.get(otherInput), "other verification conditions remain cached");
  assert.equal(await cache.invalidate(forced), true, "invalidating an absent entry is idempotent");
  assert.equal(await cache.invalidate({ ...forced, sources: [] }), true, "non-cacheable input has no matching entry to invalidate");
  const newPass = await passingResult(forced);
  assert.equal(await cache.set({ ...forced, force: false }, newPass), true);
  assert.ok(await reopened.get({ ...forced, force: false }), "a later passed review can replace the invalidated result");
});
