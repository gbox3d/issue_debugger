import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contentHash, OFFICIAL_URL } from "./evidence.js";

export const validId = id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export function createStore(dataDir) {
  async function write(kind, id, value) {
    const dir = path.join(dataDir, kind);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, `${id}.json`);
    const temp = path.join(dir, `${id}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
      await fs.rename(temp, target);
    } finally {
      await fs.unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function readReport(id) {
    if (!validId(id)) return null;
    try {
      const report = JSON.parse(await fs.readFile(path.join(dataDir, "reports", `${id}.json`), "utf8"));
      return report.id === id ? report : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function snapshotBefore(cutoff) {
    let files;
    try {
      files = await fs.readdir(path.join(dataDir, "snapshots"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    let selected = null;
    for (const file of files) {
      if (!file.endsWith(".json") || !validId(file.slice(0, -5))) continue;
      const snapshot = JSON.parse(await fs.readFile(path.join(dataDir, "snapshots", file), "utf8"));
      if (snapshot.snapshot_id !== file.slice(0, -5) || snapshot.url !== OFFICIAL_URL ||
          typeof snapshot.text !== "string" || contentHash(snapshot.text) !== snapshot.content_hash ||
          !Number.isFinite(Date.parse(snapshot.captured_at))) throw new Error("Stored snapshot integrity check failed");
      if (Date.parse(snapshot.captured_at) <= Date.parse(cutoff) &&
          (!selected || Date.parse(snapshot.captured_at) > Date.parse(selected.captured_at))) selected = snapshot;
    }
    return selected;
  }

  return {
    saveSnapshot: snapshot => write("snapshots", snapshot.snapshot_id, snapshot),
    saveReport: report => write("reports", report.id, report),
    readReport,
    snapshotBefore,
  };
}
