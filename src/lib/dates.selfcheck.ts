import { addMonths } from './dates';

console.assert(addMonths('2026-01-31', 1) === '2026-02-28', '말일 초과 클램프 실패');
console.assert(addMonths('2026-03-10', 6) === '2026-09-10', '일반 케이스 실패');
console.assert(addMonths('2026-11-30', 3) === '2027-02-28', '연도 경계 + 말일 클램프 실패');
console.assert(addMonths('2028-01-31', 1) === '2028-02-29', '윤년 2월 클램프 실패');

console.log('dates selfcheck OK');
