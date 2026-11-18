export const asList = (value) => Array.isArray(value) ? value : [];

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function formatTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "확인되지 않음";
  return `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} KST`;
}

export function claimStatus(result) {
  const agg = result?.agg || {};
  if (agg.verification_status === "not_run") return "not_run";
  if (agg.verification_status === "incomplete") return "incomplete";
  if (agg.verification_status === "reviewed") return "reviewed";
  if (!asList(agg.citations).length) return "incomplete";
  return "legacy";
}
