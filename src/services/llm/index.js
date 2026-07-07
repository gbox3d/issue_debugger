import { config } from "../../config.js";
import { openaiAdapter } from "./openaiAdapter.js";
import { anthropicAdapter } from "./anthropicAdapter.js";

/**
 * LLM Adapter 라우터.
 * 모든 agent/claimExtractor 는 공통 계약 chatJson({ messages, schemaName, temperature?, provider? }) 만 사용한다.
 * provider 를 넘기면 그 요청만 특정 provider 로 라우팅(향후 per-agent 라우팅 / RFP "2개 이상 모델" 대응).
 */

const adapters = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(provider = config.llm.provider) {
  const a = adapters[provider];
  if (!a) throw new Error(`Unknown LLM provider: ${provider} (expected one of ${Object.keys(adapters).join(", ")})`);
  return a;
}

export async function chatJson({ messages, schemaName, temperature, provider }) {
  return getAdapter(provider).chatJson({ messages, schemaName, temperature });
}

export async function getLlmInfo() {
  const a = getAdapter();
  const health = await a.health();
  return { ...health, tier: a.tier, cost_per_1k: a.cost_per_1k };
}
