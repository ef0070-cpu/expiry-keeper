import { parseOrderProductCsv } from './order-csv-import';

// 정상 케이스
{
  const csv = '상품명,브랜드,가격,카테고리,바코드,별칭\n메로나,빙그레,1000,바,8801234567890,메론바;멜론바';
  const result = parseOrderProductCsv(csv);
  console.assert(result.errors.length === 0, '정상 행에서 오류 발생하면 안 됨');
  console.assert(result.rows.length === 1, '정상 행 1개 파싱돼야 함');
  const row = result.rows[0];
  console.assert(row.name === '메로나', '상품명 파싱 실패');
  console.assert(row.brand === '빙그레', '브랜드 파싱 실패');
  console.assert(row.price === 1000, '가격 파싱 실패');
  console.assert(row.category === '바', '카테고리 파싱 실패');
  console.assert(row.barcode === '8801234567890', '바코드 파싱 실패');
  console.assert(
    JSON.stringify(row.aliases) === JSON.stringify(['메론바', '멜론바']),
    '별칭 세미콜론 분리 실패',
  );
}

// 상품명 빈 문자열 -> 오류
{
  const result = parseOrderProductCsv('상품명,가격\n,1000');
  console.assert(result.rows.length === 0, '빈 상품명 행은 저장되면 안 됨');
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('상품명'),
    '상품명 빈 오류 메시지 확인 실패',
  );
}

// 가격 오류 케이스(음수/숫자 아님) -> 오류, 가격 비움 -> 기본값 0
{
  for (const bad of ['-1', 'abc']) {
    const result = parseOrderProductCsv(`상품명,가격\n메로나,${bad}`);
    console.assert(result.rows.length === 0, `가격 ${bad}은 오류여야 함`);
    console.assert(
      result.errors.length === 1 && result.errors[0].reason.includes('가격'),
      `가격 ${bad} 오류 메시지 확인 실패`,
    );
  }
  const result = parseOrderProductCsv('상품명,가격\n메로나,');
  console.assert(result.rows.length === 1 && result.rows[0].price === 0, '가격 비면 기본값 0이어야 함');
}

// 필수 헤더 없음
{
  const result = parseOrderProductCsv('이름,금액\n메로나,1000');
  console.assert(result.rows.length === 0 && result.errors.length === 1, '필수 컬럼 없으면 오류 1건만 반환');
  console.assert(result.errors[0].line === 0, '헤더 오류는 line 0');
}

// 선택 컬럼이 아예 없어도(상품명만 있어도) 정상 처리
{
  const result = parseOrderProductCsv('상품명\n메로나');
  console.assert(result.errors.length === 0 && result.rows.length === 1, '상품명만 있어도 정상 파싱돼야 함');
  const row = result.rows[0];
  console.assert(
    row.brand === '' && row.category === '' && row.barcode === null && row.aliases.length === 0,
    '선택 컬럼 없을 때 기본값 확인 실패',
  );
}

// 여러 행 중 일부만 오류 -> 나머지는 정상 처리
{
  const csv = ['상품명,가격', '메로나,1000', ',1000', '비비빅,500'].join('\n');
  const result = parseOrderProductCsv(csv);
  console.assert(result.rows.length === 2, '오류 행 제외하고 정상 행 2개 파싱돼야 함');
  console.assert(result.errors.length === 1 && result.errors[0].line === 2, '2번째 데이터 행이 오류로 잡혀야 함');
}

console.log('order-csv-import selfcheck OK');
