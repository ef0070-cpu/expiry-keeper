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
  const lines = parseCsvLines(text);
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

    rows.push({
      name,
      expiryDate,
      barcode: barcodeRaw || null,
      quantity,
      categories: categoriesRaw
        ? categoriesRaw.split(';').map((c) => c.trim()).filter((c) => c.length > 0)
        : [],
      memo: memoRaw || null,
    });
  }

  return { rows, errors };
}
