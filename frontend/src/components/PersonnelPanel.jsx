import { useState } from "react";
import { fetchPersonnelReport, verifyPersonnel } from "../api.js";
import "./PersonnelPanel.css";

const HISTORY_KEY = "marbas.personnel.reportIds";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICTS = {
  true: { label: "지지", detail: "공식 이력의 재임기간과 일치합니다." },
  false: { label: "반박", detail: "공식 이력의 해당 기간 재직자와 다릅니다." },
  hold: { label: "보류", detail: "이 자료만으로는 확정할 수 없습니다." },
};

function readRecentIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string" && UUID.test(id)))].slice(0, 10) : [];
  } catch {
    return [];
  }
}

function kstInputTime(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function displayTime(value) {
  if (!value) return "확인되지 않음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
  }).format(date);
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function PersonnelPanel() {
  const [inputType, setInputType] = useState("person");
  const [person, setPerson] = useState("김종석");
  const [text, setText] = useState("김종석은 기상청장이었다.");
  const [subjectDate, setSubjectDate] = useState("2019-06-01");
  const [mode, setMode] = useState("retrospective");
  const [cutoff, setCutoff] = useState("2019-06-01T23:59");
  const [report, setReport] = useState(null);
  const [recentIds, setRecentIds] = useState(readRecentIds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const remember = (id) => {
    if (typeof id !== "string" || !UUID.test(id)) return;
    setRecentIds((current) => {
      const next = [id, ...current.filter((other) => other !== id)].slice(0, 10);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // 브라우저 저장이 차단되어도 현재 세션에서는 기록을 열 수 있다.
      }
      return next;
    });
  };

  const runVerification = async (request) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await verifyPersonnel(request);
      setReport(result);
      remember(result.id);
      setNotice(request.previous_id ? "새 검증 기록을 저장했습니다. 이전 기록도 보존됩니다." : "검증 기록을 저장했습니다.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const request = {
      ...(inputType === "person" ? { person: person.trim() } : { text: text.trim() }),
      subject_date: subjectDate,
      mode,
    };
    if (mode === "as_known") {
      const date = new Date(`${cutoff}:00+09:00`);
      if (Number.isNaN(date.getTime())) {
        setError("정보 기준 시각을 입력해 주세요.");
        return;
      }
      request.knowledge_cutoff = date.toISOString();
    }
    setReport(null);
    runVerification(request);
  };

  const openReport = async (id) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchPersonnelReport(id);
      setReport(result);
      remember(result.id);
      setNotice("저장 당시의 검증 기록입니다. 최신 자료를 조회한 결과는 아닙니다.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const recheck = () => {
    const request = report.request;
    runVerification({
      ...(request.text ? { text: request.text } : { person: request.person }),
      subject_date: request.subject_date,
      mode: request.mode,
      ...(request.knowledge_cutoff ? { knowledge_cutoff: request.knowledge_cutoff } : {}),
      previous_id: report.id,
    });
  };

  const chooseExample = (example) => {
    setInputType("person");
    setPerson("김종석");
    setSubjectDate(example === "after" ? "2021-01-01" : "2019-06-01");
    setMode(example === "past" ? "as_known" : "retrospective");
    setCutoff("2019-06-01T23:59");
    setReport(null);
    setError(null);
    setNotice("예시를 채웠습니다. ‘재임 여부 확인’을 눌러 검증하세요.");
  };

  const verdict = VERDICTS[report?.verdict] || VERDICTS.hold;
  const canSubmit = !loading && Boolean((inputType === "person" ? person : text).trim() && subjectDate && (mode !== "as_known" || cutoff));

  return (
    <section className="personnel-panel" aria-labelledby="personnel-heading">
      <div className="personnel-intro">
        <p className="personnel-eyebrow">기상청 · 역대 청장 이력</p>
        <h2 id="personnel-heading">그날, 누가 재직하고 있었나요?</h2>
        <p>기상청 공식 이력의 종료된 재임기간을 확인합니다. 현직의 계속 재직 여부, 이력에 없는 이름, 다른 기관은 판단을 보류합니다.</p>
      </div>

      <form className="personnel-form" onSubmit={handleSubmit}>
        <fieldset disabled={loading}>
          <legend>확인할 사람 또는 주장</legend>
          <div className="personnel-choices">
            <label><input type="radio" name="personnel-input" value="person" checked={inputType === "person"} onChange={() => setInputType("person")} /> 이름으로 확인</label>
            <label><input type="radio" name="personnel-input" value="text" checked={inputType === "text"} onChange={() => setInputType("text")} /> 문장으로 확인</label>
          </div>
          {inputType === "person" ? (
            <label className="personnel-field"><span>이름</span><input value={person} onChange={(e) => setPerson(e.target.value)} maxLength={10} required autoComplete="off" /></label>
          ) : (
            <label className="personnel-field"><span>기상청장 재직에 관한 사실 주장 한 문장</span><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} required placeholder="김종석은 기상청장이었다." /><small>Claude가 문장에서 인물과 직위를 읽습니다. 재임 여부는 공식 이력의 날짜로 확인합니다.</small></label>
          )}
          <label className="personnel-field"><span>재직 여부를 확인할 날짜</span><input type="date" value={subjectDate} onChange={(e) => setSubjectDate(e.target.value)} max={kstInputTime().slice(0, 10)} required /></label>
        </fieldset>

        <fieldset disabled={loading}>
          <legend>어느 시점의 자료를 사용할까요?</legend>
          <label className="personnel-mode"><input type="radio" name="personnel-mode" checked={mode === "retrospective"} onChange={() => setMode("retrospective")} /><span><strong>현재 자료로 과거 확인</strong><small>지금 수집한 공식 이력으로 선택한 날짜를 확인합니다.</small></span></label>
          <label className="personnel-mode"><input type="radio" name="personnel-mode" checked={mode === "as_known"} onChange={() => setMode("as_known")} /><span><strong>당시 확보 자료로 확인</strong><small>정보 기준 시각 전에 이 서비스가 저장한 자료만 사용합니다. 당시 자료가 없으면 보류합니다.</small></span></label>
          {mode === "as_known" && <label className="personnel-field"><span>정보 기준 시각 (한국 시간 · KST)</span><input type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} max={kstInputTime()} required /><small>옛 웹페이지를 자동 복원하는 기능은 아닙니다.</small></label>}
        </fieldset>

        <div className="personnel-examples" aria-label="입력 예시">
          <span>예시</span>
          <button type="button" disabled={loading} onClick={() => chooseExample("during")}>재임 중</button>
          <button type="button" disabled={loading} onClick={() => chooseExample("after")}>퇴임 후</button>
          <button type="button" disabled={loading} onClick={() => chooseExample("past")}>당시 자료 부족</button>
        </div>
        <button className="personnel-submit" type="submit" disabled={!canSubmit}>{loading ? "확인 중…" : "재임 여부 확인"}</button>
      </form>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <p className="personnel-notice" role="status">{notice}</p>}
      {loading && <p className="personnel-notice" role="status">자료와 검증 기록을 확인하고 있습니다.</p>}

      {report && <article className={`personnel-report personnel-${report.verdict}`} aria-label="인사 시점 검증 결과" aria-busy={loading}>
        <div className="personnel-report-header"><span className="personnel-verdict">{verdict.label}</span><h3>{report.claim?.person || report.request?.person || "입력 주장"} · 기상청장 재직 여부</h3></div>
        <p>{report.summary || verdict.detail}</p>
        <dl className="personnel-facts">
          <div><dt>확인 대상일</dt><dd>{report.request?.subject_date}</dd></div>
          <div><dt>확인 방식</dt><dd>{report.request?.mode === "as_known" ? "당시 확보 자료" : "현재 자료로 과거 확인"}</dd></div>
          {report.request?.knowledge_cutoff && <div><dt>정보 기준 시각</dt><dd>{displayTime(report.request.knowledge_cutoff)} KST</dd></div>}
          <div><dt>판단 시각</dt><dd>{displayTime(report.evaluated_at)} KST</dd></div>
        </dl>
        {report.warnings?.length > 0 && <ul className="personnel-warnings">{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        {report.evidence?.length > 0 ? <div className="personnel-evidence">
          <h4>판단에 사용한 공식 원문</h4>
          {report.evidence.map((evidence, i) => <div className="personnel-evidence-card" key={evidence.evidence_id || i}>
            <blockquote>{evidence.quote}</blockquote>
            <p>{evidence.person} · 재임기간 {evidence.valid_from} ~ {evidence.valid_to || "종료 확인 안 됨"}</p>
            <p className="personnel-meta">자료 수집: {displayTime(evidence.captured_at)} KST</p>
            {safeSourceUrl(evidence.url) && <a href={safeSourceUrl(evidence.url)} target="_blank" rel="noopener noreferrer">{evidence.title || "기상청 공식 원문 보기"} ↗</a>}
            <details><summary>근거 식별 정보</summary><p>근거 ID: {evidence.evidence_id}</p><p>원문 해시: {evidence.content_hash}</p></details>
          </div>)}
        </div> : <p className="personnel-meta">이 판정을 확정할 수 있는 공식 근거를 확보하지 못했습니다.</p>}
        <div className="personnel-report-actions">
          <button type="button" disabled={loading || !report.request} onClick={recheck}>동일 조건으로 다시 검증</button>
          {report.previous_id && <button type="button" disabled={loading} onClick={() => openReport(report.previous_id)}>이전 판정 보기</button>}
        </div>
        <p className="personnel-meta">보고서 {report.id}</p>
      </article>}

      {recentIds.length > 0 && <section className="personnel-history" aria-labelledby="personnel-history-heading">
        <h3 id="personnel-history-heading">이 브라우저의 최근 검증 기록</h3>
        <p>최근 10개 보고서의 식별자만 브라우저에 보관합니다. 저장된 기록은 다시 검증하기 전까지 바뀌지 않습니다.</p>
        <div>{recentIds.map((id, i) => <button key={id} type="button" disabled={loading} aria-pressed={report?.id === id} onClick={() => openReport(id)}>기록 {i + 1} · {id.slice(0, 8)}</button>)}</div>
      </section>}
    </section>
  );
}
