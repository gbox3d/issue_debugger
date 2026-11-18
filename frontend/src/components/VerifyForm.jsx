import { useState } from "react";
import "./VerifyForm.css";

export default function VerifyForm({ onSubmit, loading }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [subjectDate, setSubjectDate] = useState(() => kstNow().slice(0, 10));
  const [mode, setMode] = useState("retrospective");
  const [cutoff, setCutoff] = useState(kstNow);
  const [error, setError] = useState(null);

  const canSubmit = Boolean((text.trim() || url.trim()) && subjectDate && (mode !== "as_known" || cutoff)) && !loading;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    const sources = [...new Set(sourceUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
    if (sources.length > 3) { setError("근거 원문 URL은 최대 3개까지 입력할 수 있습니다."); return; }
    if (sources.some((value) => value.length > 2048)) { setError("각 근거 원문 URL은 2,048자 이내로 입력해 주세요."); return; }
    try {
      for (const value of [url.trim(), ...sources].filter(Boolean)) {
        if (!["https:", "http:"].includes(new URL(value).protocol)) throw new Error();
      }
    } catch { setError("URL은 http:// 또는 https://로 시작하는 올바른 주소를 입력해 주세요."); return; }
    const target = new Date(`${subjectDate}T00:00:00+09:00`);
    if (!Number.isFinite(target.getTime()) || kstNow(target).slice(0, 10) !== subjectDate || subjectDate > kstNow().slice(0, 10)) {
      setError("판단할 날짜는 오늘까지의 유효한 날짜여야 합니다."); return;
    }
    const request = { text: text.trim() || undefined, url: url.trim() || undefined, source_urls: sources, subject_date: subjectDate, mode };
    if (mode === "as_known") {
      const instant = new Date(`${cutoff}:00+09:00`);
      if (!Number.isFinite(instant.getTime()) || instant.getTime() > Date.now()) { setError("정보 기준 시각은 현재까지의 유효한 한국 시간을 입력해 주세요."); return; }
      request.knowledge_cutoff = instant.toISOString();
    }
    onSubmit(request);
  };

  return (
    <form className="verify-form" onSubmit={handleSubmit}>
      <label className="verify-field"><span>검색어 또는 검증할 문장</span><textarea
        className="verify-textarea"
        placeholder="사건명·핵심어로 관련 보도를 찾거나, 확인할 주장·기사 본문을 입력하세요."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={20000}
        disabled={loading}
      /><small>검색어만으로도 시작할 수 있습니다. 확인할 문장과 날짜를 구체적으로 쓰면 검증 범위가 분명해집니다.</small></label>
      <label className="verify-field"><span>또는 기사 URL만 입력</span><input
        className="verify-url"
        type="url"
        maxLength={2048}
        placeholder="https://... (기사 본문을 자동으로 읽습니다)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={loading}
      /><small>URL만 입력하면 기사에서 핵심 주장 최대 3개를 확인합니다. 특정 부분을 확인하려면 위에 해당 문장을 함께 입력하세요.</small></label>
      <div className="verify-time-fields">
        <label className="verify-field"><span>사실을 판단할 날짜 (한국 날짜)</span><input className="verify-url" type="date" value={subjectDate} onChange={(e) => setSubjectDate(e.target.value)} max={kstNow().slice(0, 10)} required disabled={loading} /></label>
        <label className="verify-field"><span>사용할 자료</span><select className="verify-url" value={mode} onChange={(e) => setMode(e.target.value)} disabled={loading}>
          <option value="retrospective">현재 자료로 해당 날짜 확인</option>
          <option value="as_known">당시 확보한 자료만 사용</option>
        </select></label>
      </div>
      {mode === "as_known" ? <label className="verify-field"><span>자료 기준 시각 (한국 시간 · KST)</span><input className="verify-url" type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} max={kstNow()} required disabled={loading} /><small>이 시각 전에 실제 저장한 자료만 사용합니다. 당시 자료가 없으면 보류하며, 과거 웹페이지를 자동 복원하지는 않습니다.</small></label> : <p className="verify-help">현재 확보한 자료로 선택한 날짜의 사실을 확인합니다. 이후 발표된 정정이나 회고 자료도 해당 날짜를 설명한다면 사용할 수 있습니다.</p>}
      <details className="verify-sources">
        <summary>이미 알고 있는 근거 URL 추가 (선택 · 최대 3개)</summary>
        <label className="verify-field"><span>대조할 공고·자료 등의 URL을 한 줄에 하나씩 입력하세요.</span><textarea className="verify-textarea" rows={3} value={sourceUrls} onChange={(e) => setSourceUrls(e.target.value)} disabled={loading} placeholder="https://example.org/announcement" /><small>현재 자료 모드에서는 비워 두어도 관련 자료를 검색합니다. 추가한 링크도 주장과 시점이 맞아야 근거로 사용합니다.</small></label>
      </details>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <button className="verify-btn" type="submit" disabled={!canSubmit}>
        {loading ? "분석 중..." : "검증 요청"}
      </button>
    </form>
  );
}

function kstNow(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
