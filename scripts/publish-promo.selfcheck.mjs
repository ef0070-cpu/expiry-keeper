// node scripts/publish-promo.selfcheck.mjs — 게시 판단 로직 자가검사(네트워크·파일 없음)
import assert from 'node:assert/strict';
import { dueItems, validateItem } from './publish-promo.mjs';

const has = () => true;
const ig = { id: 'a', channel: 'instagram', at: '2026-11-02T21:00:00+09:00', text: '글 #a', images: ['images/a-1.jpg'] };
const now = Date.parse('2026-11-02T21:10:00+09:00');

// 검사
assert.deepEqual(validateItem(ig, has), []);
assert.match(validateItem({ ...ig, images: [] }, has).join(), /1장 이상/);
assert.match(validateItem({ ...ig, images: ['x.png'] }, has).join(), /JPEG/);
assert.match(validateItem(ig, () => false).join(), /파일 없음/);
assert.match(validateItem({ ...ig, text: '[촬영 필요: x]' }, has).join(), /자리 표시/);
assert.match(validateItem({ ...ig, slides: [{ text: 'x' }], images: [] }, has).join(), /카드 이미지 없음/);
assert.match(validateItem({ ...ig, channel: 'threads', text: 'ㄱ'.repeat(501), images: [] }, has).join(), /500자/);
assert.deepEqual(validateItem({ ...ig, channel: 'threads', images: [] }, has), []); // 스레드는 글만 가능
assert.match(validateItem({ ...ig, at: '11/2 밤' }, has).join(), /형식 오류/);

// 게시 시각 판단
assert.deepEqual(dueItems({ approved: false, items: [ig] }, {}, now), [], '승인 전엔 안 올림');
assert.deepEqual(dueItems({ approved: 'true', items: [ig] }, {}, now), [], '문자열 "true"는 승인 아님');
assert.deepEqual(dueItems({ approved: true, items: [ig] }, {}, now).map((i) => i.id), ['a']);
assert.deepEqual(dueItems({ approved: true, items: [ig] }, { a: { postedAt: 'x' } }, now), [], '이미 올린 건 다시 안 올림');
assert.deepEqual(dueItems({ approved: true, items: [ig] }, {}, Date.parse('2026-11-02T20:59:00+09:00')), [], '시각 전');
assert.deepEqual(dueItems({ approved: true, items: [ig] }, {}, Date.parse('2026-11-03T01:00:00+09:00')), [], '3시간 넘게 늦으면 안 올림');
assert.deepEqual(dueItems({ approved: true, items: [ig] }, { a: { lastError: 'x' } }, now).map((i) => i.id), ['a'], '실패한 건 다음 회차에 재시도');

console.log('publish-promo 자가검사 통과');
