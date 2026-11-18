import test from "node:test";
import assert from "node:assert/strict";
import { createGeneralFactChecker } from "../src/modules/agents/generalFactcheck.js";
import { aggregate } from "../src/modules/aggregator.js";

const time = { subject_date: "2024-06-01", mode: "retrospective", knowledge_cutoff: "2026-11-15T00:00:00Z", evaluated_at: "2026-11-15T00:00:00Z" };
const claim = { claim_id: "c1", type: "fact", is_time_sensitive: true, needs_verification: true, claim_text: "서비스가 운영 중이다.",
  original_quote: "서비스가 운영 중이다.", input_context: "서비스가 운영 중이다.", extraction_integrity: true };
const source = { evidence_id: "source-1", url: "https://example.org/history", snippet: "Service operated from 2024-01-01 through 2024-12-31. It closed on 2025-01-01.",
  source_kind: "original_text", text_truncated: false, captured_at: "2026-11-15T00:00:01Z", published_at: null, content_hash: "hash", snapshot_id: "snapshot-1" };
function answer(overrides = {}) {
  return { claim_id: "c1", verdict: "supported", confidence: 0.9, scope_complete: true, has_unresolved_conflict: false, claim_preserved: true,
    assessment_basis: "direct", findings: [{ kind: "direct_record", text: "명시된 운영 기간을 확인했습니다.", evidence_ids: [source.evidence_id], quote: source.snippet }],
    evidence: [{ evidence_id: source.evidence_id, snippet: source.snippet, stance: "support", applies_on: time.subject_date,
      time_basis: "dated_record", time_quote: "from 2024-01-01 through 2024-12-31", time_reasoning: "The target date is inside the explicitly stated operating period." }],
    reasoning_bullets: ["기간 대조"], ...overrides };
}
async function check(first = answer(), second = answer(), context = {}) {
  const responses = [first, second];
  const checker = createGeneralFactChecker({ chat: async () => responses.shift() });
  return checker({ claim, sources: [source], time, ...context });
}
const agg = (b, c = claim) => aggregate({ claim: c, agentA: { confidence: 0, origin_candidates: [] }, agentB: b, agentC: {} });

test("original dated evidence with blind agreeing review can confirm a time-sensitive claim", async () => {
  const seen = [];
  const checker = createGeneralFactChecker({ chat: async call => { seen.push(call); return answer(); } });
  const b = await checker({ claim, sources: [source], time });
  assert.equal(agg(b).final_verdict, "true");
  assert.equal(b.review_passed, true);
  assert.equal(agg(b).temporal.subject_date, time.subject_date);
  assert.equal(agg(b).citations[0].time_quote, answer().evidence[0].time_quote);
  assert.notEqual(seen[0].messages[1].content, seen[1].messages[1].content);
  assert.equal(JSON.parse(seen[1].messages[1].content).assessment, undefined);
});

test("explicit counterevidence can refute the same claim at a later date", async () => {
  const later = { ...time, subject_date: "2025-06-01" };
  const counter = answer({ verdict: "refuted", evidence: [{ ...answer().evidence[0], stance: "refute", applies_on: later.subject_date,
    time_quote: "It closed on 2025-01-01.", time_reasoning: "Explicit closure preceded the target date and contradicts operating status." }] });
  assert.equal(agg(await check(counter, counter, { time: later })).final_verdict, "false");
});

test("review disagreement prevents confirmation despite high assessor confidence", async () => {
  const b = await check(answer(), answer({ verdict: "unknown", evidence: [], confidence: 0 }));
  assert.equal(agg(b).final_verdict, "hold");
  assert.ok(b.reason_codes.includes("review_disagreement"));
});

test("invented temporal quotation, wrong applies_on, and missing explanation are rejected", async () => {
  for (const changes of [{ time_quote: "A fabricated period in 2024 from another document" }, { applies_on: "2025-06-01" }, { time_reasoning: "" }]) {
    const bad = answer({ evidence: [{ ...answer().evidence[0], ...changes }] });
    assert.equal(agg(await check(bad, bad)).final_verdict, "hold");
  }
});

test("a correctly quoted current word without a dated period cannot bypass temporal checks", async () => {
  const bad = answer({ evidence: [{ ...answer().evidence[0], time_basis: "current_snapshot", time_quote: "" }] });
  const b = await check(bad, bad);
  assert.equal(agg(b).final_verdict, "hold");
  assert.ok(b.reason_codes.includes("time_basis_missing"));
});

test("truncated originals and search snippets cannot confirm a generic claim", async () => {
  for (const changed of [{ text_truncated: true }, { source_kind: "search_snippet" }]) {
    assert.equal(agg(await check(answer(), answer(), { sources: [{ ...source, ...changed }] })).final_verdict, "hold");
  }
});

test("as_known rejects snapshots captured after its cutoff even when the article looks old", async () => {
  const b = await check(answer(), answer(), { time: { ...time, mode: "as_known", knowledge_cutoff: "2026-11-15T00:00:00Z" } });
  assert.equal(agg(b).final_verdict, "hold");
  assert.ok(b.reason_codes.includes("snapshot_after_cutoff"));
});

test("as_known accepts an eligible captured snapshot at the exact cutoff", async () => {
  const b = await check(answer(), answer(), { time: { ...time, mode: "as_known", knowledge_cutoff: source.captured_at } });
  assert.equal(agg(b).final_verdict, "true");
});

test("reported conflict or missing document context prevents confirmation", async () => {
  for (const changes of [{ has_unresolved_conflict: true }, { scope_complete: false }]) {
    assert.equal(agg(await check(answer(changes), answer())).final_verdict, "hold");
  }
});

test("opinions and absent snapshots return hold without spending model calls", async () => {
  let calls = 0;
  const checker = createGeneralFactChecker({ chat: async () => { calls++; return answer(); } });
  const opinion = await checker({ claim: { ...claim, type: "opinion" }, sources: [source], time });
  assert.equal(opinion.review_passed, false);
  const absent = await checker({ claim, sources: [], time: { ...time, mode: "as_known" } });
  assert.deepEqual(absent.reason_codes, ["snapshot_unavailable"]);
  assert.equal(calls, 0);
});

test("failure of either model call returns a review-failed hold", async () => {
  const checker = createGeneralFactChecker({ chat: async () => { throw new Error("upstream unavailable"); } });
  const b = await checker({ claim, sources: [source], time });
  assert.equal(agg(b).final_verdict, "hold");
  assert.deepEqual(b.reason_codes, ["model_review_failed"]);
});

test("static claims on the new route also require the independent review gate", async () => {
  const b = await check();
  assert.equal(agg({ ...b, review_passed: false }, { ...claim, is_time_sensitive: false }).final_verdict, "hold");
});

test("a duplicate citation cannot hide a forged second temporal justification", async () => {
  const good = answer();
  const bad = answer({ evidence: [...good.evidence, { ...good.evidence[0], applies_on: "1900-01-01", time_quote: "Invented 1900 record", time_reasoning: "" }] });
  assert.equal(agg(await check(bad, good)).final_verdict, "hold");
});

test("an uncited future snapshot never reaches either model in as_known mode", async () => {
  let calls = 0;
  const checker = createGeneralFactChecker({ chat: async () => { calls++; return answer(); } });
  const b = await checker({ claim, time: { ...time, mode: "as_known" }, sources: [
    { ...source, captured_at: "2026-11-14T00:00:00Z" }, { ...source, evidence_id: "future", captured_at: "2026-11-16T00:00:00Z" }
  ] });
  assert.equal(agg(b).final_verdict, "hold");
  assert.equal(calls, 0);
});

test("assessor and reviewer temporal explanations remain separately auditable", async () => {
  const reviewer = answer({ evidence: [{ ...answer().evidence[0], time_reasoning: "Independent checking of the interval confirms the requested subject date." }] });
  const b = await check(answer(), reviewer);
  assert.notEqual(b.assessment.evidence[0].time_reasoning, b.review.evidence[0].time_reasoning);
});

test("a supported rewritten claim cannot override a negative or differently dated input", async () => {
  const c = { ...claim, original_quote: "서비스는 운영 중이 아니다.", input_context: "서비스는 운영 중이 아니다." };
  const rejected = answer({ claim_preserved: false });
  const b = await check(answer(), rejected, { claim: c });
  assert.equal(agg(b).final_verdict, "hold");
  assert.ok(b.reason_codes.includes("extraction_mismatch"));
});

test("an invented original quotation is rejected before model calls", async () => {
  let calls = 0;
  const checker = createGeneralFactChecker({ chat: async () => { calls++; return answer(); } });
  const b = await checker({ claim: { ...claim, original_quote: "A quotation absent from the input" }, sources: [source], time });
  assert.equal(agg(b).final_verdict, "hold");
  assert.equal(calls, 0);
});

test("a partial correction remains visible to both reviewers and cannot be silently discarded", async () => {
  const correction = { ...source, evidence_id: "correction", text_truncated: true,
    snippet: "Correction in 2024: the earlier opening announcement was wrong; the service never opened." };
  const seen = [];
  const checker = createGeneralFactChecker({ chat: async call => {
    const input = JSON.parse(call.messages[1].content);
    seen.push(input);
    return input.context_only_sources.some(s => s.snippet === correction.snippet)
      ? answer({ verdict: "unknown", has_unresolved_conflict: true, scope_complete: false, evidence: [] }) : answer();
  } });
  const b = await checker({ claim, sources: [source, correction], time });
  assert.equal(agg(b).final_verdict, "hold");
  assert.equal(seen.length, 2);
  for (const input of seen) {
    assert.equal(input.sources.length, 1);
    assert.equal(input.context_only_sources[0].snippet, correction.snippet);
  }
});

test("dated reporting requires completed-event metadata and rejects search index dates", async () => {
  const reportedClaim = { ...claim, claim_text: "연구소 폐쇄 발언이 보도되었다.", original_quote: "연구소 폐쇄 발언이 보도되었다.", input_context: "연구소 폐쇄 발언이 보도되었다." };
  const reportSource = { ...source, snippet: 'The director said yesterday that the laboratory had closed permanently.', published_at: '2024-05-20T10:00:00Z', published_at_source: 'page_metadata' };
  const reportAnswer = answer({ assessment_basis: 'reporting', answer_summary: '보도에서 폐쇄 발언을 확인했습니다.', evidence: [{ ...answer().evidence[0], snippet: reportSource.snippet,
    time_basis: 'dated_report', temporal_scope: 'completed_event', event_date: '2024-05-19', time_quote: reportSource.snippet }],
    findings: [{ kind: 'reported_statement', text: '폐쇄했다고 발언했다는 보도입니다.', evidence_ids: [source.evidence_id], quote: reportSource.snippet }] });
  const passed = await check(reportAnswer, reportAnswer, { claim: reportedClaim, sources: [reportSource] });
  assert.equal(passed.review_passed, true);
  assert.equal(agg(passed).assessment_basis, 'reporting');
  for (const changed of [{ temporal_scope: 'ongoing_status' }, { event_date: '2024-05-21' }]) {
    const bad = { ...reportAnswer, evidence: [{ ...reportAnswer.evidence[0], ...changed }] };
    assert.equal((await check(bad, bad, { claim: reportedClaim, sources: [reportSource] })).review_passed, false);
  }
  assert.equal((await check(reportAnswer, reportAnswer, { claim: reportedClaim, sources: [{ ...reportSource, published_at_source: 'search_index' }] })).review_passed, false);
});

test("an article cannot corroborate its own assertions and forged finding quotes fail closed", async () => {
  const self = await check(answer(), answer(), { sources: [{ ...source, source_role: 'input_article' }] });
  assert.ok(self.reason_codes.includes('external_corroboration_missing'));
  assert.equal(agg(self).final_verdict, 'hold');
  const forged = answer({ findings: [{ kind: 'reported_statement', text: '원문에 없는 발언', evidence_ids: [source.evidence_id], quote: 'This sentence was fabricated by the model.' }] });
  assert.equal((await check(forged, forged)).review_passed, false);
});

test("missing or invalid evidence basis and absent findings never become direct confirmation", async () => {
  for (const assessment_basis of [undefined, 'bogus', 'insufficient']) {
    const out = answer({ assessment_basis });
    const result = await check(out, out);
    assert.equal(result.review_passed, false);
    assert.equal(agg(result).final_verdict, 'hold');
  }
  assert.equal((await check(answer({ findings: [] }), answer())).review_passed, false);
  assert.equal((await check(answer(), answer({ assessment_basis: 'reporting' }))).review_passed, false);
});

test("short model evidence aliases resolve only to supplied sources and invalid citations suppress the summary", async () => {
  const checker = createGeneralFactChecker({chat: async call => {
    const {sources} = JSON.parse(call.messages[1].content);
    assert.equal(sources[0].evidence_id, 'E1');
    const out = answer({ answer_summary: '원문과 대조한 요약' });
    out.evidence[0].evidence_id = 'E1'; out.findings[0].evidence_ids = ['E1'];
    return out;
  }});
  const good = await checker({claim,sources:[source],time});
  assert.equal(good.evidence[0].evidence_id, source.evidence_id);
  assert.equal(good.findings[0].evidence_ids[0], source.evidence_id);
  assert.equal(good.review_passed, true);
  const bad = answer({answer_summary:'검증되지 않은 강한 결론', evidence:[{...answer().evidence[0],evidence_id:'E99'}]});
  const held = await check(bad, answer());
  assert.equal(held.answer_summary, '');
  assert.equal(held.review_passed, false);
});

test("invalid citation narratives cannot reappear through temporal summary fallback", async () => {
  const out = answer({answer_summary:'검증되지 않은 결론', temporal_note:'검증되지 않은 사건을 확정했다.',evidence:[{...answer().evidence[0],evidence_id:'missing'}]});
  const result = agg(await check(out,out));
  assert.equal(result.answer_summary,''); assert.equal(result.temporal.note,'');
  assert.ok(!result.final_summary.includes('확정했다'));
});
