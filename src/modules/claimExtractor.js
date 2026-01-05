import { ollamaChatJson } from "../services/llm/ollamaClient.js";
import { promptClaimExtract } from "../services/llm/prompts.js";
import { assertClaimsShape } from "../services/llm/schemas.js";

export async function extractClaims({ text, url, collected_at }) {
  const messages = promptClaimExtract({ text, url, collected_at });
  const out = await ollamaChatJson({ messages, schemaName: "ClaimExtraction", temperature: 0.2 });
  return assertClaimsShape(out);
}
