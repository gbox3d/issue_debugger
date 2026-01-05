export function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

// 텍스트 중 첫 번째 {...} JSON 오브젝트를 대충 뽑는 유틸 (모델이 잡문 섞을 때 대비)
export function extractFirstJsonObject(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start < 0) return s;

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}
