// npx tsx src/lib/tile-art.selfcheck.ts
import assert from 'node:assert/strict';
import { tileArt, TILE_ART_CHOICES } from './tile-art';

assert.equal(tileArt('딸기 요거트 바 24입'), '🍓'); // 고유한 맛이 흔한 단어(요거트)보다 먼저
assert.equal(tileArt('초코 콘'), '🍫');
assert.equal(tileArt('메로나'), '🍈');
assert.equal(tileArt('투게더 바닐라 710ml'), '🥛');
assert.equal(tileArt('빙빙바 24입'), null); // 맛 단어가 없으면 그림 없음
assert.equal(tileArt(''), null);
assert.equal(tileArt('빙빙바', '🍇'), '🍇'); // 사장님이 고른 그림이 먼저
assert.equal(tileArt('딸기바', '🍇'), '🍇');
assert.equal(tileArt('빙빙바', '👽'), null); // 목록에 없는 값은 무시
assert.ok(TILE_ART_CHOICES.length > 10);

console.log('tile-art 자가검사 통과');
