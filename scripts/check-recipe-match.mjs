// 상품명 정규화·동의어 매칭 자체 점검. 실행: node scripts/check-recipe-match.mjs
// (Node 24는 .ts 타입을 그대로 벗겨서 읽는다)
import assert from 'node:assert/strict';
import { ingredientMatches, normalizeName } from '../src/lib/ingredient-match.ts';

const hit = (name, keyword) => ingredientMatches(normalizeName(name), keyword);

// 정규화: 용량·괄호·수식어·공백이 붙어도 재료가 남아야 한다
assert.equal(normalizeName('국내산 냉동 삼겹살 500g (행사)'), '삼겹살');
assert.equal(normalizeName('무항생제 특란 30개'), '특란');
assert.equal(normalizeName('서울우유 1L'), '서울우유');

// 예전에 놓치던 표기들
assert.ok(hit('국내산 냉동 삼겹살 500g', '돼지'), '삼겹살 → 돼지');
assert.ok(hit('무항생제 특란 30개', '계란'), '특란 → 계란');
assert.ok(hit('소불고기용 500g', '소고기'), '소불고기 → 소고기');
assert.ok(hit('오뚜기 커리 분말', '카레'), '커리 → 카레');
assert.ok(hit('팽이 2봉', '버섯'), '팽이 → 버섯');
assert.ok(hit('그릭 플레인', '요거트'), '그릭 → 요거트');
assert.ok(hit('냉동 교자 1kg', '만두'), '교자 → 만두');
assert.ok(hit('손질 코다리 2마리', '생선'), '코다리 → 생선');

// 오탐 방지
assert.ok(!hit('무항생제 계란', '무'), '무항생제는 무가 아니다');
assert.ok(!hit('무염버터', '무'), '무염버터는 무가 아니다');
assert.ok(!hit('포기김치 3kg', '김밥김'), '김치는 김밥김이 아니다');
assert.ok(!hit('떡갈비', '떡볶이떡'), '떡갈비는 떡볶이떡이 아니다');
assert.ok(!hit('두유 1L', '우유'), '두유는 우유가 아니다');

console.log('OK: 재료 매칭 점검 통과');
