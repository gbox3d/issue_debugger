import { ollamaChatJson } from "../../services/llm/ollamaClient.js";
import { promptAgentC } from "../../services/llm/prompts.js";
import { assertAgentCShape } from "../../services/llm/schemas.js";

export async function runAgentC({ claim, context }) {
  const messages = promptAgentC({ claim, text: context.text });
  const out = await ollamaChatJson({ messages, schemaName: "AgentC_IntentBias", temperature: 0.2 });
  return assertAgentCShape(out);
}
