import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentHash, validId } from "./store.js";
import { validDate, validTimestamp } from "./time.js";

const FORMAT = "reviewed-result-reuse-v1";
const DAY = 24 * 60 * 60 * 1000;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = value => typeof value === "string" && Boolean(value.trim());

// Match JSON model inputs, while making object property insertion order irrelevant.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const serialized = value => JSON.stringify(canonical(value));
const without = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

function reusableInput({ claim, sources, time, versions } = {}) {
  if (!isObject(claim) || !nonempty(claim.claim_id) || !nonempty(claim.claim_text) ||
      claim.type !== "fact" || claim.needs_verification === false || claim.extraction_integrity !== true ||
      !nonempty(claim.original_quote) || typeof claim.input_context !== "string" ||
      !claim.input_context.includes(claim.original_quote)) return false;
  if (!isObject(time) || !validDate(time.subject_date) || !["retrospective", "as_known"].includes(time.mode) ||
      !validTimestamp(time.knowledge_cutoff) || !validTimestamp(time.evaluated_at)) return false;
  if (!isObject(versions) || ![versions.rule, versions.provider, versions.model].every(nonempty)) return false;
  if (!Array.isArray(sources) || !sources.length) return false;
  const ids = new Set();
  const snapshots = new Set();
  for (const source of sources) {
    if (!isObject(source) || !nonempty(source.evidence_id) || ids.has(source.evidence_id) ||
        !validId(source.snapshot_id) || snapshots.has(source.snapshot_id) ||
        !nonempty(source.url) || source.source_kind !== "original_text" || !nonempty(source.snippet) ||
        !/^[a-f0-9]{64}$/.test(source.content_hash ?? "") || !validTimestamp(source.captured_at) ||
        typeof source.text_truncated !== "boolean" || source.supplied_text_length !== source.snippet.length ||
        !Number.isInteger(source.original_text_length) || source.original_text_length < source.snippet.length) return false;
    try { if (!["http:", "https:"].includes(new URL(source.url).protocol)) return false; }
    catch { return false; }
    if (!source.text_truncated && (source.original_text_length !== source.snippet.length || contentHash(source.snippet) !== source.content_hash)) return false;
    if (time.mode === "as_known" && Date.parse(source.captured_at) > Date.parse(time.knowledge_cutoff)) return false;
    if (source.published_at != null && (!Number.isFinite(Date.parse(source.published_at)) ||
        Date.parse(source.published_at) > Date.parse(time.knowledge_cutoff))) return false;
    ids.add(source.evidence_id);
    snapshots.add(source.snapshot_id);
  }
  return sources.some(source => !source.text_truncated);
}

function inputKey(input) {
  if (!reusableInput(input)) return null;
  const { claim, sources, time, versions } = input;
  return contentHash(serialized({
    format: FORMAT,
    claim: without(claim, ["claim_id"]),
    // Keep every supplied body, including partial counterevidence, and every
    // semantic metadata field (roles, publication provenance, extraction scope).
    sources: sources.map(source => without(source, time.mode === "as_known"
      ? ["evidence_id", "snapshot_id"] : ["evidence_id", "snapshot_id", "captured_at"])),
    // In retrospective mode the cutoff is the request clock, not a historical
    // knowledge boundary. Freshly collected sources are still mandatory above.
    time: without(time, time.mode === "as_known" ? ["evaluated_at"] : ["evaluated_at", "knowledge_cutoff"]),
    versions,
  }));
}

function validCitations(citations, input, verdict, assessmentBasis) {
  if (!Array.isArray(citations) || !citations.length) return false;
  const byId = new Map(input.sources.map(source => [source.evidence_id, source]));
  return citations.every(citation => {
    const source = byId.get(citation?.evidence_id);
    if (!source || source.text_truncated || !nonempty(citation.snippet) || citation.snippet.length < 10 ||
        !source.snippet.includes(citation.snippet) || citation.applies_on !== input.time.subject_date ||
        citation.stance !== (verdict === "supported" ? "support" : "refute") ||
        typeof citation.time_reasoning !== "string" || citation.time_reasoning.trim().length < 10) return false;
    // A cached citation must have been grounded against this exact original.
    for (const [key, value] of Object.entries(source)) {
      if (key !== "snippet" && serialized(citation[key]) !== serialized(value)) return false;
    }
    if (citation.time_basis === "timeless") return input.claim.is_time_sensitive === false;
    if (typeof citation.time_quote !== "string" || citation.time_quote.length < 8 || !source.snippet.includes(citation.time_quote)) return false;
    if (citation.time_basis === "dated_report") {
      const publicationDay = typeof source.published_at === "string" ? source.published_at.slice(0, 10) : null;
      return ["page_metadata", "page_time_element"].includes(source.published_at_source) &&
        validDate(publicationDay) && publicationDay <= input.time.subject_date &&
        citation.temporal_scope === "completed_event" && validDate(citation.event_date) &&
        citation.event_date <= publicationDay && ["reporting", "mixed"].includes(assessmentBasis);
    }
    return citation.time_basis === "dated_record" && /(?:18|19|20|21)\d{2}/.test(citation.time_quote);
  });
}

function validFindings(findings, sources) {
  if (!Array.isArray(findings) || !findings.length) return false;
  const byId = new Map(sources.map(source => [source.evidence_id, source]));
  return findings.every(finding => isObject(finding) &&
    ["reported_statement", "reported_identification", "direct_record", "unresolved"].includes(finding.kind) &&
    nonempty(finding.text) && Array.isArray(finding.evidence_ids) && finding.evidence_ids.length > 0 &&
    finding.evidence_ids.every(id => typeof id === "string" && byId.has(id)) &&
    typeof finding.quote === "string" && finding.quote.length >= 10 &&
    finding.evidence_ids.some(id => byId.get(id).snippet.includes(finding.quote)));
}

function reusableResult(result, input) {
  if (!isObject(result) || result.claim_id !== input.claim.claim_id || !["supported", "refuted"].includes(result.verdict) ||
      result.valid !== true || result.scope_complete !== true || result.claim_preserved !== true || result.has_unresolved_conflict !== false ||
      result.review_required !== true || result.review_passed !== true || result.evidence_integrity !== true || result.temporal_verified !== true ||
      !Number.isFinite(result.confidence) || result.confidence < 0.7 || result.confidence > 1 ||
      !Array.isArray(result.missing_info) || result.missing_info.length ||
      !Array.isArray(result.reason_codes) || result.reason_codes.some(code => code !== "original_evidence_reviewed") ||
      result.as_of !== input.time.knowledge_cutoff || serialized(result.time_context) !== serialized(input.time)) return false;
  for (const part of [result, result.assessment, result.review]) {
    if (!isObject(part) || part.verdict !== result.verdict || !["direct", "reporting", "mixed"].includes(part.assessment_basis) ||
        part.assessment_basis !== result.assessment_basis || !validCitations(part.evidence, input, result.verdict, part.assessment_basis) ||
        !validFindings(part.findings, input.sources)) return false;
  }
  return result.review.passed === true &&
    [result.assessment, result.review].every(part => Array.isArray(part.reason_codes) && part.reason_codes.length === 0);
}

function remapResult(result, previous, current) {
  const byId = new Map(previous.sources.map((source, index) => [source.evidence_id, current.sources[index]]));
  const remapped = structuredClone(result);
  remapped.claim_id = current.claim.claim_id;
  remapped.time_context = structuredClone(current.time);
  remapped.as_of = current.time.knowledge_cutoff;
  for (const part of [remapped, remapped.assessment, remapped.review]) {
    part.evidence = part.evidence.map(citation => {
      const { snippet, stance, applies_on, time_basis, time_quote, time_reasoning, temporal_scope, event_date } = citation;
      return { ...byId.get(citation.evidence_id), snippet, stance, applies_on, time_basis, time_quote, time_reasoning, temporal_scope, event_date };
    });
    if (part.findings) part.findings = part.findings.map(finding => ({
      ...finding, evidence_ids: finding.evidence_ids.map(id => byId.get(id).evidence_id),
    }));
  }
  // Unknown reference-bearing fields or prose containing old IDs cannot be
  // safely rewritten as quotations. Conservatively rerun the checks instead.
  const output = JSON.stringify(remapped);
  for (let index = 0; index < previous.sources.length; index++) {
    for (const field of ["evidence_id", "snapshot_id"]) {
      const oldId = previous.sources[index][field];
      if (oldId !== current.sources[index][field] && output.includes(oldId)) return null;
    }
  }
  return reusableResult(remapped, current) ? remapped : null;
}

// Reuses a previously passed pair of model reviews, never a truth database or
// a substitute for fetching current evidence. Reports themselves are untouched.
export function createVerifiedCache({ dataDir, now = () => new Date(), ttlMs = DAY } = {}) {
  if (!nonempty(dataDir) || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("A data directory and positive cache TTL are required");
  const directory = path.join(dataDir, "reviewed-results");
  const clock = () => new Date(now()).getTime();

  async function get(input) {
    if (input?.force) return null;
    try {
      const key = inputKey(input);
      if (!key) return null;
      const entry = JSON.parse(await fs.readFile(path.join(directory, `${key}.json`), "utf8"));
      const current = clock();
      if (entry.format !== FORMAT || entry.key !== key || inputKey(entry.input) !== key ||
          !Number.isFinite(current) || !Number.isFinite(entry.created_at) || entry.created_at > current ||
          !Number.isFinite(entry.expires_at) || entry.expires_at <= current || entry.expires_at <= entry.created_at ||
          current - entry.created_at >= ttlMs || !reusableResult(entry.result, entry.input)) return null;
      return remapResult(entry.result, entry.input, input);
    } catch { return null; } // A missing, corrupt or unavailable cache is only a miss.
  }

  async function set(input, result) {
    if (input?.force) return false;
    let temporary;
    try {
      const key = inputKey(input);
      const created = clock();
      if (!key || !Number.isFinite(created) || !reusableResult(result, input)) return false;
      const { claim, sources, time, versions } = input;
      const entry = { format: FORMAT, key, created_at: created, expires_at: created + ttlMs,
        input: { claim, sources, time, versions }, result };
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, path.join(directory, `${key}.json`));
      return true;
    } catch { return false; }
    finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
  }

  // Invalidate before a forced review. If that review returns unknown, the
  // previous pass must not become eligible again on the next normal request.
  async function invalidate(input) {
    try {
      const key = inputKey(input); // force deliberately has no effect on the key.
      if (!key) return true; // Non-cacheable inputs cannot have a matching entry.
      await fs.unlink(path.join(directory, `${key}.json`));
      return true;
    } catch (error) { return error.code === "ENOENT"; }
  }

  return { get, set, invalidate };
}
