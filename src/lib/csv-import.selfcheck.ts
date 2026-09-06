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

console.log('csv-import selfcheck OK');
