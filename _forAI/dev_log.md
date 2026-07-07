# Dev Log

## 목차

- [2026-07-06](#2026-07-06)
  - [팩트체크플랫폼 고도화 제안요청서(RFP) 검토](#팩트체크플랫폼-고도화-제안요청서rfp-검토)
  - [사업 범위와 AI 요구사항](#사업-범위와-ai-요구사항)
  - [Marbas 로드맵과의 정합성](#marbas-로드맵과의-정합성)
  - [다음 판단이 필요한 사항 (미결)](#다음-판단이-필요한-사항-미결)
  - [관련 문서](#관련-문서)
  - [웹검색 실연동 구현 (Tavily)](#웹검색-실연동-구현-tavily)
  - [모델 업데이트 및 데모 검증 (프론트엔드 + 신뢰 DB)](#모델-업데이트-및-데모-검증-프론트엔드--신뢰-db)
  - [LLM Adapter 도입 (OpenAI + Anthropic 이중 provider)](#llm-adapter-도입-openai--anthropic-이중-provider)
  - [원격 배포 (21080/marbas) + 헤더 문구](#원격-배포-21080marbas--헤더-문구)
  - [URL 크롤링 구현 (SSRF-safe) + URL-only 입력](#url-크롤링-구현-ssrf-safe--url-only-입력)
  - [시간 개념(temporal) 도입 — "진실은 시점에 따라 달라진다"](#시간-개념temporal-도입--진실은-시점에-따라-달라진다)
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

## 2026-07-06

### 팩트체크플랫폼 고도화 제안요청서(RFP) 검토
- 시청자미디어재단이 발주한 실제 정부 입찰 제안요청서 `docs/raw/제안요청서_팩트체크 고도화 1차.hwpx`를 확인함.
- 사업명: 팩트체크플랫폼 고도화 / 예산 2억 2천만원(부가세 포함) / 사업기간 계약일로부터 4개월.
- 일정: 입찰공고 '26.7, 사업자 선정 '26.8 — 검토 시점(2026-07-06) 기준 임박한 사안.
- 입찰방식: 제한경쟁입찰(협상에 의한 계약), 기술평가 90% : 가격평가 10%.
- 자격 제한: 소기업만 참여 가능(대기업·중견기업 배제), 공동수급(컨소시엄) 불가.

### 사업 범위와 AI 요구사항
- 사업 몸통은 플랫폼 전면 재구축(UI/UX 개편, 기존 AWS 팩트체크넷 DB 이관, 역할별 기능: 일반사용자/전문팩트체커/재단관리자, 6등급 판정 체계, CMS)이고 AI는 그 중 파일럿 모듈 하나임.
- `SFR-009/010`: 텍스트 기반 주장 자동추출(LLM API 연동) + 웹검색 연동 보조. "자동 판정이 아닌 팩트체커 보조 역할"로 범위를 명시적으로 좁힘. GPT·Claude 등 2개 이상 모델의 토큰비용은 사업자 부담.
- `PER-004`: 주장추출 10초 이내 응답 요구.
- `SER-003`: LLM API 키는 환경변수/비밀관리로 다루고 하드코딩 금지.
- `SIR-003`: 외부 LLM/웹검색 연동 인터페이스 + 오픈 API 설계·문서화 요구.
- 지정 개발 스택: JSP + 전자정부표준프레임워크 + MariaDB + Apache/Tomcat (`ECR-002`).
- 이벤트 페이지, 딥페이크 탐지 등은 2단계 사업으로 명시적으로 미룸 — 1차는 의도적으로 좁게 잡힌 파일럿.

### Marbas 로드맵과의 정합성
- 맞는 부분: `plan.md`의 Phase 1(Teacher/OpenAI adapter), Phase 4(URL 수집), LLM Adapter 인터페이스 설계가 RFP의 SFR-009/SIR-003/SER-003 요구와 거의 그대로 겹침. `docs/ref.md`의 NIA 컨설팅 매핑과도 같은 방향.
- 어긋나는 부분:
  1. 기술스택 불일치 — Marbas는 Node/Express + Vite/React, RFP는 JSP/전자정부표준프레임워크/MariaDB를 명시. Marbas가 플랫폼 전체 기반이 될 수 없고, 신규 JSP 시스템이 호출하는 외부 AI API(파일럿 모듈)로 포지셔닝하는 편이 현실적.
  2. AI 범위의 온도차 — RFP는 "파일럿"으로 명시적으로 좁혔는데 `plan.md`의 Phase 5~12(다층 신뢰계층, 게이트 판정, Student sLLM 자립화)는 훨씬 장기적인 비전. 이번 1차 예산·기간으로는 Phase 5 이상은 무리이며, RFP도 "2·3단계 고도화 연계"라고 명시 — Phase 5~12는 이번 입찰 기술제안서에는 "향후 로드맵"으로만 제시하는 수준이 맞음.

### 다음 판단이 필요한 사항 (미결)
1. 입찰 참여 형태 — 직접 주사업자로 입찰(소기업 자격 + JSP/전자정부표준프레임워크 개발력 필요, 공동수급 불가) vs 주사업자에게 Marbas를 AI 서브모듈로 공급하는 포지션. 사업적 판단이라 보류 중.
2. 참여 시 우선순위 — Phase 1~4를 최우선으로 마감해 데모 가능한 상태 확보(선정이 '26.8이라 일정이 빠듯함).
3. 판정 체계를 현재 `true/false/hold/mixed`에서 RFP가 요구하는 6등급(사실/대체로사실/절반의사실/대체로사실아님/사실아님/판단불가)으로 재매핑.
4. `/api/verify`를 `SIR-003` 요구에 맞춰 정식 외부 연동 스펙(오픈 API 문서화)으로 다듬기.

### 관련 문서
- 원본: `docs/raw/제안요청서_팩트체크 고도화 1차.hwpx`
- 관련: `docs/ref.md` (NIA 컨설팅 수요조사서 검토, 동일 사업 배경)

### 웹검색 실연동 구현 (Tavily)
- JSP/전자정부프레임워크 기반 플랫폼 개발은 별도로 진행되고, Marbas는 그 플랫폼이 호출하는 **AI 파일럿 API**로 포지셔닝하기로 함. 데모 우선순위를 정하기 위해 코드를 직접 확인함.
- 확인 결과 `claimExtractor.js`는 이미 OpenAI 호출까지 붙어 동작 중이었고, 프론트엔드(`VerifyForm`/`ResultPanel`/`ClaimCard`)도 이미 존재함. 실제로 비어있던 곳은 `webSearch.stub.js`(항상 빈 배열 반환)와 `sample_trusted_db.json`(`{"docs": []}`)이었음 — 이 상태로는 근거·출처 URL 없이 LLM 자체 지식만으로 판정이 나가고 있었음.
- RFP의 SFR-010(웹검색 연동 보조)과 SFR-009(출처 URL 통합 표시) 요구에 가장 직접적으로 대응하는 부분이라 웹검색을 최우선으로 실연동함.
- 검색 API는 Tavily로 결정(LLM/RAG 파이프라인에 바로 물리기 좋고 스니펫이 정제되어 있음).
- `src/services/web/tavilySearch.js` 신규 작성 — `searchWeb({query})`가 Tavily `/search`를 호출해 `{title, url, published_at, snippet, score}` 형태로 정규화. `TAVILY_API_KEY` 미설정 시 에러 없이 `[]` 반환 + warning 로그(기존 "claim 단위 hold + warning" 게이트 철학과 동일).
- `webSearch.stub.js` 삭제, `origin.js`/`factcheck.js`가 `searchWeb`을 직접 호출하도록 교체.
- `config.js`에 `web.tavilyApiKey`, `web.maxResults`, `web.timeoutMs` 추가. `.env.example`도 실제 코드가 읽는 OpenAI 변수명으로 정정(기존에 Ollama 시절 변수명이 남아있던 drift 해소).
- 로컬 서버(`node src/server.js`)로 `POST /api/verify` 라이브 스모크 테스트 완료 — 주장 추출·3-agent 파이프라인이 끝까지 정상 동작. 다만 `.env`에 아직 `TAVILY_API_KEY`가 비어있어 웹 근거 없이 `hold`로만 떨어짐 → 키만 넣으면 바로 활성화됨.
- 다음 단계: `TAVILY_API_KEY` 발급 후 `.env`에 입력 → 실근거 기반 판정 데모 확인 → 그 다음 우선순위는 신뢰 DB 시드.

### 모델 업데이트 및 데모 검증 (프론트엔드 + 신뢰 DB)
- `OPENAI_MODEL`을 `gpt-4o-mini`(구세대) → `gpt-5.4-mini`로 교체(`.env`, `.env.example`, `config.js` 기본값 모두 반영), 실제 키로 호출 확인 완료.
- `.env`에 `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL=claude-sonnet-5` 추가함. **다만 코드에는 아직 Anthropic 호출부가 없음** — 현재는 OpenAI 클라이언트만 존재하며, 실제 연동은 다음 작업.
- Tavily API 키가 `.env`에 입력되어 실제 웹검색이 활성화됨. 같은 문장(`세종대왕은 1443년에 훈민정음을 창제했다`)으로 재검증 → 이번엔 실제 출처 URL 3건 + `verdict: supported`(0.98) + 최종 `true`(0.91)로 정상 동작 확인.
- **프론트엔드 라이브 검증**: playwright(headless chromium)로 `frontend/`(Vite, `npm run dev`, `/marbas/` base path)와 백엔드를 동시에 띄우고 실제 브라우저 렌더링을 스크린샷으로 확인함. `VerifyForm` 입력 → `ResultPanel`에 TRUE/confidence/사실근거/출처신뢰/선동위험 바 → 펼치면 판단근거·출처후보·인용 URL까지 정상 표시. 콘솔 에러 없음.
- **신뢰 DB 시드**: `sample_trusted_db.json`이 빈 배열이었던 걸 실제 검증 가능한 T1급 출처(국사편찬위원회 우리역사넷, 국가기록원) 4건으로 채움. 재검증 결과 `agentB.evidence`에 `trusted_db` 소스가 실제로 섞여 나오는 것 확인(웹검색 결과와 함께 사용됨) — RAG 경로가 web search와 별개로 정상 동작함을 확인.
- 다음 단계: Claude(Sonnet 5)를 실제로 어느 agent에 어떻게 연동할지 결정 필요(RFP가 "GPT·Claude 등 2개 이상 모델" 사용을 요구함).

### LLM Adapter 도입 (OpenAI + Anthropic 이중 provider)
- `plan.md` Phase 1이 명시한 LLM Adapter 인터페이스를 실제 구현. RFP의 "GPT·Claude 등 2개 이상 생성형 AI 모델"(SFR-009) 요구에 직접 대응.
- 구조: `src/services/llm/` 아래에 `openaiAdapter.js` + `anthropicAdapter.js` + `index.js`(라우터). 공통 계약 `chatJson({messages, schemaName, temperature?, provider?})` 하나로 통일. `claimExtractor` + 3개 agent + `server.js`(/version)가 모두 라우터만 사용하도록 교체. 기존 오해 소지 있던 `ollamaClient.js`(실제로는 OpenAI 호출)는 삭제하고 `openaiAdapter.js`로 대체.
- provider 선택은 `.env`의 `LLM_PROVIDER`(기본 openai). `chatJson`에 `provider` 인자를 주면 그 호출만 다른 provider로 라우팅 가능(향후 per-agent 라우팅 대비).
- **Anthropic 연동 시 claude-api 스킬로 정확한 API 사실 확인 후 구현** — Sonnet 5의 함정들을 코드에 반영:
  - `temperature`/`top_p`/`top_k` 를 Claude에 보내지 않음(비기본값이면 400). OpenAI 경로는 그대로 temperature 사용.
  - system 역할을 top-level `system`으로 분리(메시지 배열에 두면 안 됨).
  - `response_format`/prefill 미지원 → OpenAI와 동일하게 "JSON only" 프롬프트 지시 + lenient 파싱으로 통일.
  - adaptive thinking 기본 ON → 빠른 JSON 추출(PER-004 10초)을 위해 `thinking:{type:"disabled"}`로 끔.
  - `@anthropic-ai/sdk` 사용(timeout ms 단위), `Anthropic.APIError` 래핑, `stop_reason:"refusal"` 처리, `content[]`에서 text 블록 추출.
- 모델/단가: gpt-5.4-mini($0.75/$4.50 per 1M) ↔ claude-sonnet-5($3/$15 per 1M, 도입가 $2/$10). `cost_per_1k` 메타데이터로 어댑터에 기록(향후 비용 기반 라우팅용).
- config에 `llm.provider` + `anthropic.{apiKey(+CLAUDE_API_KEY alias), model, timeoutMs, maxTokens}` 추가. `@anthropic-ai/sdk` 런타임 의존성 추가.
- **라이브 검증(양쪽 provider 모두)**: 실제 키로 서버를 띄워 `/api/verify` 엔드투엔드 확인.
  - OpenAI: 정부수립 문장 → 정상 JSON, verdict true(0.94).
  - Anthropic(claude-sonnet-5): 훈민정음 문장 → claim 추출 + Agent A/B/C 모두 정상 JSON, verdict true(0.89), 인용 4건. 전체 파이프라인 ~19초(claim 추출 단일 호출은 10초 이내). 서버 로그에 refusal/파싱 경고 없음.
- 코드 리뷰: 어댑터 계층 대상으로 다중 에이전트 적대적 리뷰 워크플로우 실행(3개 차원 × 발견별 독립 검증). 발견 3건 중 2건 확정(둘 다 low severity·엣지케이스지만 실제 결함, 검증자가 Node로 재현):
  1. `typeof x === "object"` 가드가 JSON `null`/배열을 통과시켜 `chatJson`이 조용히 null/배열을 반환할 수 있음 → `isJsonObject()` 헬퍼(`utils/json.js`) 도입해 두 어댑터 모두 수정.
  2. `extractFirstJsonObject`가 문자열 값 안의 중괄호를 depth 계산에 포함시켜, `notes`/`snippet` 등에 `}`가 있으면 유효 JSON도 복구 실패 → 문자열/이스케이프 상태 추적하도록 수정. (Anthropic 경로는 json_object 모드가 없어 이 복구 경로를 더 자주 타므로 영향이 큼.)
  - 수정 후 유닛 테스트(null/배열 거부, 문자열 내 중괄호·이스케이프·코드펜스 복구) 통과 + Anthropic 라이브 파이프라인 재검증 정상(verdict true 0.89, 인용 4건).
- `.env` 기본값은 `LLM_PROVIDER=openai`. Claude 로 돌리려면 `LLM_PROVIDER=anthropic` 로 바꾸면 됨.

### 원격 배포 (21080/marbas) + 헤더 문구
- 원격 서버(bsqai01.iptime.org, 접근 대역 21030–21099)에 배포. nginx가 21080에서 `/home/gbox3d/www`(→`/mnt/data/pds`)를 정적 서빙 중이고, `/mnt/data/pds/marbas`가 이미 `frontend/dist`로 심볼릭 링크되어 있어(3월 설정) 프론트 빌드만 하면 `21080/marbas/`로 서빙됨. nginx 공유 설정은 건드리지 않음.
- 백엔드(21030)는 **PM2 `marbas-api`** 로 등록 + `pm2 save`(세션·재부팅 후에도 유지). 프론트는 브라우저에서 21030으로 직접 API 호출(대역 내 + CORS 열림).
- 헤더 부제 `Issue Verification System` → `Agentic Issue Verification`(에이전트 구조·RFP "다중 에이전트" 정합). `index.html` 탭 타이틀도 동일하게 변경.

### URL 크롤링 구현 (SSRF-safe) + URL-only 입력
- 교수님 지적: URL 크롤링 우선 구현 + **SSRF 방어 누락**(치명적). 서버가 사용자 임의 URL을 대신 fetch 하므로, 방어 없으면 클라우드 메타데이터(169.254.169.254)·내부망·localhost·file:// 등에 접근 가능 → 정부 플랫폼 보안심사(OWASP SER-001, 국정원 평가)에서 즉시 탈락 사유.
- `src/services/web/urlFetch.js` 신규 — SSRF 방어 1급 요건:
  - scheme(http/https만) · port(80/443만) 화이트리스트.
  - hostname 이 사설/예약/루프백/링크로컬 IP로 해석되면 차단. **IPv6는 바이트 단위 검증**으로 IPv4-mapped(`::ffff:7f00:1`)·NAT64(`64:ff9b::`) 우회까지 차단(초기 정규식 버전이 이 우회를 놓쳐서 바이트 파서로 교체).
  - 리다이렉트 수동 처리 + 매 홉 재검증(내부로 리다이렉트하는 공개 URL 차단).
  - 응답 크기/시간 상한, content-type 화이트리스트. 실패는 soft-fail(warning).
  - deterministic 최소 추출(title, article:published_time, 본문 텍스트). 본문 정제 고도화는 향후 AI-assisted로.
- `verify.js` 개편: url 있으면 크롤링 → text 비었으면 크롤링 본문을 검증 입력으로(=**URL-only 입력**), text 있으면 사용자 text 우선 + url은 출처 메타데이터. published_at → collected_at. 응답에 `input_enrichment` + `warnings`. YouTube는 감지해서 자막 미지원 warning(쓰레기 크롤링 방지).
- 프론트 `VerifyForm`: text 필수 → **text 또는 url** 이면 제출 가능하도록 완화(URL만으로 검증). 플레이스홀더 안내 문구 추가. 재빌드·배포 완료.
- **검증**:
  - SSRF: 공격 벡터 11종(메타데이터/루프백/사설/file:/gopher/차단포트/내부호스트명) + IPv6 우회 8종 전부 차단, 공개 URL(example.com)은 정상 통과. HTTP API로도 메타데이터 URL 차단 확인.
  - URL-only 정방향: 위키백과 훈민정음 페이지 URL만 입력 → 크롤링(제목 추출, 본문 20K자) → claim 18건 추출 → 첫 주장 verdict true(0.88, 인용 3건). text 없이 동작 확인.
- 알려진 잔여: DNS rebinding(검증 IP와 fetch 연결 IP 사이 미세 창) — 파일럿 baseline은 정적 벡터 전부 차단, 완전차단은 pinned-IP dispatcher로 후속 하드닝.
- config `crawl.*`(`CRAWL_ENABLED/TIMEOUT_MS/MAX_BYTES/MAX_TEXT_CHARS/MAX_REDIRECTS`) 추가.

### 시간 개념(temporal) 도입 — "진실은 시점에 따라 달라진다"
- 교수님 핵심 지적: 이슈 검증의 본질은 속도(효율)가 아니라 **시점 정확성**. 진실·여론은 시간에 따라 바뀜(예: "홍명보는 자랑스러운 축구감독" — 과거 참, 2026 월드컵 이후 여론 급반전). 성능 최적화(병렬화/중복검색 제거)는 보류(코드는 남아있으나 verify 경로엔 dedup만 반영).
- **진단(라이브)**: 기존 시스템은 시간축에 눈이 먼 상태였음. "홍명보" 질의 시 근거로 **2009년 네이버 블로그**·위키(날짜 None)를 가져와 밋밋한 "보류"만 출력, 오늘 상황 인식 0.
- **구현 3축**:
  1. **as-of 주입**: verify 에서 `asOf = new Date()`(또는 body `as_of`) 계산 → claim추출·A·B·C 프롬프트에 "오늘 날짜 + 사실/여론은 시점 의존, 최신 근거 우선, 변화 시 드러내라" 명시. 응답/리포트에 `as_of` 포함.
  2. **최신성 우선 검색**: claim추출이 `is_time_sensitive` 판정 → 시점 의존 주장은 Tavily `topic:news` + 최근 N일(`WEB_RECENCY_DAYS`, 기본 365)로 검색, 결과를 published date 최신순 정렬. (2009 블로그 → 2026-05 뉴스로 바뀜)
  3. **시간 변화 감지**: Agent B 가 `time_sensitive` / `situation_changed`(실제 변화 정황 있을 때만 true) / `temporal_note`(변화 설명) 반환. aggregator 가 `temporal` 블록 + 경고(변화면 "재평가 필요", 시점의존만이면 "결과 바뀔 수 있음") 생성. 평가/의견어("자랑스러운")는 참/거짓 강제 대신 여론·변화로 서술.
- **프론트**: ClaimCard 에 "⏱ 시점 의존/상황 변화" 배너(as-of 날짜 + note) + 인용에 published date 표시. 재빌드·배포.
- **검증(before/after)**:
  - 홍명보(시점의존 opinion): before=2009블로그·밋밋한 보류 → after=`as_of 2026-07-06`, 근거 2026-05 뉴스, `is_time_sensitive:true`, temporal_note("2026-05 기준 감독 맞음, 자랑스러운은 평가라 판정불가, 최근 여론변화 직접증거 없음"), `situation_changed:false`(정직), 소프트 경고. UI 배너 렌더 확인.
  - 세종대왕 1443(시간불변 fact): `is_time_sensitive:false`, temporal 경고 없음, verdict true(0.92) — 과잉 플래그 없음(regression OK).
- config: `web.recencyDays`(`WEB_RECENCY_DAYS`) 추가. schema 에 `situation_changed`/`temporal_note`/`as_of`/`time_sensitive` 기본값.
- **검색어 개선(주어/대상)**: 교수님 지적 — 주장 문장 전체가 아니라 **주어/대상 엔티티**로 검색해야 함. claim 추출이 `search_query`(주어+대상, 평가어 제외; 예 "홍명보 축구감독")를 생성 → verify 가 그걸로 검색. Tavily `topic:news` 는 영문 편향이라 한국 기사를 못 긁던 문제를 확인, `topic:general` + URL 날짜 추출로 우회.
- **네이버 뉴스 API 연동**: Tavily 한국어 커버리지 한계 → `src/services/web/naverSearch.js`(`searchNaverNews`, `hasNaver`) 추가. 네이버 검색 API 는 한국어 native + 항목마다 `pubDate` + `sort=date`(최신순)라 시점 의존 주장에 최적. verify 가 **시점 의존 주장 → 네이버 뉴스**(없거나 실패면 Tavily general 폴백), 시간불변 → Tavily 로 라우팅. config `naver.{clientId,clientSecret,maxResults}` (`.env` `NAVER_CLIENT_ID/SECRET`).
- **결과**: "홍명보" 재검증 시 오늘(2026-07-07)·어제 한국 기사(비난·논란·불명예 사퇴)를 발행일순으로 물어오고, temporal_note 가 "현재 여론 논란·부정 우세"를 정확히 서술. 세종대왕(시간불변)은 Tavily general 유지 — 과잉 라우팅 없음.
- **③ 시간충돌 안정화 + 여론 시계열 (완료)**:
  - **두 시간창 수집**: 시점 의존 주장은 verify 에서 **최근(네이버 뉴스, 발행일순) + 과거/배경(Tavily general = 위키·나무위키)**을 함께 가져와 `mergeEvidence`(URL dedup)로 병합. 그래야 Agent B 가 "과거 vs 최근"을 대조할 근거가 생김.
  - **Agent B 강화**: `sentiment_timeline`(period·sentiment·basis) 출력 + situation_changed 정의를 "과거/배경 vs 최근 뉴스가 실제로 달라졌을 때"로 명확화. 대조 근거가 주어지니 `situation_changed` 가 **안정적으로 true**(홍명보 3회 연속 true, 이전엔 들쭉날쭉).
  - **역사적 사실 과잉 방지(회귀)**: Agent B 가 세종대왕 같은 시간불변 사실에도 타임라인을 만들던 문제 → aggregator 가 `claim.is_time_sensitive`(추출기 판정)만 게이트로 사용하도록 수정 + 프롬프트에 "is_time_sensitive=false 면 temporal 분석 skip" 규칙 추가. 결과: 세종대왕 = 타임라인 0·temporal 경고 없음, 홍명보 = 타임라인 3.
  - **UI**: ClaimCard temporal 배너에 여론 시계열(색상: 긍정 green / 부정 red / 혼재 yellow) 렌더. 배포 확인 — "과거~2024 기대 → 2026-07 사퇴·비판" 시계열 표시.
  - 남은 후보: sentiment 전용 검색(반응·여론 기사 타깃), Narrative agent 로 확산/서사 압력 분리(plan Phase 7), 과거 뉴스 date-range 검색(현재 과거는 위키 배경에 의존).

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
