import * as XLSX from 'xlsx';
import { parseOrderProductRows } from './order-csv-import';
import { buildTemplateXlsx, readSpreadsheetRows } from './xlsx-io';

const b64ToBytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

// 템플릿: 바코드 칸이 텍스트(@) 형식이어야 엑셀이 지수로 바꾸지 않는다
{
  const b64 = buildTemplateXlsx(['상품명', '바코드'], [['메로나', '8801234567890']], ['바코드']);
  const ws = XLSX.read(b64ToBytes(b64), { type: 'array', cellNF: true }).Sheets['상품'];
  console.assert(ws['B2'].z === '@' && ws['B500'].z === '@', '바코드 칸이 텍스트 형식이 아님');
  console.assert(ws['A2'].z !== '@', '다른 칸은 그대로');
  const rows = readSpreadsheetRows(b64ToBytes(b64));
  console.assert(rows.length === 2 && rows[1][1] === '8801234567890', '템플릿 예시 행 읽기 실패: ' + JSON.stringify(rows));
}

// 사용자가 텍스트 형식을 안 지켜 바코드가 숫자 셀·날짜가 날짜 셀로 들어가도 xlsx에는 전체 자리가 있다
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['상품명', '바코드', '유통기한'],
    ['메로나', 8801062518142, new Date(2026, 11, 31)],
    ['', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const rows = readSpreadsheetRows(bytes);
  console.assert(rows.length === 2, '빈 행은 건너뜀');
  console.assert(rows[1][1] === '8801062518142', '숫자 바코드 전체 자리 유지 실패: ' + rows[1][1]);
  console.assert(rows[1][2] === '2026-12-31', '날짜 셀 YYYY-MM-DD 변환 실패: ' + rows[1][2]);
  console.assert(parseOrderProductRows(rows).rows[0].barcode === '8801062518142', '파서까지 연결');
}

console.log('xlsx-io selfcheck OK');
