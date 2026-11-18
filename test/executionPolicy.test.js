import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequestCheckRunner, normalizeExecutionPolicy, optionalAgentNotRun } from "../src/services/verification/executionPolicy.js";
import { createGeneralFactChecker } from "../src/modules/agents/generalFactcheck.js";

const claim = {
  claim_id: "c1", claim_text: "The service operated in 2024.", original_quote: "The service operated in 2024.",
  input_context: "The service operated in 2024.", extraction_integrity: true,
  type: "fact", needs_verification: true, is_time_sensitive: true,
};
const source = {
  evidence_id: "e1", snippet: "The service operated from 2024-01-01 through 2024-12-31.",
  source_kind: "original_text", text_truncated: false, captured_at: "2026-11-15T01:00:00.000Z",
};
const time = { subject_date: "2024-06-01", mode: "retrospective", knowledge_cutoff: "2026-11-15T01:00:00.000Z" };
const input = () => structuredClone({ claim, sources: [source], time });

test("origin and framing default off and cannot disable either core review", () => {
  assert.deepEqual(normalizeExecutionPolicy(), { origin: false, framing: false });
  assert.deepEqual(normalizeExecutionPolicy({ origin: true }), { origin: true, framing: false });
  assert.deepEqual(normalizeExecutionPolicy({ framing: true }), { origin: false, framing: true });
  for (const invalid of [null, [], true, { origin: "true" }, { framing: 1 }, { facts: false }, { reviewer: false }]) {
    assert.throws(() => normalizeExecutionPolicy(invalid), error => error.status === 400);
  }
});

test("default saves both optional calls while preserving two blind fact checks", async () => {
  const roles = [];
  const checkFacts = createGeneralFactChecker({ chat: async request => {
    roles.push(request.schemaName);
    return { verdict: "unknown", confidence: 0.5, evidence: [], claim_preserved: true,
      scope_complete: false, has_unresolved_conflict: false };
  } });
  const runner = createRequestCheckRunner();
  const unexpected = async () => { throw new Error("Optional operation must not run"); };
  const [facts, origin, framing] = await Promise.all([
    runner.run("factcheck_pair", input(), checkFacts),
    runner.runOptional("origin", { claim }, unexpected),
    runner.runOptional("framing", { claim }, unexpected),
  ]);
  assert.equal(facts.result.review_required, true);
  assert.deepEqual(roles.sort(), ["GeneralFactCheck_assessor", "GeneralFactCheck_reviewer"]);
  for (const optional of [origin, framing]) {
    assert.equal(optional.result.execution_status, "not_run");
    assert.equal(optional.result.skip_reason, "not_requested");
    assert.equal(optional.result.model_calls, 0);
    assert.equal(optional.result.confidence, null);
  }
  assert.equal(framing.result.propaganda_score, null);
  assert.equal(framing.result.bias_score, null);
  assert.equal(framing.result.emotion_trigger_score, null);
});

test("only explicitly selected optional analyses execute", async () => {
  for (const analysis of [{ origin: true }, { framing: true }, { origin: true, framing: true }]) {
    const roles = [];
    const runner = createRequestCheckRunner({ analysis });
    for (const role of ["origin", "framing"]) {
      const output = await runner.runOptional(role, { claim }, async () => {
        roles.push(role);
        return { claim_id: claim.claim_id, execution_status: "completed", model_calls: 1 };
      });
      assert.equal(output.result.execution_status, analysis[role] ? "completed" : "not_run");
    }
    assert.deepEqual(roles, Object.keys(analysis));
  }
  assert.throws(() => optionalAgentNotRun("reviewer", "c1"), /optional roles/);
});

test("concurrent and later exactly equivalent checks share one call within the request", async () => {
  const runner = createRequestCheckRunner();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const operation = async received => {
    calls++;
    assert.deepEqual(received, input());
    await gate;
    return { claim_id: received.claim.claim_id, evidence: [{ snippet: received.sources[0].snippet }] };
  };
  const first = runner.run("factcheck_pair", input(), operation);
  // Property insertion order is irrelevant; every field and array order stays.
  const same = { time: structuredClone(time), sources: [structuredClone(source)], claim: structuredClone(claim) };
  const second = runner.run("factcheck_pair", same, operation);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.reused, false);
  assert.equal(b.reused, true);
  a.result.evidence[0].snippet = "mutated by a consumer";
  assert.equal(b.result.evidence[0].snippet, source.snippet);
  const third = await runner.run("factcheck_pair", input(), operation);
  assert.equal(third.reused, true);
  assert.equal(third.result.evidence[0].snippet, source.snippet);
  assert.equal(calls, 1);
});

test("different roles, IDs, negation, dates, source order and partial counterevidence never share", async () => {
  const runner = createRequestCheckRunner();
  let calls = 0;
  const operation = async () => ({ sequence: ++calls });
  const variants = [
    { ...input(), claim: { ...claim, claim_id: "c2" } },
    { ...input(), claim: { ...claim, claim_text: "The service did not operate in 2024." } },
    { ...input(), claim: { ...claim, original_quote: "The service did not operate in 2024." } },
    { ...input(), claim: { ...claim, input_context: "The service operated in 2024. Correction: it did not." } },
    { ...input(), time: { ...time, subject_date: "2025-06-01" } },
    { ...input(), time: { ...time, knowledge_cutoff: "2026-11-14T01:00:00.000Z" } },
    { ...input(), sources: [{ ...source, snippet: `${source.snippet} Correction: it never operated.` }] },
    { ...input(), sources: [source, { ...source, evidence_id: "counter", text_truncated: true, snippet: "Correction: it never operated." }] },
    { ...input(), sources: [{ ...source, evidence_id: "counter", text_truncated: true, snippet: "Correction: it never operated." }, source] },
  ];
  await runner.run("assessor", input(), operation);
  assert.equal((await runner.run("reviewer", input(), operation)).reused, false);
  for (const changed of variants) assert.equal((await runner.run("assessor", changed, operation)).reused, false);
  assert.equal(calls, variants.length + 2);
});

test("input is snapshotted before asynchronous work and runners never share across requests", async () => {
  const runner = createRequestCheckRunner();
  const original = input();
  let calls = 0;
  const operation = async received => ({ sequence: ++calls, original: received.claim.claim_text });
  const first = runner.run("factcheck_pair", original, operation);
  original.claim.claim_text = "An input mutation after scheduling";
  assert.equal((await first).result.original, claim.claim_text);
  assert.equal((await createRequestCheckRunner().run("factcheck_pair", input(), operation)).reused, false);
  assert.equal(calls, 2);
});

test("different checker operations never share model or prompt configurations", async () => {
  const runner = createRequestCheckRunner();
  const first = await runner.run("factcheck_pair", input(), async () => ({ model: "first" }));
  const second = await runner.run("factcheck_pair", input(), async () => ({ model: "second" }));
  assert.equal(first.result.model, "first");
  assert.equal(second.result.model, "second");
  assert.equal(second.reused, false);
});

test("rejected singleflight evicts the failure so a later attempt executes", async () => {
  const runner = createRequestCheckRunner();
  let calls = 0;
  const operation = async () => {
    if (++calls === 1) throw new Error("temporary upstream failure");
    return { execution_status: "completed" };
  };
  const failed = await Promise.allSettled([
    runner.run("factcheck_pair", input(), operation), runner.run("factcheck_pair", input(), operation),
  ]);
  assert.ok(failed.every(outcome => outcome.status === "rejected"));
  assert.equal(calls, 1);
  assert.equal((await runner.run("factcheck_pair", input(), operation)).reused, false);
  assert.equal(calls, 2);
});

test("reported model failures and not-run results are also evicted", async () => {
  for (const failure of [
    { verification_status: "failed" }, { execution_status: "not_run" },
    { failure_reason: "upstream_unavailable" }, { reason_codes: ["model_review_failed"] },
    { reason_codes: ["factcheck_unavailable"] }, null,
  ]) {
    const runner = createRequestCheckRunner();
    let calls = 0;
    const operation = async () => ++calls === 1 ? failure : { verification_status: "completed" };
    await runner.run("factcheck_pair", input(), operation);
    assert.equal((await runner.run("factcheck_pair", input(), operation)).reused, false);
    assert.equal(calls, 2);
  }
});

test("unsupported values bypass reuse rather than silently losing input fields", async () => {
  for (const extra of [undefined, NaN, new Date("2024-01-01"), () => true]) {
    const runner = createRequestCheckRunner();
    let calls = 0;
    const operation = async received => {
      assert.equal(received.extra, extra);
      return { sequence: ++calls };
    };
    const changed = { ...input(), extra };
    for (let index = 0; index < 2; index++) assert.equal((await runner.run("factcheck_pair", changed, operation)).reused, false);
    assert.equal(calls, 2);
  }
});
