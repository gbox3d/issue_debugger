import { useState, useEffect } from "react";
import { verifyText, fetchVersion, fetchReport } from "./api.js";
import VerifyForm from "./components/VerifyForm.jsx";
import ResultPanel from "./components/ResultPanel.jsx";
import Header from "./components/Header.jsx";
import PersonnelPanel from "./components/PersonnelPanel.jsx";
import fePkg from "../package.json";
import "./App.css";

const HISTORY_KEY = "marbas.verify.reportIds";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRecentIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string" && UUID.test(id)))].slice(0, 10) : [];
  } catch { return []; }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("general");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [backendVersion, setBackendVersion] = useState(null);
  const [recentIds, setRecentIds] = useState(readRecentIds);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchVersion()
      .then((v) => setBackendVersion(v?.app?.version ?? null))
      .catch(() => setBackendVersion(null));
  }, []);

  const remember = (id) => {
    if (typeof id !== "string" || !UUID.test(id)) return;
    setRecentIds((current) => {
      const next = [id, ...current.filter((other) => other !== id)].slice(0, 10);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* 세션 안에서는 기록을 계속 제공한다. */ }
      return next;
    });
  };

  const handleSubmit = async (request) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setResults(null);
    try {
      const data = await verifyText(request);
      setResults(data);
      remember(data.id);
      if (data.id) setNotice(request.previous_id ? "새 검증 기록을 저장했습니다. 이전 기록은 그대로 보존됩니다." : "검증 기록을 저장했습니다.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openReport = async (id) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setResults(null);
    try {
      const data = await fetchReport(id);
      setResults(data);
      remember(data.id);
      setNotice("저장 당시의 판정입니다. 같은 대상일과 자료 기준으로 다시 판단하려면 재검증하세요.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const changeTabWithKeyboard = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "general" : event.key === "End" ? "personnel" : activeTab === "general" ? "personnel" : "general";
    setActiveTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  };

  return (
    <div className="app">
      <div className="version-badge">
        BE {backendVersion ?? "…"} · FE {fePkg.version}
      </div>
      <Header />
      <div className="verification-tabs" role="tablist" aria-label="검증 종류" onKeyDown={changeTabWithKeyboard}>
        <button type="button" role="tab" id="general-tab" aria-controls="general-pane" aria-selected={activeTab === "general"} tabIndex={activeTab === "general" ? 0 : -1} onClick={() => setActiveTab("general")}>
          시점 기반 팩트체크
        </button>
        <button type="button" role="tab" id="personnel-tab" aria-controls="personnel-pane" aria-selected={activeTab === "personnel"} tabIndex={activeTab === "personnel" ? 0 : -1} onClick={() => setActiveTab("personnel")}>
          검증 예제 — 재임 이력
        </button>
      </div>
      <div id="general-pane" className="general-verification-pane" role="tabpanel" aria-labelledby="general-tab" hidden={activeTab !== "general"}>
        <div className="verification-intro">
          <h2>어느 시점의 사실을 확인할까요?</h2>
          <p>검색어·검증할 문장 또는 기사 URL로 시작하세요. 관련 보도를 찾고 원문을 읽어, 보도에서 확인된 내용과 직접 기록이 뒷받침하는 사실을 구분합니다.</p>
        </div>
        <VerifyForm onSubmit={handleSubmit} loading={loading} />
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <p className="verification-note" role="status">{notice}</p>}
        {loading && <div className="loading" role="status">검증 요청을 처리하고 있습니다. 검색과 원문 수집에 시간이 걸릴 수 있습니다…</div>}
        {results && <ResultPanel data={results} />}
        {results?.id && <div className="verification-report-actions">
          <button type="button" disabled={loading || !results.request} onClick={() => handleSubmit({ ...results.request, previous_id: results.id })}>동일 조건으로 다시 검증</button>
          {results.previous_id && <button type="button" disabled={loading} onClick={() => openReport(results.previous_id)}>이전 판정 보기</button>}
        </div>}
        {recentIds.length > 0 && <section className="verification-history" aria-labelledby="verification-history-title">
          <h3 id="verification-history-title">이 브라우저의 최근 검증 기록</h3>
          <p>최근 보고서 식별자 10개만 브라우저에 보관합니다. 입력한 문장은 브라우저 저장소에 보관하지 않습니다.</p>
          <div>{recentIds.map((id, i) => <button key={id} type="button" disabled={loading} aria-pressed={results?.id === id} onClick={() => openReport(id)}>기록 {i + 1} · {id.slice(0, 8)}</button>)}</div>
        </section>}
      </div>
      <div id="personnel-pane" role="tabpanel" aria-labelledby="personnel-tab" hidden={activeTab !== "personnel"}>
        <p className="verification-note">특정 공식 이력으로 날짜 경계와 근거 추적을 확인하는 보조 예제입니다. 일반 주장 검증은 ‘시점 기반 팩트체크’를 이용하세요.</p>
        <PersonnelPanel />
      </div>
    </div>
  );
}
