# Inventory

## 목차

- [Repository](#repository)
- [Top-level structure](#top-level-structure)
- [Entrypoints](#entrypoints)
- [Backend Flow](#backend-flow)
- [LLM / Evidence Layer](#llm--evidence-layer)
- [Frontend](#frontend)
- [Tests](#tests)
- [Notes](#notes)

---

## Repository

- Name: `issue_debugger`
- Path: `/mnt/data/work/issue_debugger`
- Product/code name: `Marbas`
- Purpose: Korean issue verification / fact-checking assistant for extracting factual claims, checking sources and evidence, and returning a multi-layer verification report.

## Top-level structure

- `_forAI/`: AI-facing project memory, inventory, plan, and development log.
- `docs/`: architecture and public AI consulting/reference materials.
- `frontend/`: Vite + React UI for submitting text/URL and viewing verification results.
- `images/`: architecture diagram assets (`png`, `svg`, `mermaid`).
- `src/`: Express API, verification pipeline, agents, LLM/RAG adapters, utilities.
- `.env.example`: safe environment variable template.
- `.gitignore`: ignores dependencies, generated files, trusted DB JSON seeds, and local `.env`.
- `package.json`: backend package and runtime scripts.
- `readme.md`: project overview, API notes, local run instructions, frontend notes.
- `test.http`: manual HTTP smoke requests for `/health` and `/version`.

## Entrypoints

- Backend development: `npm run dev` -> `node --watch src/server.js`.
- Backend production-style start: `npm start` -> `node src/server.js`.
- Backend API routes:
  - `GET /health`
  - `GET /version`
  - `POST /api/verify`
- Frontend development: `cd frontend && npm run dev`.
- Frontend build: `cd frontend && npm run build`.
- Frontend runtime config: `frontend/public/config.json` currently points browser calls to port `21030` when served from the same host.

## Backend Flow

- `src/server.js`: creates Express app, CORS headers, JSON body parsing, health/version endpoints, and mounts `verifyRouter`.
- `src/routes/verify.js`: accepts `{ text?, url?, collected_at? }`. If `url` is given, crawls it (SSRF-safe) and uses the body as the verification input when `text` is empty (URL-only input); YouTube URLs are detected and skipped with a warning. Requires text **or** a fetchable url. Extracts claims, runs three agents per claim in parallel, aggregates, and returns JSON with `input_enrichment` + `warnings`.
- `src/modules/claimExtractor.js`: calls the LLM with claim-extraction prompts and validates minimal claim shape.
- `src/modules/agents/origin.js`: Agent A, origin/timeline candidate analysis. Uses web search stub only when enabled.
- `src/modules/agents/factcheck.js`: Agent B, trusted DB + web evidence pack, `supported|refuted|unknown`.
- `src/modules/agents/intent.js`: Agent C, propaganda/bias/emotion-trigger analysis.
- `src/modules/aggregator.js`: combines fact confidence, source reliability, and propaganda risk into `true|false|hold`.
- `src/modules/report.js`: shapes final claim report for API/UI use.

## LLM / Evidence Layer

- `src/services/llm/index.js`: LLM Adapter **router**. Exposes the shared contract `chatJson({ messages, schemaName, temperature?, provider? })` used by claimExtractor and all three agents, plus `getLlmInfo()` (used by `/version`). Selects provider from `config.llm.provider` (default `openai`); `provider` arg overrides per call (for future per-agent routing / RFP "2+ models").
- `src/services/llm/openaiAdapter.js`: OpenAI adapter — raw `fetch` to Chat Completions with `response_format: { type: "json_object" }` + lenient JSON recovery. Replaces the old `ollamaClient.js`.
- `src/services/llm/anthropicAdapter.js`: Anthropic adapter via `@anthropic-ai/sdk`. Splits the system message into the top-level `system` param, forces JSON via prompt instruction + lenient parse (no `response_format`/prefill on Claude), sends **no** `temperature` (Sonnet 5 400s on it), disables thinking for fast extraction, wraps `Anthropic.APIError`, and handles `stop_reason: "refusal"`.
- Both adapters share the interface `{ name, tier, model, cost_per_1k, chatJson(), health() }`.
- `src/config.js`: reads `.env` — `LLM_PROVIDER`, `OPENAI_*`, `ANTHROPIC_*` (with `CLAUDE_API_KEY` alias, `ANTHROPIC_MODEL` default `claude-sonnet-5`, `ANTHROPIC_MAX_TOKENS`), RAG settings, and Tavily web-search settings.
- `src/services/llm/prompts.js`: JSON-only prompt contracts for claim extraction and the three agents.
- `src/services/llm/schemas.js`: lightweight runtime shape guards.
- `src/services/rag/trustedDb.js`: loads trusted DB JSON from `TRUSTED_DB_PATH`, then keyword-scores docs with `credibility_weight`.
- `src/services/web/naverSearch.js`: **Naver news search** (`searchNaverNews`, `hasNaver`). Korean-native, returns `pubDate` per item, `sort=date` (newest first). Used for **time-sensitive claims** (routed in `verify.js`); strips HTML/entities, normalizes to the same shape as Tavily. Keys: `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`.
- `src/services/web/tavilySearch.js`: web search via Tavily API (`searchWeb`, `topic` general|news, extracts dates from URLs, sorts newest-first). Used for non-time-sensitive claims and as the Naver fallback. Query is built from the claim's `search_query` (subject/object entities), not the full sentence. Fails soft (returns `[]` + warning) if the key is missing or the request errors.
- `src/services/web/urlFetch.js`: **SSRF-safe URL crawler** (`fetchUrl`, `isYouTubeUrl`). Blocks non-http(s) schemes, non-standard ports, and any host that resolves to a private/reserved/loopback/link-local IP (incl. cloud metadata `169.254.169.254`, IPv4-mapped/NAT64 IPv6 via byte-level check). Follows redirects manually and re-validates each hop. Caps response size/time. Extracts title + `article:published_time` + body text (deterministic minimal, per plan). Fails soft with a warning. Config via `config.crawl` (`CRAWL_*`). Known residual: DNS-rebinding window (baseline pilot; pin-IP dispatcher = future hardening).

## Frontend

- `frontend/src/App.jsx`: owns loading/error/result state and submits verification requests.
- `frontend/src/api.js`: loads `public/config.json`, resolves API base URL, calls `/api/verify` and `/version`.
- `frontend/src/components/VerifyForm.jsx`: text/URL input form.
- `frontend/src/components/ResultPanel.jsx`: renders API verification output.
- `frontend/src/components/ClaimCard.jsx`: claim-level display component.
- CSS lives beside the relevant components plus `frontend/src/index.css`.

## Tests

- No automated test script is currently declared in root or frontend `package.json`.
- Manual smoke checks exist in `test.http` for `GET /health` and `GET /version`.
- Useful manual verification path:
  - Start backend with `npm run dev`.
  - Start frontend with `cd frontend && npm run dev`.
  - Submit Korean issue text through the UI or call `POST /api/verify` directly.

## Notes

- `.env` was previously tracked in the local commit and must remain removed from Git history before pushing.
- `readme.md` still describes the project as an Ollama prototype; runtime is now OpenAI **or** Anthropic behind the LLM Adapter router. Docs drift to clean up.
- `src/services/rag/sample_trusted_db.json` now has 4 seed docs (T1-tier Korean government/academic sources) for demo purposes; still far short of a real corpus.
- URL input is now crawled (SSRF-safe) — URL-only verification works end to end (backend + UI). YouTube transcript extraction is not implemented yet (returns a warning).
- Opinion/non-verification claims are not filtered out before agent execution yet.
- Aggregation is still confidence-threshold based; planned trust-tier gate rules live in `_forAI/plan.md`.
- **Temporal (시간 개념)**: the pipeline injects an `as_of` (current date) into every prompt; claim extraction produces `is_time_sensitive` + a `search_query` (subject/object entities). For time-sensitive claims, `verify.js` gathers **two time windows** — recent (Naver news, dated) + past/background (Tavily general = wiki/namu) — and merges them so Agent B can contrast past vs recent. Agent B returns `time_sensitive`/`situation_changed`/`temporal_note`/`sentiment_timeline`. The aggregator gates all temporal output on `claim.is_time_sensitive` (so settled historical facts get none) and emits a `temporal` block + warnings; the UI renders a "⏱ 상황 변화 감지" banner with a colored sentiment timeline. Evaluative claims (opinions) are described as sentiment-over-time, not judged true/false. Next: sentiment-targeted search + Narrative agent (plan Phase 7), past-window date-range news.
- Web search is now real (Tavily) and confirmed working end-to-end (backend + frontend) with a live `TAVILY_API_KEY` in `.env`.
- Both LLM providers are live and confirmed end-to-end: `LLM_PROVIDER=openai` (gpt-5.4-mini) and `LLM_PROVIDER=anthropic` (claude-sonnet-5) both return valid JSON through the full verify pipeline. Switch via the `LLM_PROVIDER` env var.
- `@anthropic-ai/sdk` is now a runtime dependency.
