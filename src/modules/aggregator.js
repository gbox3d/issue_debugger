function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function aggregate({ claim, agentA, agentB, agentC }) {
  const factConfidence = clamp01(agentB.confidence ?? 0);

  const originReliabilityAvg =
    (agentA.origin_candidates ?? []).reduce((s, x) => s + (x.source_reliability ?? 0), 0) /
    Math.max(1, (agentA.origin_candidates ?? []).length);

  const sourceReliability = clamp01((agentA.confidence ?? 0) * originReliabilityAvg);

  const propagandaRisk = clamp01(
    ((agentC.propaganda_score ?? 0) + (agentC.bias_score ?? 0) + (agentC.emotion_trigger_score ?? 0)) / 3
  );

  let finalVerdict = "hold";
  if (agentB.verdict === "supported" && factConfidence >= 0.7) finalVerdict = "true";
  else if (agentB.verdict === "refuted" && factConfidence >= 0.7) finalVerdict = "false";
  else finalVerdict = "hold";

  // 시간 개념: 주장 자체의 시점 의존성은 추출기(claim.is_time_sensitive) 판정을 신뢰한다.
  // (Agent B 가 역사적 사실에도 타임라인을 만드는 과잉을 막기 위해 게이트로 사용)
  const timeSensitive = Boolean(claim.is_time_sensitive);
  const temporalNote = timeSensitive && typeof agentB.temporal_note === "string" ? agentB.temporal_note.trim() : "";
  const situationChanged = timeSensitive && Boolean(agentB.situation_changed);
  const sentimentTimeline = timeSensitive && Array.isArray(agentB.sentiment_timeline) ? agentB.sentiment_timeline : [];

  const warnings = [];
  if (finalVerdict === "hold" && factConfidence < 0.7) warnings.push("근거 부족/상충으로 보류");
  if (propagandaRisk >= 0.75) warnings.push("선동/편향 위험이 높아 확산 주의");
  if (sourceReliability < 0.3) warnings.push("출처 신뢰도 낮음/최초 유포 불명확");
  if (situationChanged) warnings.push("시점에 따라 사실/여론이 달라짐 — 최신 기준 재평가 필요");
  else if (timeSensitive) warnings.push("시점 의존 주장 — 최신 상황에 따라 결과가 바뀔 수 있음");

  const citations = (agentB.evidence ?? []).slice(0, 5).map(e => ({
    url: e.url,
    published_at: e.published_at ?? null,
    snippet: e.snippet
  }));

  const baseSummary =
    finalVerdict === "true"
      ? "근거에 의해 주장과 일치하는 정황이 우세합니다."
      : finalVerdict === "false"
        ? "근거에 의해 주장과 충돌하는 정황이 우세합니다."
        : "근거가 부족하거나 상충하여 판단을 보류합니다.";

  return {
    claim_id: claim.claim_id,
    final_verdict: finalVerdict,
    final_confidence: clamp01(
      // 사실판정 비중을 가장 크게
      0.65 * factConfidence + 0.2 * sourceReliability + 0.15 * (1 - propagandaRisk)
    ),
    score_breakdown: {
      fact_confidence: factConfidence,
      source_reliability: sourceReliability,
      propaganda_risk: propagandaRisk
    },
    temporal: {
      as_of: agentB.as_of ?? null,
      time_sensitive: timeSensitive,
      situation_changed: situationChanged,
      note: temporalNote,
      sentiment_timeline: sentimentTimeline
    },
    final_summary: temporalNote ? `${baseSummary} ⏱ ${temporalNote}` : baseSummary,
    citations,
    warnings
  };
}
