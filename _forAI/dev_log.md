# Dev Log

## 목차

- [2026-11-18](#2026-11-18)
- [2026-11-15](#2026-11-15)
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

## 2026-11-18

- 사용자의 문서 정리·기존 작업 커밋 요청으로 현재 구현, 운영 관측, 실패/중단 이력, 장기 계획을 구분했다. 현재 계약은 [README](../readme.md), 문서별 역할과 시간순 요약은 [문서 안내](../docs/README.md)에 정리했다.
- Node 24.22.3 / npm 11.19.1에서 자동 테스트 128/128 통과, 프론트 빌드 성공을 재확인했다. 빌드는 `/tmp/marbas-commit-build-20261118`에 생성했으며 운영 `dist`·PM2·실제 LLM 호출에는 손대지 않았다. [재검증 기록](../docs/validation/20261118/verification.json).
- 독립 3명은 코드 계약, 과거 기록, 재현·배포 문서를 따로 평가한다. 다수결(2/3 이상)과 후보 해시를 [문서 심사 기록](../docs/documentation_review_20261118.md)에 보존한다. 미수신 투표는 통과로 취급하지 않는다.
- BE 0.8.6 / FE 0.1.5로 이미 올라간 미커밋 기능 작업과 문서를 함께 커밋 대상으로 삼는다. 비밀값·런타임 원문·빌드 산출물·개인 IDE 설정·기존 특허 백업 삭제는 대상에서 제외한다.

## 2026-11-15

> 아래 절은 당시 단계별 기록이다. “검토 중/미배포/아직/현재”는 해당 단계의 시점에 한정한다. 진행 순서는 제한 파일럿 → 범위 오류로 중단 1회 → 일반 시점 검증 재개 → 자동 검색 실패로 중단 2회 → 새 목표 착수 → 정식 1차 6.8 미통과 → 같은 2차 후보 8.3·운영 확인 후 최종 8.4 통과다. 종료 상태는 [새 목표 최종 기록](../docs/article_search_goal_20261115.md)이며, 이후 날짜의 문서 작업과 구분한다.


### 최신 사용자 지시에 따른 자동 기사 검색 새 목표 착수

- root가 `create_goal`로 활성 목표를 등록하고 개발을 진행한다. 이전 적합성 중단 2회는 이력으로 보존하며 이번 목표의 개선·심사 횟수를 별도 관리한다.
- 일반 작업물 root >8/10·개선별 최대 5회, 독립 목표 심사 >7/10·최대 3회. 효율 3개 작업은 각각 >7/10·최대 5회 개선 후 정체 시 중단하고 사용자와 상의한다. 최신 지시가 이전 중단·재개 절차를 대체한다.
- 담당은 root(총괄), article_retrieval(뉴스 검색), personnel_ui(UI), quality_gate(목표 독립 심사), 별도 효율 3개 에이전트와 기록관이다. [새 목표 계획·반복 대장](../docs/article_search_goal_20261115.md)을 작성했으며 개선은 각 0회, 목표 심사는 0/3이다. 이는 착수 시점의 0회 기록이며 이후 점수·개선은 아래 진행 기록과 반복 대장에 갱신한다.

### 새 목표 모듈 검토·1차 개선과 실사용 검증 대기

- root 모듈 평가: executionPolicy 8.2(정책 10개·핵심 30개 검사), usageMetrics 8.5(집중 16개 검사), verifiedCache 초기 8.0 → dated_report 호환 개선 1회 → 8.3(캐시/검증기 27개 검사). 실제 제공사 토큰·요청 격리·unknown null을 사용하며, 새 근거 확인 후 캐시 재사용·B/D 필수·A/C 선택을 적용했다.
- UI 첫 제출은 구체 답변이 가려져 7.8 미통과, 개선 1회 후 코드 검토 8.4이며 실제 브라우저 대기다. 뉴스 수집 코드 검토는 8.4(26개 및 후속 집중 13개 검사)이고 키워드만/기사 URL 단독의 실제 수용 결과는 대기한다.
- 통합 첫 실행 110/111: undefined 시간 필드가 JSON 저장에서 빠진 1개 실패를 null로 수정했다. 통합 개선 1회로 집계하고 재실행 결과를 기다린다. 실제 입력 검증 경로는 `/tmp/marbas-news-live-20261115`다.
- delivery_review 독립 사전검토 진행, 정식 목표 심사 0/3. 목표 전체 통과나 새 운영 배포는 아직 없다. 이전 중단 2회는 과거 이력이며 현 작업의 최대 5회 개선·목표 최대 3회 규칙을 유지한다.

### 새 목표 정식 1차 6.8 미통과와 수정·2차 준비

- delivery_review 정식 1차는 6.8/10으로 미통과했다. 보류인데 temporal_note가 전면 사실 요약으로 나오는 우회를 root가 서버 note/summary 제거·UI 고정 보류 문구·과거 보고서 및 상세 서술 방어로 수정했다. 정식 심사 1/3이며 2차 결과와 운영 배포는 아직 없다.
- root 최신 작업물 점수 뉴스 8.6·UI 8.5·통합 8.5, 개선 횟수 3/5·2/5·3/5. 캐시는 dated_report 호환·강제 무효화의 2/5 개선으로 최종 8.4, 실행 정책 8.2·사용량 8.5는 모듈 통과다. 캐시 강제 갱신은 이전 통과 결과의 부활을 막고 날짜·본문 해시·규칙 변경은 miss 처리한다.
- 자동 128/128 통과(`/tmp/marbas-news-tests-gate2-20261115.log`). 실제 키워드 보고서 `1c2663bd-9255-4ed5-81ad-2cc81ead3932`는 명시 URL 없이 원문 6개·AI 3호출·유효 인용을 확보했으나 반증 검색 미완료로 hold다. 기사 단독 `c310d395-cac2-4c20-9549-7c098eaf045b`는 8개 중 핵심 3개 검토(보도 범위 true 2/hold 1), AI 7호출이며 나머지 미검증을 표시한다. 개인명·주장 세부는 기록하지 않는다.
- 실제 브라우저 1365px·390px 가로 넘침/JS 오류 없음. 후보 BE 0.8.6 / FE 0.1.5, general-news-v3는 아직 미배포다. 산출물은 `/tmp/marbas-news-final-20261115/`다.
- 고정 원문 캐시 모듈 실측: 같은 공식 출시 페이지를 새로 가져와 동일 해시를 확인했다. cold 2 Opus 호출·입력 8,508/출력 2,481토큰·14.139초, warm hit 0호출/0토큰·0.426초. 키워드 자동 검색 전체 경로 성능이나 가격 측정이 아니며 GET 재생의 무AI 동작과도 구분한다.

### 정식 2차 후보 8.3 통과·배포 후 운영 확인 중

- delivery_review의 2차 배포 전 후보 심사는 8.3/10 통과다. 1차 6.8 실패와 우회 수정 이력은 보존하며 정식 심사 사용량은 2/3이다. 전체 목표 최종 판단은 운영 확인 뒤 수신한다.
- BE 0.8.6 / FE 0.1.5, general-news-v3를 공개 `/marbas/`에 반영하고 PM2 marbas-api online을 확인했다. 검토한 `/tmp` 빌드를 디렉터리 교체로 반영했으며 이전 프론트는 `/tmp/marbas-frontend-before-0.8.6-20261115`에 보존했다. `/tmp/marbas-news-production-20261115`의 실제 운영 키워드·기사 URL 단독·재생 검증은 진행 중이다.
- readme에는 원문 목표 6개/수집 18회/제공사 12호출/동시 3개, 200자 미만 부분 본문, 핵심 3개 범위, 내부 도구 계약, 선택 A/C, 캐시 무효화/24시간 TTL, 실제 사용량, 완료 사건 보도의 dated_report 제한을 반영했다. 특허 목표 도식은 구현 완료 도식으로 바꾸지 않았다.

### 같은 정식 2차 최종 8.4 통과·목표 달성과 운영 검증 완료

- delivery_review가 운영 증빙을 확인한 뒤 같은 2차 최종 점수 8.4/10으로 목표 달성·차단 사항 없음을 확정했다. 1차 6.8 실패와 수정, 2차 후보 8.3은 이력으로 남기며 심사 2/3·3차 미사용이다.
- 운영 키워드 `7e4054f8-eab7-4d85-b31e-ee218625a2cf`: 원문 6개·3호출, 반증 검색 미완료로 hold 유지. 기사 단독 `732b4388-c814-425a-b11c-42674ec1bd31`: 원문 6개·8개 중 3개 검토·보도 범위 true 3·반증 완료·7호출. 모두 HTTP 200·공개 GET 정확 재생이다. 개인명·주장 세부는 남기지 않는다.
- 운영 브라우저 설정 가로채기 없이 1365px/390px 넘침·JS 오류 0, 근거 카드 4+9·역할 표시 확인. 독립 검토에서 인용 13/13·보도 내용 인용 19/19·해시·원래 입력 보존을 확인했다. 128개 테스트와 고정 원문 캐시 2→0호출도 검토했다. 관측 약 58~67초 및 핵심 3개 제한을 전체 정확도/캐시 적중률로 일반화하지 않는다.
- 보고서 ID·수치·사용량·심사 이력만 담은 `docs/validation/20261115/operational-audit.json`, 공개 Python 원문 캐시 모듈 측정, 내용을 제거한 UI 보류 회귀 기록을 보존했다. 전체 실사용 보고서는 문서로 복사하지 않았다. 임시 API 31319/Vite 5179를 종료하고 운영 marbas-api는 유지했다.

### 자동 기사 검색 실사용 실패 — 개발 중단 2회

- 보고서 `1c48a416-de43-4a77-b416-98dd0a2e8b50`에서 키워드 검색 후 원문 0개가 반환된 실패를 재검토했다. 관련 개인명·주장 세부는 기록하지 않는다.
- 주 에이전트 조사: Tavily 6개 뒤 Naver 6개를 합쳐 앞 6개만 수집하면서 Naver 후보가 제외됐고, YouTube 1개·원문 수집 실패 5개 이후 후보로 진행하지 않았다. 긴 한영 혼합 검색어 하나와 검색 오류/0건/수집 실패의 진단 구분 부족도 확인했다.
- 기록관이 이전 6건 API·운영 브라우저 산출물을 확인한 결과 모두 명시적 `source_urls` 1개가 제공됐다. 당시 성공을 키워드만 입력하거나 기사 URL만 입력한 실사용의 성공으로 확대할 수 없다. 이전 구현·테스트·배포 성과는 아래 이력으로 보존한다.
- `quality_gate` 공식 적합성 **5.5/10**, 중단 누적 **2회**. 코드 수정 없이 읽기 전용 교정 설계 중이다. 재심사 7/10 이상 후 재개하며 누적 3회 중지 규칙을 유지한다.

### 교정안 재개 적합성 8.0 — 일반 시점 검증 구현 재개

- `quality_gate`의 교정안 재개 적합성 **8.0/10**을 수신하여 구현을 재개했다. 중단 누적은 **1회**다. 아래 기능 검증과 최종 품질 8.0/10·적합성 8.2/10을 통과했으며 운영 화면의 실제 제출·저장·GET 재생도 확인하여 일반 시점 검증 MVP의 첫 개발 범위를 완료했다.
- 범위: 명시적 시점·원문 근거를 사용하는 일반 판정 MVP. 일반 원문 수집·스냅샷·시점 분리·보고서 저장과 일반 입력 중심 UI·근거·이력을 구현하며 기상청은 보조 예제로 둔다. 모든 기관·주장 정확성을 보증하지 않는다.
- 담당: `general_backend`는 수집·저장·시점 계약, `personnel_ui`는 일반 기본 화면·근거·이력, 주 에이전트는 B와 독립 D·원문 및 시간 인용 게이트·통합, `quality_gate`는 최종 심사, 기록관은 문서와 상태 기록. 확정된 API 계약과 `GENERAL_DATA_DIR` 저장 동작을 실제 코드로 확인하여 `readme.md`와 현재 문서에 반영했다.

- 교정 구현은 BE 0.8.5 / FE 0.1.4. 중간 적합성 **7.5/10**, 중단 누적 **1회**를 유지했다. 중복 인용의 시간 검사 누락과 모듈 단위 미래 스냅샷 문맥 허용 문제를 수정하고 회귀 검사 3개를 추가했다.
- 실제 검증 경과는 첫 판정 모듈 1/6 → 첫 전체 API 3/6 → 수정 후 전체 API 6/6 예상 판정 일치다. confidence의 0~100 출력·메뉴의 본문 한도 소모를 확인해 임계값 완화 없이 0~1 스키마 명시·Readability 기사 본문 추출로 수정했다. 일반 수집에 적용하고 스크립트 실행 없이 `extraction_scope`를 기록한다. Python 3.12 출시·Voyager 1 발사·핀란드 NATO 가입의 날짜 전후 6건이며 전체 정확도 평가가 아니다.
- 추가 지적에 따라 입력 원문 `original_quote` 포함 검사와 B/D `claim_preserved`를 요구했다. 부분 본문은 `context_only_sources`로 정정·반증 검토에 유지하되 확정 인용에는 사용하지 않고, 미해결 반증은 보류하도록 보완했다. 이 마지막 변경 이후 같은 6건을 재실행해 6/6 통과했다. 최종 품질 8.0/10·적합성 8.2/10 통과 후 운영 화면 검증도 통과했다.
- 브라우저 일반 입력 true·재검증 새 UUID/true·이전 GET 결과 일치를 확인했다. 모바일 버전 배지 겹침 수정 후 390px 가로 넘침 없음·JavaScript 오류 0건을 확인했다.
- 백엔드 담당의 신규 일반 서비스 테스트 10개 통과 보고를 받았다. 합성 자료·모의 모델 기반으로 날짜 경계, 저장/재생, 과거 자료·변조·재검증 조건을 검사한 결과다.
- 마지막 수정 후 주 에이전트 `npm test` 67/67·diff 검사 통과. 실제 API 6/6, 1977년 정보 기준 보관본 없음의 HTTP 200 hold/근거 0/`snapshot_unavailable`, 브라우저 재검증·이전 GET JSON 일치·390px 넘침 없음·JS 오류 0·배지 겹침 없음 확인. 소수 사례와 27~41초 관측 시간을 전체 정확도·성능 지표로 일반화하지 않는다.

- 최종 품질은 8.0/10, 적합성은 8.2/10이며 중단 누적 1회를 유지한다. 8점은 정확도 80%가 아니다. PM2 BE 0.8.5 재시작·FE 0.1.4 프로덕션 빌드 성공 후 실제 운영 Chrome 검증도 통과했다.
- 운영 메모: 기존 프론트 빌드가 운영 `dist`를 공유함을 확인하여 이후 미리보기 빌드는 `/tmp`의 별도 `outDir`로 분리했다.
- 운영 Chrome은 설정 가로채기 없이 공개 `/marbas/`에 접속해 일반 탭·BE 0.8.5 / FE 0.1.4를 확인했다. 실제 폼의 Voyager 1 / 1977-09-06 검증 HTTP 200 true와 공개 GET 보고서 JSON 완전 일치·JS 오류 0을 확인했다. 검증용 API 31318/Vite 5179 관련 4개 프로세스는 종료하고 운영 PM2를 유지했다. Node 지원 범위와 검증 환경 22.21.0도 readme에 반영했다. 최종 기록 단계에서 소스 변경이나 커밋은 하지 않았다.

### 범위 적합성 재평가 — 개발 중단 1회

- 당시 작업 상태 질문에 미완료·개발 중단 상태를 설명하고 읽기 전용 교정안 설계 검토를 시작했다. 범용 시점 검증의 첫 범위와 향후 확장을 구분한 미확정 초안을 남겼으며 이 단계 자체를 개발 재개나 완료로 취급하지 않았다.
- 사용자가 기상청 전용 범위를 지적했다. 원래 목표는 시간에 따라 변하는 일반 사실을 검증하는 AI 에이전트이며, 기상청 전용 제품 전환은 요청되지 않았다. 주 에이전트가 제한 실험을 원래 목표의 완료로 취급한 범위 판단 오류를 정정했다.
- `quality_gate` 공식 재평가: 적합성 **4.5/10**. 개발을 중단하고 범위를 재검토하며 중단 누적은 **1회**다. 교정 구현 범위는 아직 확정되지 않았으며 적합성 재심사 전이다. 적합성 재심사 7/10 이상 후 재개, 누적 3회면 작업 중지 규칙을 유지한다.
- 사용자 정확성 질문에 대한 구분: 기상청 공식 이력은 해당 재임 사례의 정답 대조 근거이며 전체 시스템 정확도·coverage의 근거는 아니다. 이전 **8.4/10은 제한 실험 내부 품질 점수이고 정확도 84%가 아니다**.
- 원래 목표는 미완료다. 이 중단 이후 코드 수정·추가 배포 없이 구현 기록과 `_forAI` 현재 상태만 정정했다. 아래 구현·검증·배포 내역은 중단 전 이력으로 보존한다.

### 중단 전 제한 파일럿 구현 이력

- 사용자 요청으로 A(시간), B(근거·평가), C(제품·운영)가 독립 검토 후 표결했다. 8개 개선안은 3/3 채택, 3분류→6등급 단순 치환은 0/3 부결했다.
- 당시 개발 범위를 기상청 역대 청장의 종료된 재임기간과 공식 원문 근거를 사용하는 시점 검증 파일럿으로 좁혔다. 제한 설계 적합성 8.0/10 승인 후 구현했으며, 중간 적합성 8.3/10과 내부 품질 8.4/10·적합성 8.3/10을 통과했다. 그 시점의 중단은 0회였으며, 해당 범위 재평가 직후 중단 누적은 1회였고, 이후 자동 검색 재평가에서 2회가 됐다.
- 기록관을 추가하고 문서 정리·기록을 명시적으로 요청받았다. 특허 선행연구 비교, 시간 캐시, 6등급, GPU 전제, 인간 검수만으로 약관 적격성을 보장한다는 단정을 보완했다.
- 통과 규칙: 최종 품질 ≥7/10. 적합성 ≤6/10이면 즉시 중단, 재검토 ≥7/10 후 재개, 중단 3회 누적 시 작업 중지.
- 상세 범위·평가자·점수·검증 결과는 [구현 검토 기록](../docs/implementation_review_20261115.md)에서 관리한다. 소스 코드·비밀 설정은 기록관 수정 범위에서 제외한다.
- 구현: BE 0.8.4 / FE 0.1.3. 신규 personnel 서비스·라우트·화면, 공식 원문 스냅샷/근거/UUID 보고서, 두 시간 모드 및 재검증을 추가했다. 일반 판정의 근거 ID·인용 검사와 무근거·의견·상충·시간 의존 보류를 적용하고 confidence에서 표현 점수를 분리했다.
- 중간 지적 반영: 같은 근거 ID가 지지와 반박으로 함께 제출되면 충돌로 처리하고, 프롬프트의 사실 변화·대중 여론 혼합을 수정했다.
- 검증: 주 에이전트 `npm test` 35개·diff 검사·프론트 빌드 통과. 독립 검토자 9개 프로브 통과. 실제 공식 자료 true/false/과거 스냅샷 부재 hold, 실제 Opus 자연어 HTTP 200, Chrome 결과·조회·재검증·390px 화면·ID만 브라우저 저장 점검 완료.
- 운영 반영: 프론트 빌드 후 PM2 `marbas-api` 재시작, 로컬 신규 API의 저장·GET 재생 일치, 기존 `/marbas/`·`/marbas/version` HTTP 200을 확인했다. 실제 Chrome이 [운영 URL](http://bsqai01.iptime.org:21080/marbas/)에서 설정 가로채기 없이 재임 여부 `true` 및 BE 0.8.4 / FE 0.1.3 표시를 확인했다. 임시 미리보기 서버 2개는 종료했다.
- 인간 골드셋, 전체 한국어 정확도, 전체 특허 토론·검수 운영, 범용 기관 인사·현직 확정은 미완료다. 커밋은 생성하지 않았다.

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
