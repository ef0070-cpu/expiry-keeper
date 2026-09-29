import { checkCsvBarcode, parseCsvLines } from './csv-import';
import { OrderProduct } from './order-types';

export interface ParsedOrderProductRow {
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  aliases: string[];
  /** 내려받은 엑셀의 ID 칸 — 있으면 그 상품을 수정, 없으면 새 상품 */
  id: string | null;
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
  return parseOrderProductRows(parseCsvLines(text));
}

/** 행 목록(CSV 또는 엑셀에서 읽은 것)을 검증한다. 첫 행은 머리글. */
export function parseOrderProductRows(lines: string[][]): ParsedOrderProductCsvResult {
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
  // 머리글이 'ID' 또는 'ID(수정 금지)' 등
  const idIdx = header.findIndex((h) => h.startsWith('ID'));

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
    const barcodeCheck = checkCsvBarcode(barcodeRaw);
    if ('error' in barcodeCheck) {
      errors.push({ line, reason: barcodeCheck.error });
      continue;
    }

    rows.push({
      name,
      brand,
      price,
      category,
      barcode: barcodeCheck.barcode,
      aliases: aliasesRaw
        ? aliasesRaw.split(';').map((a) => a.trim()).filter((a) => a.length > 0)
        : [],
      id: (idIdx === -1 ? '' : (cols[idIdx] ?? '')).trim() || null,
    });
  }

  return { rows, errors };
}

/** 엑셀로 내려받기/올리기에 쓰는 머리글. ID는 기존 상품을 찾는 열쇠라 고치면 안 된다. */
export const ORDER_SHEET_HEADER = ['상품명', '브랜드', '가격', '카테고리', '바코드', '별칭', 'ID(수정 금지)'];

/** 기존 발주 상품을 엑셀 행으로(머리글 제외). */
export function orderProductsToSheetRows(products: OrderProduct[]): (string | number)[][] {
  return products.map((p) => [
    p.name,
    p.brand,
    p.price,
    p.category,
    p.barcode ?? '',
    (p.aliases ?? []).join(';'),
    p.id,
  ]);
}

/** 올린 행을 기존 상품과 맞춘다 — ID가 같으면(없으면 바코드가 같으면) 그 상품의 엑셀 칸만 바꾸고
 * 사진·납품상태 등 엑셀에 없는 값은 그대로 둔다. 못 찾으면 새 상품. */
export function planOrderImport(
  rows: ParsedOrderProductRow[],
  existing: OrderProduct[],
  newId: () => string,
): { product: OrderProduct; isNew: boolean }[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  return rows.map((row) => {
    const match = (row.id && byId.get(row.id)) || (row.barcode && byBarcode.get(row.barcode)) || null;
    const fields = {
      name: row.name,
      brand: row.brand,
      price: row.price,
      category: row.category,
      barcode: row.barcode,
      aliases: row.aliases,
    };
    if (match) return { product: { ...match, ...fields }, isNew: false };
    return {
      product: { id: newId(), imageUri: null, status: 'active', ...fields },
      isNew: true,
    };
  });
}
