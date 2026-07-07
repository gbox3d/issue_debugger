import express from "express";
import { extractClaims } from "../modules/claimExtractor.js";

import { runAgentA } from "../modules/agents/origin.js";
import { runAgentB } from "../modules/agents/factcheck.js";
import { runAgentC } from "../modules/agents/intent.js";

import { aggregate } from "../modules/aggregator.js";
import { renderReport } from "../modules/report.js";

import { fetchUrl, isYouTubeUrl } from "../services/web/urlFetch.js";
import { searchWeb } from "../services/web/tavilySearch.js";
import { searchNaverNews, hasNaver } from "../services/web/naverSearch.js";
import { config } from "../config.js";

export const verifyRouter = express.Router();

// 여러 검색 결과를 URL 기준 dedup 병합(순서 유지: 최근→과거).
function mergeEvidence(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of list ?? []) {
      const key = (e.url || "").split(/[?#]/)[0] || e.title || "";
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(e);
    }
  }
  return out;
}

verifyRouter.post("/verify", async (req, res) => {
  try {
    const { text, url, collected_at, as_of } = req.body ?? {};

    // 기준 시각(as-of). 진실은 시점에 따라 달라지므로 모든 단계에 "오늘"을 주입한다.
    // 클라이언트가 as_of 를 주면 재현/과거시점 검증용으로 사용, 아니면 현재 시각.
    const asOf = (typeof as_of === "string" && as_of.trim()) || new Date().toISOString();

    const warnings = [];
    let effectiveText = typeof text === "string" ? text : "";
    let inputEnrichment = null;
    let publishedAt = collected_at ?? null;

    // 0) URL 수집 (SSRF-safe). url 이 있으면 크롤링해서 본문/메타데이터를 확보한다.
    //    - text 가 비어 있으면 크롤링 본문을 검증 입력으로 사용 (URL-only 입력 지원)
    //    - text 가 있으면 사용자가 준 text 를 우선하고 URL 은 출처 메타데이터로 부착
    if (url && typeof url === "string" && url.trim()) {
      if (isYouTubeUrl(url)) {
        // YouTube 는 HTML 본문이 아니라 자막/음성이 콘텐츠라 일반 크롤링 대상이 아님.
        warnings.push("YouTube 링크는 아직 자막 추출을 지원하지 않습니다. 영상 내용은 검증 대상에서 제외되며, text 를 함께 입력하세요.");
      } else {
        const crawled = await fetchUrl({ url });
        if (crawled.ok) {
          inputEnrichment = {
            source: "crawl",
            final_url: crawled.final_url,
            title: crawled.title,
            published_at: crawled.published_at
          };
          if (crawled.published_at && !publishedAt) publishedAt = crawled.published_at;
          if (!effectiveText.trim()) {
            // URL-only 입력: 크롤링 본문을 검증 입력으로 사용 (제목을 앞에 붙여 문맥 보강)
            effectiveText = [crawled.title, crawled.text].filter(Boolean).join("\n\n");
          }
        } else {
          warnings.push(`URL 수집 실패: ${crawled.warning}`);
        }
      }
    }

    if (!effectiveText.trim()) {
      return res.status(400).json({
        error: "text 가 필요합니다. (URL만 준 경우 수집에 실패했거나 지원하지 않는 링크입니다)",
        warnings
      });
    }

    const ctx = { text: effectiveText, url: url ?? null, collected_at: publishedAt, as_of: asOf };

    // 1) Claim Extraction (as-of 주입 → is_time_sensitive 판정 포함)
    const claimsOut = await extractClaims(ctx);

    // 2) For each claim: run A/B/C in parallel
    const results = [];
    for (const claim of claimsOut.claims) {
      // 검색어는 주장 문장 전체가 아니라 주어/대상 엔티티(claim.search_query). 없으면 entities → claim_text 순 폴백.
      const query =
        (typeof claim.search_query === "string" && claim.search_query.trim()) ||
        (Array.isArray(claim.entities) && claim.entities.length ? claim.entities.join(" ") : "") ||
        claim.claim_text;
      // 시점 의존 주장 → 두 시간창을 함께 수집해 "과거 vs 최근" 대조 근거를 만든다:
      //   - 최근: 네이버 뉴스(발행일순, 오늘 상황)
      //   - 과거/배경: Tavily general(위키·나무위키 등 확립된/과거 프레이밍)
      // 그래야 situation_changed(여론/사실 변화)가 대조에 근거해 안정적으로 잡힌다.
      let web = [];
      if (claim.is_time_sensitive && hasNaver()) {
        const [recent, baseline] = await Promise.all([
          searchNaverNews({ query, count: config.naver.maxResults }),
          config.web.enabled ? searchWeb({ query, topic: "general", maxResults: 5 }) : Promise.resolve([])
        ]);
        web = mergeEvidence(recent, baseline);
        if (!web.length && config.web.enabled) {
          web = await searchWeb({ query, topic: "general", maxResults: 10 });
        }
      } else if (config.web.enabled) {
        web = await searchWeb({ query, topic: "general", maxResults: config.web.maxResults });
      }

      const [a, b, c] = await Promise.all([
        runAgentA({ claim, web, asOf }),
        runAgentB({ claim, web, asOf }),
        runAgentC({ claim, context: ctx })
      ]);

      const agg = aggregate({ claim, agentA: a, agentB: b, agentC: c });
      const report = renderReport({ claim, agentA: a, agentB: b, agentC: c, agg });

      results.push({ claim, agentA: a, agentB: b, agentC: c, agg, report });
    }

    res.json({
      input: { text: effectiveText, url: url ?? null, collected_at: publishedAt, as_of: asOf },
      input_enrichment: inputEnrichment,
      warnings,
      claims: claimsOut.claims,
      results
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
