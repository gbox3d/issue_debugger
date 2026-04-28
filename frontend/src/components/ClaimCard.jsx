import "./ClaimCard.css";

const VERDICT_MAP = {
  true: { label: "TRUE", cls: "verdict-true" },
  false: { label: "FALSE", cls: "verdict-false" },
  hold: { label: "HOLD", cls: "verdict-hold" },
  mixed: { label: "MIXED", cls: "verdict-mixed" },
};

function pct(v) {
  return `${Math.round((v ?? 0) * 100)}%`;
}

export default function ClaimCard({ result }) {
  const { claim, agentA, agentB, agentC, agg, report } = result;
  const v = VERDICT_MAP[agg?.final_verdict] || VERDICT_MAP.hold;

  return (
    <article className="claim-card">
      {/* Header */}
      <div className="claim-header">
        <span className={`verdict-badge ${v.cls}`}>{v.label}</span>
        <span className="claim-confidence">confidence {pct(agg?.final_confidence)}</span>
      </div>

      {/* Claim text */}
      <p className="claim-text">{claim?.claim_text}</p>

      {/* Score breakdown */}
      <div className="score-grid">
        <ScoreBar label="사실 근거" value={agg?.score_breakdown?.fact_confidence} />
        <ScoreBar label="출처 신뢰" value={agg?.score_breakdown?.source_reliability} />
        <ScoreBar label="선동 위험" value={agg?.score_breakdown?.propaganda_risk} invert />
      </div>

      {/* Warnings */}
      {agg?.warnings?.length > 0 && (
        <ul className="claim-warnings">
          {agg.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {/* Fact reasoning */}
      {agentB?.reasoning_bullets?.length > 0 && (
        <details className="claim-details">
          <summary>판단 근거</summary>
          <ul>
            {agentB.reasoning_bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Origin */}
      {agentA?.origin_candidates?.length > 0 && (
        <details className="claim-details">
          <summary>출처 후보 ({agentA.origin_candidates.length})</summary>
          <ul>
            {agentA.origin_candidates.map((o, i) => (
              <li key={i}>
                <span className="origin-type">[{o.source_type}]</span>{" "}
                {o.url ? (
                  <a href={o.url} target="_blank" rel="noopener noreferrer">
                    {o.url}
                  </a>
                ) : (
                  o.notes || "URL 없음"
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Bias / Intent */}
      {agentC && (
        <details className="claim-details">
          <summary>편향/선동 분석</summary>
          <div className="bias-grid">
            <span>선동성: {pct(agentC.propaganda_score)}</span>
            <span>편향: {pct(agentC.bias_score)}</span>
            <span>감정유발: {pct(agentC.emotion_trigger_score)}</span>
          </div>
          {agentC.manipulation_flags?.length > 0 && (
            <div className="manip-flags">
              {agentC.manipulation_flags.map((f, i) => (
                <span key={i} className="flag-tag">{f}</span>
              ))}
            </div>
          )}
        </details>
      )}

      {/* Citations */}
      {agg?.citations?.length > 0 && (
        <details className="claim-details">
          <summary>인용 ({agg.citations.length})</summary>
          <ul className="citations-list">
            {agg.citations.map((c, i) => (
              <li key={i}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noopener noreferrer">{c.url}</a>
                ) : (
                  <span>{c.snippet}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function ScoreBar({ label, value, invert }) {
  const v = value ?? 0;
  const p = Math.round(v * 100);
  const color = invert
    ? v > 0.7 ? "var(--red)" : v > 0.4 ? "var(--yellow)" : "var(--green)"
    : v > 0.7 ? "var(--green)" : v > 0.4 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="score-bar-wrap">
      <div className="score-bar-label">
        <span>{label}</span>
        <span>{p}%</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}
