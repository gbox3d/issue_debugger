import { asList, claimStatus, formatTime, safeUrl } from "./verificationDisplay.js";
import "./ClaimCard.css";

const VERDICT_MAP = {
  true: { label: "근거상 지지", cls: "verdict-true" },
  false: { label: "근거상 반박", cls: "verdict-false" },
  hold: { label: "판단 보류", cls: "verdict-hold" },
  mixed: { label: "상충하는 근거", cls: "verdict-mixed" },
};
const BASIS_LABEL = { direct: "직접 기록 근거", reporting: "언론 보도 근거", mixed: "보도와 직접 기록", insufficient: "근거 부족" };
const FINDING_LABEL = { reported_statement: "보도에 담긴 발언", reported_identification: "보도에 등장한 인물·대상", direct_record: "직접 기록에서 확인", unresolved: "아직 확인되지 않은 부분" };
const REVIEW_LABEL = { supported: "지지", refuted: "반박", unknown: "보류", true: "지지", false: "반박", hold: "보류" };
const SOURCE_ROLE = { input_article: "검사 대상 기사", user_reference: "사용자가 추가한 근거", discovered_source: "자동 검색으로 수집한 근거" };

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : "기록 없음";
}

export default function ClaimCard({ result, noEvidence = false }) {
  const { claim, agentA, agentB, agentC, agg = {} } = result;
  const citations = asList(agg.citations).filter(Boolean);
  const status = noEvidence ? "not_run" : claimStatus(result);
  const reviewed = status === "reviewed";
  const incomplete = ["not_run", "incomplete"].includes(status);
  const basis = agg.assessment_basis;
  const unsafeSummary = asList(agg.reason_codes).some(code => ["citation_invalid", "finding_invalid", "extraction_mismatch", "time_quote_invalid", "time_applicability_unverified", "time_basis_missing", "report_time_unverified", "assessment_basis_missing", "assessment_basis_conflict"].includes(code));
  const answer = unsafeSummary ? "인용이나 시점의 일치를 확인하지 못해 확정 판단을 보류했습니다. 아래 원문에 연결된 확인 내용과 보류 사유를 참고하세요." : agg.answer_summary || agg.final_summary;
  const baseVerdict = VERDICT_MAP[agg.final_verdict] || VERDICT_MAP.hold;
  const label = incomplete ? "검증 미완료"
    : basis === "reporting" && agg.final_verdict === "true" ? "보도상 지지"
    : basis === "reporting" && agg.final_verdict === "false" ? "보도상 반박"
    : baseVerdict.label;
  const claimId = encodeURIComponent(claim?.claim_id || "claim");
  const citationId = (index) => `evidence-${claimId}-${index}`;
  const findings = (asList(agg.reason_codes).includes("extraction_mismatch") ? [] : asList(agg.findings)).filter((finding) => finding && FINDING_LABEL[finding.kind] && typeof finding.text === "string"
    && (finding.kind === "unresolved" || citations.some((citation) => asList(finding.evidence_ids).includes(citation.evidence_id))));
  const warnings = asList(agg.warnings);
  const reasons = asList(agentB?.reasoning_bullets);
  const nextAction = noEvidence ? "원문이 확보되지 않아 사실 검토를 실행하지 못했습니다. 아래 검색·수집 내역에서 원인을 확인하세요."
    : status === "not_run" ? "사실 검토가 실행되지 않았습니다. 자료를 확보한 뒤 다시 검증할 수 있습니다."
    : "확정 판단에 필요한 근거 또는 검토가 부족합니다. 원문과 보류 사유를 확인해 주세요.";

  return (
    <article className="claim-card">
      <div className="claim-header">
        <span className={`verdict-badge ${incomplete ? "verdict-hold" : baseVerdict.cls}`}>{label}</span>
        <span className="claim-basis">{incomplete ? (status === "not_run" ? "사실 검토 미실행" : "검토 미완료") : BASIS_LABEL[basis] || "이전 보고서 · 근거 유형 기록 없음"}</span>
      </div>

      {incomplete ? <p className="claim-next-action">{nextAction}</p> : answer && <p className="claim-answer">{answer}</p>}
      {basis === "reporting" && !incomplete && <p className="claim-scope-note">이 판단은 수집한 보도의 내용에 관한 것입니다. 당사자의 직접 발언·공식 기록을 확인했다는 뜻이나, 보도 내용 자체의 진실을 보증하는 판정은 아닙니다.</p>}
      {basis === "mixed" && !incomplete && <p className="claim-scope-note">보도 내용과 직접 기록을 함께 검토했습니다. 각 근거가 확인하는 범위를 아래에서 구분합니다.</p>}

      {findings.length > 0 && <ul className="claim-findings">{findings.map((finding, index) => {
        const linked = citations.map((citation, i) => asList(finding.evidence_ids).includes(citation.evidence_id) ? i : -1).filter((i) => i >= 0);
        return <li key={index}>
          <span className={`finding-kind finding-${finding.kind}`}>{FINDING_LABEL[finding.kind]}</span>
          <p>{finding.text}</p>
          {finding.quote && linked.length > 0 && <details className="finding-quote"><summary>판단에 사용한 원문 표현</summary><blockquote>{finding.quote}</blockquote></details>}
          {linked.length > 0 ? <div className="finding-links">{linked.map((i) => <a key={i} href={`#${citationId(i)}`}>근거 {i + 1}</a>)}</div> : <small>연결된 원문 근거가 없어 추가 확인이 필요합니다.</small>}
        </li>;
      })}</ul>}

      <div className="claim-target">
        <p className="claim-target-label">검증할 주장 · 아래 문장 자체가 확인된 사실은 아닙니다</p>
        <blockquote className="claim-text">{claim?.claim_text || "주장 내용이 기록되지 않았습니다."}</blockquote>
      </div>

      {citations.length > 0 && <section className="claim-evidence" aria-label="원문 근거">
        <h3>확인에 사용한 원문 <span>{citations.length}건</span></h3>
        <ol className="citations-list">
          {citations.map((citation, i) => <li key={citation.evidence_id || i} id={citationId(i)}>
            <div className="citation-heading"><span className="citation-number">근거 {i + 1}</span>{safeUrl(citation.url) ? <a href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer">{citation.title || citation.url} ↗</a> : <span>원문 주소가 기록되지 않았습니다</span>}</div>
            {citation.snippet && <blockquote className="citation-quote">{citation.snippet}</blockquote>}
            <p className="citation-inline-time">발행 {formatTime(citation.published_at)} · 수집 {formatTime(citation.captured_at)}</p>
            {SOURCE_ROLE[citation.source_role] && <p className="citation-inline-time">{SOURCE_ROLE[citation.source_role]}</p>}
            {citation.citation_role === "finding_context" && <p className="citation-limitation">보류 사유와 보도 내용을 설명하는 자료이며, 확정 판정의 근거로 채택된 것은 아닙니다.</p>}
            <p className="citation-inline-time">주장 적용일 {citation.applies_on || agg.temporal?.subject_date || "확인되지 않음"}</p>
            <details className="claim-details citation-time-details"><summary>이 날짜에 적용한 이유</summary>
              {citation.time_quote && <div className="citation-time"><span>원문 속 날짜·기간</span><blockquote>{citation.time_quote}</blockquote></div>}
              <p className="citation-reason">{citation.time_reasoning || "이전 기록에 적용 이유가 없습니다."}</p>
              <p className="citation-inline-time">{citation.time_basis === "dated_record" ? "원문의 명시적 날짜·기간을 사용" : citation.time_basis === "dated_report" ? "기사 발행 시각과 본문 사건 표현을 대조" : citation.time_basis === "timeless" ? "특정 시점에 의존하지 않는 사실로 검토" : "시점 근거 유형 기록 없음"}</p>
              {citation.text_truncated && <p className="citation-limitation">수집 길이 제한으로 본문 일부만 검토했습니다.</p>}
              {citation.evidence_id && <p className="citation-identifiers">근거 ID: {citation.evidence_id}</p>}
              {citation.content_hash && <p className="citation-identifiers">원문 해시: {citation.content_hash}</p>}
            </details>
          </li>)}
        </ol>
      </section>}

      <details className="claim-details">
        <summary>판단 이유와 검토 내역{warnings.length ? ` · 참고 ${warnings.length}개` : ""}</summary>
        {agg.temporal?.subject_date && <p className="claim-review-note">사실 판단 대상일 {agg.temporal.subject_date}</p>}
        {unsafeSummary && <p className="claim-review-note">인용 검증을 통과하지 못해 모델의 서술형 결론을 표시하지 않습니다.</p>}
        {!unsafeSummary && agg.temporal?.note && <p className="claim-review-note">{agg.temporal.note}</p>}
        {!unsafeSummary && reasons.length > 0 && <ul>{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
        {agg.review && <div className="claim-review">
          <p>별도 검토: {incomplete ? "확정 조건 미충족" : agg.review.passed ? "판정 조건 충족" : "확정 조건 미충족"} · 의견 {REVIEW_LABEL[agg.review.verdict] || "기록 없음"}</p>
          {!unsafeSummary && asList(agg.review.reasoning_bullets).length > 0 && <ul>{agg.review.reasoning_bullets.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
        </div>}
        {warnings.length > 0 && <ul className="claim-warnings">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        {asList(agentA?.origin_candidates).length > 0 && <details className="claim-details"><summary>추가 출처 후보</summary><ul>{agentA.origin_candidates.map((origin, i) => <li key={i}>{safeUrl(origin.url) ? <a href={safeUrl(origin.url)} target="_blank" rel="noopener noreferrer">{origin.url}</a> : origin.notes || "주소 없음"}</li>)}</ul></details>}
      </details>

      <details className="claim-details">
        <summary>모델 참고 점수 · {reviewed ? "정확도를 뜻하지 않음" : status === "not_run" ? "미실행" : "표시하지 않음"}</summary>
        {reviewed ? <>
          <p className="claim-review-note">모델 자체 점수 {pct(agg.final_confidence)} · 실제 정답 확률이나 측정된 정확도가 아닙니다.</p>
          <div className="score-grid">
            <ScoreBar label="사실 근거" value={agg.score_breakdown?.fact_confidence} />
            <ScoreBar label="출처 신뢰" value={agg.score_breakdown?.source_reliability} />
            <ScoreBar label="감정 자극도" value={agg.score_breakdown?.propaganda_risk} invert />
          </div>
          {agentC && <p className="claim-review-note">표현 분석: 편향 {pct(agentC.bias_score)} · 감정유발 {pct(agentC.emotion_trigger_score)}</p>}
        </> : <p className="claim-review-note">{status === "not_run" ? "사실 검토 미실행 — 점수를 계산한 결과가 아닙니다." : "검토 완료 여부가 확인되지 않아 점수를 표시하지 않습니다."}</p>}
      </details>
    </article>
  );
}

function ScoreBar({ label, value, invert }) {
  if (!Number.isFinite(value)) return <p className="score-bar-label">{label}: 기록 없음</p>;
  const v = Math.max(0, Math.min(1, value));
  const color = invert ? v > 0.7 ? "var(--red)" : v > 0.4 ? "var(--yellow)" : "var(--green)" : v > 0.7 ? "var(--green)" : v > 0.4 ? "var(--yellow)" : "var(--red)";
  return <div className="score-bar-wrap"><div className="score-bar-label"><span>{label}</span><span>{pct(value)}</span></div><div className="score-bar-track"><div className="score-bar-fill" style={{ width: pct(value), background: color }} /></div></div>;
}
