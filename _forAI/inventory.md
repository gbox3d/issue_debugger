# Inventory

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
- `src/routes/verify.js`: accepts `{ text, url?, collected_at? }`, rejects missing `text`, extracts claims, runs three agents per claim in parallel, aggregates, and returns JSON.
- `src/modules/claimExtractor.js`: calls the LLM with claim-extraction prompts and validates minimal claim shape.
- `src/modules/agents/origin.js`: Agent A, origin/timeline candidate analysis. Uses web search stub only when enabled.
- `src/modules/agents/factcheck.js`: Agent B, trusted DB + web evidence pack, `supported|refuted|unknown`.
- `src/modules/agents/intent.js`: Agent C, propaganda/bias/emotion-trigger analysis.
- `src/modules/aggregator.js`: combines fact confidence, source reliability, and propaganda risk into `true|false|hold`.
- `src/modules/report.js`: shapes final claim report for API/UI use.

## LLM / Evidence Layer

- `src/services/llm/ollamaClient.js`: legacy filename/API names, but implementation calls `https://api.openai.com/v1/chat/completions` with `response_format: { type: "json_object" }`.
- `src/config.js`: reads `.env`, uses `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`, RAG settings, and web-search flag.
- `src/services/llm/prompts.js`: JSON-only prompt contracts for claim extraction and the three agents.
- `src/services/llm/schemas.js`: lightweight runtime shape guards.
- `src/services/rag/trustedDb.js`: loads trusted DB JSON from `TRUSTED_DB_PATH`, then keyword-scores docs with `credibility_weight`.
- `src/services/web/webSearch.stub.js`: placeholder for real web search integration.

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
- `.env.example` still contains older Ollama-oriented variable names, while current runtime code reads OpenAI variables. This docs/code drift should be cleaned up.
- `readme.md` also still describes parts of the project as an Ollama prototype, but current `ollamaClient.js` already calls OpenAI.
- `src/services/rag/sample_trusted_db.json` is referenced by default config but may be missing because `src/services/rag/*_db.json` is ignored.
- URL input is passed through the API but not used for crawling yet.
- Opinion/non-verification claims are not filtered out before agent execution yet.
- Aggregation is still confidence-threshold based; planned trust-tier gate rules live in `_forAI/plan.md`.
