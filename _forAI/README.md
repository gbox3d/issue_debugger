# _forAI Guide

## 목차

- [One-line summary](#one-line-summary)
- [Read order](#read-order)
- [File roles](#file-roles)
- [Quick Project Map](#quick-project-map)
- [Careful Points](#careful-points)
- [Repository](#repository)

---

## One-line summary

`issue_debugger` is the Marbas prototype: a Korean issue verification and fact-checking assistant with an Express API, OpenAI-backed agent pipeline, local trusted-source RAG stub, and React frontend.

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
- Verification flow: `claimExtractor -> origin/factcheck/intent agents -> aggregate -> report`.
- LLM layer: `src/services/llm/ollamaClient.js` is legacy-named but currently calls the OpenAI Chat Completions API.
- RAG layer: `src/services/rag/trustedDb.js` reads a local JSON trusted DB and does simple keyword scoring.
- Frontend: `frontend/` is a Vite React app that calls `/api/verify` and displays claim reports.
- Planning docs: `docs/architecture.md`, `docs/ref.md`, and `_forAI/plan.md` describe the intended agent-first public AI fact-checking system.

## Careful Points

- `.env` must stay untracked; use `.env.example` for safe defaults.
- The trusted DB seed file at `src/services/rag/sample_trusted_db.json` is ignored by pattern and may be absent locally.
- Web search is still a stub.
- URL input is accepted by the API but not yet used for crawling/body extraction.
- Current code and older docs are partly in transition from Ollama naming to OpenAI runtime.

## Repository

- Name: `issue_debugger`
- Path: `/mnt/data/work/issue_debugger`
