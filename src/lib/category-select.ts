/**
 * 홈 구역(매장) 칩 선택 규칙.
 * 기본(단일): 누른 칩 하나만 선택되고 다른 칩은 자동으로 꺼진다. 켜진 칩을 다시 누르면 '전체'(선택 없음).
 * 여러 개(multi): 누른 칩을 켜고 끈다 — 비교할 때만 쓴다.
 */
export function nextCategorySelection(prev: ReadonlySet<string>, c: string, multi: boolean): Set<string> {
  if (multi) {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    return next;
  }
  return prev.size === 1 && prev.has(c) ? new Set() : new Set([c]);
}
