import { config } from "../../config.js";
import { safeJsonParse, extractFirstJsonObject, isJsonObject } from "../../utils/json.js";
import { logWarn } from "../../utils/logger.js";

/**
 * OpenAI Chat Completions adapter — JSON 출력 강제.
 * response_format: json_object 로 유효 JSON 을 강제하고, 혹시 잡문이 섞이면 lenient 파싱으로 복구.
 */
export const openaiAdapter = {
  name: "openai",
  tier: "teacher",
  get model() {
    return config.openai.model;
  },
  // 참고용 단가(USD / 1K tokens). gpt-5.4-mini: $0.75/$4.50 per 1M.
  cost_per_1k: { input: 0.00075, output: 0.0045 },

  async chatJson({ messages, schemaName, temperature = 0.2 }) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), config.openai.timeoutMs);

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.openai.apiKey}`,
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

      const direct = safeJsonParse(content);
      if (direct.ok && isJsonObject(direct.value)) return direct.value;

      const extracted = extractFirstJsonObject(content);
      const parsed = safeJsonParse(extracted);
      if (parsed.ok && isJsonObject(parsed.value)) return parsed.value;

      logWarn(`[${schemaName}] OpenAI returned non-JSON. Raw=${content.slice(0, 400)}...`);
      throw new Error(`[${schemaName}] OpenAI returned non-JSON output`);
    } finally {
      clearTimeout(t);
    }
  },

  async health() {
    return { ok: Boolean(config.openai.apiKey), provider: "openai", model: config.openai.model };
  },
};
