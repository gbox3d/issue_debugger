import fs from "node:fs";

function loadEnvFile(path = ".env") {
  if (!fs.existsSync(path)) return;
  const raw = fs.readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  version: "0.8.0",

  // 활성 LLM provider 선택 (openai | anthropic)
  llm: {
    provider: (process.env.LLM_PROVIDER ?? "openai").toLowerCase(),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 60000),
  },

  anthropic: {
    // CLAUDE_API_KEY 도 alias 로 인식
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 60000),
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096),
  },

  rag: {
    trustedDbPath: process.env.TRUSTED_DB_PATH ?? "./src/services/rag/sample_trusted_db.json",
    topK: Number(process.env.TRUSTED_DB_TOPK ?? 5)
  },

  web: {
    enabled: String(process.env.WEB_SEARCH_ENABLED ?? "false").toLowerCase() === "true",
    tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
    maxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS ?? 5),
    timeoutMs: Number(process.env.WEB_SEARCH_TIMEOUT_MS ?? 15000),
    recencyDays: Number(process.env.WEB_RECENCY_DAYS ?? 365) // topic=news 일 때 최근 N일로 제한
  },

  // 네이버 검색 API (한국어 뉴스 — pubDate 포함, 발행일순). 시점 의존 주장에 우선 사용.
  naver: {
    clientId: process.env.NAVER_CLIENT_ID ?? "",
    clientSecret: process.env.NAVER_CLIENT_SECRET ?? "",
    maxResults: Number(process.env.NAVER_MAX_RESULTS ?? 15)
  },

  // 검증 파이프라인 성능 튜닝
  pipeline: {
    claimConcurrency: Number(process.env.CLAIM_CONCURRENCY ?? 4), // 동시에 처리할 claim 수
    maxClaims: Number(process.env.CLAIM_MAX ?? 12) // 요청당 검증할 최대 claim 수 (초과분은 skip)
  },

  // SSRF-safe URL 크롤러
  crawl: {
    enabled: String(process.env.CRAWL_ENABLED ?? "true").toLowerCase() === "true",
    timeoutMs: Number(process.env.CRAWL_TIMEOUT_MS ?? 10000),
    maxBytes: Number(process.env.CRAWL_MAX_BYTES ?? 3000000),
    maxTextChars: Number(process.env.CRAWL_MAX_TEXT_CHARS ?? 20000),
    maxRedirects: Number(process.env.CRAWL_MAX_REDIRECTS ?? 3)
  }
};
