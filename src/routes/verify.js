import express from "express";
import { extractClaims } from "../modules/claimExtractor.js";

import { runAgentA } from "../modules/agents/origin.js";
import { runAgentB } from "../modules/agents/factcheck.js";
import { runAgentC } from "../modules/agents/intent.js";

import { aggregate } from "../modules/aggregator.js";
import { renderReport } from "../modules/report.js";

export const verifyRouter = express.Router();

verifyRouter.post("/verify", async (req, res) => {
  try {
    const { text, url, collected_at } = req.body ?? {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text(string) is required" });
    }

    // 1) Claim Extraction
    const claimsOut = await extractClaims({ text, url, collected_at });

    // 2) For each claim: run A/B/C in parallel
    const results = [];
    for (const claim of claimsOut.claims) {
      const [a, b, c] = await Promise.all([
        runAgentA({ claim, context: { text, url, collected_at } }),
        runAgentB({ claim, context: { text, url, collected_at } }),
        runAgentC({ claim, context: { text, url, collected_at } })
      ]);

      const agg = aggregate({ claim, agentA: a, agentB: b, agentC: c });
      const report = renderReport({ claim, agentA: a, agentB: b, agentC: c, agg });

      results.push({ claim, agentA: a, agentB: b, agentC: c, agg, report });
    }

    res.json({
      input: { text, url: url ?? null, collected_at: collected_at ?? null },
      claims: claimsOut.claims,
      results
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
