import { config } from "../../config.js";
import { normalizeUrl } from "../verification/time.js";
import { searchNaverNewsDetailed } from "./naverSearch.js";
import { searchWebDetailed } from "./tavilySearch.js";
import { fetchUrl, isYouTubeUrl } from "./urlFetch.js";

const querySchema = {
  type: "object", additionalProperties: false, required: ["query"],
  properties: { query: { type: "string", minLength: 1, maxLength: 160 }, count: { type: "integer", minimum: 1, maximum: 10 } }
};
export const NEWS_TOOL_SCHEMAS = [
  { name: "search_news", description: "Search news by relevance; returned excerpts are discovery hints, not verified original evidence.", input_schema: querySchema },
  { name: "search_web", description: "Search original records and reporting across the web; distinguish provider failures from no matches.", input_schema: querySchema },
  { name: "fetch_article", description: "Fetch and extract a public HTTP(S) article using server-side URL protections. Does not bypass access restrictions.",
    input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string", maxLength: 2048 } } } }
];

function validQuery(input) {
  return input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).every(key => ["query", "count"].includes(key)) &&
    typeof input.query === "string" && input.query.trim().length > 0 && input.query.length <= 160 &&
    !/[\u0000-\u001f]/.test(input.query) &&
    (input.count == null || Number.isInteger(input.count) && input.count >= 1 && input.count <= 10);
}

export function fetchFailureCode(warning) {
  const text = String(warning ?? "").toLowerCase();
  if (/blocked/.test(text)) return "blocked_url";
  if (/unsupported/.test(text)) return "unsupported_type";
  if (/invalid url|invalid redirect/.test(text)) return "invalid_url";
  if (/http \d/.test(text)) return "http_error";
  if (/abort|timeout/.test(text)) return "timeout";
  if (/no extractable text/.test(text)) return "no_text";
  if (/too large/.test(text)) return "content_too_large";
  if (/disabled/.test(text)) return "disabled";
  return "network_error";
}

export function unsupportedMediaReason(url) {
  if (isYouTubeUrl(url)) return "unsupported_video";
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (/(?:^|\/)(?:videos?|watch|reels?)(?:\/|$)/i.test(parsed.pathname)) return "unsupported_video";
  if (/(?:^|\.)podcasts\.apple\.com$/i.test(parsed.hostname) ||
      /(?:^|\/)(?:podcasts?)(?:\/|$)/i.test(parsed.pathname) ||
      /(?:^|\.)spotify\.com$/i.test(parsed.hostname) && /^\/(?:episode|show)\//.test(parsed.pathname)) return "unsupported_audio";
  return null;
}

export function createNewsTools({ searchNews = searchNaverNewsDetailed, searchWeb = searchWebDetailed, fetchArticle = fetchUrl } = {}) {
  const invalid = provider => ({ provider, status: "error", error_code: "invalid_input", results: [] });
  return {
    async search_news(input) {
      if (!validQuery(input)) return invalid("naver");
      try { return await searchNews({ query: input.query.trim(), count: input.count ?? 8 }); }
      catch { return { provider: "naver", status: "error", error_code: "network_error", results: [] }; }
    },
    async search_web(input) {
      if (!validQuery(input)) return invalid("tavily");
      if (!config.web.enabled) return { provider: "tavily", status: "disabled", error_code: "disabled_by_config", results: [] };
      try { return await searchWeb({ query: input.query.trim(), maxResults: input.count ?? 8, topic: "general" }); }
      catch { return { provider: "tavily", status: "error", error_code: "network_error", results: [] }; }
    },
    async fetch_article(input) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "url")) {
        return { status: "error", error_code: "invalid_input", result: null };
      }
      let url;
      try { url = normalizeUrl(input.url); } catch { return { status: "error", error_code: "invalid_url", result: null }; }
      const unsupported = unsupportedMediaReason(url);
      if (unsupported) return { status: "unsupported", error_code: unsupported, result: null };
      try {
        const result = await fetchArticle({ url, preferArticle: true });
        if (!result?.ok) {
          const error_code = fetchFailureCode(result?.warning);
          return { status: error_code === "blocked_url" ? "blocked" : error_code === "unsupported_type" ? "unsupported" : "error", error_code, result: null };
        }
        return { status: "ok", result };
      } catch { return { status: "error", error_code: "network_error", result: null }; }
    }
  };
}

export async function searchProviders({ query, providers = ["naver", "tavily"], maxResults = 8 }) {
  const tools = createNewsTools();
  return { batches: await Promise.all(providers.map(provider =>
    provider === "naver" ? tools.search_news({ query, count: maxResults }) : tools.search_web({ query, count: maxResults }))) };
}
