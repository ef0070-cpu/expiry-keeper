import { extractDateCandidates, extractExpiryDateFromText } from './date-ocr';

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
console.assert(
  extractExpiryDateFromText('2026.9.1', 'ymd', REF) === '2026-09-01',
  'TRIPLE_RE 한 자리 일(day) 놓치는 버그: 한 자리 숫자도 정확히 매칭되어야 함',
);

// 사진 인식 후보: 미래(늦은 순) → 지난 날짜(늦은 순), 중복 제거
console.assert(
  JSON.stringify(
    extractDateCandidates('제조 2025.12.01 유통 2026.06.30 LOT 2026.06.30 2025.10.01', 'ymd', REF),
  ) === JSON.stringify(['2026-06-30', '2025-12-01', '2025-10-01']),
  '후보 순서/중복 제거 실패',
);
// 기한 지난 상품: 지난 날짜만 있어도 후보로 나와야 함(기존 추출은 null)
console.assert(
  extractDateCandidates('2025.10.01 14:9 CF1 A', 'ymd', REF)[0] === '2025-10-01',
  '지난 날짜 후보 누락',
);
console.assert(extractDateCandidates('숫자 없음', 'ymd', REF).length === 0, '후보 없으면 빈 배열');

// 성분표·용량 숫자가 날짜로 잡히면 안 된다(더 긴 숫자의 일부, 3자리 연도, 터무니없는 연도)
{
  const R2 = '2026-09-29';
  const none = (t: string) => extractDateCandidates(t, 'ymd', R2).length === 0;
  console.assert(none('나트륨 120.5mg'), "'120.5'가 2120년 5월로 잡힘");
  console.assert(none('12345.6'), "'12345.6'의 일부가 날짜로 잡힘");
  console.assert(none('2120.05'), '10년 넘게 뒤의 연도는 빼야 함');
  // 정상 날짜는 그대로
  console.assert(extractDateCandidates('26.12.31', 'ymd', R2)[0] === '2026-12-31', '2자리 연도 실패');
  console.assert(extractDateCandidates('5.9.2026', 'dmy', R2)[0] === '2026-09-05', '한 자리 일-월-연 실패');
  console.assert(extractDateCandidates('31.12.2026', 'dmy', R2)[0] === '2026-12-31', '일-월-연 실패');
}

console.log('date-ocr selfcheck OK');
