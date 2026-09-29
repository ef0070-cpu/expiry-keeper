import * as XLSX from 'xlsx';

// 엑셀 템플릿 만들기·읽기. CSV는 엑셀이 13자리 바코드를 8.80908E+12로 바꿔 저장해 뒷자리가
// 사라지므로, 바코드(와 날짜) 칸을 미리 '텍스트' 형식으로 지정한 .xlsx 템플릿을 준다.

/** 데이터 아래로 텍스트 형식을 미리 걸어 둘 빈 행 수 — 사용자가 이 범위에 입력하면 숫자로 바뀌지 않는다.
 * ponytail: 1000행 넘게 입력하면 그 아래는 기본(숫자) 형식 — 부족하면 늘린다 */
const TEXT_ROWS = 1000;

/** header 첫 행 + rows(예시 또는 기존 상품) + 빈 행들. textColumns에 든 열은 데이터 끝에서
 * TEXT_ROWS행 더까지 텍스트(@) 형식. 결과는 base64. */
export function buildTemplateXlsx(
  header: string[],
  rows: (string | number)[][],
  textColumns: string[],
): string {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const lastRow = rows.length + TEXT_ROWS;
  for (const colName of textColumns) {
    const c = header.indexOf(colName);
    if (c === -1) continue;
    for (let r = 1; r <= lastRow; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const v = ws[addr]?.v;
      ws[addr] = { t: 's', v: v == null ? '' : String(v), z: '@' };
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: header.length - 1 } });
  ws['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length * 2 + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '상품');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 셀 값을 CSV와 같은 문자열로. 숫자 바코드는 xlsx 안에 전체 자리가 남아 있어 그대로 문자열로,
 * 날짜 셀은 YYYY-MM-DD로 바꾼다. */
function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

/** 첫 시트를 CSV 파서와 같은 string[][]로 읽는다(빈 행은 건너뜀). */
export function readSpreadsheetRows(data: Uint8Array): string[][] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  return rows
    .map((r) => r.map(cellText))
    .filter((r) => r.some((c) => c.trim() !== ''));
}
