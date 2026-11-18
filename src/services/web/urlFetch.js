import dnsp from "node:dns/promises";
import net from "node:net";
import { config } from "../../config.js";
import { logWarn } from "../../utils/logger.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/**
 * SSRF-safe URL 크롤러.
 *
 * 사용자가 넣은 임의 URL을 서버가 대신 fetch 하므로, 방어 없이는 SSRF 취약점이 된다.
 * 방어 계층:
 *  1) scheme 은 http/https 만 허용 (file:, gopher:, data: 등 차단)
 *  2) port 는 표준(80/443)만 허용
 *  3) hostname 이 사설/예약/루프백/링크로컬(169.254.169.254 클라우드 메타데이터 포함) 로 해석되면 차단
 *  4) 리다이렉트는 수동 처리하고 매 홉마다 재검증 (내부로 리다이렉트되는 공개 URL 차단)
 *  5) 응답 크기/시간 상한 (자원 고갈 방지)
 *  6) content-type 은 text/html·text/plain 계열만 처리
 *
 * 실패는 예외를 던지지 않고 { ok:false, warning } 로 soft-fail 한다(파이프라인 게이트 철학과 동일).
 *
 * 알려진 잔여 위험: DNS rebinding — 여기서 검증한 IP 와 fetch 가 실제 연결하는 IP 사이에 미세한
 * 재해석 창이 있다. 파일럿 baseline 은 위 정적 벡터를 모두 막으며, 완전 차단은 pinned-IP dispatcher 로
 * 후속 하드닝 예정.
 */

const YT_RE = /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function isYouTubeUrl(raw) {
  try {
    const u = new URL(raw);
    return YT_RE.test(u.hostname);
  } catch {
    return false;
  }
}

// IPv6 를 16바이트로 전개 (embedded dotted IPv4 tail 도 처리). 실패 시 null.
function expandIPv6(ip) {
  let s = ip;
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, v4.index) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 255, v & 255);
  }
  return bytes;
}

function ipIsBlocked(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0) return true; // "this" network
    if (p[0] === 10) return true; // 10/8 private
    if (p[0] === 127) return true; // loopback
    if (p[0] === 169 && p[1] === 254) return true; // link-local (incl. 169.254.169.254 metadata)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12 private
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16 private
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // 192.0.0/24 reserved
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64/10 CGNAT
    if (p[0] >= 224) return true; // multicast/reserved 224.0.0.0+
    return false;
  }
  if (net.isIPv6(ip)) {
    const b = expandIPv6(ip.toLowerCase());
    if (!b) return true; // 파싱 실패 → 차단
    const zeroThru = (n) => b.slice(0, n).every((x) => x === 0);
    if (zeroThru(15) && (b[15] === 0 || b[15] === 1)) return true; // :: / ::1
    if (b[0] === 0xff) return true; // multicast ff00::/8
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
    if ((b[0] & 0xfe) === 0xfc) return true; // ULA fc00::/7
    // IPv4-mapped ::ffff:0:0/96 · IPv4-compatible ::/96 → 내장 IPv4 로 판정
    if (zeroThru(10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
      return ipIsBlocked(b.slice(12).join("."));
    }
    // NAT64 64:ff9b::/96 → 내장 IPv4 로 판정
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return ipIsBlocked(b.slice(12).join("."));
    }
    return false; // global unicast → 허용
  }
  return true; // 알 수 없으면 안전측으로 차단
}

async function assertPublicHost(hostname) {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  // URL.hostname 은 IPv6 리터럴을 대괄호로 감싸서 준다([::1]) → net.isIP 가 인식하도록 제거
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`blocked host: ${hostname}`);
  }
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new Error(`blocked ip: ${hostname}`);
    return;
  }
  const addrs = await dnsp.lookup(host, { all: true });
  if (!addrs.length) throw new Error(`no DNS record: ${hostname}`);
  for (const a of addrs) {
    if (ipIsBlocked(a.address)) {
      throw new Error(`blocked (${hostname} resolves to non-public ${a.address})`);
    }
  }
}

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

export function extractFromHtml(html, url = "https://example.org/", preferArticle = true) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? decodeEntities(m[1]).trim() : null;
  };
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let published_at =
    pick(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i);
  let published_at_source = published_at ? "page_metadata" : null;

  let article = null;
  // Scripts and external resources are disabled by JSDOM's defaults. Readability
  // removes navigation/forms so document limits apply to the article, not menus.
  if (preferArticle) {
    const dom = new JSDOM(html, { url });
    try {
      const doc = dom.window.document;
      const dateMeta = [...doc.querySelectorAll("meta")].find(node =>
        /^(article:published_time|date|datepublished|pubdate|publishdate|parsely-pub-date)$/i.test(node.getAttribute("property") || node.getAttribute("name") || ""));
      const metadataDate = dateMeta?.getAttribute("content");
      if (metadataDate && Number.isFinite(Date.parse(metadataDate))) {
        published_at = metadataDate; published_at_source = "page_metadata";
      } else {
        // Only article-level JSON-LD dates qualify; a site's footer year or
        // an unrelated nested recommendation is not the article's date.
        const articleDate = value => {
          if (Array.isArray(value)) return value.map(articleDate).find(Boolean);
          if (!value || typeof value !== "object") return null;
          const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
          if (types.some(type => /^(NewsArticle|Article|ReportageNewsArticle|BlogPosting)$/.test(type)) &&
              typeof value.datePublished === "string" && Number.isFinite(Date.parse(value.datePublished))) return value.datePublished;
          return articleDate(value["@graph"]);
        };
        for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const date = articleDate(JSON.parse(script.textContent));
            if (date) { published_at = date; published_at_source = "page_metadata"; break; }
          } catch { /* malformed publisher metadata cannot establish a date */ }
        }
        if (!published_at) {
          const date = doc.querySelector("article time[datetime], main time[datetime]")?.getAttribute("datetime");
          if (date && Number.isFinite(Date.parse(date))) { published_at = date; published_at_source = "page_time_element"; }
        }
      }
      article = new Readability(doc).parse();
    }
    finally { dom.window.close(); }
  }
  const body = article?.textContent?.trim() ? article.textContent.replace(/\s+/g, " ").trim() : decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!Number.isFinite(Date.parse(published_at))) { published_at = null; published_at_source = null; }
  return { title, published_at, published_at_source, text: body.slice(0, config.crawl.maxTextChars), text_truncated: body.length > config.crawl.maxTextChars,
    extraction_scope: article?.textContent?.trim() ? "article" : "page_text" };
}

async function readCapped(resp, maxBytes) {
  const lenHeader = Number(resp.headers.get("content-length") ?? 0);
  if (lenHeader && lenHeader > maxBytes) throw new Error(`content too large: ${lenHeader}B`);
  if (!resp.body) return { text: "", truncated: false };
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      truncated = true;
      chunks.push(value.subarray(0, value.length - (total - maxBytes)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf-8"), truncated };
}

function fail(warning) {
  logWarn(`[crawl] ${warning}`);
  return { ok: false, final_url: null, title: null, published_at: null, text: null, warning };
}

export async function fetchUrl({ url, preferArticle = false }) {
  if (!config.crawl.enabled) return fail("crawling disabled");

  let current;
  try {
    current = new URL(url);
  } catch {
    return fail(`invalid url: ${url}`);
  }

  for (let hop = 0; hop <= config.crawl.maxRedirects; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return fail(`unsupported scheme: ${current.protocol}`);
    }
    if (current.port && !["80", "443"].includes(current.port)) {
      return fail(`blocked port: ${current.port}`);
    }
    try {
      await assertPublicHost(current.hostname);
    } catch (e) {
      return fail(String(e?.message ?? e));
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), config.crawl.timeoutMs);
    let resp;
    try {
      resp = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "MarbasBot/0.1 (+factcheck pilot)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location");
        if (!loc) return fail(`redirect without location (${resp.status})`);
        try {
          current = new URL(loc, current); // 상대경로 해석; 다음 루프에서 재검증
        } catch {
          return fail(`invalid redirect target: ${loc}`);
        }
        continue;
      }

      if (!resp.ok) return fail(`HTTP ${resp.status}`);

      const ctype = (resp.headers.get("content-type") || "").toLowerCase();
      if (!/text\/html|text\/plain|application\/xhtml/.test(ctype)) {
        return fail(`unsupported content-type: ${ctype || "unknown"}`);
      }

      const body = await readCapped(resp, config.crawl.maxBytes);
      const extracted = /text\/plain/.test(ctype)
        ? { title: null, published_at: null, text: body.text.slice(0, config.crawl.maxTextChars), text_truncated: body.text.length > config.crawl.maxTextChars, extraction_scope: "plain_text" }
        : extractFromHtml(body.text, current.href, preferArticle);
      const { title, published_at, published_at_source, text, text_truncated, extraction_scope } = extracted;
      if (!text) return fail("no extractable text");
      return { ok: true, final_url: current.href, title, published_at, published_at_source: published_at_source ?? null, text, text_truncated: body.truncated || text_truncated, extraction_scope, warning: null };
    } catch (e) {
      return fail(`fetch failed: ${String(e?.message ?? e)}`);
    } finally {
      // The deadline covers response headers AND the body stream.
      clearTimeout(t);
    }
  }

  return fail("too many redirects");
}
