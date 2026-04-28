import { useState } from "react";
import { verifyText } from "./api.js";
import VerifyForm from "./components/VerifyForm.jsx";
import ResultPanel from "./components/ResultPanel.jsx";
import Header from "./components/Header.jsx";
import "./App.css";

export default function App() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async ({ text, url }) => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await verifyText({ text, url });
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Header />
      <VerifyForm onSubmit={handleSubmit} loading={loading} />
      {error && <div className="error-banner">{error}</div>}
      {loading && <div className="loading">분석 중...</div>}
      {results && <ResultPanel data={results} />}
    </div>
  );
}
