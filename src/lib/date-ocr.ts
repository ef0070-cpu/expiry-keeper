import { isValidDateStr, todayStr } from './dates';
import { DateOcrOrder } from './settings';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toYear(raw: string): number {
  return raw.length === 4 ? Number(raw) : 2000 + Number(raw);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const TRIPLE_RE = /(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,4})/g;
const PAIR_RE = /(\d{2,4})\s*[.\-/]\s*(\d{1,2})(?!\d)/g;

/** 3묶음(년+월+일) 후보 하나를 dateOcrOrder 기준으로 해석한다. */
function resolveTriple(a: string, b: string, c: string, order: DateOcrOrder): string | null {
  const aIsYear = a.length === 4;
  const cIsYear = c.length === 4;
  let yearRaw: string;
  let rest: [string, string];
  let yearFirst: boolean;
  if (aIsYear && !cIsYear) {
    yearRaw = a;
    rest = [b, c];
    yearFirst = true;
  } else if (cIsYear && !aIsYear) {
    yearRaw = c;
    rest = [a, b];
    yearFirst = false;
  } else if (aIsYear && cIsYear) {
    return null;
  } else if (order === 'ymd') {
    yearRaw = a;
    rest = [b, c];
    yearFirst = true;
  } else {
    yearRaw = c;
    rest = [a, b];
    yearFirst = false;
  }

  const r0 = Number(rest[0]);
  const r1 = Number(rest[1]);
  let month: number;
  let day: number;
  if (yearFirst) {
    // 국내 표준(년-월-일) — 연도가 앞이면 항상 월-일 순서, 설정과 무관
    month = r0;
    day = r1;
  } else if (r0 > 12 && r1 <= 12) {
    // r0는 월이 될 수 없으므로 구조적으로 일-월 확정, 설정과 무관
    day = r0;
    month = r1;
  } else if (r1 > 12 && r0 <= 12) {
    day = r1;
    month = r0;
  } else if (order === 'dmy') {
    day = r0;
    month = r1;
  } else {
    month = r0;
    day = r1;
  }

  const year = toYear(yearRaw);
  const result = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateStr(result) ? result : null;
}

/** 2묶음(년+월만, 일 없음) 후보 하나를 dateOcrOrder 기준으로 해석한다. 일은 해당 월의 마지막 날로 채운다. */
function resolvePair(a: string, b: string, order: DateOcrOrder): string | null {
  const aIsYear = a.length === 4;
  const bIsYear = b.length === 4;
  let yearRaw: string;
  let monthRaw: string;
  if (aIsYear && !bIsYear) {
    yearRaw = a;
    monthRaw = b;
  } else if (bIsYear && !aIsYear) {
    yearRaw = b;
    monthRaw = a;
  } else if (aIsYear && bIsYear) {
    return null;
  } else if (order === 'ymd') {
    yearRaw = a;
    monthRaw = b;
  } else {
    yearRaw = b;
    monthRaw = a;
  }

  const year = toYear(yearRaw);
  const month = Number(monthRaw);
  if (month < 1 || month > 12) return null;
  const day = lastDayOfMonth(year, month);
  const result = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateStr(result) ? result : null;
}

/** ML Kit이 인식한 원문 텍스트에서 유통기한으로 보이는 날짜를 찾아 YYYY-MM-DD로 반환한다.
 * 못 찾으면 null. referenceDate는 "미래(또는 오늘) 날짜만 채택" 판단 기준일(기본값: 오늘) —
 * 제조일자와 유통기한이 함께 찍힌 경우 기준일 이전 후보를 제외하기 위함. */
export function extractExpiryDateFromText(
  text: string,
  dateOcrOrder: DateOcrOrder,
  referenceDate: string = todayStr(),
): string | null {
  const candidates: string[] = [];

  for (const m of text.matchAll(TRIPLE_RE)) {
    const resolved = resolveTriple(m[1], m[2], m[3], dateOcrOrder);
    if (resolved) candidates.push(resolved);
  }

  if (candidates.length === 0) {
    for (const m of text.matchAll(PAIR_RE)) {
      const resolved = resolvePair(m[1], m[2], dateOcrOrder);
      if (resolved) candidates.push(resolved);
    }
  }

  const future = candidates.filter((d) => d >= referenceDate);
  if (future.length === 0) return null;
  future.sort();
  return future[future.length - 1];
}

/** 사진에서 읽힌 날짜 후보를 사용자가 고를 순서로 돌려준다(중복 제거). 유통기한일 가능성이 큰
 * 순서 — 기준일 이후 날짜(늦은 것부터), 그다음 이미 지난 날짜(늦은 것부터). 지난 날짜도 빼지
 * 않는 이유: 기한이 지난 상품도 등록해야 하고, 사용자가 직접 보고 고르므로 제조일 오인 위험이 낮다. */
export function extractDateCandidates(
  text: string,
  dateOcrOrder: DateOcrOrder,
  referenceDate: string = todayStr(),
): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TRIPLE_RE)) {
    const resolved = resolveTriple(m[1], m[2], m[3], dateOcrOrder);
    if (resolved) found.add(resolved);
  }
  if (found.size === 0) {
    for (const m of text.matchAll(PAIR_RE)) {
      const resolved = resolvePair(m[1], m[2], dateOcrOrder);
      if (resolved) found.add(resolved);
    }
  }
  const desc = [...found].sort().reverse();
  return [...desc.filter((d) => d >= referenceDate), ...desc.filter((d) => d < referenceDate)];
}
