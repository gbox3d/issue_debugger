# Inventory

## 목차

- [기준과 진입점](#기준과-진입점)
- [일반 검증 경로](#일반-검증-경로)
- [화면과 보조 예제](#화면과-보조-예제)
- [검사와 미구현 범위](#검사와-미구현-범위)

## 기준과 진입점

2026-11-18 기준 코드 지도입니다. BE 0.8.6 / FE 0.1.5, `general-news-v3`입니다. 현재 계약은 [readme.md](../readme.md), 역사와 문서 역할은 [문서 안내](../docs/README.md)를 기준으로 읽습니다.

| 경로 | 역할 |
|---|---|
| `src/server.js` | Express, `/health`, `/version`, 일반·재임 라우터 |
| `src/routes/verify.js` | 일반 POST 검증, UUID GET 재생, no-store 응답 |
| `src/services/verification/time.js` | 입력·URL·KST 날짜·모드·cutoff 정규화 |
| `src/config.js` | `.env`와 환경 변수, 앱 버전·제공자·수집 설정 |
| `.env.example` | 키가 비어 있는 설정 예제. 검색은 별도 설정 필요 |
| `docs/validation/` | 본문을 제외한 개발 감사와 로컬 검사 기록. UUID는 익명이 아님 |

## 일반 검증 경로

1. `verification/service.js`가 입력을 정규화하고 URL-only이면 본문을 확보합니다. `claimExtractor.js`가 원문 구절을 보존한 주장을 추출하며 최대 3개를 처리합니다.
2. `web/newsTools.js`는 `search_news`, `search_web`, `fetch_article` 내부 계약입니다. 서버가 실행하며 모델 자율 도구 루프·MCP 서버는 없습니다.
3. `verification/retrieval.js`는 주 검색·반증·언어 보완, 관련성·중복·출처 분산, 수집 성공/실패를 관리합니다. 적격 6건 목표·수집 18회·동시 3회·검색 제공자 12회·수집 시간 60초 예산이며 부분 원문은 별도로 남습니다.
4. `web/naverSearch.js`는 `sort=sim`, `web/tavilySearch.js`는 제공자 관련도 순서를 유지합니다. 상세 어댑터는 disabled/error/no_results/ok를 구분하며 기존 배열 반환 wrapper도 남아 있습니다.
5. `web/urlFetch.js`는 HTTP(S)·기본 포트·공개 주소·리다이렉트를 검사하고 크기·시간을 제한합니다. 일반 HTML은 Readability/JSDOM을 사용하며 원문 발행 메타데이터와 추출 범위를 기록합니다. 스크립트 실행과 영상/오디오 전사는 하지 않습니다. DNS 재바인딩 잔여 위험은 [백로그](memo.md#보안-백로그)입니다.
6. `modules/agents/generalFactcheck.js`가 B/D를 별도 문맥에서 실행하고 입력 보존·원문 인용·시점을 검사합니다. 짧거나 잘린 본문은 반증 확인용 문맥이며 확정 인용은 금지합니다. `dated_report`는 완료 사건의 보도만 허용합니다. 모델용 짧은 ID는 서버의 원문 ID로 정확히 복원합니다.
7. `modules/aggregator.js`는 적격성과 동의·점수 조건에 따라 true/false/hold를 정합니다. 문맥 설명용 인용은 확정 근거와 분리합니다. 무결성 실패 시 서술형 요약·시점 설명을 숨깁니다.
8. `verification/store.js`는 원문·해시·시각·보고서를 원자 저장합니다. `as_known`은 URL별 cutoff 이전 최신 저장본에서 관련 자료를 선택하며 새 웹 요청을 하지 않습니다.
9. `verification/verifiedCache.js`는 같은 의미 입력·자료·버전의 통과 검토만 재사용합니다. 현재 수집 뒤 조회하며 `as_known`은 적격 저장본을 사용합니다. TTL 24시간은 재사용 만료이고 삭제 기능은 아닙니다. 강제 재검토는 일치하는 키를 먼저 무효화합니다.
10. `verification/executionPolicy.js`는 A/C 선택과 요청 내부 동일 입력 공유를 관리합니다. B/D 역할은 합치지 않습니다. `llm/usageMetrics.js`는 요청별 어댑터 호출·제공사 토큰·관측 시간·생략/캐시를 기록하며 SDK HTTP 재시도·청구액은 측정하지 않습니다.

`llm/index.js`는 공통 `chatJson()` 제공자 라우터이고 `anthropicAdapter.js`/`openaiAdapter.js`는 기존 JSON 결과 계약을 유지합니다. 기본은 Anthropic Opus이며 검토 B/D의 기반 모델은 같습니다. `agents/origin.js`(A), `agents/intent.js`(C)는 선택 기능입니다. 과거 `agents/factcheck.js`와 `rag/trustedDb.js`는 legacy 경로이며 일반 `/api/verify`에서 사용하지 않습니다. gitignored 로컬 seed는 새 복제본의 일반 검증 필수 파일이 아닙니다.

## 화면과 보조 예제

- `frontend/src/App.jsx`: 일반 검증 기본 화면, 보고서 재생·재검증, 최근 UUID 10개.
- `VerifyForm.jsx`: 문장·기사 URL·보조 원문·대상일·자료 모드. 기사 최대 3개 주장 범위 표시.
- `ResultPanel.jsx`, `ClaimCard.jsx`, `verificationDisplay.js`: 보도/직접 기록·출처 역할·미검증 범위·실패·자원 사용량, 구형 보고서 안전 표시.
- `frontend/src/api.js`: `public/config.json`으로 API 주소 결정. 커밋 값 `/marbas`는 운영용이고 로컬 개발은 README의 별도 API 주소 설정 필요.
- `src/routes/personnel.js`, `services/personnel/`, `PersonnelPanel.jsx`: 기상청 공식 종료 재임기간 예제, 자체 저장·시점 검사·UUID 보고서. 일반 목표의 정확도 근거가 아닙니다.

## 검사와 미구현 범위

`npm test`는 로컬 모의 자료·모의 모델을 포함한 회귀 검사입니다. 2026-11-18 **128/128 통과**, `npm run build -- --outDir /tmp/marbas-commit-build-20261118`도 통과했습니다. [이번 검사 증거](../docs/validation/20261118/verification.json)를 봅니다. 테스트는 실제 인터넷·모델 정확도 평가가 아닙니다.

2026-11-15 실제 키워드·URL-only·재생·모바일 검증과 고정 원문 캐시 모듈 측정은 [당시 감사](../docs/validation/20261115/operational-audit.json), [캐시 측정](../docs/validation/20261115/cache-benchmark.json)에 있습니다. 이전 35개·67개 검사와 6건 수동 근거 URL 시험은 [과거 구현 기록](../docs/implementation_review_20261115.md)에서 분리합니다.

운영 호출의 사용량은 어댑터 호출 기준이며 캐시 모듈 2→0회 결과를 일반 적중률이나 전체 API 절감률로 확대하지 않습니다. 전체 정확도 골드셋, 다중모델 토론, 인간 검수·정정 전파, Student·벡터 DB, 사용자별 인증·자동 삭제 정책은 미구현입니다.
