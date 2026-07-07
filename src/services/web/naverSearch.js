import { config } from "../../config.js";
import { logWarn } from "../../utils/logger.js";

/**
 * 네이버 검색 API — 뉴스 검색.
 * 한국어 native + 항목마다 pubDate(발행일) 포함 + sort=date(최신순) 라, 시점 의존 주장(이슈)에 최적.
 * 반환 형태는 Tavily searchWeb 과 동일: [{ title, url, published_at, snippet, score }]
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

export async function searchNaverNews({ query, count }) {
  if (!hasNaver()) {
    logWarn("[naver] client id/secret missing, skipping");
    return [];
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.web.timeoutMs);

  try {
    const display = Math.min(100, Math.max(1, count ?? config.naver.maxResults));
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${display}&sort=date`;

    const resp = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": config.naver.clientId,
        "X-Naver-Client-Secret": config.naver.clientSecret
      },
      signal: controller.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logWarn(`[naver] error: ${resp.status} ${resp.statusText} ${body}`);
      return [];
    }

    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    // sort=date 라 이미 최신순. 형태만 정규화.
    return items.map((it) => ({
      title: stripHtml(it.title),
      url: it.originallink || it.link || "",
      published_at: toIso(it.pubDate),
      snippet: stripHtml(it.description).slice(0, 400),
      score: null
    }));
  } catch (e) {
    logWarn(`[naver] request failed: ${String(e?.message ?? e)}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}
