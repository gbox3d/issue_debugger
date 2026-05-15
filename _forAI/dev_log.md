# Dev Log

## 목차

- [2026-04-28](#2026-04-28)
  - [forAI 스캐폴드 동기화](#forai-스캐폴드-동기화)
  - [프로젝트 구조 재확인](#프로젝트-구조-재확인)
- [2026-03-22](#2026-03-22)
  - [프로젝트명 반영](#프로젝트명-반영)
  - [초기 LLM 방향 수정](#초기-llm-방향-수정)
  - [Agent 중심 방향 확정](#agent-중심-방향-확정)
  - [이번에 확인한 현재 구현 상태](#이번에-확인한-현재-구현-상태)
  - [현재 확인된 공백 / 문제점](#현재-확인된-공백--문제점)
  - [이번에 정리한 방향성](#이번에-정리한-방향성)
  - [다음 구현 우선순위](#다음-구현-우선순위)
  - [참고 문서](#참고-문서)

---

## 2026-04-28

### forAI 스캐폴드 동기화
- `forai-scaffold` 스킬로 `_forAI/README.md`와 `_forAI/inventory.md`를 생성함.
- 기존 `_forAI/plan.md`, `_forAI/memo.md`, `_forAI/dev_log.md`는 덮어쓰지 않고 보존함.

### 프로젝트 구조 재확인
- 백엔드는 Express 기반이며 `src/server.js`가 `/health`, `/version`, `/api/verify`를 제공함.
- 검증 흐름은 `claimExtractor -> origin/factcheck/intent agents -> aggregate -> report` 구조임.
- 프론트엔드는 `frontend/`의 Vite React 앱이며, `frontend/src/api.js`가 백엔드 API를 호출함.
- LLM 파일명은 `ollamaClient.js`로 남아 있지만 현재 구현은 OpenAI Chat Completions API를 호출함.
- `.env`는 Git에서 제거하고 `.gitignore`로만 관리해야 함. 공개 가능한 값은 `.env.example`에만 둔다.

## 2026-03-22

### 프로젝트명 반영
- 프로젝트 코드명을 `Marbas`로 확정함.
- 이름 선택 이유는 `숨은 일에 대한 진실한 답`과 `기계기술` 이미지가 현재 시스템 방향과 잘 맞기 때문.
- README와 런타임 표기, 패키지명을 `Marbas` 기준으로 정리함.

### 초기 LLM 방향 수정
- 초기 계획의 기본 LLM 백엔드를 `로컬 Ollama`가 아니라 `ChatGPT API(OpenAI API)` 기준으로 잡기로 함.
- 현재 저장소 코드는 Ollama 프로토타입이지만, 초기 제품화 범위에서는 Ollama를 뒤로 미루고 OpenAI 쪽을 기본 backend로 연결하는 방향으로 수정 예정.
- 따라서 문서에서는 `현재 구현 상태`와 `초기 제품화 방향`을 분리해서 기록해야 함.

### Agent 중심 방향 확정
- 이 프로젝트는 단순 검증 API보다 `agent concept`가 강한 프로젝트로 정의함.
- claim 추출, 출처 추적, 크롤링, 사실 대조, 서사 분석, 리포트 생성까지를 각각 agent 역할로 나누는 쪽이 맞음.
- 크롤링과 본문 정리도 규칙 기반 직접 파싱보다 `AI-assisted extraction` 비중을 높이는 방향으로 정함.
- 직접 파싱은 canonical URL, 제목, 발행시각 같은 최소 메타데이터 추출 수준으로 최대한 제한함.

### 이번에 확인한 현재 구현 상태
- Express 기반 서버가 구성되어 있고 `GET /health`, `GET /version`, `POST /api/verify` 엔드포인트가 준비되어 있음.
- 검증 파이프라인은 `claim extraction -> Agent A(origin) / Agent B(factcheck) / Agent C(intent) -> aggregate -> report` 구조로 이미 분리되어 있음.
- LLM 연동은 로컬 Ollama 기준으로 구현되어 있으며, JSON 강제 파싱과 최소 스키마 검증 유틸이 포함되어 있음.
- RAG 검색은 로컬 JSON 기반 단순 키워드 검색 구조로 준비되어 있음.
- 리포트는 claim별로 `verdict`, `confidence`, `fact`, `origin`, `intent`, `citations`, `warnings`를 반환하는 형태까지 구성되어 있음.

### 현재 확인된 공백 / 문제점
- `.env`와 `config.js`에서 참조하는 `./src/services/rag/sample_trusted_db.json` 파일이 실제로 없음.
- 웹 검색은 아직 `webSearch.stub.js` 상태라서 외부 실시간 근거를 수집하지 못함.
- `url` 입력 필드는 API에 존재하지만, 실제 본문 수집/파싱에는 아직 사용되지 않음.
- claim extraction 결과에서 `opinion`이나 `needs_verification=false` 항목을 후속 검증 단계에서 필터링하지 않고 있음.
- 최종 판정은 아직 `fact confidence + source reliability + propaganda risk` 정도의 단순 가중 방식임.
- 사용자가 중요하게 본 `초국가적 공신력`, `이권 개입 가능성`, `독립 출처 여부`, `집단 분위기 전염`, `인간 편향 유발`은 아직 모델/스키마/집계 규칙에 반영되지 않음.

### 이번에 정리한 방향성
- 이 시스템은 단순한 `참/거짓` 판별기보다 `다층 검증 리포트`로 가는 방향이 적합함.
- 사실 판정과 별개로 `출처 공신력`, `독립성`, `이해관계 거리`, `선동성`, `집단 확산 리스크`, `인과 관계 가설`을 분리해서 보여주는 구조가 필요함.
- 공신력은 언론 브랜드 자체보다 `1차 자료`, `초국가·공적 기관`, `독립 검증 가능성` 중심으로 설계하는 것이 맞음.
- 이권 개입이나 인과 분석은 최종 사실 판정과 섞지 않고 `가설층`으로 분리하는 것이 안전함.

### 다음 구현 우선순위
1. `ChatGPT API` 기반 agent runtime과 공통 JSON contract를 먼저 잡는다.
2. `Intake / Claim / Source / Fact / Narrative / Report Agent` 역할을 분리한다.
3. `sample_trusted_db.json`과 신뢰 소스 메타데이터 seed를 만들어 최소 동작 가능한 근거 저장소를 확보한다.
4. `/api/verify`에서 검증 대상 claim만 남기고 의견성 claim은 `skipped_claims`로 분리한다.
5. 크롤링과 본문 정리는 `Crawl/Collection Agent` 중심으로 옮기고 직접 파싱은 최소화한다.
6. evidence/source에 `source_tier`, `independence_class`, `interest_risk`를 붙이는 공신력 모델을 도입한다.
7. 최종 aggregator를 게이트 방식으로 바꿔 상위 근거가 없으면 기본값이 `hold`가 되도록 조정한다.
8. 리포트에 `social_contagion_score`, `narrative_pressure_score`, `causal_hypotheses`를 추가한다.

### 참고 문서
- 상세 구현 계획은 `_forAI/plan.md`에 정리함.
- 현재 공개 문서인 `readme.md`는 아직 아키텍처 이미지 수준이라, 구현이 조금 더 진행되면 API 사용법과 판정 기준을 보강해야 함.
