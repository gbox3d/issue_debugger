import test from "node:test";
import assert from "node:assert/strict";
import { extractFromHtml } from "../src/services/web/urlFetch.js";

test("navigation does not consume the article limit or hide the event date", () => {
  const passage = "The community observatory opened on 2024-04-12. This dated announcement records the completed opening, with details about the scientific programme and its public access policy.";
  const html = `<html><head><title>Observatory opening</title></head><body><nav>${'<a href="/menu">Site navigation menu and account settings</a>'.repeat(1500)}</nav><article><h1>Observatory opening</h1>${`<p>${passage}</p>`.repeat(8)}<script>untrustedArticleCommand()</script></article></body></html>`;
  const article = extractFromHtml(html);
  assert.equal(article.extraction_scope, "article");
  assert.equal(article.text_truncated, false);
  assert.ok(article.text.includes("opened on 2024-04-12"));
  assert.ok(!article.text.includes("untrustedArticleCommand"));
  const legacy = extractFromHtml(html, "https://example.org/", false);
  assert.equal(legacy.extraction_scope, "page_text");
  assert.equal(legacy.text_truncated, true);
});

test("long extracted article still declares the real truncation boundary", () => {
  const html = `<html><head><title>Long archive</title></head><body><article>${"<p>A dated record from 2024 describes the site's history and the evidence supporting each version.</p>".repeat(500)}</article></body></html>`;
  const result = extractFromHtml(html);
  assert.equal(result.text_truncated, true);
  assert.equal(result.text.length, 20000);
});

test("publication metadata survives reversed attributes and article JSON-LD without using a URL year", () => {
  const body = '<article><p>A statement was issued yesterday to explain the completed event to readers.</p></article>';
  const meta = extractFromHtml(`<html><head><meta content="2026-11-09T09:55:00+09:00" property="article:published_time"></head><body>${body}</body></html>`);
  assert.equal(meta.published_at_source, 'page_metadata');
  assert.equal(meta.published_at, '2026-11-09T09:55:00+09:00');
  const json = extractFromHtml(`<html><head><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-11-09T01:00:00Z"}]}</script></head><body>${body}</body></html>`);
  assert.equal(json.published_at, '2026-11-09T01:00:00Z');
  assert.equal(extractFromHtml(`<html><body>${body}</body></html>`, 'https://example.org/2026/11/09/news').published_at, null);
});

test("a page header date cannot override the article's own time element", () => {
  const html = '<html><body><header><time datetime="2026-11-14">Today</time></header><article><time datetime="2024-05-20T10:00:00Z">Published</time><p>The laboratory announced its completed closure yesterday.</p></article></body></html>';
  const result = extractFromHtml(html);
  assert.equal(result.published_at, '2024-05-20T10:00:00Z');
  assert.equal(result.published_at_source, 'page_time_element');
  assert.equal(extractFromHtml('<header><time datetime="2026-11-14">Today</time></header><article>A report without a date.</article>').published_at, null);
});
