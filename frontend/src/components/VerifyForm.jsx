import { useState } from "react";
import "./VerifyForm.css";

export default function VerifyForm({ onSubmit, loading }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSubmit({ text: text.trim(), url: url.trim() });
  };

  return (
    <form className="verify-form" onSubmit={handleSubmit}>
      <textarea
        className="verify-textarea"
        placeholder="검증할 텍스트를 입력하세요. 기사 본문, 소문, SNS 글 등..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={loading}
      />
      <input
        className="verify-url"
        type="url"
        placeholder="원문 URL (선택)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={loading}
      />
      <button className="verify-btn" type="submit" disabled={loading || !text.trim()}>
        {loading ? "분석 중..." : "검증 요청"}
      </button>
    </form>
  );
}
