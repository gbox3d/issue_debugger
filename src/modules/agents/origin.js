import { chatJson } from "../../services/llm/index.js";
import { promptAgentA } from "../../services/llm/prompts.js";
import { assertAgentAShape } from "../../services/llm/schemas.js";
import { searchWeb } from "../../services/web/tavilySearch.js";
import { config } from "../../config.js";

export async function runAgentA({ claim, web, asOf }) {
  // web 이 넘어오면 재사용(Agent A·B 웹검색 중복 제거). 없으면 직접 검색.
  const webResults = web ?? (config.web.enabled ? await searchWeb({ query: claim.claim_text }) : []);

  const messages = promptAgentA({
    claim: {
      ...claim,
      web_results: webResults
    },
    asOf
  });

  const out = await chatJson({ messages, schemaName: "AgentA_Origin", temperature: 0.2 });
  return assertAgentAShape(out);
}
