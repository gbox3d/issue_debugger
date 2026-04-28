# Marbas 현재 상태 정리 및 다음 구현 계획

> 최종 갱신: 2026-04-28
> 연결 문서: [../docs/architecture.md](../docs/architecture.md), [../docs/ref.md](../docs/ref.md), [./dev_log.md](./dev_log.md)

## Summary
- 현재 구현된 범위는 `Express 서버`, `/health`, `/version`, `POST /api/verify`, LLM 기반 `claim extraction`, claim별 `출처 추적(A) / 팩트체크(B) / 의도·편향(C)` 병렬 분석, 최종 `aggregate/report` 생성까지다.
- 입력 형태는 `{ text, url?, collected_at? }`이고, 현재는 `text`가 필수이며 `url`은 전달만 되고 실제 본문 수집에는 쓰이지 않는다.
- 현재 저장소의 프로토타입은 로컬 Ollama 호출 코드가 남아 있으나, `config.js`는 이미 `openai` 설정으로 전환되어 있어 Phase 1의 OpenAI Adapter 정착 작업이 진행 중인 상태다.
- 현재 가장 큰 공백은 `신뢰 DB seed 파일 부재(17 bytes)`, `웹 검색 stub 상태`, `URL 수집 미구현`, `의견 claim 미필터링`, `공신력/독립성/이해관계/집단 확산 리스크 모델 부재`다.
- 초기 제품화 기준 LLM 백엔드는 `ChatGPT API(OpenAI API)`를 우선 사용하고, 로컬 Ollama는 초기 범위에서 제외한 뒤 나중에 대체 가능 provider로 검토한다.
- 이 프로젝트는 단순 API 래퍼보다 `agent-first` 성격이 강하므로, claim 추출, 출처 추적, 크롤링, 사실 대조, 서사 분석, 리포트 생성을 agent 역할로 분리하는 방향으로 잡는다.
- 수집과 정리 단계도 직접 파서 위주로 가지 않고, `최소한의 deterministic 전처리 + AI-assisted extraction`을 기본 전략으로 둔다.
- **장기 전략은 `상용 Teacher LLM → 인간 검증 데이터 자산화 → 국산 Student sLLM(LoRA + RAG + 에이전트 하네스)` 으로 이어지는 단계적 자립화(증류 기반)다.** 이 방향이 ①상용 API 활용과 ⑤독자 LLM 구축의 모순을 해소한다.
- 따라서 다음 계획은 `OpenAI Adapter 정착(Teacher 가동)`을 먼저 하고, agent 분리, 신뢰 DB, URL 수집, 공신력 모델, 게이트 판정, 서사·확산 분석, 검증 인프라, 학습 데이터셋, Student LoRA, A/B 라우팅, 자립화 순으로 확장한다.

## Implementation Changes

### Layer A — MVP 안정화 (Phase 1~4)

- `Phase 1`: **Teacher 가동.** `ChatGPT API(OpenAI API)` 기반 agent runtime을 정착한다. 현재 `server.js`에 남아 있는 `getOllamaInfo` 의존을 `OpenAIAdapter`로 교체한다. LLM Adapter 인터페이스(`name/tier/cost_per_1k/generate/health`)를 도입해 추후 Anthropic/HyperCLOVA X/Marbas Student를 같은 인터페이스로 라우팅 가능하게 만든다. 이 단계에서는 Ollama 연동을 목표에서 제외하고, agent orchestration과 prompt contract 안정화에 집중한다.
- `Phase 2`: **6 Agent 분리.** 최소 구성은 `Intake Agent`, `Claim Agent`, `Source Agent`, `Fact Agent`, `Narrative Agent`, `Report Agent`로 잡고, 각 agent는 JSON contract 기반으로 다음 단계에 넘길 산출물을 명확히 만든다. 현재의 `agents/origin.js`, `agents/factcheck.js`, `agents/intent.js`는 각각 `Source/Fact/Narrative`로 흡수·재명명한다.
- `Phase 3`: **Trust DB seed.** `sample_trusted_db.json`에 실데이터를 채운다. 신뢰 DB 부재, 웹 검색 비활성, 모델 JSON 오류가 있어도 요청 전체를 죽이지 말고 claim 단위 `hold + warning`으로 내리게 한다. `needs_verification=true`이면서 `type !== opinion`인 claim만 후속 에이전트로 보내고, 나머지는 `skipped_claims`로 분리한다.
- `Phase 4`: **URL 수집.** `url`이 들어오면 크롤링과 본문 정리를 별도 `Crawl/Collection Agent`가 담당하게 하고, 직접 파싱은 `canonical URL`, `title`, `published_at` 같은 최소 메타데이터 추출에만 제한한다. 본문 정리, 핵심 문장 추출, 노이즈 제거는 AI-assisted extraction을 우선 사용한다. 수집 실패 시 text fallback + warning.

### Layer B — 다층 검증 모델 (Phase 5~7)

- `Phase 5`: **공신력 모델.** 신뢰 계층을 `T0 원문/1차 자료`, `T1 초국가·공적 기관`, `T2 학술·전문기관·검증기관`, `T3 일반 언론`, `T4 SNS·커뮤니티`로 고정한다. 모든 evidence와 source 후보에 `source_tier`, `independence_class`, `interest_risk`, `country_scope`를 붙인다. `Source Agent`는 `origin_chain`과 `independence_signals`를 추가하고, `Fact Agent`의 verdict는 `supported|refuted|mixed|unknown`으로 확장한다.
- `Phase 6`: **게이트형 판정.** 최종 판정 규칙을 게이트 방식으로 바꾼다. T0/T1 또는 독립 고신뢰 근거가 없으면 `true/false`를 주지 않고 기본값은 `hold`로 둔다. 여러 언론이 같은 원문을 받아쓴 경우는 독립 증거 1건으로 본다. 이권 개입과 인과 추정은 사실 판정과 분리된 `가설층`으로만 출력한다.
- `Phase 7`: **서사 압력과 집단 확산 리스크.** `Narrative Agent`는 기존 편향 점수에 더해 `narrative_pressure_score`를 반환한다. 별도 contagion 분석 단계에서 복붙 확산, 상호 인용, 동일 문구 군집, 원문 부재 확산을 감지해 `social_contagion_score`를 만든다. 최종 리포트는 `사실 판정`, `출처 무결성`, `이해관계 리스크`, `서사 압력`, `집단 확산 리스크`, `가설성 인과 분석`을 분리해 보여준다.

### Layer C — 검증 인프라 / 데이터 자산화 (Phase 8~9)

- `Phase 8`: **품질 보증과 검증 큐.** fixture 기반 통합 테스트와 agent mock 테스트를 추가한다. `test.http`와 문서에 샘플 요청/응답을 남긴다. 운영 로그는 모델 파싱 실패, 근거 부족, 출처 불일치, URL 수집 실패를 구조화해서 기록한다. **전문가 자문단·시민 검증단을 위한 `Human Validation Queue`를 도입**한다. Aggregator 출력 중 일부를 큐에 적재하고, 1차(전문가) → 2차(시민 다수) → IAA(평가자 간 일치도) 측정 흐름을 만든다. `readme`는 API 사용법, 판정 의미, 한계와 면책 문구까지 포함하도록 확장한다.
- `Phase 9`: **학습 데이터셋 자산화.** IAA 임계치(≥ 0.8)를 통과한 검증 결과만 `Verification Data Lake`에 적재한다. 레코드 스키마는 `{ input, claim, teacher_output, human_label, validators, iaa, use_for_training }`. **Teacher 출력은 그대로 학습 라벨로 쓰지 않는다 — 항상 `human_label`이 정답.** 이로써 상용 API TOS 회피 + model collapse 방지 + 공공사업 거버넌스 요건을 동시 충족한다. 산출물: 한국어 팩트체크 골드 데이터셋 v1.

### Layer D — Student sLLM 자립화 (Phase 10~12)

- `Phase 10`: **Student LoRA 학습.** 베이스 모델 후보(EXAONE 3.5 / Solar / Kanana / A.X)를 PoC로 평가하고 1순위·2순위·백업을 확정한다. SFT(human_label 기반 지도학습) → 선택적 DPO/KTO(선호 학습) → RAG 결합 평가 순으로 학습한다. 산출물: `Marbas Student v0.1` LoRA 가중치 + 평가 리포트.
- `Phase 11`: **A/B 라우팅.** LLM Router를 도입해 Teacher/Student를 동일 LLM Adapter 인터페이스로 라우팅한다. 단순 분류·추출 태스크는 Student 우선, 복잡 추론·요약은 Teacher 우선으로 라우팅 규칙을 설정한다. 동일 입력에 대한 Teacher/Student 응답을 비교해 학습 신호를 누적한다. KPI: Student 트래픽 비중, 비용 절감률, 정확도 차이.
- `Phase 12`: **점진적 자립화.** Student 트래픽 비중을 단계적으로 확대한다(예: 1차년도 20% → 2차년도 50% → 3차년도 80%). RAG 신뢰 DB만 갱신하면 최신성 유지가 가능하므로, **재학습 없이 새 사실에 대응**할 수 있도록 RAG 운영 프로세스를 표준화한다. 데이터 주권·비용·운영 자립을 함께 달성한다.

## Public APIs / Types
- 입력 API는 `POST /api/verify`를 유지하고 `text` 필수 규칙도 유지한다. `url`이 있으면 수집 단계가 선행되고, 수집 실패 시 `text` 기준으로 fallback한다.
- 요청에 `options`를 추가한다: `{ lang: "ko|en|auto", depth: "fast|standard|deep", include_hypothesis: bool }`.
- 응답 루트에는 `verified_claims`, `skipped_claims`, `input_enrichment`를 추가한다.
- `verified_claims[].agg.final_verdict`는 `true|false|mixed|hold`로 확장한다.
- `verified_claims[].agg.score_breakdown`은 기존 항목에 `independence_score`, `interest_risk`, `narrative_pressure_score`, `social_contagion_score`를 추가한다.
- `verified_claims[].report.why`는 기존 `fact/origin/intent` 외에 `trust`, `contagion`, `hypothesis` 섹션을 추가한다.
- evidence 항목은 기존 필드 외에 `source_tier`, `independence_class`, `credibility_weight`, `quoted_text`를 포함한다.
- LLM Adapter 인터페이스: `{ name, tier: "teacher"|"student"|"local", cost_per_1k, generate(prompt, schema, options), health() }`. Phase 11부터 `LlmRouter`가 이 인터페이스를 라우팅 대상으로 삼는다.

## Test Plan

### MVP / 검증 모델 (Phase 1~7)
- 신뢰 DB seed만 있어도 `/api/verify`가 최소 1개 사실 주장에 대해 정상 응답을 반환해야 한다.
- `opinion` 또는 `needs_verification=false` claim은 에이전트 호출 대상에서 제외되고 `skipped_claims`에 이유와 함께 남아야 한다.
- 상위 계층 근거 2개 이상이 같은 사실을 지지하면 `true`, 상위 계층 근거가 직접 반박하면 `false`가 되어야 한다.
- 일부 사실만 맞고 결론이 과장된 경우 `mixed`가 되어야 한다.
- 동일 원문을 여러 기사로 재인용한 경우 독립 출처 수가 부풀려지지 않아야 한다.
- URL 수집 실패 시 text 기반 흐름으로 fallback하고, 실패 이유가 warning에 남아야 한다.
- 신뢰 DB 파일이 없거나 웹 검색이 비활성이라도 서버가 죽지 않고 `hold`와 부족 사유를 반환해야 한다.
- 고감정 선동 문구가 있어도 근거가 충분하면 사실 판정과 편향 경고가 분리되어 동시에 나와야 한다.
- T3/T4 근거만으로는 절대 `true`/`false`로 판정되지 않고 `hold`로 떨어져야 한다.

### 검증 인프라 / 데이터셋 (Phase 8~9)
- Human Validation Queue에 적재된 항목은 1차 전문가 라벨링 없이 학습 풀에 진입할 수 없다.
- IAA가 임계치 미만인 항목은 `use_for_training = false`로 표시되어야 한다.
- `human_label`이 누락된 레코드는 학습 데이터로 export되지 않아야 한다.
- Teacher 출력만 있는 레코드는 학습 데이터셋 export에서 자동 제외되어야 한다(TOS 회피 검증).

### Student / 라우팅 (Phase 10~12)
- Student LoRA 학습 파이프라인이 동일 데이터셋으로 재현 가능해야 한다(seed 고정, 결정성).
- LLM Router는 Adapter 장애 시 자동 fallback해야 한다(예: Student 503 → Teacher).
- 라우팅 결정은 로그에 남겨 Teacher/Student 비중과 비용을 집계할 수 있어야 한다.
- Teacher와 Student의 동일 입력 응답 비교 결과가 평가 데이터로 자동 누적되어야 한다.
- RAG 신뢰 DB만 갱신해도 새로운 사실에 대해 올바른 evidence를 인용할 수 있어야 한다(재학습 불필요 검증).

## Assumptions
- 초기 제품화 아키텍처는 `단일 Express 서비스 + ChatGPT API(OpenAI API)`를 기본으로 하고, Ollama는 초기 범위에서 제외한 뒤 나중에 로컬 provider 옵션으로 검토한다.
- v1의 "실시간"은 요청 시점 검색과 수집을 뜻하며, 상시 크롤링 파이프라인은 범위 밖으로 둔다.
- 우선순위는 한국어 기사와 소문 입력이지만, 스키마와 파이프라인은 영어도 처리 가능하게 유지한다.
- 공신력의 최상위 앵커는 `초국가·공적·1차 자료`이며, 언론 다수 노출 자체는 최고 신뢰 근거로 간주하지 않는다.
- 인과 관계와 이권 개입은 중요하지만 v1에서는 `검증된 사실`이 아니라 `분리된 가설`로만 제시한다.
- 크롤링과 정리 단계는 직접 규칙 기반 파싱보다 `AI-assisted extraction`을 우선하고, deterministic 파싱은 최소 메타데이터 추출에 한정한다.
- **자립화의 "독자성"은 베이스 모델의 처음부터 학습이 아니라 `한국어 도메인 데이터 + 국내 신뢰 출처 DB + 자체 평가·운영 하네스`에서 확보한다.** from-scratch 사전학습은 5~10억 단위 공공사업 예산으로 비현실적이며, 팩트체크의 핵심은 모델 사전지식이 아닌 외부 근거 인출 정확도이기 때문이다.
- **Teacher 출력은 그대로 학습 라벨로 쓰지 않는다.** 항상 인간 검증(전문가 + 시민 다수 + IAA)을 통과한 `human_label`만 정답으로 사용한다. 이는 상용 API TOS 회피, model collapse 방지, 공공사업 거버넌스 요건의 3중 안전장치다.
- **베이스 모델은 국산 우선**이다. 1순위 EXAONE 3.5, 2순위 Solar, 백업으로 Qwen·Llama. 라이선스·데이터 주권·정치적 정합성을 함께 본다.
- **최신성 유지는 RAG 갱신**으로 한다. Student LoRA 재학습은 분기/반기 단위로 하되, 새 사실 대응은 신뢰 DB만 갱신하면 충분하도록 설계한다.

## Versioning Policy

[../docs/ref.md](../docs/ref.md), `_forAI/memo.md` 의 SemVer 규칙을 따른다:
- `x.x.n` — 버그 수정 / 작은 개선
- `x.n.0` — 새 기능 추가 (하위 호환)
- `n.0.0` — 메이저 (하위 호환 깨짐 가능)

Phase 단위로 어떤 자릿수가 올라가는지 미리 결정해 둔다:
- Phase 1~4 (MVP 안정화): `0.x.0` 단위 갱신
- Phase 5~7 (다층 검증 모델): `0.x.0` 갱신, 7 완료 시 `1.0.0`
- Phase 8~9 (검증 인프라): `1.x.0`
- Phase 10~12 (Student 자립화): Student v0.1 도입 시 `2.0.0` 검토 (응답 의미 일부 변경 가능)
