function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function aggregate({ claim, agentA, agentB, agentC, sources = [] }) {
  const notRun = ["not_run", "incomplete"].includes(agentB.verification_status);
  const unsafeNarrative = (agentB.reason_codes ?? []).some(code => ["citation_invalid", "finding_invalid", "extraction_mismatch", "time_quote_invalid", "time_applicability_unverified", "time_basis_missing", "report_time_unverified", "assessment_basis_missing", "assessment_basis_conflict"].includes(code));
  const factConfidence = Number.isFinite(agentB.confidence) && agentB.confidence >= 0 && agentB.confidence <= 1 ? agentB.confidence : 0;

  const originReliabilityAvg =
    (agentA.origin_candidates ?? []).reduce((s, x) => s + (x.source_reliability ?? 0), 0) /
    Math.max(1, (agentA.origin_candidates ?? []).length);

  const sourceReliability = agentA.execution_status === "not_run" ? null : clamp01((agentA.confidence ?? 0) * originReliabilityAvg);

  const propagandaRisk = agentC.execution_status === "not_run" ? null : clamp01(
    ((agentC.propaganda_score ?? 0) + (agentC.bias_score ?? 0) + (agentC.emotion_trigger_score ?? 0)) / 3
  );

  const evidence = agentB.evidence ?? [];
  const hasConflict = evidence.some(e => e.stance === "support") && evidence.some(e => e.stance === "refute");
  const scoreValid = Number.isFinite(agentB.confidence) && agentB.confidence >= 0 && agentB.confidence <= 1;
  const factual = claim.type === "fact" && claim.needs_verification !== false;
  // 일반 API는 실제 원문과 별도 검토를 요구한다. 이전 호출 계약의 검색 요약은
  // 시점 의존 사실을 확정할 수 없으며, 새 API는 시간 적용성을 별도로 검증한다.
  const reviewed = agentB.review_required === true;
  const temporalEligible = reviewed ? agentB.review_passed === true && agentB.temporal_verified === true : claim.is_time_sensitive === false;
  const eligible = factual && temporalEligible &&
    agentB.evidence_integrity === true && evidence.length > 0 && !hasConflict && scoreValid;
  let finalVerdict = "hold";
  if (eligible && agentB.verdict === "supported" && factConfidence >= 0.7 && evidence.some(e => e.stance === "support")) finalVerdict = "true";
  else if (eligible && agentB.verdict === "refuted" && factConfidence >= 0.7 && evidence.some(e => e.stance === "refute")) finalVerdict = "false";

  // 시간 개념: 주장 자체의 시점 의존성은 추출기(claim.is_time_sensitive) 판정을 신뢰한다.
  // (Agent B 가 역사적 사실에도 타임라인을 만드는 과잉을 막기 위해 게이트로 사용)
  const timeSensitive = Boolean(claim.is_time_sensitive);
  const temporalNote = !unsafeNarrative && timeSensitive && typeof agentB.temporal_note === "string" ? agentB.temporal_note.trim() : "";
  const situationChanged = factual && timeSensitive && Boolean(agentB.situation_changed);
  const sentimentTimeline = timeSensitive && Array.isArray(agentB.sentiment_timeline) ? agentB.sentiment_timeline : [];

  const warnings = [];
  if (finalVerdict === "hold") warnings.push("근거 또는 시점 검증 조건 미충족으로 보류");
  if (!factual) warnings.push("의견·복합 주장 또는 검증 대상이 아닌 문장은 사실로 확정하지 않습니다");
  if (agentB.evidence_integrity !== true) warnings.push("수집 근거와 인용의 일치를 확인하지 못했습니다");
  if (hasConflict) warnings.push("지지·반박 근거가 함께 있어 검토가 필요합니다");
  const reasonLabels = {
    extraction_mismatch: "추출한 주장이 입력 원문의 의미를 보존하는지 확인하지 못했습니다",
    source_unavailable: "적격 원문을 확보하지 못했습니다",
    factcheck_unavailable: "팩트체크 호출을 완료하지 못했습니다",
    citation_invalid: "원문과 인용의 일치를 확인하지 못했습니다",
    context_incomplete: "판정에 필요한 문맥 또는 출처 관계가 충분하지 않습니다",
    evidence_conflict: "근거의 충돌이 해소되지 않았습니다",
    insufficient_evidence: "판정을 뒷받침하는 근거가 충분하지 않습니다",
    model_uncertain: "모델이 충분한 근거를 확인하지 못했습니다",
    original_text_missing: "검증 가능한 원문을 확보하지 못했습니다",
    source_truncated: "인용 자료의 전체 문맥이 잘려 확정할 수 없습니다",
    capture_time_missing: "근거 수집 시각을 확인하지 못했습니다",
    snapshot_after_cutoff: "자료 기준 시각 이후 수집된 근거입니다",
    time_applicability_unverified: "주장 대상일에 적용되는 근거인지 확인하지 못했습니다",
    time_quote_invalid: "원문에서 날짜·기간 인용을 확인하지 못했습니다",
    time_basis_missing: "명시적인 시점 근거가 없습니다",
    snapshot_unavailable: "자료 기준 시각 이전에 저장된 관련 원문이 없습니다",
    model_review_failed: "모델 판정 또는 별도 검토 호출에 실패했습니다",
    review_disagreement: "판정과 별도 검토의 결론이 일치하지 않습니다",
    report_time_unverified: "보도 시각과 사건 시점의 연결을 확인하지 못했습니다",
    external_corroboration_missing: "입력 기사 밖의 근거로 주장을 확인하지 못했습니다",
    finding_invalid: "확인 내용의 원문 인용이 일치하지 않습니다",
    assessment_basis_missing: "직접 기록과 보도 근거의 구분이 확인되지 않았습니다",
    assessment_basis_conflict: "표시된 근거 유형과 확인 내용이 서로 맞지 않습니다",
    cache_refresh_failed: "기존 검토 캐시를 초기화하지 못해 강제 재검증을 진행하지 못했습니다",
    counter_search_incomplete: "정정·반박 자료 검색 또는 관련 원문 확인을 마치지 못해 확정을 보류합니다"
  };
  for (const code of agentB.reason_codes ?? []) if (reasonLabels[code]) warnings.push(reasonLabels[code]);
  if (reviewed) warnings.push("원문과 시점의 의미 판단에는 모델 오류가 남을 수 있습니다. 별도 검토도 동일 모델을 사용하며 정확도 보증이 아닙니다");
  else if (timeSensitive) warnings.push("검색 요약만으로 시점별 사실을 확정할 수 없습니다");
  if (propagandaRisk >= 0.75) warnings.push("감정적·일방적 표현이 강함 — 사실과 별개로 판단을 흔들 수 있음");
  if (sourceReliability !== null && sourceReliability < 0.3) warnings.push("출처 신뢰도 낮음/최초 유포 불명확");
  if (situationChanged) warnings.push("대상 시점에 따라 사실 상태가 달라짐 — 근거의 적용 시점을 확인하세요");
  else if (timeSensitive) warnings.push("시점 의존 주장 — 최신 상황에 따라 결과가 바뀔 수 있음");

  const displayEvidence = agentB.evidence_integrity === true ? [...evidence] : [];
  // Grounded findings can explain a hold even when no decisive proof exists.
  // These contextual quotations do not participate in the verdict gate above.
  for (const finding of agentB.findings ?? []) {
    for (const id of finding.evidence_ids ?? []) {
      const source = sources.find(item => item.evidence_id === id);
      if (source && typeof finding.quote === "string" && finding.quote.length >= 10 && source.snippet.includes(finding.quote) &&
          !displayEvidence.some(item => item.evidence_id === id)) displayEvidence.push({ ...source, snippet: finding.quote, citation_role: "finding_context" });
    }
  }
  const citations = displayEvidence.slice(0, 12).map(e => ({
    evidence_id: e.evidence_id,
    url: e.url,
    published_at: e.published_at ?? null,
    published_at_source: e.published_at_source ?? null,
    source_role: e.source_role,
    citation_role: e.citation_role ?? "decisive_evidence",
    snippet: e.snippet,
    title: e.title,
    captured_at: e.captured_at,
    content_hash: e.content_hash,
    snapshot_id: e.snapshot_id,
    source_kind: e.source_kind,
    extraction_scope: e.extraction_scope,
    text_truncated: e.text_truncated,
    applies_on: e.applies_on ?? null,
    time_basis: e.time_basis ?? null,
    time_quote: e.time_quote ?? null,
    time_reasoning: e.time_reasoning ?? null
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
    final_confidence: notRun ? null : factConfidence,
    verification_status: agentB.verification_status ?? (evidence.length ? "reviewed" : "incomplete"),
    assessment_basis: agentB.assessment_basis ?? "insufficient",
    answer_summary: unsafeNarrative ? "" : agentB.answer_summary ?? "",
    findings: agentB.findings ?? [],
    confidence_kind: "model_self_report_not_probability",
    score_breakdown: {
      fact_confidence: notRun ? null : factConfidence,
      source_reliability: sourceReliability,
      propaganda_risk: propagandaRisk
    },
    temporal: {
      ...agentB.time_context,
      as_of: agentB.as_of ?? null,
      time_sensitive: timeSensitive,
      situation_changed: situationChanged,
      note: temporalNote,
      sentiment_timeline: sentimentTimeline
    },
    final_summary: temporalNote ? `${baseSummary} ⏱ ${temporalNote}` : baseSummary,
    citations,
    reason_codes: agentB.reason_codes ?? [],
    review: agentB.review ?? null,
    warnings
  };
}
