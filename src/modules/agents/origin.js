import { ollamaChatJson } from "../../services/llm/ollamaClient.js";
import { promptAgentA } from "../../services/llm/prompts.js";
import { assertAgentAShape } from "../../services/llm/schemas.js";
import { webSearchStub } from "../../services/web/webSearch.stub.js";
import { config } from "../../config.js";

export async function runAgentA({ claim }) {
  // TODO: 실제 구현에서는 claim 기반 웹검색 결과를 모아서 evidence로 제공
  const web = config.web.enabled ? await webSearchStub({ query: claim.claim_text }) : [];

  const messages = promptAgentA({
    claim: {
      ...claim,
      web_results: web
    }
  });

  const out = await ollamaChatJson({ messages, schemaName: "AgentA_Origin", temperature: 0.2 });
  return assertAgentAShape(out);
}
