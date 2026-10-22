// npx tsx src/lib/tile-color.selfcheck.ts
import assert from 'node:assert/strict';
import { autoTileColor, splitTileName, tileColor } from './tile-color';

assert.deepEqual(splitTileName('누가바 피넛버터'), ['누가바', '피넛버터']);
assert.deepEqual(splitTileName('옥동자'), ['옥동자', '']);
assert.deepEqual(splitTileName(' 메로나  코코넛 '), ['메로나', '코코넛']);

const hex = /^#[0-9A-F]{6}$/;
for (const n of ['메로나', '비비빅', '옥동자', '누가바 피스타치오', '설레임 밀크', '']) assert.match(autoTileColor(n).bg, hex);

// 같은 상품은 늘 같은 색
assert.deepEqual(autoTileColor('누가바'), autoTileColor('누가바'));
// 맛 키워드가 맛 부분에서 먼저 잡힌다: 피스타치오 → 초록 계열, 피넛버터 → 갈색 계열(서로 다른 색)
const green = autoTileColor('누가바 피스타치오').bg;
const brown = autoTileColor('누가바 피넛버터').bg;
assert.notEqual(green, brown);
assert.ok(parseInt(green.slice(3, 5), 16) > parseInt(green.slice(1, 3), 16), '피스타치오는 초록이 더 강해야 함');
// 밝은 배경엔 검은 글씨, 어두운 배경엔 흰 글씨
assert.equal(autoTileColor('설레임 밀크').fg, '#1A1A1A');
assert.equal(autoTileColor('초코퍼지').fg, '#FFFFFF');
// 직접 고른 색이 우선, 잘못된 값이면 자동 색
assert.equal(tileColor('메로나', '#2E8BD8').bg, '#2E8BD8');
assert.deepEqual(tileColor('메로나', 'blue'), autoTileColor('메로나'));
assert.deepEqual(tileColor('메로나', null), autoTileColor('메로나'));

console.log('tile-color 자가검사 통과');
