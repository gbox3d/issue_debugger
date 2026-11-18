import { createHash } from "node:crypto";

// 검색 요약과 모델 인용의 연결을 확인한다. 원문 전체 검증이나 의미상 지지의 보장은 아니다.
export function prepareEvidence(items, asOf) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) return [];
  return items.flatMap(item => {
    if (typeof item.snippet !== "string" || !item.snippet.trim()) return [];
    try {
      if (!["https:", "http:"].includes(new URL(item.url).protocol)) return [];
    } catch { return []; }
    const published = item.published_at ? Date.parse(item.published_at) : NaN;
    if (Number.isFinite(published) && published > cutoff) return [];
    const evidence_id = createHash("sha256")
      .update(JSON.stringify([item.url, item.published_at, item.snippet])).digest("hex");
    return [{ ...item, evidence_id }];
  });
}

export function groundEvidence(output, supplied, claimId) {
  const byId = new Map(supplied.map(e => [e.evidence_id, e]));
  const cited = Array.isArray(output.evidence) ? output.evidence : [];
  const seen = new Map();
  const evidence = [];
  let valid = output.claim_id === claimId && cited.length > 0;
  for (const citation of cited) {
    const source = byId.get(citation?.evidence_id);
    const quote = typeof citation?.snippet === "string" ? citation.snippet.trim() : "";
    if (!source || quote.length < 10 || !source.snippet.includes(quote) ||
        !["support", "refute"].includes(citation.stance)) {
      valid = false;
      continue;
    }
    if (seen.has(source.evidence_id)) {
      if (seen.get(source.evidence_id) !== citation.stance) valid = false;
      continue;
    }
    seen.set(source.evidence_id, citation.stance);
    evidence.push({ ...source, snippet: quote, stance: citation.stance });
  }
  return { ...output, claim_id: claimId, evidence, evidence_integrity: valid };
}
