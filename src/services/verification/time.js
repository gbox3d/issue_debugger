import { normalizeExecutionPolicy } from "./executionPolicy.js";

export function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function koreaDate(value) {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return false;
  if (/[+-]14:(?!00)/.test(value)) return false;
  return validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export function normalizeUrl(value, name = "url") {
  if (typeof value !== "string" || value.length > 2048) throw requestError(`${name}은 2048자 이내의 공개 HTTP(S) 주소여야 합니다.`);
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw requestError(`${name} 주소가 유효하지 않습니다.`); }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.port && !["80", "443"].includes(parsed.port))) throw requestError(`${name}은 기본 포트의 공개 HTTP(S) 주소여야 합니다.`);
  parsed.hash = "";
  return parsed.href;
}

export function normalizeRequest(input, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw requestError("요청 객체가 필요합니다.");
  if (input.text != null && typeof input.text !== "string") throw requestError("text는 문자열이어야 합니다.");
  const text = input.text?.trim() || "";
  if (text.length > 20000) throw requestError("검증할 텍스트는 20,000자 이내로 입력하세요.");
  const url = input.url == null || input.url === "" ? null : normalizeUrl(input.url);
  if (!text && !url) throw requestError("검증할 text 또는 url을 입력하세요.");
  if (input.source_urls != null && (!Array.isArray(input.source_urls) || input.source_urls.length > 3)) throw requestError("source_urls는 최대 3개 주소의 배열이어야 합니다.");
  const source_urls = [...new Set((input.source_urls ?? []).map(value => normalizeUrl(value, "source_urls")))];
  let subject_date = input.subject_date ?? koreaDate(now);
  let mode = input.mode ?? "retrospective";
  let cutoff = input.knowledge_cutoff ?? null;
  if (input.as_of != null) {
    if (input.mode != null || input.subject_date != null || input.knowledge_cutoff != null) throw requestError("기존 as_of는 mode, subject_date, knowledge_cutoff와 함께 지정할 수 없습니다.");
    const legacy = input.as_of;
    if (validDate(legacy)) {
      subject_date = legacy;
      cutoff = `${legacy}T00:00:00+09:00`;
    } else if (validTimestamp(legacy)) {
      subject_date = koreaDate(legacy);
      cutoff = legacy;
    } else throw requestError("as_of는 유효한 날짜 또는 시간대가 포함된 ISO 시각이어야 합니다.");
    mode = "as_known";
  }
  if (!validDate(subject_date) || subject_date > koreaDate(now)) throw requestError("subject_date는 오늘(한국 날짜) 이전 또는 오늘의 유효한 YYYY-MM-DD 날짜여야 합니다.");
  if (!["retrospective", "as_known"].includes(mode)) throw requestError("지원하지 않는 검증 모드입니다.");
  let knowledge_cutoff = null;
  if (mode === "as_known") {
    if (!validTimestamp(cutoff) || Date.parse(cutoff) > now.getTime()) throw requestError("knowledge_cutoff는 현재 이전의 시간대가 포함된 유효한 ISO 시각이어야 합니다.");
    knowledge_cutoff = new Date(cutoff).toISOString();
  } else if (cutoff != null && cutoff !== "") throw requestError("knowledge_cutoff는 당시 확보 자료 모드에서만 지정하세요.");
  return { text, url, source_urls, subject_date, mode, knowledge_cutoff, analysis: normalizeExecutionPolicy(input.analysis) };
}
