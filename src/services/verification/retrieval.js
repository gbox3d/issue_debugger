import { randomUUID } from "node:crypto";
import { createNewsTools, searchProviders, unsupportedMediaReason } from "../web/newsTools.js";
import { contentHash } from "./store.js";
import { normalizeUrl } from "./time.js";

export const RETRIEVAL_LIMITS = { target: 6, attempts: 18, providerCalls: 12, concurrency: 3, milliseconds: 60000 };
const MAX_TEXT = 12000;
const MIN_BODY_TEXT = 200;
const RELATION_STOPWORDS = new Set(["the", "and", "with", "that", "was", "were", "for", "from", "have", "has", "this", "are", "not", "있다", "했다", "한다", "대한", "관련"]);
const QUERY_GENERIC_TERMS = new Set(["denial", "correction", "deny", "denied", "corrected", "rumor", "rumour", "rumors", "rumours", "fact", "facts", "check", "factcheck", "true", "false", "news", "report", "reports", "reported", "statement", "statements", "claim", "claims", "allegation", "allegations", "affair", "relationship", "marriage", "wife", "girlfriend", "husband", "boyfriend", "admit", "admitted", "admission", "confirm", "confirmed", "interview", "official", "ceo", "chief", "founder", "profile", "biography"]);
const words = text => String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
const shortQuery = value => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().split(/\s+/).slice(0, 16).join(" ").slice(0, 160).trim() : "";

export function claimQueries(claim) {
  const planned = Array.isArray(claim.search_queries) ? claim.search_queries.map(item => shortQuery(typeof item === "string" ? item : item?.query)).filter(Boolean) : [];
  if (planned.length) return [...new Set(planned)].slice(0, 3);
  const entities = (Array.isArray(claim.entities) ? claim.entities : []).filter(item => typeof item === "string" && item.trim());
  const entityWords = entities.flatMap(words);
  const relation = words(claim.claim_text).filter(word => !entityWords.some(entity => word.startsWith(entity)));
  const koEntities = entities.filter(item => /[가-힣]/.test(item));
  const enEntities = entities.filter(item => !/[가-힣]/.test(item) && /[a-z]/i.test(item));
  const ko = koEntities.length ? [...koEntities, ...relation.filter(word => /[가-힣]/.test(word)).slice(0, 3)].join(" ") : "";
  const en = enEntities.length ? [...enEntities, ...relation.filter(word => /^[a-z]/i.test(word)).slice(0, 3)].join(" ") : "";
  const legacy = shortQuery(claim.search_query || claim.claim_text);
  // Separate scripts instead of concatenating translations into one long search.
  const base = [ko, en].map(shortQuery).filter(Boolean);
  if (!base.length) base.push(legacy);
  const followup = base[0] ? `${base[0]} ${/[가-힣]/.test(base[0]) ? "발언 정정" : "statement correction"}` : "";
  return [...new Set([...base, ...(base.length > 1 ? [followup, legacy] : [legacy, followup])].filter(Boolean))].slice(0, 3);
}

export function counterQuery(claim, alternate = null) {
  const explicit = Array.isArray(claim.search_queries) ? claim.search_queries.find(item => item?.purpose === "counterevidence")?.query : null;
  const base = shortQuery(alternate || explicit || claimQueries(claim)[0] || claim.claim_text);
  return `${base.slice(0, 135).trim()} ${/[가-힣]/.test(base) ? "정정 반박" : "denial correction"}`.trim();
}

function usable(snapshot, cutoff) {
  return !snapshot.text_truncated && snapshot.text.trim().length >= MIN_BODY_TEXT && snapshot.text.length <= MAX_TEXT &&
    (!snapshot.published_at || Date.parse(snapshot.published_at) <= Date.parse(cutoff));
}

function relevance(candidate, claim) {
  const text = `${candidate.title ?? ""} ${candidate.snippet ?? candidate.content ?? ""}`.toLowerCase();
  const compact = text.replace(/\s/g, "");
  const entities = (Array.isArray(claim.entities) ? claim.entities : []).filter(value => typeof value === "string" && value.trim());
  const entityScore = entities.reduce((score, entity) => score + (compact.includes(entity.toLowerCase().replace(/\s/g, "")) ? 8 : 0), 0);
  // Extraction may provide Korean entity names but only put their foreign
  // aliases in the planned query. Two distinct name/subject terms establish
  // relevance; generic search intents alone must never admit a candidate.
  const aliasTerms = [...new Set(claimQueries(claim).flatMap(words))].filter(word => /^[a-z][a-z0-9]+$/.test(word) && !RELATION_STOPWORDS.has(word) && !QUERY_GENERIC_TERMS.has(word));
  const candidateWords = new Set(words(text));
  const aliasMatches = aliasTerms.filter(word => candidateWords.has(word)).length;
  const profile = /\/(?:authors?|profiles?|biography|bio)(?:\/|$)/i.test(String(candidate.url ?? ""));
  const aliasRelevant = !profile && aliasMatches >= 2;
  const relationWords = [...new Set(words(claim.claim_text))].filter(word => word.length >= 3 && !RELATION_STOPWORDS.has(word) && !entities.some(entity => entity.toLowerCase().includes(word)));
  const relationScore = relationWords.reduce((score, word) => score + Number(text.includes(word)), 0);
  return { score: entityScore + relationScore + (aliasRelevant ? aliasMatches * 4 : 0), relevant: entities.length ? entityScore > 0 || aliasRelevant : relationScore >= 2 };
}

function batchesFor(result, providers) {
  if (Array.isArray(result)) return [{ provider: "custom", status: result.length ? "ok" : "no_results", results: result }];
  if (Array.isArray(result?.batches)) return result.batches;
  if (result && Array.isArray(result.results)) return [result];
  return providers.map(provider => ({ provider, status: "error", error_code: "invalid_response", results: [] }));
}

export function retrievalFailure(trace) {
  if (trace.captured > 0 && trace.usable === 0) return "source_unusable";
  if (trace.attempted || trace.candidates.some(item => item.state === "unsupported")) return "source_fetch_failed";
  if (trace.queries.some(item => item.status === "error")) return "search_failed";
  if (trace.queries.length && trace.queries.every(item => item.status === "disabled")) return "search_disabled";
  return "search_no_results";
}

export function createArticleRetrieval({ search = searchProviders, fetchSource, saveSnapshot, now = () => new Date(), knowledgeCutoff, limits = {} }) {
  const budget = { ...RETRIEVAL_LIMITS, ...limits };
  let elapsed = 0;
  let activeStarted = null;
  const elapsedTime = () => elapsed + (activeStarted == null ? 0 : Date.now() - activeStarted);
  const tools = createNewsTools(fetchSource ? { fetchArticle: fetchSource } : {});
  const snapshots = new Map();
  const seen = new Map();
  const pickedProviders = new Map();
  const pickedDomains = new Map();
  const pickedCounterClaims = new Map();
  const trace = { status: "not_run", queries: [], candidates: [], attempted: 0, captured: 0, usable: 0, unsearched_claim_ids: [],
    counter_search_complete: false, unchecked_claim_ids: [], stop_reason: null };
  let calls = 0;
  const pending = [];
  const exhausted = () => trace.attempted >= budget.attempts || elapsedTime() >= budget.milliseconds;

  function mergeRole(candidate, role, claimIds) {
    candidate.collection_roles = [...new Set([...(candidate.collection_roles ?? [candidate.source_role]), role])];
    candidate.claim_ids = [...new Set([...(candidate.claim_ids ?? []), ...claimIds])];
    if (role === "input_article" || role === "user_reference" && candidate.source_role === "discovered_source") candidate.source_role = role;
  }

  function addCandidate(result, provider, claim = null, role = "discovered_source", purpose = "primary") {
    const claimIds = claim ? [claim.claim_id] : [];
    let url;
    try { url = normalizeUrl(result.url); } catch {
      trace.candidates.push({ url: null, title: String(result.title ?? "").slice(0, 300), provider, source_role: role, claim_ids: claimIds, counter_claim_ids: purpose === "counterevidence" ? claimIds : [], search_purposes: [purpose], first_search_purpose: purpose, state: "unsupported", reason: "invalid_url" });
      return null;
    }
    const candidate = { url, title: String(result.title ?? "").slice(0, 300), provider, source_role: role, collection_roles: [role], claim_ids: claimIds,
      counter_claim_ids: purpose === "counterevidence" ? claimIds : [], search_purposes: [purpose], first_search_purpose: purpose, state: "not_attempted" };
    if (seen.has(url)) {
      const existing = seen.get(url);
      mergeRole(existing, role, claimIds);
      existing.search_purposes = [...new Set([...existing.search_purposes, purpose])];
      existing.counter_claim_ids = [...new Set([...existing.counter_claim_ids, ...candidate.counter_claim_ids])];
      const saved = snapshots.get(existing.final_url ?? url);
      if (saved) { mergeRole(saved, role, claimIds); saved.search_purposes = [...existing.search_purposes]; }
      trace.candidates.push({ ...candidate, state: "duplicate", reason: "duplicate_url" });
      return existing;
    }
    trace.candidates.push(candidate);
    const unsupported = unsupportedMediaReason(url);
    if (unsupported) { seen.set(url, candidate); candidate.state = "unsupported"; candidate.reason = unsupported; return candidate; }
    const match = claim ? relevance(result, claim) : { score: 1000, relevant: true };
    if (!match.relevant) { candidate.reason = "irrelevant_candidate"; return candidate; }
    seen.set(url, candidate);
    const counterSignal = purpose === "counterevidence" && /정정|반박|부인|오보|사실무근|\bden(?:y|ied|ial)|\bcorrect(?:ion|ed)|\brefut|\bfalse\b/i.test(`${result.title ?? ""} ${result.snippet ?? ""}`);
    pending.push({ candidate, newCounter: purpose === "counterevidence", score: match.score + (counterSignal ? 12 : 0), indexedDate: result.published_at ?? null, domain: new URL(url).hostname });
    return candidate;
  }

  async function capture(item) {
    const { candidate } = item;
    trace.attempted++;
    for (const claimId of candidate.counter_claim_ids) pickedCounterClaims.set(claimId, (pickedCounterClaims.get(claimId) ?? 0) + 1);
    pickedProviders.set(candidate.provider, (pickedProviders.get(candidate.provider) ?? 0) + 1);
    pickedDomains.set(item.domain, (pickedDomains.get(item.domain) ?? 0) + 1);
    const response = await tools.fetch_article({ url: candidate.url });
    if (response.status !== "ok") {
      candidate.state = response.status === "unsupported" ? "unsupported" : "fetch_failed";
      candidate.reason = response.error_code;
      return null;
    }
    const source = response.result;
    if (typeof source.text !== "string" || !source.text.trim()) { candidate.state = "fetch_failed"; candidate.reason = "no_text"; return null; }
    let finalUrl;
    try { finalUrl = normalizeUrl(source.final_url ?? candidate.url); } catch { candidate.state = "fetch_failed"; candidate.reason = "invalid_url"; return null; }
    candidate.final_url = finalUrl;
    if (snapshots.has(finalUrl)) {
      const saved = snapshots.get(finalUrl);
      mergeRole(saved, candidate.source_role, candidate.claim_ids);
      saved.search_purposes = [...new Set([...saved.search_purposes, ...candidate.search_purposes])];
      candidate.state = "duplicate"; candidate.reason = "duplicate_final_url";
      return saved;
    }
    const snapshot = {
      snapshot_id: randomUUID(), url: finalUrl, requested_url: candidate.url, title: typeof source.title === "string" ? source.title : finalUrl,
      published_at: typeof source.published_at === "string" && Number.isFinite(Date.parse(source.published_at)) ? source.published_at : null,
      published_at_source: source.published_at_source ?? null, indexed_published_at: item.indexedDate,
      captured_at: new Date(now()).toISOString(), text: source.text, content_hash: contentHash(source.text),
      text_truncated: Boolean(source.text_truncated || source.text.trim().length < MIN_BODY_TEXT), extraction_scope: source.extraction_scope ?? "page_text",
      body_quality: source.text.trim().length < MIN_BODY_TEXT ? "insufficient_text" : "substantial_text",
      source_role: candidate.source_role, collection_roles: [...candidate.collection_roles], claim_ids: [...candidate.claim_ids],
      search_purposes: [...candidate.search_purposes],
    };
    snapshots.set(finalUrl, snapshot);
    await saveSnapshot(snapshot);
    candidate.state = "captured";
    candidate.reason = usable(snapshot, knowledgeCutoff) ? null : snapshot.body_quality === "insufficient_text" ? "insufficient_body" : snapshot.text_truncated || snapshot.text.length > MAX_TEXT ? "partial_text" : "publication_after_cutoff";
    trace.captured = snapshots.size;
    trace.usable = [...snapshots.values()].filter(item => usable(item, knowledgeCutoff)).length;
    return snapshot;
  }

  function nextCandidate(counterOnly = false) {
    // Provider round-robin prevents one provider from occupying every fetch slot;
    // relevance and domain diversity select candidates within each provider.
    const claimCount = item => item.candidate.counter_claim_ids.length ? Math.min(...item.candidate.counter_claim_ids.map(id => pickedCounterClaims.get(id) ?? 0)) : 0;
    pending.sort((a, b) => Number(b.newCounter) - Number(a.newCounter) ||
      Number(b.candidate.search_purposes.includes("counterevidence")) - Number(a.candidate.search_purposes.includes("counterevidence")) ||
      claimCount(a) - claimCount(b) ||
      (pickedProviders.get(a.candidate.provider) ?? 0) - (pickedProviders.get(b.candidate.provider) ?? 0) ||
      (b.score - 5 * (pickedDomains.get(b.domain) ?? 0)) - (a.score - 5 * (pickedDomains.get(a.domain) ?? 0)));
    const index = counterOnly ? pending.findIndex(item => item.candidate.search_purposes.includes("counterevidence")) : 0;
    return pending.splice(index, 1)[0];
  }

  async function drain(target = budget.target, maxAttempts = budget.attempts, counterOnly = false) {
    const available = () => counterOnly ? pending.filter(item => item.candidate.search_purposes.includes("counterevidence")).length : pending.length;
    while (available() && trace.usable < target && trace.attempted < maxAttempts && !exhausted()) {
      const count = Math.min(budget.concurrency, maxAttempts - trace.attempted, target - trace.usable, available());
      // Reserve in sequence so the next choice observes provider/domain usage.
      const running = [];
      for (let index = 0; index < count; index++) running.push(capture(nextCandidate(counterOnly)));
      await Promise.all(running);
    }
  }

  async function collectReferences(references) {
    for (const { url, role } of references) addCandidate({ url }, "supplied", null, role);
    await drain();
    return references.map(({ url }) => snapshots.get(seen.get(url)?.final_url ?? url) ?? null);
  }

  async function discover(claims) {
    const eligible = claims.filter(claim => claim.type === "fact" && claim.needs_verification !== false);
    const planned = eligible.map(claim => ({ claim, queries: claimQueries(claim) }));
    function counterIncomplete(claim) {
      const checks = trace.queries.filter(query => query.claim_id === claim.claim_id && query.purpose === "counterevidence" && ["ok", "no_results"].includes(query.status));
      if (!checks.length) return true;
      if (checks.every(query => query.result_count === 0)) return false;
      const candidates = trace.candidates.filter(candidate => candidate.counter_claim_ids.includes(claim.claim_id) && candidate.reason !== "irrelevant_candidate" && candidate.reason !== "duplicate_url");
      const newCandidates = candidates.filter(candidate => candidate.first_search_purpose === "counterevidence");
      const toCheck = newCandidates.length ? newCandidates : candidates;
      return toCheck.length > 0 && !toCheck.some(candidate => {
        const snapshot = snapshots.get(candidate.final_url ?? candidate.url);
        return snapshot?.body_quality !== "insufficient_text" && (candidate.state === "captured" || candidate.reason === "duplicate_final_url");
      });
    }
    async function searchClaim(claim, query, purpose, providers) {
      if (!query || calls + providers.length > budget.providerCalls || exhausted()) return;
      calls += providers.length;
      let response;
      try { response = await search({ query, claim, purpose, providers, maxResults: 8 }); }
      catch { response = { batches: providers.map(provider => ({ provider, status: "error", error_code: "network_error", results: [] })) }; }
      for (const batch of batchesFor(response, providers)) {
        const results = Array.isArray(batch.results) ? batch.results.slice(0, 16) : [];
        const status = ["ok", "no_results", "disabled", "error"].includes(batch.status) ? batch.status : "error";
        trace.queries.push({ claim_id: claim.claim_id, query, purpose, provider: batch.provider ?? "custom", status,
          result_count: results.length, ...(batch.error_code ? { error_code: batch.error_code } : {}) });
        if (status === "ok") for (const result of results) addCandidate(result, batch.provider ?? "custom", claim, "discovered_source", purpose);
      }
    }
    // Reserve half the search calls and two usable slots for independent
    // correction/denial discovery. More claims share providers across purposes.
    const pairedProviders = eligible.length * 4 <= budget.providerCalls;
    const primaryLimit = Math.floor(budget.providerCalls / 2);
    const searched = [];
    for (const item of planned) {
      const firstProvider = /[가-힣]/.test(item.queries[0] ?? "") ? "naver" : "tavily";
      const providers = pairedProviders ? ["naver", "tavily"] : [firstProvider];
      if (calls + providers.length > primaryLimit || exhausted()) continue;
      await searchClaim(item.claim, item.queries[0], "primary", providers);
      searched.push({ ...item, firstProvider });
    }
    const reservedSlots = Math.min(budget.target, Math.max(2, eligible.length));
    await drain(Math.max(0, budget.target - reservedSlots), Math.max(0, budget.attempts - Math.min(6, budget.attempts)));
    for (const item of searched) {
      const providers = pairedProviders ? ["naver", "tavily"] : [item.firstProvider === "naver" ? "tavily" : "naver"];
      await searchClaim(item.claim, counterQuery(item.claim), "counterevidence", providers);
    }
    // A failed first counter search can need a second language. Keep one usable
    // slot and three fetch attempts for that final query instead of filling them
    // with the remaining primary results first.
    const canFallback = calls + 2 <= budget.providerCalls;
    const initialCounterTarget = canFallback ? Math.min(budget.target, Math.max(trace.usable + 1, budget.target - 1)) : budget.target;
    await drain(initialCounterTarget, canFallback ? Math.max(trace.attempted, budget.attempts - 3) : budget.attempts, true);
    for (const { claim, queries } of searched) {
      if (!counterIncomplete(claim) || calls + 2 > budget.providerCalls || exhausted()) continue;
      const used = new Set(trace.queries.filter(item => item.claim_id === claim.claim_id).map(item => item.query));
      if (used.size >= 3) continue;
      const otherLanguage = queries.slice(1).find(query => /[가-힣]/.test(query) !== /[가-힣]/.test(queries[0]));
      const alternate = otherLanguage || queries.slice(1).find(query => query !== queries[0]);
      if (!alternate) continue;
      const query = counterQuery(claim, alternate);
      if (!used.has(query)) await searchClaim(claim, query, "counterevidence", ["naver", "tavily"]);
    }
    await drain();
    for (let round = 1; round < 3 && trace.usable < budget.target && !exhausted(); round++) {
      for (const { claim, queries } of planned) {
        if (calls >= budget.providerCalls) break;
        if (new Set(trace.queries.filter(item => item.claim_id === claim.claim_id).map(item => item.query)).size >= 3) continue;
        if (queries[round] && !trace.queries.some(item => item.claim_id === claim.claim_id && item.query === queries[round])) {
          await searchClaim(claim, queries[round], "primary", ["naver", "tavily"].slice(0, budget.providerCalls - calls));
        }
      }
      await drain();
    }
    trace.unsearched_claim_ids = eligible.filter(claim => !trace.queries.some(query => query.claim_id === claim.claim_id && query.purpose === "primary")).map(claim => claim.claim_id);
    trace.unchecked_claim_ids = eligible.filter(counterIncomplete).map(claim => claim.claim_id);
    trace.counter_search_complete = eligible.length > 0 && trace.unchecked_claim_ids.length === 0;
    trace.stop_reason = trace.usable >= budget.target ? "target_reached" : trace.attempted >= budget.attempts ? "attempt_limit" : elapsedTime() >= budget.milliseconds ? "deadline" : calls >= budget.providerCalls ? "search_budget" : eligible.length ? "candidates_exhausted" : "no_eligible_claims";
    return [...snapshots.values()];
  }

  function report() {
    trace.status = trace.usable >= budget.target ? "complete" : trace.captured ? "partial" : trace.queries.length || trace.attempted || trace.candidates.length ? "failed" : "not_run";
    return trace;
  }
  async function timed(task, input) {
    activeStarted = Date.now();
    try { return await task(input); }
    finally { elapsed += Date.now() - activeStarted; activeStarted = null; }
  }
  // Claim extraction can happen between input acquisition and discovery. Its
  // model latency must not consume the separate article-retrieval deadline.
  return { collectReferences: input => timed(collectReferences, input), discover: input => timed(discover, input), report, snapshots };
}
