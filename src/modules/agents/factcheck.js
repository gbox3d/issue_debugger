import { chatJson } from "../../services/llm/index.js";
import { promptAgentB } from "../../services/llm/prompts.js";
import { assertAgentBShape } from "../../services/llm/schemas.js";
import { searchTrustedDb } from "../../services/rag/trustedDb.js";
import { searchWeb } from "../../services/web/tavilySearch.js";
import { config } from "../../config.js";
import { prepareEvidence, groundEvidence } from "../../services/llm/evidence.js";

export async function runAgentB({ claim, web, asOf }) {
  // 1) Trusted DB evidence
  const trustedHits = await searchTrustedDb({ query: claim.claim_text });

  // 2) Web evidence — web 이 넘어오면 재사용(Agent A·B 중복 검색 제거). 없으면 직접 검색.
  const webHits = web ?? (config.web.enabled ? await searchWeb({ query: claim.claim_text }) : []);

  const evidencePack = {
    trusted_db: prepareEvidence(trustedHits, asOf),
    web: prepareEvidence(webHits, asOf)
  };

  const messages = promptAgentB({ claim, evidencePack, asOf });
  const out = await chatJson({ messages, schemaName: "AgentB_FactCheck", temperature: 0.2 });
  return {
    ...groundEvidence(assertAgentBShape(out), [...evidencePack.trusted_db, ...evidencePack.web], claim.claim_id),
    as_of: asOf,
  };
}
