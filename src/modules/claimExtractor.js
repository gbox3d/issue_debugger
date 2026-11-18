import { chatJson } from "../services/llm/index.js";
import { promptClaimExtract } from "../services/llm/prompts.js";
import { assertClaimsShape } from "../services/llm/schemas.js";

export async function extractClaims({ text, url, collected_at, published_at, as_of, subject_date, mode, knowledge_cutoff }) {
  const messages = promptClaimExtract({ text, url, collected_at, published_at, asOf: as_of, subject_date, mode, knowledge_cutoff });
  const out = await chatJson({ messages, schemaName: "ClaimExtraction", temperature: 0.2 });
  return assertClaimsShape(out);
}
