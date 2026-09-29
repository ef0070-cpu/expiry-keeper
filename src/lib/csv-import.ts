export function parseCsvLines(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return clean
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

import { isValidDateStr } from './dates';

export interface ParsedProductRow {
  name: string;
  expiryDate: string;
  barcode: string | null;
  quantity: number;
  categories: string[];
  memo: string | null;
}

export interface RowError {
  line: number;
  reason: string;
}

export interface ParsedCsvResult {
  rows: ParsedProductRow[];
  errors: RowError[];
}

export function parseProductCsv(text: string): ParsedCsvResult {
  return parseProductRows(parseCsvLines(text));
}

/** 행 목록(CSV 또는 엑셀에서 읽은 것)을 검증한다. 첫 행은 머리글. */
export function parseProductRows(lines: string[][]): ParsedCsvResult {
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, reason: '파일이 비어있습니다' }] };
  }

  const header = lines[0].map((h) => h.trim());
  const nameIdx = header.indexOf('상품명');
  const expiryIdx = header.indexOf('유통기한');
  if (nameIdx === -1 || expiryIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 0, reason: '필수 컬럼(상품명/유통기한)을 찾을 수 없습니다' }],
    };
  }
  const barcodeIdx = header.indexOf('바코드');
  const quantityIdx = header.indexOf('수량');
  const categoriesIdx = header.indexOf('카테고리');
  const memoIdx = header.indexOf('메모');

  const rows: ParsedProductRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i];
    const line = i;
    const name = (cols[nameIdx] ?? '').trim();
    if (!name) {
      errors.push({ line, reason: '상품명이 비어있습니다' });
      continue;
    }
    const expiryDate = (cols[expiryIdx] ?? '').trim();
    if (!isValidDateStr(expiryDate)) {
      errors.push({ line, reason: '유통기한 형식이 올바르지 않습니다' });
      continue;
    }
    const quantityRaw = (quantityIdx === -1 ? '' : (cols[quantityIdx] ?? '')).trim();
    let quantity = 1;
    if (quantityRaw !== '') {
      const parsed = Number(quantityRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        errors.push({ line, reason: '수량은 1 이상 숫자여야 합니다' });
        continue;
      }
      quantity = parsed;
    }
    const barcodeRaw = (barcodeIdx === -1 ? '' : (cols[barcodeIdx] ?? '')).trim();
    const categoriesRaw = (categoriesIdx === -1 ? '' : (cols[categoriesIdx] ?? '')).trim();
    const memoRaw = (memoIdx === -1 ? '' : (cols[memoIdx] ?? '')).trim();
    const barcodeCheck = checkCsvBarcode(barcodeRaw);
    if ('error' in barcodeCheck) {
      errors.push({ line, reason: barcodeCheck.error });
      continue;
    }

    rows.push({
      name,
      expiryDate,
      barcode: barcodeCheck.barcode,
      quantity,
      categories: categoriesRaw
        ? categoriesRaw.split(';').map((c) => c.trim()).filter((c) => c.length > 0)
        : [],
      memo: memoRaw || null,
    });
  }

  return { rows, errors };
}

/** CSV 바코드 칸 검사(유통기한·발주 가져오기 공용). 비어 있으면 null, 이상하면 사유 문자열.
 * 엑셀은 13자리 바코드를 숫자로 보고 8.80908E+12 같은 지수로 바꿔 저장해 뒷자리가 사라진다 —
 * 그대로 받으면 스캔으로 영영 못 찾는 상품이 생기므로 그 줄을 막고 고치는 법을 알려 준다. */
export function checkCsvBarcode(raw: string): { barcode: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { barcode: null };
  if (/e\+?\d/i.test(v)) {
    return {
      error: `바코드가 ${v}처럼 줄어 저장됐어요. 엑셀에서 바코드 칸을 '텍스트' 형식으로 바꿔 숫자를 다시 입력한 뒤 저장해 주세요`,
    };
  }
  if (!/^\d+$/.test(v)) return { error: `바코드는 숫자만 입력해 주세요 (${v})` };
  return { barcode: v };
}
