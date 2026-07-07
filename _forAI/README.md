# _forAI Guide

## 목차

- [One-line summary](#one-line-summary)
- [Current State / Handoff (2026-07-07)](#current-state--handoff-2026-07-07)
- [Read order](#read-order)
- [File roles](#file-roles)
- [Quick Project Map](#quick-project-map)
- [Careful Points](#careful-points)
- [Repository](#repository)

---

## One-line summary

`issue_debugger` is the Marbas prototype: a Korean **issue** verification / fact-checking assistant — Express API + agent pipeline (claim → origin/factcheck/intent → aggregate → report), dual LLM backend (OpenAI **or** Anthropic behind an adapter router), SSRF-safe URL crawling, Naver/Tavily web search, a **temporal (time-aware) layer**, and a React frontend.

## Current State / Handoff (2026-07-07)

- **Versions**: backend `0.8.0` (`package.json` + `src/config.js`), frontend `0.1.0` (`frontend/package.json`). Bump patch (+1) each change unless told otherwise; see `memo.md` → 버전 규칙.
- **Deployed**: `http://bsqai01.iptime.org:21080/marbas/` — nginx serves `/mnt/data/pds/marbas` (symlink → `frontend/dist`, rebuild with `cd frontend && npm run build`); backend runs under **PM2** as `marbas-api` on port 21030 (`pm2 restart marbas-api` after backend changes; `pm2 save` done).
- **Keys**: live in `.env` (untracked) — OpenAI, Anthropic, Tavily, Naver all set. `LLM_PROVIDER` switches OpenAI/Anthropic.
- **Done today**: dual-LLM adapter; SSRF-safe crawler + URL-only input; **time axis** = as_of injection → subject/object `search_query` → Naver news (dated, Korean) → past+recent contrast → `situation_changed` + `sentiment_timeline` (여론 시계열) in UI.
- **Next candidates** (see `dev_log.md` 2026-07-07 tail): sentiment-targeted search + Narrative agent (plan Phase 7); past-window date-range news; 6-등급 판정 매핑 (RFP); `/api/verify` 오픈API 문서화. Security backlog (DNS rebinding 등) parked in `memo.md`.

## Read order

1. `README.md`
2. `inventory.md`
3. `memo.md`
4. `dev_log.md`
5. `plan.md`

## File roles

- `inventory.md`: what exists in the repository, where the runtime starts, and known implementation gaps.
- `memo.md`: short rules and durable project notes.
- `dev_log.md`: chronological AI-assisted project notes and maintenance history.
- `plan.md`: product/architecture roadmap and phased implementation plan.

## Quick Project Map

- Backend: `src/server.js` starts an Express service with `/health`, `/version`, and `/api/verify`.
- Verification flow: `claimExtractor -> origin/factcheck/intent agents -> aggregate -> report`, with an `as_of` (time) threaded through every prompt.
- LLM layer: `src/services/llm/index.js` (router) + `openaiAdapter.js` / `anthropicAdapter.js`; shared `chatJson()` contract, provider from `LLM_PROVIDER`.
- Search/crawl: `src/services/web/naverSearch.js` (Korean news, dated), `tavilySearch.js` (general/fallback), `urlFetch.js` (SSRF-safe crawler).
- RAG layer: `src/services/rag/trustedDb.js` reads a local JSON trusted DB (4 seed docs) and does keyword scoring.
- Frontend: `frontend/` is a Vite React app that calls `/api/verify` and displays claim reports incl. the temporal banner + sentiment timeline.
- Planning docs: `docs/architecture.md`, `docs/ref.md`, `docs/rfp_review.md`, and `_forAI/plan.md`.

## Careful Points

- `.env` must stay untracked (it holds real keys); use `.env.example` for safe defaults.
- Deployed via nginx symlink + PM2 — rebuild frontend and `pm2 restart marbas-api` for changes to show (see Handoff above).
- `src/services/rag/sample_trusted_db.json` is git-ignored by pattern but present locally (4 seed docs).
- Temporal output is gated on `claim.is_time_sensitive` (settled historical facts get no timeline). The "past" contrast window currently leans on Tavily general (wiki/namu), since Naver has no date-range filter.
- `plan.md` is the April roadmap (Phases 1–12); today's work covers Phase 1/4 + a new time axis not in the original plan — read `dev_log.md` (2026-07-06/07) for the true current state.

## Repository

- Name: `issue_debugger`
- Path: `/mnt/data/work/issue_debugger`
