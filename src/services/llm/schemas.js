// “강제 스키마”는 코드 레벨에서도 검증할 수 있게 최소 체크 함수를 둡니다.

export function assertClaimsShape(obj) {
  if (!obj || !Array.isArray(obj.claims)) throw new Error("claims schema invalid");
  for (const c of obj.claims) {
    if (typeof c.claim_id !== "string") throw new Error("claim_id missing");
    if (typeof c.claim_text !== "string") throw new Error("claim_text missing");
  }
  return obj;
}

export function assertAgentAShape(obj) {
  if (!obj || typeof obj.claim_id !== "string") throw new Error("agentA schema invalid");
  if (!Array.isArray(obj.origin_candidates)) obj.origin_candidates = [];
  if (!Array.isArray(obj.timeline)) obj.timeline = [];
  if (typeof obj.confidence !== "number") obj.confidence = 0;
  return obj;
}

export function assertAgentBShape(obj) {
  if (!obj || typeof obj.claim_id !== "string") throw new Error("agentB schema invalid");
  if (!["supported", "refuted", "unknown"].includes(obj.verdict)) obj.verdict = "unknown";
  if (!Array.isArray(obj.evidence)) obj.evidence = [];
  if (!Array.isArray(obj.reasoning_bullets)) obj.reasoning_bullets = [];
  if (!Array.isArray(obj.missing_info)) obj.missing_info = [];
  if (typeof obj.confidence !== "number") obj.confidence = 0;
  return obj;
}

export function assertAgentCShape(obj) {
  if (!obj || typeof obj.claim_id !== "string") throw new Error("agentC schema invalid");
  for (const k of ["propaganda_score", "bias_score", "emotion_trigger_score", "confidence"]) {
    if (typeof obj[k] !== "number") obj[k] = 0;
  }
  if (!Array.isArray(obj.manipulation_flags)) obj.manipulation_flags = [];
  if (typeof obj.notes !== "string") obj.notes = "";
  return obj;
}
