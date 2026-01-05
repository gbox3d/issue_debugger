import fs from "node:fs";

function loadEnvFile(path = ".env") {
  if (!fs.existsSync(path)) return;
  const raw = fs.readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  version: "0.1.0",
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL ?? "gpt-oss:20b",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 60000)
  },

  rag: {
    trustedDbPath: process.env.TRUSTED_DB_PATH ?? "./src/services/rag/sample_trusted_db.json",
    topK: Number(process.env.TRUSTED_DB_TOPK ?? 5)
  },

  web: {
    enabled: String(process.env.WEB_SEARCH_ENABLED ?? "false").toLowerCase() === "true"
  }
};
