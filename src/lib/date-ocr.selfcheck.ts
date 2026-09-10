import { extractExpiryDateFromText } from './date-ocr';

const REF = '2026-01-01'; // 오늘 날짜에 결과가 좌우되지 않도록 고정한 기준일

console.assert(
  extractExpiryDateFromText('유통기한 2026.09.10까지', 'ymd', REF) === '2026-09-10',
  '연도 4자리 앞(년-월-일) 실패',
);
console.assert(
  extractExpiryDateFromText('EXP 25.09.2026', 'ymd', REF) === '2026-09-25',
  '연도 4자리 뒤 + 25는 월이 될 수 없어 구조적으로 일-월 확정되는 케이스 실패',
);
console.assert(
  extractExpiryDateFromText('09.10.2026', 'mdy', REF) === '2026-09-10',
  '연도 4자리 뒤 + 09·10 둘 다 월/일 가능해 설정값(mdy)으로 판단하는 케이스 실패',
);
console.assert(
  extractExpiryDateFromText('제조 2025.06.01 유통기한 2026.09.10', 'ymd', REF) === '2026-09-10',
  '여러 후보 중 기준일 이후 가장 늦은 날짜 채택 실패',
);
console.assert(
  extractExpiryDateFromText('26.09.10', 'ymd', REF) === '2026-09-10',
  '2자리 연도끼리 애매한 경우 + ymd 설정 실패',
);
console.assert(
  extractExpiryDateFromText('10.09.26', 'dmy', REF) === '2026-09-10',
  '2자리 연도끼리 애매한 경우 + dmy 설정 실패',
);
console.assert(
  extractExpiryDateFromText('2026.09', 'ymd', REF) === '2026-09-30',
  '년/월만 있는 경우 해당 월 마지막 날 채택 실패',
);
console.assert(
  extractExpiryDateFromText('맛있는 초코과자 120g', 'ymd', REF) === null,
  '날짜 없는 텍스트에서 null 반환 실패',
);
console.assert(
  extractExpiryDateFromText('2026.13.32', 'ymd', REF) === null,
  'PAIR_RE 잘못된 부분매칭 버그: 잘못된 3묶음 입력이 spurious 2묶음 결과를 생산하지 않아야 함',
);

console.log('date-ocr selfcheck OK');
