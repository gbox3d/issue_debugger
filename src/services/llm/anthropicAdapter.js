import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { safeJsonParse, extractFirstJsonObject, isJsonObject } from "../../utils/json.js";
import { logWarn } from "../../utils/logger.js";

/**
 * Anthropic Claude (Messages API) adapter.
 *
 * OpenAI 경로와 동일한 계약({ messages, schemaName }) 을 받아 유효 JSON 객체를 돌려준다.
 * 주의(Sonnet 5 기준):
 *  - temperature/top_p/top_k 는 전달하지 않는다(비기본값이면 400).
 *  - system 역할은 top-level `system` 으로 분리해야 한다(메시지 배열에 두면 안 됨).
 *  - response_format(json_object) 이나 assistant prefill 은 지원되지 않으므로,
 *    OpenAI 경로처럼 "JSON only" 프롬프트 지시 + lenient 파싱으로 맞춘다.
 *  - adaptive thinking 이 기본 ON 이라, 빠른 JSON 추출(RFP PER-004: 10초 이내)을 위해 명시적으로 끈다.
 *  - 향후 프롬프트에 실제 JSON Schema 가 실리면 output_config.format 으로 하드 보장 전환 가능.
 */

let _client = null;
function client() {
  if (!_client) {
    _client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      timeout: config.anthropic.timeoutMs, // TS SDK 는 ms 단위
    });
  }
  return _client;
}

// OpenAI 스타일 messages([{role, content}]) → Anthropic { system, messages }
function toAnthropic(messages) {
  const systemParts = [];
  const convo = [];
  for (const m of messages ?? []) {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.role === "system") systemParts.push(content);
    else convo.push({ role: m.role, content });
  }
  return { system: systemParts.join("\n\n"), messages: convo };
}

export const anthropicAdapter = {
  name: "anthropic",
  tier: "teacher",
  get model() {
    return config.anthropic.model;
  },
  // 참고용 단가(USD / 1K tokens). claude-sonnet-5: $3/$15 per 1M(도입가 $2/$10, 2026-08-31 까지).
  cost_per_1k: { input: 0.003, output: 0.015 },

  async chatJson({ messages, schemaName }) {
    const { system, messages: convo } = toAnthropic(messages);

    let resp;
    try {
      resp = await client().messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        thinking: { type: "disabled" },
        system,
        messages: convo,
      });
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        throw new Error(`Anthropic error: ${e.status ?? "?"} ${e.message}`);
      }
      throw e;
    }

    if (resp.stop_reason === "refusal") {
      logWarn(`[${schemaName}] Claude refused the request (stop_reason=refusal)`);
      throw new Error(`[${schemaName}] Claude refused the request`);
    }

    const text = (resp.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const direct = safeJsonParse(text);
    if (direct.ok && isJsonObject(direct.value)) return direct.value;

    const extracted = extractFirstJsonObject(text);
    const parsed = safeJsonParse(extracted);
    if (parsed.ok && isJsonObject(parsed.value)) return parsed.value;

    logWarn(`[${schemaName}] Claude returned non-JSON. Raw=${text.slice(0, 400)}...`);
    throw new Error(`[${schemaName}] Claude returned non-JSON output`);
  },

  async health() {
    return { ok: Boolean(config.anthropic.apiKey), provider: "anthropic", model: config.anthropic.model };
  },
};
