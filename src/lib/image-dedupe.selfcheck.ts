import { contentKey, uniqueByKey } from './image-dedupe';

const a = new Uint8Array([1, 2, 3, 4]);
const sameAsA = new Uint8Array([1, 2, 3, 4]);
const b = new Uint8Array([1, 2, 3, 5]);
console.assert(contentKey(a) === contentKey(sameAsA), '같은 내용은 같은 지문');
console.assert(contentKey(a) !== contentKey(b), '다른 내용은 다른 지문');

// 주소는 달라도 내용이 같으면 첫 번째만, 못 받은 사진(null)은 뺀다 — 순서 유지
const items = ['u1', 'u2(같은 사진)', 'u3(깨진 주소)', 'u4'];
const keys = [contentKey(a), contentKey(sameAsA), null, contentKey(b)];
console.assert(JSON.stringify(uniqueByKey(items, keys)) === JSON.stringify(['u1', 'u4']), '중복·빈 사진 정리 실패');

console.log('image-dedupe selfcheck OK');
