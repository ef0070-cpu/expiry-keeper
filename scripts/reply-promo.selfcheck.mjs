// node scripts/reply-promo.selfcheck.mjs — 댓글 분류 규칙이 깨지지 않았는지 확인(API 호출 없음)
import assert from 'node:assert/strict';
import { classify } from './reply-promo.mjs';

const kind = (t) => classify(t)?.kind ?? null;

assert.equal(kind('가격이 얼마예요?'), 'price');
assert.equal(kind('무료인가요'), 'price');
assert.equal(kind('이런 기능 추가해 주세요'), 'request');
assert.equal(kind('오류가 나요'), 'request');
assert.equal(kind('좋은 앱 감사합니다'), 'thanks');

// 답하지 않아야 하는 것
assert.equal(kind('ㅋㅋㅋ'), null);
assert.equal(kind(''), null);
assert.equal(kind('가격 궁금해요 https://spam.example'), null);
assert.equal(kind('환불은 어떻게 하나요'), null);
assert.equal(kind('쿠팡이랑 비교하면 어때요'), null);
assert.equal(kind('가'.repeat(301)), null);

// 가격 답변에는 금액·무료 여부가 없어야 한다
const price = classify('가격이 얼마예요?').reply;
assert.ok(!/\d|무료|원/.test(price), price);

console.log('reply-promo 자가검사 통과');
