// npx tsx src/lib/fridge-layout.selfcheck.ts
import assert from 'node:assert/strict';
import { dropIndexAt, isSpacerId, layoutRects, moveItem, newSpacerId, normalizeColumns, normalizeSpan, packRows, spanWidth } from './fridge-layout';

const widths = (rows: { index: number; width: number }[][]) => rows.map((r) => r.map((c) => `${c.index}:${c.width}`).join(' '));

// 칸 수
assert.equal(spanWidth(undefined, 3), 1);
assert.equal(spanWidth(2, 3), 2);
assert.equal(spanWidth(2, 2), 2);
assert.equal(spanWidth('full', 4), 4);

// 3열: 메로나(2칸) + 1칸 → 한 줄, 다음부터 새 줄
assert.deepEqual(widths(packRows([2, 1, 1, 1, 1], 3)), ['0:2 1:1', '2:1 3:1 4:1']);
// 2칸 다음에 2칸은 안 들어가 다음 줄로(순서 유지, 빈 자리는 남김)
assert.deepEqual(widths(packRows([1, 2, 2], 3)), ['0:1 1:2', '2:2']);
assert.deepEqual(widths(packRows([1, 1, 2], 3)), ['0:1 1:1', '2:2']);
// 줄 전체
assert.deepEqual(widths(packRows([1, 'full', 1], 3)), ['0:1', '1:3', '2:1']);
// 열 수가 줄면 2칸이 줄 전체가 된다
assert.deepEqual(widths(packRows([2, 1], 2)), ['0:2', '1:1']);
assert.deepEqual(packRows([], 3), []);

// 끼워 넣기: "to 앞"에 넣는다
assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'a', 'd']);
assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 1, 4), ['a', 'c', 'd', 'b']);
assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 2), ['a', 'b', 'c']);

// 좌표 → 놓을 자리
const rows = packRows([2, 1, 1, 1, 1], 3);
const rects = layoutRects(rows, { cols: 3, width: 320, gap: 10, tileHeight: 120, rowGap: () => 20 });
assert.equal(rects.length, 5);
assert.equal(Math.round(rects[0].w), 210); // 2칸 = 100*2 + 간격 10
assert.equal(rects[2].y, 140); // 둘째 줄 = 120 + 줄 간격 20
assert.equal(dropIndexAt(rects, 20, 50), 0); // 첫 카드 왼쪽 → 그 앞
assert.equal(dropIndexAt(rects, 200, 50), 1); // 첫 카드(2칸) 오른쪽 → 그 뒤
assert.equal(dropIndexAt(rects, 300, 200), 5); // 마지막 카드 오른쪽 → 맨 뒤
assert.equal(dropIndexAt(rects, 300, 500), 5); // 맨 아래 바깥 → 맨 뒤
assert.equal(dropIndexAt(rects, 105, 130), null); // 줄 사이 틈

// 빈칸·저장값 정리
const sp = newSpacerId();
assert.ok(isSpacerId(sp) && !isSpacerId('abc'));
assert.equal(normalizeColumns(5), 3);
assert.equal(normalizeColumns(2), 2);
assert.equal(normalizeSpan('2'), 1);
assert.equal(normalizeSpan('full'), 'full');

console.log('fridge-layout 자가검사 통과');
