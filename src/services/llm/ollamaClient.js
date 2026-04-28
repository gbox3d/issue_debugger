import { config } from "../../config.js";
import { safeJsonParse, extractFirstJsonObject } from "../../utils/json.js";
import { logWarn } from "../../utils/logger.js";

/**
 * OpenAI Chat Completions API — JSON 출력 강제
 */
export async function ollamaChatJson({ messages, schemaName, temperature = 0.2 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.openai.timeoutMs);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.openai.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.openai.model,
        messages,
        temperature,
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`OpenAI error: ${resp.status} ${resp.statusText} ${body}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";

    // 1차: 통으로 JSON 파싱
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
  return {
    ok: true,
    provider: "openai",
    model: config.openai.model,
  };
}
