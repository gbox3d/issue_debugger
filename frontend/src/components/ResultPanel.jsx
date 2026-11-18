import ClaimCard from "./ClaimCard.jsx";
import { asList, claimStatus, formatTime, safeUrl } from "./verificationDisplay.js";
import "./ResultPanel.css";

const QUERY_STATUS = { ok: "검색됨", no_results: "검색 결과 없음", disabled: "검색 미설정", error: "검색 실패" };
const CANDIDATE_STATUS = { captured: "본문 확보", fetch_failed: "본문 수집 실패", unsupported: "지원하지 않는 형식", duplicate: "중복 제외", not_attempted: "수집하지 않음" };
const SOURCE_ROLE = { input_article: "검사 대상 기사", user_reference: "사용자가 추가한 근거", discovered_source: "자동 검색 근거" };
const FAILURE_REASON = {
  search_failed: "검색 서비스 응답 실패", search_disabled: "검색 서비스가 설정되지 않음", search_no_results: "관련 검색 결과 없음",
  source_fetch_failed: "후보 기사의 본문을 확보하지 못함", source_unusable: "본문이 불완전하거나 자료 시점이 맞지 않음",
  input_source_unavailable: "입력한 기사의 본문을 확보하지 못함", snapshot_unavailable: "자료 기준 시각 이전에 저장된 원문이 없음",
  blocked_url: "접근이 제한된 주소", unsupported_type: "지원하지 않는 자료 형식", unsupported_video: "영상 본문은 수집하지 않음",
  http_error: "원문 서버에서 오류 응답", timeout: "응답 시간 초과", network_error: "원문 서버 연결 실패", no_text: "읽을 수 있는 본문 없음",
  invalid_url: "올바르지 않은 주소", budget_exceeded: "이번 요청의 수집 한도에 도달",
  irrelevant_candidate: "검색 제목·요약에서 주장과의 관련성이 확인되지 않음", insufficient_body: "제목 수준의 짧은 본문만 확보해 참고 자료로 보존",
  partial_text: "본문 일부만 확보해 참고 자료로 보존", publication_after_cutoff: "자료 기준 시각 이후에 발행된 자료",
  content_too_large: "본문 크기가 수집 한도를 초과", duplicate_url: "같은 주소가 있어 중복 제외", duplicate_final_url: "이동된 주소가 같아 중복 제외",
};

function failureText(value) {
  if (!value) return null;
  return FAILURE_REASON[value] || (/[가-힣]/.test(value) ? value : "세부 원인을 확인하지 못했습니다");
}

export default function ResultPanel({ data }) {
  const results = asList(data.results).filter(Boolean);
  const time = data.time || data.request || {};
  const retrieval = data.retrieval;
  const coverage = data.coverage || {};
  const sourceCountKnown = Number.isFinite(retrieval?.usable) || Array.isArray(data.evidence_sources);
  const hasSources = retrieval?.usable > 0 || asList(data.evidence_sources).length > 0 || results.some((result) => asList(result.agg?.citations).length > 0);
  const noEvidence = !hasSources && (sourceCountKnown || results.length > 0);
  const incomplete = noEvidence || (results.length > 0 && results.every((result) => ["not_run", "incomplete"].includes(claimStatus(result))));
  const warnings = asList(data.warnings);
  const nextAction = time.mode === "as_known"
    ? "이 기준 시각 이전에 저장된 자료가 필요합니다. 현재 확보한 자료로 과거를 확인하려면 자료 사용 방식을 바꿔 새 검증을 요청하세요."
    : "검색어에 사건명·날짜를 더해 다시 요청하거나, 알고 있는 기사 URL을 입력해 보세요. 근거 URL을 추가하는 방법도 있습니다.";

  return (
    <section className="result-panel" aria-label="검증 결과">
      <div className={`result-overview ${incomplete ? "result-overview-incomplete" : ""}`}>
        <p className="result-eyebrow">이번 검증에서 확인한 내용</p>
        <h2 className="result-title">{noEvidence ? "원문 확보 실패로 검증 미완료" : incomplete ? "근거 검토가 끝나지 않았습니다" : data.status === "hold" ? "판단 보류 · 추가 근거가 필요합니다" : "주장별 확인 결과"}</h2>
        {time.subject_date && <p className="result-count">사실 판단 대상일 {time.subject_date} · {time.mode === "as_known" ? "당시 확보 자료 기준" : "현재 자료로 확인"}</p>}
        {incomplete && <p className="result-next-action">{nextAction}</p>}
        <p className="result-count">
          검증 대상 {Number.isFinite(coverage.extracted) ? coverage.extracted : results.length}개
          {Number.isFinite(coverage.reviewed) && <> · 검토 {coverage.reviewed}개</>}
          {Number.isFinite(coverage.decided) && <> · 판단 제시 {coverage.decided}개</>}
        </p>
        {coverage.extracted > coverage.attempted && <p className="result-next-action">이번에는 핵심 주장 {coverage.attempted}개를 검토했습니다. 나머지 {coverage.extracted - coverage.attempted}개는 미검증이며, 해당 문장을 따로 입력해 확인할 수 있습니다.</p>}
      </div>

      <div className="result-list">
        {results.map((result, i) => <ClaimCard key={result.claim?.claim_id || i} result={result} noEvidence={noEvidence} />)}
      </div>
      {!results.length && <p className="result-empty">검증할 주장을 확보하지 못했습니다. 기사 본문이나 확인할 문장을 입력하면 다시 시도할 수 있습니다.</p>}

      <RetrievalSummary retrieval={retrieval} noEvidence={noEvidence} />
      {data.resource_usage && <ResourceUsage usage={data.resource_usage} />}

      <details className="result-details">
        <summary>검증 시점과 한계{warnings.length ? ` · 안내 ${warnings.length}개` : ""}</summary>
        <dl className="result-time">
          <div><dt>사실 판단 대상일</dt><dd>{time.subject_date || "확인되지 않음"}</dd></div>
          <div><dt>자료 사용 방식</dt><dd>{time.mode === "as_known" ? "당시 확보 자료만 사용" : time.mode === "retrospective" ? "현재 자료로 해당 날짜 확인" : "이전 기록에 정보 없음"}</dd></div>
          <div><dt>자료 기준 시각</dt><dd>{formatTime(time.knowledge_cutoff || time.evaluated_at || data.evaluated_at)}</dd></div>
          <div><dt>판단 실행 시각</dt><dd>{formatTime(time.evaluated_at || data.evaluated_at)}</dd></div>
        </dl>
        <p className="result-note">분석과 별도 검토는 같은 기반 모델을 사용하므로 공통 오류가 남을 수 있습니다. 모델 점수와 검토 일치는 실제 정답률이 아닙니다.</p>
        {warnings.length > 0 && <ul className="claim-warnings">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        {data.id && <p className="result-record-id">저장된 보고서 {data.id}</p>}
      </details>
    </section>
  );
}

function ResourceUsage({ usage }) {
  const number = (value) => Number.isFinite(value) ? value.toLocaleString("ko-KR") : "기록 없음";
  const tokenFields = [
    ["input_tokens", "입력 토큰"], ["output_tokens", "출력 토큰"],
    ["cache_read_input_tokens", "프롬프트 캐시 읽기"], ["cache_creation_input_tokens", "프롬프트 캐시 생성"],
  ];
  function tokenText(field) {
    const total = usage.token_totals?.[field];
    const measured = usage.measured_token_totals?.[field];
    const unmeasured = usage.unmeasured_calls?.[field];
    if (Number.isFinite(total)) return `${number(total)} 토큰`;
    if (Number.isFinite(measured)) return `측정분 ${number(measured)} 토큰${Number.isFinite(unmeasured) ? ` · ${number(unmeasured)}회 미측정` : " · 전체 합계 알 수 없음"}`;
    return Number.isFinite(unmeasured) && unmeasured > 0 ? `측정 정보 없음 · ${number(unmeasured)}회 미측정` : "측정 정보 없음";
  }
  return <details className="result-details resource-usage">
    <summary>자원 사용 기록 · 모델 호출 {number(usage.call_count)}회 · 검증 캐시 재사용 {number(usage.verified_cache_hits)}회</summary>
    <dl className="resource-usage-grid">
      <div><dt>실제 모델 호출</dt><dd>{number(usage.call_count)}회</dd></div>
      <div><dt>모델 호출 생략</dt><dd>{number(usage.skipped_call_count)}회</dd></div>
      <div><dt>검증 결과 캐시 재사용</dt><dd>{number(usage.verified_cache_hits)}회</dd></div>
      {tokenFields.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{tokenText(field)}</dd></div>)}
    </dl>
    <p className="result-note">토큰은 API가 반환한 측정값만 표시합니다. 미측정 호출이 있으면 전체 합계는 알 수 없습니다. 검증 결과 재사용과 프롬프트 캐시 사용은 서로 다른 기록입니다.</p>
  </details>;
}

function RetrievalSummary({ retrieval, noEvidence }) {
  if (!retrieval) return <p className="result-note">이전 보고서에는 검색 과정 기록이 없습니다. 다시 검증하면 현재의 검색·원문 수집 내역을 확인할 수 있습니다.</p>;
  const queries = asList(retrieval.queries);
  const candidates = asList(retrieval.candidates);
  const found = queries.reduce((sum, query) => sum + (Number.isFinite(query.result_count) ? query.result_count : 0), 0);
  const failures = candidates.filter((candidate) => ["fetch_failed", "unsupported"].includes(candidate.state));
  const failedQueries = queries.filter((query) => ["error", "disabled"].includes(query.status));
  const count = (value) => Number.isFinite(value) ? `${value}건` : "기록 없음";
  const searchLabel = { complete: "검색·수집 기록", partial: "일부 원문만 확보했습니다", failed: "검색·원문 수집에 실패했습니다", not_run: "새로운 웹 검색을 실행하지 않았습니다" }[retrieval.status] || "검색·수집 기록";
  return <section className="retrieval-summary" aria-label="검색과 원문 수집 내역">
    <h3>{searchLabel}</h3>
    <dl className="retrieval-counts">
      <div><dt>검색 결과 <small>(중복 포함)</small></dt><dd>{found}건</dd></div>
      <div><dt>본문 확보</dt><dd>{count(retrieval.captured)}</dd></div>
      <div><dt>검토에 사용할 원문</dt><dd>{count(retrieval.usable)}</dd></div>
    </dl>
    {typeof retrieval.counter_search_complete === "boolean" && <p className="result-note">{retrieval.counter_search_complete ? "정정·반박 자료 검색과 관련 후보 확인을 수행했습니다. 검색 범위 밖의 자료가 없다는 뜻은 아닙니다." : "정정·반박 검색 또는 관련 원문 확인이 일부 끝나지 않았습니다. 해당 주장은 확정을 보류합니다."}</p>}
    {(failures.length > 0 || failedQueries.length > 0) && <p className="retrieval-failure-note">검색 실패·미설정 {failedQueries.length}건 · 원문 수집 실패 {failures.length}건. 아래 내역에서 원인을 확인할 수 있습니다.</p>}
    {noEvidence && !failures.length && !failedQueries.length && <p className="retrieval-failure-note">관련 결과가 없거나 검토 가능한 원문이 확보되지 않았습니다. 검색 요약만으로 사실을 판정하지 않습니다.</p>}
    <details className="result-details">
      <summary>검색어와 기사별 수집 내역 보기</summary>
      {queries.length > 0 ? <ul className="retrieval-list">{queries.map((query, i) => <li key={i}>
        <span className="retrieval-state">{QUERY_STATUS[query.status] || "상태 확인 필요"}</span>
        <strong>{query.query || "검색어 기록 없음"}</strong>
        <small>{query.provider || "검색 제공자 기록 없음"} · 결과 {Number.isFinite(query.result_count) ? query.result_count : 0}건</small>
        {query.purpose && <small>{query.purpose === "counterevidence" ? "정정·반박 검색" : "주장 관련 검색"}</small>}
        {query.error_code && <p>{failureText(query.error_code)}</p>}
      </li>)}</ul> : <p className="result-note">이번 요청에서 실행한 검색어가 없습니다.</p>}
      {candidates.length > 0 && <ul className="retrieval-list">{candidates.map((candidate, i) => <li key={`${candidate.url}-${i}`}>
        <span className="retrieval-state">{CANDIDATE_STATUS[candidate.state] || "상태 확인 필요"}</span>
        {SOURCE_ROLE[candidate.source_role] && <small>{SOURCE_ROLE[candidate.source_role]}</small>}
        {safeUrl(candidate.url) ? <a href={safeUrl(candidate.url)} target="_blank" rel="noopener noreferrer">{candidate.title || candidate.url} ↗</a> : <strong>{candidate.title || "주소 확인 불가"}</strong>}
        {candidate.reason && <p>{failureText(candidate.reason)}</p>}
      </li>)}</ul>}
    </details>
  </section>;
}
