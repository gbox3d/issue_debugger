import { config } from "../../config.js";
import { logWarn } from "../../utils/logger.js";

// 한국 뉴스 URL 등에 박힌 날짜(20YYMMDD, 20YY-MM-DD 등)를 뽑아 ISO 로 변환.
// URL 날짜는 검색 힌트로만 사용하며 원문의 발행 시각을 대신하지 않는다.
function dateFromUrl(url) {
  const m = String(url ?? "").match(/(20\d{2})[/_.\-]?(0[1-9]|1[0-2])[/_.\-]?(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * 웹검색. 기본 topic="general" (한국어 커버리지가 news topic보다 훨씬 좋음).
 * 제공자의 관련도 순서를 유지한다. URL에서 추측한 날짜는 별도로 표시한다.
 * query 는 주장 문장 전체가 아니라 주어/대상 엔티티(claim.search_query)를 넣는다.
 */
export async function searchWebDetailed({ query, topic = "general", days, maxResults, request = fetch }) {
  const provider = "tavily";
  if (typeof query !== "string" || !query.trim() || query.length > 160) return { provider, status: "error", error_code: "invalid_query", results: [] };
  if (!config.web.tavilyApiKey) {
    return { provider, status: "disabled", error_code: "not_configured", results: [] };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.web.timeoutMs);

  const isNews = topic === "news";
  try {
    const resp = await request("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        api_key: config.web.tavilyApiKey,
        query: query.trim(),
        topic: isNews ? "news" : "general",
        ...(isNews ? { days: days ?? config.web.recencyDays } : {}),
        search_depth: "basic",
        max_results: maxResults ?? config.web.maxResults,
        include_answer: false,
        include_raw_content: false
      })
    });

    if (!resp.ok) {
      logWarn(`[webSearch] HTTP ${resp.status}`);
      return { provider, status: "error", error_code: `http_${resp.status}`, results: [] };
    }

    const data = await resp.json();
    if (!Array.isArray(data?.results)) return { provider, status: "error", error_code: "invalid_response", results: [] };
    const results = data.results;

    const mapped = results.map((r) => ({
      title: r.title ?? "untitled",
      url: r.url ?? "",
      published_at: r.published_date ?? dateFromUrl(r.url) ?? null,
      snippet: (r.content ?? "").slice(0, 400),
      score: typeof r.score === "number" ? r.score : null,
      provider,
      published_at_source: r.published_date ? "api" : dateFromUrl(r.url) ? "url_inferred" : null
    }));
    // Keep provider relevance order. A new publication is not necessarily relevant.
    return { provider, status: mapped.length ? "ok" : "no_results", results: mapped };
  } catch (e) {
    const error_code = e?.name === "AbortError" ? "timeout" : e instanceof SyntaxError ? "invalid_response" : "network_error";
    logWarn(`[webSearch] ${error_code}`);
    return { provider, status: "error", error_code, results: [] };
  } finally {
    clearTimeout(t);
  }
}

export async function searchWeb(options) {
  return (await searchWebDetailed(options)).results;
}
