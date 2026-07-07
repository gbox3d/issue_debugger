export function systemJsonOnly(schemaName, asOf) {
  return {
    role: "system",
    content: [
      "You are a verification assistant.",
      "Return ONLY valid JSON object. No markdown, no extra text.",
      asOf ? `The current date is ${asOf}. Truth and public sentiment are TIME-DEPENDENT — the same claim can be true at one time and false/contested at another.` : "",
      asOf ? "Do NOT rely on stale prior knowledge. Prefer the MOST RECENT provided evidence (a newer published_at outweighs an older one for time-sensitive claims). Judge time-sensitive claims AS OF the current date. If the situation has recently changed, you MUST surface that change rather than giving a timeless answer." : "",
      "If evidence is insufficient, set verdict to 'unknown' / hold.",
      `Schema: ${schemaName}`
    ].filter(Boolean).join("\n")
  };
}

export function promptClaimExtract({ text, url, collected_at, asOf }) {
  return [
    systemJsonOnly("ClaimExtraction", asOf),
    {
      role: "user",
      content: JSON.stringify({
        task: "Extract factual claims from input. Separate opinions. Provide spans if possible.",
        instructions: [
          "Set is_time_sensitive=true for any claim whose truth OR evaluation can change over time (current role/status, records, rankings, 'now', reputation/sentiment words like '자랑스러운'/'최고').",
          "Evaluative/sentiment words are opinions, not facts — mark type=opinion but STILL extract them so the sentiment can be tracked.",
          "search_query: build the BEST short web query to find recent NEWS about this claim's SUBJECT (주어) and key OBJECT/target (대상) — use the proper-noun entities (people, orgs, events) only. Do NOT put the whole sentence, and DROP evaluative/sentiment modifiers ('자랑스러운','최고','역적'). Example: '홍명보는 한국의 자랑스러운 축구감독이다' -> search_query '홍명보 축구 국가대표 감독'. Keep it in the claim's language."
        ],
        input: { text, url: url ?? null, collected_at: collected_at ?? null, as_of: asOf ?? null },
        output_schema: {
          claims: [
            {
              claim_id: "c1",
              type: "fact|opinion|mixed",
              claim_text: "string",
              span: { start: 0, end: 10 },
              entities: ["string"],
              keywords: ["string"],
              language: "ko|en|unknown",
              is_time_sensitive: true,
              search_query: "홍명보 축구 국가대표 감독",
              needs_verification: true
            }
          ]
        }
      })
    }
  ];
}

export function promptAgentA({ claim, asOf }) {
  return [
    systemJsonOnly("AgentA_Origin", asOf),
    {
      role: "user",
      content: JSON.stringify({
        task: "Track earliest origin candidates and timeline. Order timeline chronologically and include the most RECENT relevant events. If no web results are provided, be conservative.",
        as_of: asOf ?? null,
        claim,
        output_schema: {
          claim_id: claim.claim_id,
          origin_candidates: [
            {
              url: "string",
              published_at: "ISO8601 or null",
              source_type: "news|blog|sns|community|unknown",
              source_reliability: 0.0,
              notes: "string"
            }
          ],
          timeline: [{ time: "ISO8601 or null", event: "string" }],
          confidence: 0.0
        }
      })
    }
  ];
}

export function promptAgentB({ claim, evidencePack, asOf }) {
  return [
    systemJsonOnly("AgentB_FactCheck", asOf),
    {
      role: "user",
      content: JSON.stringify({
        task: "Judge claim with provided evidence ONLY. Do not use outside knowledge.",
        as_of: asOf ?? null,
        claim,
        evidence_pack: evidencePack,
        rules: [
          "If the claim is a settled historical fact (claim.is_time_sensitive is false — e.g. a past date/event), set time_sensitive=false, situation_changed=false, sentiment_timeline=[] and skip temporal analysis. Only do the temporal/sentiment analysis below for claims about current status or public sentiment.",
          "The evidence spans TIME: recent dated news + older/background (encyclopedic) sources. Explicitly COMPARE the earlier/background framing against the MOST RECENT news.",
          "Weigh evidence by recency: for time-sensitive claims, evidence with a newer published_at is more authoritative for the CURRENT state.",
          "TEMPORAL CONFLICT: set situation_changed=true when the subject's status or public sentiment clearly DIFFERS between the earlier/background evidence and the most recent news (e.g., celebrated→criticized, appointed→resigned). Judge verdict by the CURRENT state as of the current date, and explain what changed and when in temporal_note.",
          "EVALUATIVE/OPINION claims (e.g. '자랑스러운', '최고', '역적'): do NOT force true/false. Set verdict 'unknown' and describe the CURRENT public sentiment and the shift in temporal_note + sentiment_timeline.",
          "Build sentiment_timeline chronologically (oldest→newest) from the dated evidence: each entry = a period, the dominant sentiment then, and the basis/trigger.",
          "If evidence is contradictory or weak => verdict unknown.",
          "Confidence should reflect strength, recency, and number of credible sources."
        ],
        output_schema: {
          claim_id: claim.claim_id,
          verdict: "supported|refuted|unknown",
          confidence: 0.0,
          time_sensitive: true,
          situation_changed: "true 는 과거/배경 근거와 최근 뉴스 사이에 사실/여론이 실제로 달라진 정황이 확인될 때. 단순 시점 의존만으로 true 로 하지 말 것.",
          as_of: asOf ?? null,
          temporal_note: "시점에 따른 사실/여론 변화 설명 (예: '2024 감독 선임 당시 기대·긍정 → 2026 월드컵 실패 후 비난·사퇴로 여론 반전'). 변화 증거가 없으면 그렇다고 명시.",
          sentiment_timeline: [
            { period: "예: '2024' 또는 '2026-06'", sentiment: "positive|neutral|negative|mixed", basis: "근거/촉발 요약" }
          ],
          evidence: [
            {
              source: "trusted_db|web",
              title: "string",
              url: "string",
              published_at: "ISO8601 or null",
              snippet: "string",
              stance: "support|refute"
            }
          ],
          reasoning_bullets: ["string"],
          missing_info: ["string"]
        }
      })
    }
  ];
}

export function promptAgentC({ claim, text, asOf }) {
  return [
    systemJsonOnly("AgentC_IntentBias", asOf),
    {
      role: "user",
      content: JSON.stringify({
        task: "Analyze intent/bias/propaganda patterns. Do NOT decide factual truth here. Note that sentiment/framing can shift over time — describe the CURRENT framing as of the current date.",
        as_of: asOf ?? null,
        claim,
        original_text: text,
        output_schema: {
          claim_id: claim.claim_id,
          propaganda_score: 0.0,
          bias_score: 0.0,
          emotion_trigger_score: 0.0,
          manipulation_flags: ["string"],
          confidence: 0.0,
          notes: "string"
        }
      })
    }
  ];
}
