import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { safeJsonParse, extractFirstJsonObject, isJsonObject } from "../../utils/json.js";
import { logWarn } from "../../utils/logger.js";
import { trackLlmCall } from "./usageMetrics.js";

/**
 * Anthropic Claude (Messages API) adapter.
 *
 * OpenAI 경로와 동일한 계약({ messages, schemaName }) 을 받아 유효 JSON 객체를 돌려준다.
 * 주의(Claude Opus 5.5 기준):
 *  - temperature/top_p/top_k 는 전달하지 않는다(400 오류).
 *  - system 역할은 top-level `system` 으로 분리해야 한다(메시지 배열에 두면 안 됨).
 *  - response_format(json_object) 이나 assistant prefill 은 지원되지 않으므로,
 *    OpenAI 경로처럼 "JSON only" 프롬프트 지시 + lenient 파싱으로 맞춘다.
 *  - adaptive thinking 은 항상 ON 이므로 thinking 비활성화 옵션을 보내지 않는다.
 *    effort=medium 을 사용하고, max_tokens 는 thinking + JSON 출력 전체의 한도다.
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
  // 기본 모델 참고용 단가(USD / 1K tokens). claude-opus-5-5: $4/$20 per 1M.
  cost_per_1k: { input: 0.004, output: 0.02 },

  async chatJson({ messages, schemaName }) {
    return trackLlmCall({ provider: "anthropic", model: config.anthropic.model, stage: schemaName }, async captureUsage => {
      const { system, messages: convo } = toAnthropic(messages);

      let resp;
      try {
        resp = await client().messages.create({
          model: config.anthropic.model,
          max_tokens: config.anthropic.maxTokens,
          output_config: { effort: "medium" },
          system,
          messages: convo,
        });
      } catch (e) {
        if (e instanceof Anthropic.APIError) {
          throw new Error(`Anthropic error: ${e.status ?? "?"} ${e.message}`);
        }
        throw e;
      }

      captureUsage(resp.usage, resp.model);

      if (resp.stop_reason === "refusal") {
        logWarn(`[${schemaName}] Claude refused the request (stop_reason=refusal)`);
        throw new Error(`[${schemaName}] Claude refused the request`);
      }

      if (resp.stop_reason === "max_tokens") {
        throw new Error(`[${schemaName}] Claude output exceeded ANTHROPIC_MAX_TOKENS (${config.anthropic.maxTokens}); increase the limit`);
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
    });
  },

  async health() {
    return { ok: Boolean(config.anthropic.apiKey), provider: "anthropic", model: config.anthropic.model };
  },
};
