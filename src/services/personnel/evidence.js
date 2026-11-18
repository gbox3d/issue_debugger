import { createHash } from "node:crypto";

export const OFFICIAL_URL = "https://www.kma.go.kr/kma/org/chief/generation_01.jsp";
export const RULE_VERSION = "personnel-v1";

export function contentHash(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function koreaDate(value) {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Only the agency's explicitly bounded historical tenure table is supported.
// A missing or changed row must not silently become evidence of non-tenure.
export function parseTenures(text) {
  if (typeof text !== "string") throw new Error("source_structure_changed");
  const header = /역대\s+청장\s+번호\s+부처\s+성명\s+재임기간\s+/u.exec(text);
  if (!header) throw new Error("source_structure_changed");
  const table = text.slice(header.index + header[0].length).split("소속기관")[0];
  const starts = [...table.matchAll(/(?:^|\s)(\d{1,2})\s+(기상청|기상대|관상대)\s+/gu)];
  const rows = [];
  const numbers = new Set();
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    if (start[2] !== "기상청") continue;
    const block = table.slice(start.index, starts[i + 1]?.index ?? table.length).trim();
    const match = /^(\d{1,2})\s+기상청\s+([가-힣]{2,10})\s+(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2}|현재)$/u.exec(block);
    if (!match || numbers.has(match[1])) throw new Error("source_structure_changed");
    numbers.add(match[1]);
    const valid_from = match[3].replaceAll(".", "-");
    const valid_to = match[4] === "현재" ? null : match[4].replaceAll(".", "-");
    if (!validDate(valid_from) || (valid_to && (!validDate(valid_to) || valid_to < valid_from))) {
      throw new Error("source_invalid_dates");
    }
    rows.push({ person: match[2], valid_from, valid_to, quote: match[0], number: Number(match[1]) });
  }
  if (rows.length < 2) throw new Error("source_structure_changed");
  rows.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    if (!previous.valid_to || previous.valid_to >= rows[i].valid_from) throw new Error("source_overlapping_tenures");
  }
  return rows;
}

export function assessTenure({ person, subjectDate, rows, capturedAt }) {
  const known = rows.filter(row => row.person === person);
  if (!known.length) return { verdict: "hold", reason: "unknown_person", rows: [] };
  if (rows.some(row => row.valid_to && row.valid_to > koreaDate(capturedAt))) {
    return { verdict: "hold", reason: "source_future_tenure", rows: [] };
  }
  const covering = rows.find(row => row.valid_from <= subjectDate && (!row.valid_to || subjectDate <= row.valid_to));
  if (!covering) return { verdict: "hold", reason: "uncovered_date", rows: known };
  if (!covering.valid_to) return { verdict: "hold", reason: "open_tenure", rows: [covering] };
  return { verdict: covering.person === person ? "true" : "false", reason: covering.person === person ? "within_confirmed_tenure" : "another_confirmed_holder", rows: [covering] };
}

export function evidenceFor(snapshot, rows) {
  return rows.map(row => {
    if (!snapshot.text.includes(row.quote)) throw new Error("quote_mismatch");
    return {
      evidence_id: `${snapshot.snapshot_id}:${row.number}`,
      url: snapshot.url,
      title: snapshot.title,
      quote: row.quote,
      content_hash: snapshot.content_hash,
      captured_at: snapshot.captured_at,
      snapshot_id: snapshot.snapshot_id,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      person: row.person,
    };
  });
}
