import { nextCategorySelection } from './category-select';

const S = (...a: string[]) => new Set(a);
const same = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((v) => y.has(v));

// 단일(기본)
console.assert(same(nextCategorySelection(S(), '남양동', false), S('남양동')), '단일: 선택 없음 → 누른 칩만');
console.assert(same(nextCategorySelection(S('남양동'), '대방동', false), S('대방동')), '단일: 다른 칩을 누르면 바뀜(남양동 자동 해제)');
console.assert(same(nextCategorySelection(S('남양동'), '남양동', false), S()), '단일: 켜진 칩을 다시 누르면 전체');
console.assert(same(nextCategorySelection(S('남양동', '대방동'), '사파동', false), S('사파동')), '단일: 여러 개가 남아 있어도 하나만');
console.assert(same(nextCategorySelection(S('남양동', '대방동'), '남양동', false), S('남양동')), '단일: 둘 켜진 상태에서 하나를 누르면 그 하나만');

// 여러 개
console.assert(same(nextCategorySelection(S('남양동'), '대방동', true), S('남양동', '대방동')), '여러 개: 추가');
console.assert(same(nextCategorySelection(S('남양동', '대방동'), '남양동', true), S('대방동')), '여러 개: 끄기');
console.assert(same(nextCategorySelection(S('남양동'), '남양동', true), S()), '여러 개: 마지막 하나를 끄면 전체');

// 원본을 바꾸지 않는다
const orig = S('남양동');
nextCategorySelection(orig, '대방동', true);
nextCategorySelection(orig, '대방동', false);
console.assert(same(orig, S('남양동')), '입력 집합을 변경하지 않음');

console.log('category-select selfcheck OK');
