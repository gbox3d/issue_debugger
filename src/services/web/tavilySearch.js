import { config } from "../../config.js";
import { logWarn } from "../../utils/logger.js";

// 한국 뉴스 URL 등에 박힌 날짜(20YYMMDD, 20YY-MM-DD 등)를 뽑아 ISO 로 변환.
// Tavily general 검색은 published_date 를 안 주는 경우가 많아, 시간순 정렬을 위해 보조로 사용.
function dateFromUrl(url) {
  const m = String(url ?? "").match(/(20\d{2})[/_.\-]?(0[1-9]|1[0-2])[/_.\-]?(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * 웹검색. 기본 topic="general" (한국어 커버리지가 news topic보다 훨씬 좋음).
 * published_date 가 없으면 URL 에서 날짜를 추출해 시간순 정렬한다.
 * query 는 주장 문장 전체가 아니라 주어/대상 엔티티(claim.search_query)를 넣는다.
 */
export async function searchWeb({ query, topic = "general", days, maxResults }) {
  if (!config.web.tavilyApiKey) {
    logWarn("[webSearch] TAVILY_API_KEY missing, skipping web search");
    return [];
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.web.timeoutMs);

  const isNews = topic === "news";
  try {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: config.web.tavilyApiKey,
        query,
        topic: isNews ? "news" : "general",
        ...(isNews ? { days: days ?? config.web.recencyDays } : {}),
        search_depth: "basic",
        max_results: maxResults ?? config.web.maxResults,
        include_answer: false,
        include_raw_content: false
      })
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logWarn(`[webSearch] Tavily error: ${resp.status} ${resp.statusText} ${body}`);
      return [];
    }

    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const mapped = results.map((r) => ({
      title: r.title ?? "untitled",
      url: r.url ?? "",
      published_at: r.published_date ?? dateFromUrl(r.url) ?? null,
      snippet: (r.content ?? "").slice(0, 400),
      score: typeof r.score === "number" ? r.score : null
    }));

    // 날짜 있는 결과를 최신순으로 앞에 (없으면 관련도 순 유지)
    mapped.sort((a, b) => {
      const ta = a.published_at ? Date.parse(a.published_at) : NaN;
      const tb = b.published_at ? Date.parse(b.published_at) : NaN;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });

    return mapped;
  } catch (e) {
    logWarn(`[webSearch] request failed: ${String(e?.message ?? e)}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}
