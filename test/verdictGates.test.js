import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/modules/aggregator.js";
import { prepareEvidence, groundEvidence } from "../src/services/llm/evidence.js";

const claim = { claim_id: "c1", type: "fact", is_time_sensitive: false };
const origin = { confidence: 0.9, origin_candidates: [{ source_reliability: 0.9 }] };
const wording = { propaganda_score: 0, bias_score: 0, emotion_trigger_score: 0 };
const supplied = prepareEvidence([{ url: "https://example.org/record?id=1", published_at: "2020-01-01", snippet: "The official record states that the event occurred in 1999." }], "2025-01-01");
function grounded(overrides = {}) {
  return groundEvidence({ claim_id: "c1", verdict: "supported", confidence: 0.99,
    evidence: [{ evidence_id: supplied[0].evidence_id, snippet: supplied[0].snippet, stance: "support" }], ...overrides }, supplied, "c1");
}
const run = (b, c = claim, aC = wording) => aggregate({ claim: c, agentA: origin, agentB: b, agentC: aC });

test("empty evidence cannot produce a confirmed verdict at maximum confidence", () => {
  assert.equal(run({ verdict: "supported", confidence: 1, evidence: [] }).final_verdict, "hold");
});
test("opinions, mixed claims and unchecked claim types stay on hold", () => {
  for (const type of ["opinion", "mixed", undefined]) assert.equal(run(grounded(), { ...claim, type }).final_verdict, "hold");
});
test("time-sensitive search snippets cannot certify historical webpage state", () => {
  assert.equal(run(grounded(), { ...claim, is_time_sensitive: true }).final_verdict, "hold");
});
test("a static grounded claim keeps its verdict and score regardless of emotional wording", () => {
  const plain = run(grounded());
  const emotional = run(grounded(), claim, { propaganda_score: 1, bias_score: 1, emotion_trigger_score: 1 });
  assert.equal(plain.final_verdict, "true");
  assert.equal(emotional.final_verdict, plain.final_verdict);
  assert.equal(emotional.final_confidence, plain.final_confidence);
});
test("invented IDs, altered quotes and wrong claim IDs invalidate citations", () => {
  for (const overrides of [
    { claim_id: "other" },
    { evidence: [{ evidence_id: "invented", snippet: supplied[0].snippet, stance: "support" }] },
    { evidence: [{ evidence_id: supplied[0].evidence_id, snippet: "A made-up quotation contradicting the source", stance: "support" }] }
  ]) {
    const out = run(grounded(overrides));
    assert.equal(out.final_verdict, "hold");
    assert.equal(out.citations.length, 0);
  }
});
test("citation URLs come from the supplied source, not the model", () => {
  const out = grounded({ evidence: [{ evidence_id: supplied[0].evidence_id, snippet: supplied[0].snippet, stance: "support", url: "https://fake.example" }] });
  assert.equal(out.evidence[0].url, supplied[0].url);
});
test("future evidence and invalid cutoffs never enter the fact evidence pack", () => {
  const items = [{ url: "https://example.org", snippet: "A sufficiently long future record.", published_at: "2026-01-01" }];
  assert.deepEqual(prepareEvidence(items, "2025-01-01"), []);
  assert.deepEqual(prepareEvidence(items, "invalid"), []);
});
test("conflicting stances and invalid confidence cannot confirm a claim", () => {
  const b = grounded();
  assert.equal(run({ ...b, evidence: [...b.evidence, { ...b.evidence[0], stance: "refute" }] }).final_verdict, "hold");
  for (const confidence of [-1, 2, NaN, Infinity, "0.99"]) assert.equal(run({ ...b, confidence }).final_verdict, "hold");
});

test("opposite stances on the same evidence ID cannot be hidden by deduplication", () => {
  const cited = grounded().evidence[0];
  const b = grounded({ evidence: [{ ...cited, stance: "support" }, { ...cited, stance: "refute" }] });
  assert.equal(b.evidence_integrity, false);
  assert.equal(run(b).final_verdict, "hold");
});
