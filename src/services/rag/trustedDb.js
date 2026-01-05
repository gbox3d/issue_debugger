import fs from "node:fs";
import { config } from "../../config.js";

let _dbCache = null;

function loadDb() {
  if (_dbCache) return _dbCache;
  const raw = fs.readFileSync(config.rag.trustedDbPath, "utf-8");
  _dbCache = JSON.parse(raw);
  if (!Array.isArray(_dbCache.docs)) _dbCache.docs = [];
  return _dbCache;
}

// 초간단 BM25/벡터 없이 "키워드 포함 점수"로 시작 (나중에 벡터DB로 교체)
function scoreDoc(doc, qTokens) {
  const text = `${doc.title ?? ""} ${doc.text ?? ""}`.toLowerCase();
  let hit = 0;
  for (const t of qTokens) if (t && text.includes(t)) hit += 1;
  const w = Number(doc.credibility_weight ?? 1);
  return hit * w;
}

export async function searchTrustedDb({ query }) {
  const db = loadDb();
  const qTokens = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);

  const scored = db.docs
    .map((doc) => ({ doc, score: scoreDoc(doc, qTokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.rag.topK);

  // evidence pack 형태로 정규화
  return scored.map(({ doc }) => ({
    title: doc.title ?? "untitled",
    url: doc.url ?? "",
    published_at: doc.published_at ?? null,
    snippet: (doc.text ?? "").slice(0, 240),
    credibility_weight: Number(doc.credibility_weight ?? 1)
  }));
}
