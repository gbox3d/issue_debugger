export function renderReport({ claim, agentA, agentB, agentC, agg }) {
  // 최종 리포트는 텍스트(또는 Markdown)로도 내고, 필요하면 JSON 그대로 UI에 표시하면 됩니다.
  return {
    title: `검증 리포트 - ${claim.claim_id}`,
    claim: claim.claim_text,
    verdict: agg.final_verdict,
    confidence: agg.final_confidence,
    why: {
      fact: { verdict: agentB.verdict, confidence: agentB.confidence, bullets: agentB.reasoning_bullets },
      origin: { confidence: agentA.confidence, origin_candidates: agentA.origin_candidates?.slice(0, 3) ?? [] },
      intent: {
        propaganda_score: agentC.propaganda_score,
        bias_score: agentC.bias_score,
        emotion_trigger_score: agentC.emotion_trigger_score,
        flags: agentC.manipulation_flags
      }
    },
    citations: agg.citations,
    warnings: agg.warnings
  };
}
