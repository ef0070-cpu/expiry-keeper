// 빠른발주 냉동고 배치 계산(2026-10-22): 상품별 칸 크기(1칸/2칸/줄), 빈칸, 줄 채우기, 끼워 넣기.
// IO 없는 순수 함수(자가검사: npx tsx src/lib/fridge-layout.selfcheck.ts).

/** 카드가 차지하는 칸: 1칸, 2칸, 줄 전체 */
export type TileSpan = 1 | 2 | 'full';
export type FridgeColumns = 2 | 3 | 4;
export type FridgeBackground = 'chest' | 'case' | 'none';

export const DEFAULT_COLUMNS: FridgeColumns = 3;

/** 진열대의 빈 자리. 상품 대신 이 id로 배치 목록에 들어간다 */
const SPACER_PREFIX = 'spacer:';
export const isSpacerId = (id: string) => id.startsWith(SPACER_PREFIX);
export const newSpacerId = () => SPACER_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** 이 열 수에서 실제로 차지하는 칸 수(2칸이어도 2열이면 줄 전체와 같다) */
export function spanWidth(span: TileSpan | undefined, cols: number): number {
  if (span === 'full') return cols;
  return Math.min(span ?? 1, cols);
}

export function normalizeColumns(v: unknown): FridgeColumns {
  return v === 2 || v === 3 || v === 4 ? v : DEFAULT_COLUMNS;
}

export function normalizeSpan(v: unknown): TileSpan {
  return v === 2 || v === 'full' ? v : 1;
}

/** 진열 순서대로 줄을 채운다. 남은 칸이 모자라면 다음 줄로(순서는 절대 바꾸지 않는다). 결과는 줄마다 [위치, 칸 수] 목록 */
export function packRows(spans: (TileSpan | undefined)[], cols: number): { index: number; width: number }[][] {
  const rows: { index: number; width: number }[][] = [];
  let row: { index: number; width: number }[] = [];
  let used = 0;
  spans.forEach((span, index) => {
    const width = spanWidth(span, cols);
    if (used + width > cols && row.length) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ index, width });
    used += width;
  });
  if (row.length) rows.push(row);
  return rows;
}

/** from 위치의 항목을 빼서 to 위치(빼기 전 기준 목록에서 "이 항목 앞")에 끼워 넣는다 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  const at = Math.max(0, Math.min(next.length, to > from ? to - 1 : to));
  next.splice(at, 0, it);
  return next;
}

export type TileRect = { index: number; x: number; y: number; w: number; h: number };

/**
 * 줄 채우기 결과를 화면 좌표로 바꾼다(끌기 중 손가락 위치 → 놓을 자리 계산용).
 * 계산값으로 위치를 구해 기기마다 측정 오차가 생기지 않게 한다.
 */
export function layoutRects(
  rows: { index: number; width: number }[][],
  opts: { cols: number; width: number; gap: number; tileHeight: number; rowGap: (rowIdx: number) => number },
): TileRect[] {
  const cell = (opts.width - opts.gap * (opts.cols - 1)) / opts.cols;
  const rects: TileRect[] = [];
  let y = 0;
  rows.forEach((row, r) => {
    if (r > 0) y += opts.rowGap(r - 1);
    let x = 0;
    for (const { index, width } of row) {
      const w = cell * width + opts.gap * (width - 1);
      rects.push({ index, x, y, w, h: opts.tileHeight });
      x += w + opts.gap;
    }
    y += opts.tileHeight;
  });
  return rects;
}

/** 손가락 위치(그리드 기준 좌표)에 놓으면 들어갈 자리. 카드 왼쪽 절반이면 그 앞, 오른쪽 절반이면 그 뒤. 카드 밖이면 null */
export function dropIndexAt(rects: TileRect[], x: number, y: number): number | null {
  const hit = rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (!hit) {
    // 마지막 줄 아래쪽에 놓으면 맨 뒤로
    const bottom = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);
    return rects.length && y > bottom ? rects.length : null;
  }
  return x > hit.x + hit.w / 2 ? hit.index + 1 : hit.index;
}
