import { config } from "../../config.js";
import { logWarn } from "../../utils/logger.js";

/**
 * 네이버 검색 API — 뉴스 검색.
 * 관련도 정렬을 사용하며 검색 장애와 검색 결과 없음을 구분한다.
 * 기존 배열 반환 함수는 detailed 결과의 results만 반환하는 호환 래퍼다.
 */

export function hasNaver() {
  return Boolean(config.naver.clientId && config.naver.clientSecret);
}

function stripHtml(s) {
  return String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(pubDate) {
  if (!pubDate) return null;
  const d = new Date(pubDate); // 네이버 pubDate 는 RFC1123 (예: "Mon, 06 Jul 2026 15:30:00 +0900")
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function searchNaverNewsDetailed({ query, count, request = fetch }) {
  const provider = "naver";
  if (typeof query !== "string" || !query.trim() || query.length > 160) return { provider, status: "error", error_code: "invalid_query", results: [] };
  if (!hasNaver()) {
    return { provider, status: "disabled", error_code: "not_configured", results: [] };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.web.timeoutMs);

  try {
    const display = Math.min(100, Math.max(1, Number.isFinite(count) ? count : config.naver.maxResults));
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query.trim())}&display=${display}&sort=sim`;

    const resp = await request(url, {
      headers: {
        "X-Naver-Client-Id": config.naver.clientId,
        "X-Naver-Client-Secret": config.naver.clientSecret
      },
      signal: controller.signal
    });

    if (!resp.ok) {
      logWarn(`[naver] HTTP ${resp.status}`);
      return { provider, status: "error", error_code: `http_${resp.status}`, results: [] };
    }

    const data = await resp.json();
    if (!Array.isArray(data?.items)) return { provider, status: "error", error_code: "invalid_response", results: [] };
    const items = data.items;

    const results = items.map((it) => ({
      title: stripHtml(it.title),
      url: it.originallink || it.link || "",
      published_at: toIso(it.pubDate),
      snippet: stripHtml(it.description).slice(0, 400),
      score: null, provider
    }));
    return { provider, status: results.length ? "ok" : "no_results", results };
  } catch (e) {
    const error_code = e?.name === "AbortError" ? "timeout" : e instanceof SyntaxError ? "invalid_response" : "network_error";
    logWarn(`[naver] ${error_code}`);
    return { provider, status: "error", error_code, results: [] };
  } finally {
    clearTimeout(t);
  }
}

export async function searchNaverNews(options) {
  return (await searchNaverNewsDetailed(options)).results;
}
