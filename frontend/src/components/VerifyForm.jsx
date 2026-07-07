import { useState } from "react";
import "./VerifyForm.css";

export default function VerifyForm({ onSubmit, loading }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const canSubmit = Boolean(text.trim() || url.trim()) && !loading;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim() && !url.trim()) return;
    onSubmit({ text: text.trim(), url: url.trim() });
  };

  return (
    <form className="verify-form" onSubmit={handleSubmit}>
      <textarea
        className="verify-textarea"
        placeholder="검증할 텍스트를 입력하세요. 기사 본문, 소문, SNS 글 등... (URL만 입력해도 됩니다)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={loading}
      />
      <input
        className="verify-url"
        type="url"
        placeholder="원문 URL (텍스트 없이 URL만 입력 시 본문을 자동 수집)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={loading}
      />
      <button className="verify-btn" type="submit" disabled={!canSubmit}>
        {loading ? "분석 중..." : "검증 요청"}
      </button>
    </form>
  );
}
