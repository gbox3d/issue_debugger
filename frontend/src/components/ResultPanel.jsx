import ClaimCard from "./ClaimCard.jsx";
import "./ResultPanel.css";

export default function ResultPanel({ data }) {
  const { claims, results } = data;

  if (!results || results.length === 0) {
    return <div className="result-empty">추출된 사실 주장이 없습니다.</div>;
  }

  return (
    <section className="result-panel">
      <h2 className="result-title">검증 결과</h2>
      <p className="result-count">{results.length}개 주장 분석 완료</p>
      <div className="result-list">
        {results.map((r, i) => (
          <ClaimCard key={r.claim?.claim_id || i} result={r} />
        ))}
      </div>
    </section>
  );
}
