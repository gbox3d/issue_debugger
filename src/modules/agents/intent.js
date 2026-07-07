import { chatJson } from "../../services/llm/index.js";
import { promptAgentC } from "../../services/llm/prompts.js";
import { assertAgentCShape } from "../../services/llm/schemas.js";

export async function runAgentC({ claim, context }) {
  const messages = promptAgentC({ claim, text: context.text, asOf: context.as_of });
  const out = await chatJson({ messages, schemaName: "AgentC_IntentBias", temperature: 0.2 });
  return assertAgentCShape(out);
}
