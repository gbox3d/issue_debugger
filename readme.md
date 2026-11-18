# Marbas

Marbas는 문장이나 기사 URL에서 주장을 추출하고, 선택한 날짜에 적용되는 원문을 찾아 근거와 보류 사유를 보여주는 팩트체크 보조 시스템입니다.

문서 기준일은 **2026-11-18**입니다. 구현 버전은 **BE 0.8.6 / FE 0.1.5**, 판정 규칙은 `general-news-v3`이며 기본 모델은 Anthropic `claude-opus-5-5`입니다. OpenAI 어댑터도 선택할 수 있습니다. 이 모델명은 저장소 설정값이며 제공사의 최신 모델 목록을 뜻하지 않습니다.

## 목차

- [현재 구현과 한계](#현재-구현과-한계)
- [실행 방법](#실행-방법)
- [API](#api)
- [검색과 시점 판단](#검색과-시점-판단)
- [저장과 자원 사용](#저장과-자원-사용)
- [검증 기록과 문서](#검증-기록과-문서)
- [코드명](#코드명)

## 현재 구현과 한계

- 키워드·문장·기사 URL 입력 → 주장 추출 → 관련 자료 및 정정·반박 검색 → 원문 수집 → 사실 대조 B와 별도 검토 D → 인용·시점 검사 → 보고서 저장 순서입니다.
- B/D는 **같은 설정 모델에 서로의 답을 보여주지 않는 별도 문맥**을 사용합니다. 서로 다른 모델의 검증이나 정확도 보증은 아닙니다. 새 검토가 필요한 적격 주장에 두 호출을 사용하며, 캐시 적중·자료 부족 등에서는 호출하지 않을 수 있습니다.
- 출처 추적 A와 표현 분석 C는 API의 `analysis`로 선택하며 기본값은 둘 다 false입니다. 표현 점수는 사실 판정과 분리합니다.
- 요청당 추출 순서의 **핵심 주장 최대 3개**를 처리합니다(`min(3, CLAIM_MAX)`). 나머지는 미검증으로 표시합니다. 의견·복합 주장도 확정하지 않습니다.
- 판정은 `true | false | hold`입니다. 보도에 의한 지지와 직접 기록을 구분하고, 입력 기사 자체만으로 그 기사 속 주장을 교차 확인하지 않습니다. 인용·시점·명제 보존 실패, 충돌, 필요한 반증 검색 미완료는 보류합니다.
- HTML/XHTML/plain text를 수집합니다. PDF·이미지 OCR·영상/오디오 전사·로그인·스크립트 실행이 필요한 페이지는 지원 범위 밖입니다. 추출 실패나 제목 수준의 본문은 적격 원문으로 보지 않습니다.
- 재임 이력 탭은 기상청의 **종료된 청장 재임기간**을 대조하는 보조 예제입니다. 현직·기간 공백 등은 보류하며 제품 전체나 일반 정확도의 평가 기준이 아닙니다.

인간 골드셋 기반의 전체 정확도 평가, 자동 출처 계보/재인용 독립성 판별, 다중모델 토론, 인간 검수·정정 운영, Student 학습·GPU 인프라는 아직 구현 완료 범위에 포함하지 않습니다. 장기 설계는 [architecture.md](docs/architecture.md)에 별도로 보존합니다.

## 실행 방법

의존성 기준 Node.js 지원 범위는 `^20.19.0 || ^22.13.0 || >=24.0.0`입니다. 11월 15일 실행 기록은 Node 22.21.0이며 11월 18일 재검증 환경은 [검사 기록](docs/validation/20261118/verification.json)에 남깁니다.

```bash
npm ci
# 최초 설정 때만 복사합니다. 기존 .env는 유지합니다.
cp -n .env.example .env
# .env의 API 키와 검색 설정을 편집한 뒤 실행합니다.
npm run dev
```

기본 API 포트는 `8080`이며 `PORT`로 변경합니다. `.env`는 Git에 포함하지 않습니다.

| 설정 | 의미 |
|---|---|
| `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | 기본 Claude 경로. `CLAUDE_API_KEY`도 별칭으로 지원 |
| `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS` | 모델명, thinking과 JSON 출력의 합계 한도 |
| `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL` | 선택 OpenAI 경로 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | Naver 뉴스 검색. Tavily 활성화 여부와 별개 |
| `WEB_SEARCH_ENABLED=true`, `TAVILY_API_KEY` | Tavily 웹 검색 활성화. 예제 파일은 기본 false |
| `GENERAL_DATA_DIR`, `PERSONNEL_DATA_DIR` | 일반 검증·재임 예제의 로컬 저장 경로 |
| `CLAIM_CONCURRENCY`, `CLAIM_MAX` | 동시 주장 수와 요청 상한. 일반 서비스의 주장 수는 설정값이 커도 최대 3개 |
| `CRAWL_*` | 수집 활성화·시간·크기·리다이렉트 제한 |

LLM 키만 넣어서는 자동 검색이 활성화되지 않습니다. 검색 제공자를 하나 이상 설정하세요. 두 제공자 모두 설정되지 않으면 검색 미설정 상태를 기록합니다. 원문 URL 수집은 별도로 가능하지만 외부 근거·반증 탐색이 부족하면 보류될 수 있습니다. RAG 환경 변수는 과거 `factcheck.js` 경로용이며 현재 일반 API는 로컬 seed DB를 조회하지 않습니다.

프론트엔드의 커밋된 `frontend/public/config.json`은 운영 게이트웨이용입니다. **로컬 개발에서만** 다음 값으로 바꾸고 페이지를 새로고침합니다. 원격 개발 환경이면 `apiHost`를 브라우저에서 접근 가능한 API 호스트로 지정합니다.

```json
{ "apiHost": "http://127.0.0.1", "apiPort": 8080 }
```

```bash
cd frontend
npm ci
npm run dev
```

기본 개발 화면은 `http://localhost:5173/marbas/`입니다. Vite의 기존 `/api` 프록시는 운영용 `/marbas` 설정과 `/version`을 모두 대신하지 않으므로 위 API 주소 설정이 필요합니다. 운영 빌드 전에는 `config.json`을 `{ "apiHost": "/marbas", "apiPort": null }`로 되돌립니다.

검사 명령(저장소 루트에서 시작):

```bash
npm test
cd frontend
npm run build -- --outDir /tmp/marbas-check-build
```

이 서버에서는 `frontend/dist`가 운영 서비스에 연결되어 있습니다. 검증 빌드는 별도 경로를 사용합니다. `npm run build`의 기본 출력 `dist/` 갱신과 `pm2 restart marbas-api`는 운영 반영 작업입니다. 2026-11-15 확인한 운영 주소는 [Marbas](http://bsqai01.iptime.org:21080/marbas/)이며, 11월 18일에는 배포·유료 API 재검증을 수행하지 않고 기존 작업을 문서화·커밋합니다.

## API

| 경로 | 동작 |
|---|---|
| `GET /health` | 프로세스 응답 확인. LLM·검색 제공자 연결 성공을 보증하지 않음 |
| `GET /version` | 앱·설정된 LLM 정보. 포함된 참고 단가는 실측 청구 비용이 아님 |
| `POST /api/verify` | 일반 시점 검증과 새 보고서 저장 |
| `GET /api/reports/:id` | 저장 보고서 재생. 새 검색·모델 호출 없음 |
| `POST /api/personnel/verify` | 기상청 종료 재임기간 보조 예제 |
| `GET /api/personnel/reports/:id` | 보조 예제 보고서 재생 |

일반 검증 요청 예시(실행 시 외부 API를 사용할 수 있음):

```bash
curl http://127.0.0.1:8080/api/verify \
  -H 'Content-Type: application/json' \
  -d '{"text":"Python 3.12.0은 2023년 10월 2일에 출시되었다.","subject_date":"2023-10-03"}'
```

| 필드 | 계약 |
|---|---|
| `text`, `url` | 하나 이상 필요. text 최대 20,000자, URL 최대 2,048자. 함께 있으면 text가 검증 대상, URL은 검사 대상 기사로 수집 |
| `source_urls` | 추가 원문 URL 최대 3개. 자동 신뢰나 채택을 뜻하지 않음 |
| `subject_date` | 판단 대상일 `YYYY-MM-DD`. 기본 한국 날짜 오늘, 미래 날짜 불가 |
| `mode` | `retrospective`(기본) 또는 `as_known` |
| `knowledge_cutoff` | `as_known`에서만 필수. 현재 이전의 시간대 포함 ISO 시각 |
| `previous_id` | 같은 정규화 요청의 이전 UUID. 새 UUID로 재검증하며 이전 보고서는 보존 |
| `force_refresh` | 정확히 true이면 현재 입력·근거 키의 검토 캐시를 무효화하고 새 검토. 전체 캐시 삭제는 아님 |
| `analysis` | `{ "origin": false, "framing": false }`. 각 선택값은 boolean이며 B/D를 끄는 옵션은 없음 |

보조 인사 API는 `person`(한글 2~10자) 또는 `text`(최대 500자) 중 하나만 받으며 `subject_date`가 필수입니다. 자연어는 단일 긍정형 기상청 청장 재임 주장에 한정합니다. 위 일반 API의 기본 날짜·입력 한도와 구분합니다.

기존 `as_of`는 `as_known`으로 해석하며 `mode`·`subject_date`·`knowledge_cutoff`와 함께 사용할 수 없습니다. 날짜만 지정하면 한국 시간 00:00 기준입니다. 재검증은 GET 응답의 `request`에 `previous_id`를 추가하여 POST합니다.

응답에는 `id`, `previous_id`, `request`, `time`, `claims`, `results`, `evidence_sources`, `retrieval`, `resource_usage`, `coverage`, `versions`, 상태와 사유가 포함됩니다. `evidence_sources`는 원문 전체 대신 메타데이터를 담고, 결과의 인용에는 원문 구절과 시점 설명을 담습니다.

- `coverage.extracted`: 추출 수, `attempted`: 처리 대상 수, `searched`: 새 검색 질의가 있는 주장 수, `reviewed`: 사실 검토 완료 수, `assessed`/`decided`: 보류가 아닌 수입니다. 과거 자료 모드의 새 검색 수는 0일 수 있습니다.
- 전체 `status=assessed`는 한 주장 이상에 판정을 제시했다는 뜻입니다. 전체 `verification_status=completed | incomplete | not_run`과 주장별 `reviewed | incomplete | not_run`은 실행 상태이며, 모든 추출 주장의 확정을 뜻하지 않습니다.
- `retrieval`은 검색어·제공자 상태·후보별 처리·반증 검색 미완료를 기록합니다. `search_disabled`, `search_failed`, `search_no_results`, `source_fetch_failed`, `source_unusable` 등을 구분합니다.
- 자료 부족은 HTTP 200의 저장된 보류 보고서가 될 수 있습니다. URL-only `as_known`에서 보관 원문이 없으면 `results=[]`, `hold`, `snapshot_unavailable`입니다. 잘못된 요청은 400, 없는 이전 보고서는 404, 주장 추출 실패는 502를 반환합니다.

## 검색과 시점 판단

서버가 `search_news`(Naver), `search_web`(Tavily), `fetch_article`을 실행합니다. 모델은 검색어를 제안하고 서버가 예산·입력을 통제합니다. 이 도구는 애플리케이션 내부 JavaScript 계약이며 별도 MCP 서버나 Claude의 자율 `tool_use` 반복 루프를 구현한 것은 아닙니다.

Naver는 관련도순(`sort=sim`), Tavily는 제공자 관련도 순서를 사용합니다. 주 검색과 정정·반박 검색을 수행하고 예산이 남으면 다른 언어 검색어로 보완합니다. 영상·음성·무관 후보를 제외하고 중복 URL·출처 분산을 고려합니다. 모든 재인용 기사의 계보를 자동 판별하는 기능은 아닙니다.

| 범위 | 한도 |
|---|---|
| 적격 원문 목표 | 6건. 입력 기사·추가 URL도 공유 예산에 포함 |
| 수집 시도 | 최대 18회, 동시 3회 |
| 검색 제공자 호출 | 최대 12회. 선택 분석 A도 이 파이프라인에서 확보한 자료를 전달받음 |
| 수집 단계 시간 | 60초 예산. 진행 중 외부 요청의 완료로 초과 가능하며 전체 검증 SLA가 아님 |
| 모델 전달 원문 | 자료별 최대 12,000자 |

수집된 자료 수는 부분 자료 때문에 6건보다 많을 수 있습니다. 200자 미만, 수집에서 잘림, 모델 전달 한도 초과 자료는 참고 문맥으로 남기고 결정적 확정 인용에서는 제외합니다. Readability/JSDOM으로 본문을 추출하며 스크립트를 실행하지 않습니다. 스냅샷은 추출 본문이지 원래 웹페이지 전체의 보존본이 아닙니다.

| 자료 모드 | 의미 |
|---|---|
| `retrospective` | 지금 수집한 자료로 대상일을 검토. 이후 정정·회고도 활용 가능하나 당시 알려진 정보의 재현은 아님 |
| `as_known` | 서버가 cutoff 이전에 실제 저장한 URL별 최신 스냅샷 중 관련 자료를 선택. 새 검색·수집 없이 검토하며 과거 웹 전체를 복원하지 않음 |

`dated_record`는 원문 속 명시적 연도·기간과 적용 이유를 요구합니다. `dated_report`는 원문 페이지 발행 메타데이터 또는 기사 시간 요소와 사건 구절로 **완료 사건의 보도**를 연결하는 제한적 방식입니다. 사건·발행일은 대상일 이하여야 하며 진행 중 상태·예정·현재 역할의 지속 증명에 쓰지 않습니다. 검색 인덱스·URL 추정 날짜는 원문 발행일을 대신하지 않습니다. 시간 비의존 주장에만 `timeless`를 허용합니다. 의미·권위·상대 날짜 해석은 모델 판단이므로 오류 가능성이 남습니다.

## 저장과 자원 사용

`GENERAL_DATA_DIR`(기본 `data/verification`) 아래에 `snapshots/`(본문·해시·수집 시각), `reports/`(입력·판정·근거·버전), `reviewed-results/`(재사용용 주장·원문·두 검토 결과)를 저장합니다. 보조 예제는 `PERSONNEL_DATA_DIR`(기본 `data/personnel`)에 따로 저장합니다. 생성 디렉터리는 0700, 파일은 0600이며 Git에서는 제외합니다.

검토 캐시는 `retrospective`에서 원문을 새로 수집한 **뒤** 조회합니다. `as_known`에서는 같은 cutoff의 적격 저장본을 대조합니다. 주장·대상일·자료 모드·근거 내용과 역할·모델·규칙 등이 같고, 인용·시점·두 검토가 통과한 supported/refuted 결과만 재사용합니다. unknown·미완료·충돌은 저장하지 않습니다. 기본 TTL 24시간은 재사용 만료이며 **자동 파일 삭제 정책이 아닙니다**. 새 수집 시각·식별자는 재매핑하고, retrospective의 요청 실행 시각은 재사용 키에서 제외합니다. `previous_id` 또는 `force_refresh=true`는 일치하는 키를 무효화한 후 재검토합니다.

`resource_usage`는 요청별 **어댑터 호출 수**, 제공사가 반환한 토큰, 관측 소요시간, 생략·캐시 적중을 기록합니다. SDK 내부 HTTP 재시도는 별도 집계하지 않습니다. 제공자마다 입력 토큰의 캐시 포함 방식이 다르며 알 수 없는 토큰은 null입니다. 전체 duration은 요청 계측 시작부터 보고서 저장 직전까지, 개별 duration은 어댑터 호출 시간입니다. 검색 비용·달러 청구액·정확한 절감률은 계산하지 않습니다.

입력과 수집 원문은 선택한 외부 LLM에, 검색어는 검색 제공자에 전송됩니다. 브라우저는 최근 보고서 UUID 10개만 보관하지만 서버는 입력·원문·보고서를 보관합니다. **보고서 ID만 알면 GET으로 내용을 조회할 수 있으며 사용자별 인증·접근 제어와 자동 보존기한/삭제 기능은 없습니다.** 감사 기록의 UUID도 원문 조회에 연결될 수 있으므로 내용을 줄인 기록이지 익명 자료는 아닙니다. 별도 백업·접근·보존 정책이 필요하며, 남은 DNS 재바인딩 등 작업은 [보안 백로그](./_forAI/memo.md#보안-백로그)에 기록합니다.

## 검증 기록과 문서

2026-11-15의 개발 목표 심사는 1차 6.8 미통과 후 같은 2차에서 후보 8.3 → 운영 검증 후 **최종 8.4/10 통과**했습니다(2/3 사용). 이전 단계의 중단 2회는 별도 이력입니다. 운영 키워드·기사 URL 단독·저장 보고서 재생·화면을 확인했으며 기사 8개 주장 중 3개만 검토했습니다. 당시 두 요청은 약 58~67초였고, 키워드의 반증 원문 미확보는 보류로 유지했습니다.

동일 공식 원문을 다시 수집한 캐시 **모듈** 실험은 모델 호출 2→0회, 입력/출력 토큰 8,508/2,481→0/0, 시간 14.139→0.426초였습니다. 전체 API의 일반 절감률·적중률이나 전체 정확도를 뜻하지 않습니다. 11월 18일 커밋 준비에서는 자동 테스트 **128/128**, 임시 경로 빌드를 재확인했습니다. 기능 버전은 기존 작업에서 올린 0.8.6/0.1.5를 유지합니다.

- [문서 안내와 기준](docs/README.md): 현재 계약·역사·기획 자료의 구분
- [개발 목표·심사 기록](docs/article_search_goal_20261115.md), [11월 15일 기술 감사](docs/validation/20261115/operational-audit.json)
- [이전 단계 구현·중단 기록](docs/implementation_review_20261115.md)
- [이번 문서 독립 심사](docs/documentation_review_20261118.md): 이번 3인 문서 표결은 이전 개발 심사와 별개
- [_forAI](./_forAI/README.md): 코드 위치·다음 작업·변경 이력

## 코드명

Marbas는 Ars Goetia의 숨은 사실·기계기술 이미지를 차용한 코드명입니다. 원래 명명 참고 자료는 [정리 CSV](docs/ars_goetia_72_demons_detailed.csv)에 보존합니다.
