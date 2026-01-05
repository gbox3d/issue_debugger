import { ollamaChatJson } from "../../services/llm/ollamaClient.js";
import { promptAgentB } from "../../services/llm/prompts.js";
import { assertAgentBShape } from "../../services/llm/schemas.js";
import { searchTrustedDb } from "../../services/rag/trustedDb.js";
import { webSearchStub } from "../../services/web/webSearch.stub.js";
import { config } from "../../config.js";

export async function runAgentB({ claim }) {
  // 1) Trusted DB evidence
  const trustedHits = await searchTrustedDb({ query: claim.claim_text });

  // 2) Web evidence (stub)
  const webHits = config.web.enabled ? await webSearchStub({ query: claim.claim_text }) : [];

  const evidencePack = {
    trusted_db: trustedHits,
    web: webHits
  };

  const messages = promptAgentB({ claim, evidencePack });
  const out = await ollamaChatJson({ messages, schemaName: "AgentB_FactCheck", temperature: 0.2 });
  return assertAgentBShape(out);
}
