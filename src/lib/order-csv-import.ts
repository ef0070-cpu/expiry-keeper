import { parseCsvLines } from './csv-import';

export interface ParsedOrderProductRow {
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  aliases: string[];
}

export interface RowError {
  line: number;
  reason: string;
}

export interface ParsedOrderProductCsvResult {
  rows: ParsedOrderProductRow[];
  errors: RowError[];
}

/** 발주 상품 전용 CSV 파서. 줄 분리/따옴표 처리는 csv-import.ts의 범용 parseCsvLines를 그대로
 * 쓰고, 컬럼 정의·검증만 발주 상품(OrderProduct)에 맞게 별도로 둔다 — 유통기한 CSV(Product)와
 * 완전히 분리하기 위함. */
export function parseOrderProductCsv(text: string): ParsedOrderProductCsvResult {
  const lines = parseCsvLines(text);
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, reason: '파일이 비어있습니다' }] };
  }

  const header = lines[0].map((h) => h.trim());
  const nameIdx = header.indexOf('상품명');
  if (nameIdx === -1) {
    return { rows: [], errors: [{ line: 0, reason: '필수 컬럼(상품명)을 찾을 수 없습니다' }] };
  }
  const brandIdx = header.indexOf('브랜드');
  const priceIdx = header.indexOf('가격');
  const categoryIdx = header.indexOf('카테고리');
  const barcodeIdx = header.indexOf('바코드');
  const aliasesIdx = header.indexOf('별칭');

  const rows: ParsedOrderProductRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i];
    const line = i;
    const name = (cols[nameIdx] ?? '').trim();
    if (!name) {
      errors.push({ line, reason: '상품명이 비어있습니다' });
      continue;
    }
    const priceRaw = (priceIdx === -1 ? '' : (cols[priceIdx] ?? '')).trim();
    let price = 0;
    if (priceRaw !== '') {
      const parsed = Number(priceRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push({ line, reason: '가격은 0 이상 숫자여야 합니다' });
        continue;
      }
      price = parsed;
    }
    const brand = (brandIdx === -1 ? '' : (cols[brandIdx] ?? '')).trim();
    const category = (categoryIdx === -1 ? '' : (cols[categoryIdx] ?? '')).trim();
    const barcodeRaw = (barcodeIdx === -1 ? '' : (cols[barcodeIdx] ?? '')).trim();
    const aliasesRaw = (aliasesIdx === -1 ? '' : (cols[aliasesIdx] ?? '')).trim();

    rows.push({
      name,
      brand,
      price,
      category,
      barcode: barcodeRaw || null,
      aliases: aliasesRaw
        ? aliasesRaw.split(';').map((a) => a.trim()).filter((a) => a.length > 0)
        : [],
    });
  }

  return { rows, errors };
}
