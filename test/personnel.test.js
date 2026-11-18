import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { test } from "node:test";
import { createPersonnelRouter } from "../src/routes/personnel.js";
import { createPersonnelService } from "../src/services/personnel/service.js";
import { OFFICIAL_URL, parseTenures, contentHash } from "../src/services/personnel/evidence.js";

// Synthetic regression fixtures, not a human-labelled fact-checking benchmark.
const TABLE = "역대 청장 번호 부처 성명 재임기간 4 기상청 이현재 2025.01.01~현재 3 기상청 박후임 2020.01.01~2024.12.31 2 기상청 김전임 2018.01.01~2019.12.31 1 기상대 유이전 2010.01.01~2017.12.31 소속기관 기타";
const SOURCE = { ok: true, final_url: OFFICIAL_URL, title: "공식 이력 테스트", text: TABLE };
const CLOCK = "2026-11-15T01:00:00.000Z";
const INPUT = { person: "김전임", subject_date: "2019-06-01", mode: "retrospective" };

async function fixture(t, overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "marbas-personnel-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const options = { dataDir, now: () => new Date(CLOCK), fetchSource: async () => SOURCE, ...overrides };
  return { service: createPersonnelService(options), options, dataDir };
}

async function httpFixture(t, overrides = {}) {
  const { options, dataDir } = await fixture(t, overrides);
  const app = express();
  app.use(express.json());
  app.use("/api", createPersonnelRouter(options));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async body => {
    const response = await fetch(`${base}/personnel/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  };
  return { base, post, dataDir };
}

test("HTTP supports bounded tenure with a quote, hash and saved report", async t => {
  const { base, post, dataDir } = await httpFixture(t);
  const { response, body } = await post(INPUT);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.verdict, "true");
  assert.equal(body.evidence.length, 1);
  assert.ok(TABLE.includes(body.evidence[0].quote));
  assert.equal(body.evidence[0].content_hash, contentHash(TABLE));
  assert.equal(body.evidence[0].captured_at, CLOCK);
  assert.equal(body.evidence[0].url, OFFICIAL_URL);
  const replay = await fetch(`${base}/personnel/reports/${body.id}`);
  assert.deepEqual(await replay.json(), body);
  const stat = await fs.stat(path.join(dataDir, "reports", `${body.id}.json`));
  assert.equal(stat.mode & 0o777, 0o600);
});

test("false requires a different holder's closed interval", async t => {
  const { service } = await fixture(t);
  const report = await service.verify({ ...INPUT, subject_date: "2021-06-01" });
  assert.equal(report.verdict, "false");
  assert.equal(report.reason_codes[0], "another_confirmed_holder");
  assert.equal(report.evidence[0].person, "박후임");
});

test("both endpoints of a closed tenure are inclusive", async t => {
  const { service } = await fixture(t);
  for (const subject_date of ["2018-01-01", "2019-12-31"]) {
    assert.equal((await service.verify({ ...INPUT, subject_date })).verdict, "true");
  }
  assert.equal((await service.verify({ ...INPUT, subject_date: "2020-01-01" })).verdict, "false");
});

test("unknown people, agency predecessors, gaps and current tenure are held", async t => {
  const { service } = await fixture(t);
  for (const input of [
    { ...INPUT, person: "미확인" },
    { ...INPUT, person: "유이전", subject_date: "2015-01-01" },
    { ...INPUT, subject_date: "2017-12-31" },
    { ...INPUT, subject_date: "2026-01-01" },
    { ...INPUT, person: "이현재", subject_date: "2026-01-01" },
  ]) assert.equal((await service.verify(input)).verdict, "hold");
});

test("current source cannot retroactively satisfy an as-known cutoff", async t => {
  let fetches = 0;
  const { service } = await fixture(t, { fetchSource: async () => { fetches += 1; return SOURCE; } });
  await service.verify(INPUT);
  const report = await service.verify({ ...INPUT, mode: "as_known", knowledge_cutoff: "2020-01-01T00:00:00Z" });
  assert.equal(report.verdict, "hold");
  assert.deepEqual(report.reason_codes, ["snapshot_unavailable"]);
  assert.equal(fetches, 1);
  assert.equal(report.evidence.length, 0);
});

test("as-known uses only the latest actually saved snapshot before cutoff", async t => {
  let time = CLOCK;
  let source = SOURCE;
  const { service } = await fixture(t, { now: () => new Date(time), fetchSource: async () => source });
  const first = await service.verify(INPUT);
  time = "2026-11-15T02:00:00.000Z";
  source = { ...SOURCE, text: TABLE.replace("김전임", "최정정") };
  const corrected = await service.verify(INPUT);
  assert.equal(corrected.verdict, "hold");
  const historical = await service.verify({ ...INPUT, mode: "as_known", knowledge_cutoff: "2026-11-15T01:30:00Z" });
  assert.equal(historical.verdict, "true");
  assert.equal(historical.source.snapshot_id, first.source.snapshot_id);
  assert.equal(historical.evidence[0].captured_at, CLOCK);
});

test("reverification preserves prior report and requires the same request", async t => {
  let fetches = 0;
  const { service } = await fixture(t, { fetchSource: async () => { fetches += 1; return SOURCE; } });
  const first = await service.verify(INPUT);
  const next = await service.verify({ ...INPUT, previous_id: first.id });
  assert.notEqual(next.id, first.id);
  assert.equal(next.previous_id, first.id);
  assert.equal(fetches, 2);
  assert.deepEqual(await service.readReport(first.id), first);
  await assert.rejects(() => service.verify({ ...INPUT, person: "박후임", previous_id: first.id }), /같은 주장/);
});

test("valid free-text extraction is grounded and raw text is replayable", async t => {
  const text = "김전임은 기상청장이었다.";
  const { service } = await fixture(t, { extractClaim: async input => {
    assert.equal(input, text);
    return { person: "김전임", organization: "기상청", position: "청장", type: "fact", assertion: "holds_office" };
  } });
  const report = await service.verify({ text, subject_date: INPUT.subject_date });
  assert.equal(report.verdict, "true");
  assert.equal(report.request.text, text);
  assert.equal(report.request.person, undefined);
  assert.equal((await service.verify({ ...report.request, previous_id: report.id })).previous_id, report.id);
});

test("opinions, negatives, compounds and invented extracted people cannot become facts", async t => {
  let fetches = 0;
  const { service } = await fixture(t, {
    fetchSource: async () => { fetches += 1; return SOURCE; },
    extractClaim: async () => ({ person: "김전임", organization: "기상청", position: "청장", type: "fact", assertion: "holds_office" }),
  });
  for (const text of ["김전임은 최고의 기상청장이었다.", "김전임은 기상청장이 아니었다.", "김전임은 기상청장이었다. 박후임도 기상청장이었다.", "박후임은 기상청장이었다.", "김전임은 기상청장이라고 주장했다."]) {
    const report = await service.verify({ text, subject_date: INPUT.subject_date });
    assert.equal(report.verdict, "hold");
    assert.deepEqual(report.reason_codes, ["unsupported_claim"]);
  }
  assert.equal(fetches, 0);
});

test("model outage and scope mismatch are explicit holds", async t => {
  const a = await fixture(t, { extractClaim: async () => { throw new Error("offline"); } });
  assert.deepEqual((await a.service.verify({ text: "김전임은 기상청장이었다.", subject_date: INPUT.subject_date })).reason_codes, ["extraction_unavailable"]);
  const b = await fixture(t, { extractClaim: async () => ({ person: "김전임", organization: "다른기관", position: "청장", type: "fact", assertion: "holds_office" }) });
  assert.equal((await b.service.verify({ text: "김전임은 기상청장이었다.", subject_date: INPUT.subject_date })).verdict, "hold");
});

test("source failure, non-official redirect and malformed table cannot certify a claim", async t => {
  for (const source of [
    { ok: false },
    { ...SOURCE, final_url: "https://example.org/copy" },
    { ...SOURCE, text: TABLE.replace("재임기간", "근무 경력") },
    { ...SOURCE, text: TABLE.replace("2019.12.31", "2019.02.30") },
    { ...SOURCE, text: TABLE.replace("2019.12.31", "2020.01.01") },
    { ...SOURCE, text: TABLE.replace("2 기상청 김전임 2018.01.01~2019.12.31", "2 기상청 김전임 날짜미상") },
  ]) {
    const { service } = await fixture(t, { fetchSource: async () => source });
    assert.equal((await service.verify(INPUT)).verdict, "hold");
  }
});

test("future-ended announced tenure is not treated as completed tenure", async t => {
  const { service } = await fixture(t, { fetchSource: async () => ({ ...SOURCE, text: TABLE.replace("2025.01.01~현재", "2025.01.01~2028.12.31") }) });
  const report = await service.verify(INPUT);
  assert.equal(report.verdict, "hold");
  assert.deepEqual(report.reason_codes, ["source_future_tenure"]);
});

test("invalid requests return 400 before any external call", async t => {
  let fetches = 0;
  const { post } = await httpFixture(t, { fetchSource: async () => { fetches += 1; return SOURCE; } });
  for (const input of [
    {}, [], { ...INPUT, person: { name: "김전임" } },
    { ...INPUT, text: "김전임은 기상청장이다." },
    { ...INPUT, subject_date: "2019-02-29" },
    { ...INPUT, subject_date: "2026-11-16" },
    { ...INPUT, mode: "invalid" },
    { ...INPUT, mode: "as_known", knowledge_cutoff: "2020-01-01" },
    { ...INPUT, mode: "as_known", knowledge_cutoff: "2020-02-30T00:00:00Z" },
    { ...INPUT, mode: "as_known", knowledge_cutoff: "2026-11-16T00:00:00Z" },
    { ...INPUT, previous_id: "../../.env" },
  ]) assert.equal((await post(input)).response.status, 400);
  assert.equal(fetches, 0);
});

test("report access validates UUID and has no public report-list endpoint", async t => {
  const { base } = await httpFixture(t);
  assert.equal((await fetch(`${base}/personnel/reports/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${base}/personnel/reports/00000000-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await fetch(`${base}/personnel/reports`)).status, 404);
});

test("stored evidence tampering is detected instead of certifying historical claims", async t => {
  const { service, dataDir } = await fixture(t);
  const first = await service.verify(INPUT);
  const file = path.join(dataDir, "snapshots", `${first.source.snapshot_id}.json`);
  const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
  snapshot.text = snapshot.text.replace("김전임", "최변조");
  await fs.writeFile(file, JSON.stringify(snapshot));
  await assert.rejects(() => service.verify({ ...INPUT, mode: "as_known", knowledge_cutoff: CLOCK }), /integrity/);
});

test("parser rejects reversed tenure ranges and duplicate row numbers", () => {
  assert.throws(() => parseTenures(TABLE.replace("2018.01.01~2019.12.31", "2019.12.31~2018.01.01")), /source_invalid_dates/);
  assert.throws(() => parseTenures(TABLE.replace("2 기상청 김전임", "3 기상청 김전임")), /source_structure_changed/);
});
