import {
  addMonths,
  autoFormatDateByOrder,
  expiryFromManufacture,
  isoToOrderedInput,
  orderedInputToIso,
} from './dates';

console.assert(expiryFromManufacture('2026-03-10', 12, 'month') === '2027-03-09', '제조일+12개월 → 하루 전');
console.assert(expiryFromManufacture('2026-03-10', 180, 'day') === '2026-09-05', '제조일+180일 → 하루 전');
console.assert(expiryFromManufacture('2026-03-1', 12, 'month') === null, '덜 입력한 제조일');
console.assert(expiryFromManufacture('2026-03-10', 0, 'month') === null, '기간 0');

console.assert(addMonths('2026-01-31', 1) === '2026-02-28', '말일 초과 클램프 실패');
console.assert(addMonths('2026-03-10', 6) === '2026-09-10', '일반 케이스 실패');
console.assert(addMonths('2026-11-30', 3) === '2027-02-28', '연도 경계 + 말일 클램프 실패');
console.assert(addMonths('2028-01-31', 1) === '2028-02-29', '윤년 2월 클램프 실패');

console.assert(autoFormatDateByOrder('10092026', 'dmy') === '10-09-2026', '일/월/년 서식');
console.assert(orderedInputToIso('10-09-2026', 'dmy') === '2026-09-10', '일/월/년 → 저장');
console.assert(orderedInputToIso('09-10-2026', 'mdy') === '2026-09-10', '월/일/년 → 저장');
console.assert(orderedInputToIso('31-02-2026', 'dmy') === null, '없는 날짜');
console.assert(orderedInputToIso('10-09-20', 'dmy') === null, '덜 입력');
console.assert(isoToOrderedInput('2026-09-10', 'mdy') === '09-10-2026', '저장 → 월/일/년');
console.assert(isoToOrderedInput('2026', 'dmy') === '', '연도만 미리 채운 값은 해외 순서에선 빈칸');

console.log('dates selfcheck OK');
