import {
  dateOrderFromBarcode,
  extractDateCandidates,
  extractExpiryDateFromText,
  stableDate,
  textInRegion,
  viewRectToImage,
} from './date-ocr';

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

// 실시간 자동 인식: 사각형 안 글자만 본다 — 사진 전체를 읽으면 제조일·로트 숫자가 섞여 오인식
{
  // 미리보기 300x400(세로), 캡처 3000x4000 — 배율 0.1
  const r = viewRectToImage({ x: 50, y: 150, width: 200, height: 100 }, { width: 300, height: 400 }, { width: 3000, height: 4000 });
  console.assert(r.left === 500 && r.top === 1500 && r.right === 2500 && r.bottom === 2500, '화면→이미지 좌표 변환 실패');
  // 캡처가 가로로 누운 크기(4000x3000)로 와도 같은 결과
  const r2 = viewRectToImage({ x: 50, y: 150, width: 200, height: 100 }, { width: 300, height: 400 }, { width: 4000, height: 3000 });
  console.assert(r2.left === 500 && r2.bottom === 2500, '누운 이미지 크기 보정 실패');
  const lines = [
    { text: '제조일 2026.01.05', frame: { left: 600, top: 800, right: 2400, bottom: 900 } },
    { text: '2026.12.31 까지', frame: { left: 700, top: 1900, right: 2300, bottom: 2100 } },
    { text: 'LOT 2029.03.01', frame: { left: 600, top: 3500, right: 2400, bottom: 3600 } },
  ];
  console.assert(extractExpiryDateFromText(textInRegion(lines, r), 'ymd', REF) === '2026-12-31', '사각형 밖 숫자가 섞이면 안 됨');
}
// 확정 규칙: 최근 3번 중 2번 같은 날짜 — 흔들린 한 장(null)이 끼어도 확정, 서로 다르면 보류
{
  console.assert(stableDate(['2026-12-31', null, '2026-12-31']) === '2026-12-31', '사이에 못 읽은 장이 있어도 확정');
  console.assert(stableDate(['2026-12-31', '2026-12-30']) === null, '서로 다르면 확정 안 함');
  console.assert(stableDate(['2026-12-31']) === null, '한 번만 읽힌 건 확정 안 함');
  console.assert(
    stableDate(['2026-01-01', '2026-01-01', null, '2026-06-30', '2026-07-01']) === null,
    '오래된 결과(3번 전)는 세지 않음',
  );
}

console.assert(dateOrderFromBarcode('8801043014809')?.order === 'ymd', '한국 880');
console.assert(dateOrderFromBarcode('6901028075831')?.mfg === true, '중국 690 → 제조일+기간 안내');
console.assert(dateOrderFromBarcode('4006381333931')?.order === 'dmy', '독일 400');
console.assert(dateOrderFromBarcode('012345678905')?.order === 'mdy', 'UPC-A 12자리 → 미국');
console.assert(dateOrderFromBarcode('2001234567890') === null, '매장 내부 코드는 추천 없음');
console.assert(dateOrderFromBarcode(null) === null, '바코드 없음');

console.assert(extractDateCandidates('生产日期 20260310', 'ymd', REF)[0] === '2026-03-10', '붙은 8자리 날짜');
console.assert(extractDateCandidates('2026031014:22 B3', 'ymd', REF)[0] === '2026-03-10', '시간이 바로 붙은 날짜');
console.assert(extractDateCandidates('8801043014809', 'ymd', REF).length === 0, '바코드 숫자는 날짜 아님');
console.assert(extractDateCandidates('LOT 20260310123456', 'ymd', REF).length === 0, '긴 로트 번호는 날짜 아님');

console.log('date-ocr selfcheck OK');
