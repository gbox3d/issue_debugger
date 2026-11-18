function policyError(message) {
  return Object.assign(new TypeError(message), { status: 400 });
}

export function normalizeExecutionPolicy(analysis = {}) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis) ||
      Object.keys(analysis).some(key => !["origin", "framing"].includes(key))) {
    throw policyError("analysis는 origin·framing 선택 여부를 담은 객체여야 합니다.");
  }
  for (const key of ["origin", "framing"]) {
    if (analysis[key] !== undefined && typeof analysis[key] !== "boolean") {
      throw policyError(`analysis.${key}는 boolean이어야 합니다.`);
    }
  }
  // Facts and the blind counterevidence review are mandatory; neither is a flag.
  return Object.freeze({ origin: analysis.origin ?? false, framing: analysis.framing ?? false });
}

export function optionalAgentNotRun(role, claimId, reason = "not_requested") {
  const common = { claim_id: claimId, confidence: null, execution_status: "not_run", skip_reason: reason, model_calls: 0 };
  if (role === "origin") return { ...common, origin_candidates: [], timeline: [] };
  if (role === "framing") return { ...common, propaganda_score: null, bias_score: null,
    emotion_trigger_score: null, manipulation_flags: [], notes: "" };
  throw new TypeError("Only origin and framing are optional roles");
}

// Only plain JSON data can be shared. Preserve every value and array position;
// never normalize text, remove IDs, prune sources, or round dates/numbers.
function exactJson(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object" || ancestors.has(value) ||
      (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
    throw new TypeError("Check inputs must contain only acyclic JSON data");
  }
  ancestors.add(value);
  const json = Array.isArray(value)
    ? `[${Array.from(value, item => exactJson(item, ancestors)).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${exactJson(value[key], ancestors)}`).join(",")}}`;
  ancestors.delete(value);
  return json;
}

function completed(result) {
  if (!result || typeof result !== "object" || result.failure_reason) return false;
  if ([result.execution_status, result.verification_status].some(status => ["not_run", "failed", "error"].includes(status))) return false;
  return !(Array.isArray(result.reason_codes) ? result.reason_codes : [])
    .some(code => ["model_review_failed", "factcheck_unavailable"].includes(code));
}

// Create one runner INSIDE each verification request. It retains exact results
// only for that request and does not replace the persisted reviewed-result cache.
export function createRequestCheckRunner({ analysis } = {}) {
  const policy = normalizeExecutionPolicy(analysis);
  const operations = new WeakMap();

  async function run(role, input, operation) {
    if (typeof role !== "string" || !role.trim() || typeof operation !== "function") {
      throw new TypeError("A checking role and operation are required");
    }
    let serialized;
    try { serialized = exactJson(input); }
    catch {
      // Unsupported objects are safe to execute, but unsafe to coalesce.
      return { result: await operation(input), reused: false };
    }
    // A different checker can have different model/prompt settings even when
    // its role and data match. Reuse requires the same operation as well.
    let checks = operations.get(operation);
    if (!checks) operations.set(operation, checks = new Map());
    const key = JSON.stringify([role, serialized]);
    const existing = checks.get(key);
    const reused = Boolean(existing);
    let pending = existing;
    if (!pending) {
      // Snapshot the actual operation input so caller mutation cannot change
      // the evidence after we have computed the sharing key.
      pending = Promise.resolve().then(() => operation(JSON.parse(serialized))).then(result => {
        if (!completed(result)) checks.delete(key);
        return structuredClone(result);
      }).catch(error => {
        checks.delete(key);
        throw error;
      });
      checks.set(key, pending);
    }
    // Isolate report annotations: mutating one consumer's result must not alter
    // the shared result or another consumer's evidence/claim references.
    return { result: structuredClone(await pending), reused };
  }

  async function runOptional(role, input, operation) {
    const skipped = optionalAgentNotRun(role, input.claim.claim_id);
    if (!policy[role]) return { result: skipped, reused: false };
    return run(role, input, operation);
  }

  return { policy, run, runOptional };
}
