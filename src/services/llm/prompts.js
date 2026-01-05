export function systemJsonOnly(schemaName) {
  return {
    role: "system",
    content:
      [
        "You are a verification assistant.",
        "Return ONLY valid JSON object. No markdown, no extra text.",
        "If evidence is insufficient, set verdict to 'unknown' / hold.",
        `Schema: ${schemaName}`
      ].join("\n")
  };
}

export function promptClaimExtract({ text, url, collected_at }) {
  return [
    systemJsonOnly("ClaimExtraction"),
    {
      role: "user",
      content: JSON.stringify({
        task: "Extract factual claims from input. Separate opinions. Provide spans if possible.",
        input: { text, url: url ?? null, collected_at: collected_at ?? null },
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
              needs_verification: true
            }
          ]
        }
      })
    }
  ];
}

export function promptAgentA({ claim }) {
  return [
    systemJsonOnly("AgentA_Origin"),
    {
      role: "user",
      content: JSON.stringify({
        task: "Track earliest origin candidates and timeline. If no web results are provided, be conservative.",
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

export function promptAgentB({ claim, evidencePack }) {
  return [
    systemJsonOnly("AgentB_FactCheck"),
    {
      role: "user",
      content: JSON.stringify({
        task: "Judge claim with provided evidence ONLY. Do not use outside knowledge.",
        claim,
        evidence_pack: evidencePack,
        rules: [
          "If evidence is contradictory or weak => verdict unknown",
          "Confidence should reflect strength and number of credible sources"
        ],
        output_schema: {
          claim_id: claim.claim_id,
          verdict: "supported|refuted|unknown",
          confidence: 0.0,
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

export function promptAgentC({ claim, text }) {
  return [
    systemJsonOnly("AgentC_IntentBias"),
    {
      role: "user",
      content: JSON.stringify({
        task: "Analyze intent/bias/propaganda patterns. Do NOT decide factual truth here.",
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
