import { config } from "../../config.js";
import { safeJsonParse, extractFirstJsonObject } from "../../utils/json.js";
import { logWarn } from "../../utils/logger.js";

/**
 * Ollama /api/chat 사용 (Node 20 fetch)
 * - JSON 출력 강제: 모델이 텍스트를 섞어도 JSON만 추출
 */
export async function ollamaChatJson({ messages, schemaName, temperature = 0.2 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.ollama.timeoutMs);

  try {
    const resp = await fetch(`${config.ollama.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama.model,
        messages,
        stream: false,
        options: { temperature }
      })
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Ollama error: ${resp.status} ${resp.statusText} ${body}`);
    }

    const data = await resp.json();
    const content = data?.message?.content ?? "";

    // 1차: 통으로 JSON 파싱 시도
    const direct = safeJsonParse(content);
    if (direct.ok && typeof direct.value === "object") return direct.value;

    // 2차: 텍스트 중 첫 JSON object만 추출
    const extracted = extractFirstJsonObject(content);
    const parsed = safeJsonParse(extracted);
    if (parsed.ok && typeof parsed.value === "object") return parsed.value;

    logWarn(`[${schemaName}] Model returned non-JSON. Raw=${content.slice(0, 400)}...`);
    throw new Error(`[${schemaName}] Model returned non-JSON output`);
  } finally {
    clearTimeout(t);
  }
}


export async function getOllamaInfo() {
  try {
    // 1) Ollama 서버 버전
    const vRes = await fetch(`${config.ollama.baseUrl}/api/version`);
    const version = vRes.ok ? await vRes.json() : null;

    // 2) 로컬 모델 목록
    const mRes = await fetch(`${config.ollama.baseUrl}/api/tags`);
    const models = mRes.ok ? await mRes.json() : null;

    return {
      ok: true,
      server: version,
      models
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e.message ?? e)
    };
  }
}