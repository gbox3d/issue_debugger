import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../../config.js";
import { extractClaims } from "../../modules/claimExtractor.js";
import { runAgentA } from "../../modules/agents/origin.js";
import { runAgentC } from "../../modules/agents/intent.js";
import { runGeneralFactChecks } from "../../modules/agents/generalFactcheck.js";
import { aggregate } from "../../modules/aggregator.js";
import { renderReport } from "../../modules/report.js";
import { getAdapter, withUsageMetrics, getUsageMetrics, recordSkippedLlmCall, recordVerifiedCacheHit } from "../llm/index.js";
import { fetchUrl } from "../web/urlFetch.js";
import { searchProviders } from "../web/newsTools.js";
import { createArticleRetrieval, retrievalFailure } from "./retrieval.js";
import { mapLimit } from "../../utils/async.js";
import { createStore, contentHash, validId } from "./store.js";
import { normalizeRequest, requestError } from "./time.js";
import { createVerifiedCache } from "./verifiedCache.js";
import { createRequestCheckRunner } from "./executionPolicy.js";

const MAX_SOURCES = 6;
const MAX_SUPPLIED_CHARS = 12000;
const RULE_VERSION = "general-news-v3";

function suppliedSource(snapshot) {
  const snippet = snapshot.text.slice(0, MAX_SUPPLIED_CHARS);
  return {
    evidence_id: contentHash(JSON.stringify([snapshot.url, snapshot.content_hash, snapshot.snapshot_id])),
    snapshot_id: snapshot.snapshot_id, url: snapshot.url, requested_url: snapshot.requested_url,
    title: snapshot.title, published_at: snapshot.published_at, captured_at: snapshot.captured_at,
    published_at_source: snapshot.published_at_source ?? null, indexed_published_at: snapshot.indexed_published_at ?? null,
    source_role: snapshot.source_role ?? "discovered_source", collection_roles: snapshot.collection_roles ?? [], claim_ids: snapshot.claim_ids ?? [],
    search_purposes: snapshot.search_purposes ?? [],
    content_hash: snapshot.content_hash, snippet, source_kind: "original_text",
    extraction_scope: snapshot.extraction_scope ?? "page_text",
    body_quality: snapshot.text.length < 200 ? "insufficient_text" : snapshot.body_quality ?? "substantial_text",
    text_truncated: Boolean(snapshot.text_truncated || snapshot.text.length < 200 || snapshot.text.length > snippet.length),
    original_text_length: snapshot.text.length, supplied_text_length: snippet.length,
  };
}

function unknownFact(claim, time, reason) {
  return {
    claim_id: claim.claim_id, verdict: "unknown", confidence: null, evidence: [], evidence_integrity: false,
    verification_status: reason === "factcheck_unavailable" ? "incomplete" : "not_run", failure_reason: reason,
    model_calls: reason === "factcheck_unavailable" ? null : 0,
    review_required: true, review_passed: false, temporal_verified: false,
    reason_codes: [reason], reasoning_bullets: [], missing_info: [reason],
    time_sensitive: Boolean(claim.is_time_sensitive), as_of: time.knowledge_cutoff,
    time_context: time, temporal_note: "원문 또는 검증 단계가 준비되지 않아 판단을 보류합니다.",
    situation_changed: false, sentiment_timeline: [],
  };
}

function archivedSources(snapshots, requestedUrls, claims) {
  const requested = new Set(requestedUrls);
  const words = [...new Set(claims.flatMap(claim => [
    ...(Array.isArray(claim.entities) ? claim.entities.filter(value => typeof value === "string") : []),
    typeof claim.search_query === "string" ? claim.search_query : "", claim.claim_text,
  ]).join(" ").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  return snapshots.map(snapshot => {
    const preferred = requested.has(snapshot.url) || requested.has(snapshot.requested_url);
    const text = `${snapshot.title} ${snapshot.text}`.toLowerCase();
    const score = words.reduce((total, word) => total + Number(text.includes(word)), 0);
    return { snapshot, preferred, score };
  }).filter(item => item.preferred || item.score > 0)
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.score - a.score || Date.parse(b.snapshot.captured_at) - Date.parse(a.snapshot.captured_at))
    .slice(0, MAX_SOURCES).map(item => item.snapshot);
}

export function createVerificationService({
  dataDir = process.env.GENERAL_DATA_DIR || path.resolve("data/verification"),
  now = () => new Date(), fetchSource = fetchUrl, search = searchProviders,
  extract = extractClaims, checkFacts = runGeneralFactChecks, origin = runAgentA, framing = runAgentC,
} = {}) {
  const store = createStore(dataDir);
  const cache = createVerifiedCache({ dataDir, now });
  async function verify(input) {
    const started = new Date(now());
    const request = normalizeRequest(input, started);
    const checks = createRequestCheckRunner({ analysis: request.analysis });
    const adapter = getAdapter();
    const versions = { rule: RULE_VERSION, provider: adapter.name, model: adapter.model };
    if (input.previous_id != null) {
      if (!validId(input.previous_id)) throw requestError("이전 보고서 ID가 유효하지 않습니다.");
      const previous = await store.readReport(input.previous_id);
      if (!previous) throw requestError("이전 보고서를 찾을 수 없습니다.", 404);
      if (JSON.stringify(normalizeRequest(previous.request, started)) !== JSON.stringify(request)) throw requestError("재검증은 이전 보고서와 같은 입력·날짜·자료 조건으로 요청하세요.");
    }
    const time = {
      subject_date: request.subject_date, mode: request.mode,
      knowledge_cutoff: request.knowledge_cutoff ?? started.toISOString(), evaluated_at: started.toISOString(),
    };
    const warnings = [
      request.mode === "as_known" ? "당시 확보 자료 모드: 이 서버에 정보 기준 시각 이전에 저장한 원문만 사용합니다. 전체 과거 웹을 복원하지 않습니다."
        : "현재 수집한 자료로 선택한 날짜를 검증합니다. 그 당시 알려진 정보의 재현은 아닙니다.",
      "AI의 의미·시간 해석은 오류가 있을 수 있습니다. 두 검토의 일치나 모델 점수는 측정된 정확도가 아닙니다.",
    ];
    if (input.as_of != null) warnings.push("기존 as_of는 당시 확보 자료 모드로 해석했습니다. 날짜만 지정한 값은 한국 시간 00:00 기준입니다.");
    const requestedUrls = [...new Set([request.url, ...request.source_urls].filter(Boolean))];
    const archived = request.mode === "as_known" ? await store.snapshotsBefore(time.knowledge_cutoff) : [];
    const retrieval = createArticleRetrieval({ search, fetchSource, saveSnapshot: store.saveSnapshot, now, knowledgeCutoff: time.knowledge_cutoff });
    let retrievalTrace = { status: "not_run", queries: [], candidates: [], attempted: 0, captured: 0, usable: 0, unsearched_claim_ids: [], stop_reason: "archive_only" };
    let inputSnapshot = null;
    if (request.url) inputSnapshot = request.mode === "as_known"
      ? archived.find(snapshot => snapshot.url === request.url || snapshot.requested_url === request.url) ?? null
      : (await retrieval.collectReferences([{ url: request.url, role: "input_article" }]))[0];
    let effectiveText = request.text;
    if (!effectiveText && inputSnapshot) effectiveText = [inputSnapshot.title, inputSnapshot.text].filter(Boolean).join("\n\n").slice(0, 20000);
    let totalExtracted = 0;
    async function saveReport(claims, results, sources, reasonCodes = []) {
      const adapter = getAdapter();
      const evaluatedAt = new Date(now()).toISOString();
      const report = {
        id: randomUUID(), previous_id: input.previous_id ?? null, request,
        time: { ...time, evaluated_at: evaluatedAt }, evaluated_at: evaluatedAt,
        status: results.some(result => result.agg.final_verdict !== "hold") ? "assessed" : "hold", reason_codes: reasonCodes,
        verification_status: results.length && results.every(result => result.agentB.verification_status === "reviewed") ? "completed"
          : results.some(result => ["reviewed", "incomplete"].includes(result.agentB.verification_status)) ? "incomplete" : "not_run",
        failure_reason: results.length && results.some(result => result.agentB.verification_status !== "not_run") ? null : reasonCodes[0] ?? null,
        retrieval: request.mode === "as_known" ? retrievalTrace : retrieval.report(),
        input: {
          text: effectiveText, url: request.url, collected_at: inputSnapshot?.captured_at ?? null,
          published_at: inputSnapshot?.published_at ?? null, as_of: time.knowledge_cutoff,
          subject_date: request.subject_date, mode: request.mode, knowledge_cutoff: time.knowledge_cutoff,
        },
        input_enrichment: inputSnapshot ? { source: "stored_original", final_url: inputSnapshot.url, title: inputSnapshot.title, published_at: inputSnapshot.published_at, captured_at: inputSnapshot.captured_at } : null,
        evidence_sources: sources.map(({ snippet, ...metadata }) => metadata),
        warnings: [...new Set(warnings)], claims, results,
        coverage: {
          assessed: results.filter(result => result.agg.final_verdict !== "hold").length, attempted: results.length, extracted: totalExtracted,
          searched: new Set(retrieval.report().queries.map(query => query.claim_id)).size,
          reviewed: results.filter(result => result.agentB.verification_status === "reviewed").length,
          decided: results.filter(result => result.agg.final_verdict !== "hold").length,
        },
        versions, resource_usage: getUsageMetrics(),
      };
      await store.saveReport(report);
      return report;
    }
    if (!effectiveText.trim()) {
      const reason = request.mode === "as_known" ? "snapshot_unavailable" : "input_source_unavailable";
      warnings.push(request.mode === "as_known" ? "정보 기준 시각 이전의 입력 URL 원문이 없어 주장을 추출하지 못했습니다. 텍스트를 함께 입력할 수 있습니다." : "입력 URL의 본문을 확보하지 못했습니다. 검증할 텍스트를 함께 입력하세요.");
      return saveReport([], [], [], [reason]);
    }
    const context = {
      text: effectiveText, url: request.url, collected_at: inputSnapshot?.captured_at ?? null,
      published_at: inputSnapshot?.published_at ?? null, as_of: time.knowledge_cutoff,
      subject_date: time.subject_date, mode: time.mode, knowledge_cutoff: time.knowledge_cutoff,
    };
    let extracted;
    try { extracted = await extract(context); }
    catch { throw requestError("주장을 추출하지 못했습니다. 잠시 후 다시 시도하세요.", 502); }
    if (!Array.isArray(extracted?.claims) || extracted.claims.some(claim => typeof claim?.claim_id !== "string" || typeof claim?.claim_text !== "string")) throw requestError("주장 추출 결과가 올바르지 않습니다.", 502);
    totalExtracted = extracted.claims.length;
    // Initial article checks reserve two independent model calls and primary +
    // counterevidence searches for each of the three central extracted claims.
    const maximum = Number.isFinite(config.pipeline.maxClaims) && config.pipeline.maxClaims > 0 ? Math.min(3, config.pipeline.maxClaims) : 3;
    const claims = extracted.claims.slice(0, maximum).map(claim => {
      const extractedQuote = typeof claim.original_quote === "string" ? claim.original_quote.trim() : "";
      const exactClaim = claim.claim_text.trim();
      // A missing quote can be recovered only when the extracted claim itself is verbatim.
      // An explicitly invented quote must not be repaired into apparent valid extraction.
      const originalQuote = extractedQuote || (!claim.original_quote && effectiveText.includes(exactClaim) ? exactClaim : "");
      return {
        ...claim, original_quote: originalQuote, input_context: effectiveText,
        extraction_integrity: Boolean(exactClaim && originalQuote && effectiveText.includes(originalQuote)),
      };
    });
    const eligibleClaims = claims.filter(claim => claim.extraction_integrity);
    if (eligibleClaims.length < claims.length) warnings.push("일부 추출 주장의 원문 구절을 입력에서 확인하지 못했습니다. 해당 주장은 검색·판정을 진행하지 않고 보류합니다.");
    if (claims.length < totalExtracted) warnings.push(`추출된 ${totalExtracted}개 주장 중 ${claims.length}개만 검증했습니다. 나머지는 미검증입니다.`);
    let snapshots;
    if (!eligibleClaims.length) snapshots = [];
    else if (request.mode === "as_known") {
      snapshots = archivedSources(archived, requestedUrls, eligibleClaims).map(snapshot => {
        const matches = url => url && [snapshot.url, snapshot.requested_url].includes(url);
        const source_role = matches(request.url) ? "input_article" : request.source_urls.some(matches) ? "user_reference" : "discovered_source";
        return { ...snapshot, source_role, collection_roles: [source_role] };
      });
      retrievalTrace = { ...retrievalTrace, captured: snapshots.length, usable: snapshots.filter(item => !item.text_truncated && item.text.length >= 200 && item.text.length <= MAX_SUPPLIED_CHARS).length };
    } else {
      await retrieval.collectReferences(request.source_urls.map(url => ({ url, role: "user_reference" })));
      snapshots = await retrieval.discover(eligibleClaims);
      retrievalTrace = retrieval.report();
      if (retrievalTrace.unsearched_claim_ids.length) warnings.push(`검색 예산으로 ${retrievalTrace.unsearched_claim_ids.length}개 주장은 별도 검색하지 못했습니다. 개별 검색 여부를 확인하세요.`);
      if (retrievalTrace.queries.some(query => query.status === "error")) warnings.push("일부 검색 도구에 장애가 발생했습니다. 검색 결과가 없는 경우와 구분해 기록했습니다.");
      if (retrievalTrace.candidates.some(candidate => candidate.state === "fetch_failed")) warnings.push("일부 기사 본문을 수집하지 못했습니다. 실패한 기사는 판정 근거로 사용하지 않습니다.");
    }
    // Publication timestamps alone cannot establish a page's past contents.
    const sources = snapshots.filter(snapshot => !snapshot.published_at || Date.parse(snapshot.published_at) <= Date.parse(time.knowledge_cutoff)).map(suppliedSource);
    if (sources.some(source => source.text_truncated)) warnings.push("일부 원문이 수집 또는 모델 전달 한도에서 잘렸습니다. 잘린 자료는 확정 판정의 근거로 사용하지 않습니다.");
    if (!sources.length && eligibleClaims.length) warnings.push(request.mode === "as_known" ? "정보 기준 이전에 저장한 관련 원문이 없어 판단을 보류합니다." : "적격 원문을 확보하지 못해 판단을 보류합니다. 검색 요약만으로 확정하지 않습니다.");
    const concurrency = Number.isFinite(config.pipeline.claimConcurrency) ? Math.max(1, Math.min(4, config.pipeline.claimConcurrency)) : 2;
    // Current sources are collected BEFORE reuse. Any changed body, counterevidence,
    // date, model or checking rule invalidates a previous pair of reviews.
    async function cachedCheck(args) {
      const cacheInput = { ...args, versions, force: input.previous_id != null || input.force_refresh === true };
      if (cacheInput.force && !await cache.invalidate(cacheInput)) return unknownFact(args.claim, time, "cache_refresh_failed");
      const counterSearchComplete = request.mode === "as_known" || !retrieval.report().unchecked_claim_ids?.includes(args.claim.claim_id);
      const previous = counterSearchComplete ? await cache.get(cacheInput) : null;
      if (previous) {
        recordVerifiedCacheHit();
        recordSkippedLlmCall({ stage: "factcheck_pair", reason: "verified_result_cache", count: 2 });
        return { ...previous, result_reused: true };
      }
      const checked = await checkFacts(args);
      if (!counterSearchComplete) return { ...checked, review_passed: false, temporal_verified: false,
        reason_codes: [...(checked.reason_codes ?? []), "counter_search_incomplete"] };
      await cache.set({ ...cacheInput, force: false }, checked);
      return { ...checked, result_reused: false };
    }
    async function optional(role, args, operation) {
      const outcome = await checks.runOptional(role, args, operation);
      if (outcome.result.execution_status === "not_run" || outcome.reused) recordSkippedLlmCall({ stage: role, reason: outcome.reused ? "same_request_reuse" : "not_requested" });
      return outcome.result;
    }
    async function facts(args) {
      const outcome = await checks.run("factcheck_pair", args, cachedCheck);
      if (outcome.reused) recordSkippedLlmCall({ stage: "factcheck_pair", reason: "same_request_reuse", count: 2 });
      return outcome.result;
    }
    const results = await mapLimit(claims, concurrency, async claim => {
      const noSourcesReason = request.mode === "as_known" ? "snapshot_unavailable" : retrievalFailure(retrieval.report());
      const emptyOrigin = { claim_id: claim.claim_id, confidence: null, execution_status: "not_run", model_calls: 0, origin_candidates: [], timeline: [] };
      const emptyFraming = { claim_id: claim.claim_id, confidence: null, execution_status: "not_run", model_calls: 0, propaganda_score: null, bias_score: null, emotion_trigger_score: null, manipulation_flags: [], notes: "" };
      const [a, b, c] = !claim.extraction_integrity
        ? [emptyOrigin, unknownFact(claim, time, "extraction_mismatch"), emptyFraming]
        : sources.length ? await Promise.all([
        optional("origin", { claim, web: sources, asOf: time.knowledge_cutoff }, origin).catch(() => emptyOrigin),
        facts({ claim, sources, time }).catch(() => unknownFact(claim, time, "factcheck_unavailable")),
        optional("framing", { claim, context }, framing).catch(() => emptyFraming),
      ]) : [emptyOrigin, unknownFact(claim, time, noSourcesReason), emptyFraming];
      const agg = aggregate({ claim, agentA: a, agentB: b, agentC: c, sources });
      const report = renderReport({ claim, agentA: a, agentB: b, agentC: c, agg });
      return { claim, agentA: a, agentB: b, agentC: c, agg, report };
    });
    const reasonCodes = eligibleClaims.length < claims.length ? ["extraction_mismatch"] : [];
    if (!sources.length && eligibleClaims.length) reasonCodes.push(request.mode === "as_known" ? "snapshot_unavailable" : retrievalFailure(retrieval.report()));
    return saveReport(claims, results, sources, reasonCodes);
  }
  return { verify: input => withUsageMetrics(() => verify(input)), readReport: store.readReport };
}
