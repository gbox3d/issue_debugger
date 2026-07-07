export function safeJsonParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false, value: null };
  }
}

// JSON `null` 과 최상위 배열은 우리가 기대하는 "객체"가 아니다 (typeof null === "object" 함정 방지).
export function isJsonObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 텍스트 중 첫 번째 {...} JSON 오브젝트를 뽑는 유틸 (모델이 잡문/코드펜스 섞을 때 대비).
// 문자열 값 안의 중괄호는 depth 계산에서 제외한다 (예: {"notes":"score is high }"}).
export function extractFirstJsonObject(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start < 0) return s;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}
