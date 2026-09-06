import { parseCsvLines } from './csv-import';

console.assert(
  JSON.stringify(parseCsvLines('a,b,c\n1,2,3')) === JSON.stringify([['a', 'b', 'c'], ['1', '2', '3']]),
  '기본 콤마 분리 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('상품명,메모\n딸기,"콤마, 포함 메모"')) ===
    JSON.stringify([['상품명', '메모'], ['딸기', '콤마, 포함 메모']]),
  '따옴표 안 콤마 보존 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('a,b\n"이스케이프""따옴표""",c')) ===
    JSON.stringify([['a', 'b'], ['이스케이프"따옴표"', 'c']]),
  '이스케이프된 따옴표 처리 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('﻿a,b\n1,2')) === JSON.stringify([['a', 'b'], ['1', '2']]),
  'BOM 제거 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('a,b\r\n1,2\r\n')) === JSON.stringify([['a', 'b'], ['1', '2']]),
  'CRLF 처리 및 끝 빈 줄 제거 실패',
);

import { parseProductCsv } from './csv-import';

// parseProductCsv - 정상 케이스
{
  const csv =
    '상품명,유통기한,바코드,수량,카테고리,메모\n딸기우유,2026-12-31,8801234567890,3,편의점;마트,메모입니다';
  const result = parseProductCsv(csv);
  console.assert(result.errors.length === 0, '정상 행에서 오류 발생하면 안 됨');
  console.assert(result.rows.length === 1, '정상 행 1개 파싱돼야 함');
  const row = result.rows[0];
  console.assert(row.name === '딸기우유', '상품명 파싱 실패');
  console.assert(row.expiryDate === '2026-12-31', '유통기한 파싱 실패');
  console.assert(row.barcode === '8801234567890', '바코드 파싱 실패');
  console.assert(row.quantity === 3, '수량 파싱 실패');
  console.assert(
    JSON.stringify(row.categories) === JSON.stringify(['편의점', '마트']),
    '카테고리 세미콜론 분리 실패',
  );
  console.assert(row.memo === '메모입니다', '메모 파싱 실패');
}

// 상품명 빈 문자열 -> 오류
{
  const result = parseProductCsv('상품명,유통기한\n,2026-12-31');
  console.assert(result.rows.length === 0, '빈 상품명 행은 저장되면 안 됨');
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('상품명'),
    '상품명 빈 오류 메시지 확인 실패',
  );
}

// 유통기한 형식 오류
{
  const result = parseProductCsv('상품명,유통기한\n딸기우유,2026/12/31');
  console.assert(result.rows.length === 0, '잘못된 날짜 행은 저장되면 안 됨');
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('유통기한'),
    '유통기한 형식 오류 메시지 확인 실패',
  );
}

// 수량 비움 -> 기본값 1
{
  const result = parseProductCsv('상품명,유통기한,수량\n딸기우유,2026-12-31,');
  console.assert(result.rows.length === 1 && result.rows[0].quantity === 1, '수량 비면 기본값 1이어야 함');
}

// 수량 오류 케이스
for (const bad of ['0', '-1', 'abc']) {
  const result = parseProductCsv(`상품명,유통기한,수량\n딸기우유,2026-12-31,${bad}`);
  console.assert(result.rows.length === 0, `수량 ${bad}은 오류여야 함`);
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('수량'),
    `수량 ${bad} 오류 메시지 확인 실패`,
  );
}

// 필수 헤더 없음
{
  const result = parseProductCsv('이름,날짜\n딸기우유,2026-12-31');
  console.assert(result.rows.length === 0 && result.errors.length === 1, '필수 컬럼 없으면 오류 1건만 반환');
  console.assert(result.errors[0].line === 0, '헤더 오류는 line 0');
}

// 여러 행 중 일부만 오류 -> 나머지는 정상 처리
{
  const csv = ['상품명,유통기한', '딸기우유,2026-12-31', ',2026-12-31', '초코파이,2026-11-01'].join('\n');
  const result = parseProductCsv(csv);
  console.assert(result.rows.length === 2, '오류 행 제외하고 정상 행 2개 파싱돼야 함');
  console.assert(result.errors.length === 1 && result.errors[0].line === 2, '2번째 데이터 행이 오류로 잡혀야 함');
}

console.log('csv-import selfcheck OK');
