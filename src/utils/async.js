// 동시성 제한 map. items 를 최대 limit 개씩 병렬 처리하고, 입력 순서대로 결과 배열을 돌려준다.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
