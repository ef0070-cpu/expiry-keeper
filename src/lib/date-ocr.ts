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

// (?<!\d)·(?!\d): 더 긴 숫자의 일부는 날짜로 보지 않는다 — '나트륨 120.5mg'의 '20.5'가 2020년 5월,
// '12345.6'이 '2345.6'으로 잡히던 문제. 연도는 2자리·4자리만(3자리 '120'이 2120년이 되던 문제).
const TRIPLE_RE = /(?<!\d)(\d{4}|\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4}|\d{1,2})(?!\d)/g;
const PAIR_RE = /(?<!\d)(\d{4}|\d{2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g;
// 구분 기호 없이 붙은 8자리 날짜(중국 제품에 흔함: '20260310', 시간이 바로 붙은 '2026031014:22').
// 더 긴 숫자(바코드·로트 번호)의 일부는 제외 — 뒤에 숫자가 오면 시간(HH:)일 때만 허용
const COMPACT_RE = /(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=\D|$|[0-2]\d:)/g;

/** 유통기한으로 말이 되는 연도 범위(기준 해 3년 전 ~ 10년 뒤). 성분표 숫자 등이 우연히 날짜
 * 모양이 돼도 터무니없는 연도(2120년 등)는 후보에서 뺀다. */
function isPlausibleYear(date: string, referenceDate: string): boolean {
  const y = Number(date.slice(0, 4));
  const ref = Number(referenceDate.slice(0, 4));
  return y >= ref - 3 && y <= ref + 10;
}

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

/** 유통기한으로 보이는 날짜 하나(기준일 이후 중 가장 늦은 날짜). 없으면 null.
 * 제조일자와 유통기한이 함께 찍힌 경우 기준일 이전 후보를 제외하기 위함. */
export function extractExpiryDateFromText(
  text: string,
  dateOcrOrder: DateOcrOrder,
  referenceDate: string = todayStr(),
): string | null {
  // 후보는 기준일 이후(늦은 순)가 먼저 오므로 첫 후보가 기준일 이후면 그게 답이다
  const first = extractDateCandidates(text, dateOcrOrder, referenceDate)[0];
  return first && first >= referenceDate ? first : null;
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
  for (const m of text.matchAll(COMPACT_RE)) {
    const d = `${m[1]}-${m[2]}-${m[3]}`;
    if (isValidDateStr(d)) found.add(d);
  }
  if (found.size === 0) {
    for (const m of text.matchAll(PAIR_RE)) {
      const resolved = resolvePair(m[1], m[2], dateOcrOrder);
      if (resolved) found.add(resolved);
    }
  }
  const desc = [...found].filter((d) => isPlausibleYear(d, referenceDate)).sort().reverse();
  return [...desc.filter((d) => d >= referenceDate), ...desc.filter((d) => d < referenceDate)];
}

// ---------- 바코드 국가번호로 날짜 순서 추천 ----------

// GS1 앞 3자리 범위 → [나라, 날짜 순서]. 주의: 생산국이 아니라 바코드를 등록한 나라라서 추천일 뿐이다
// (한국 회사가 중국에서 만들어도 880). 목록에 없는 번호는 추천하지 않는다(기본값 유지).
const GS1_RANGES: [number, number, string, DateOcrOrder][] = [
  [0, 19, '미국·캐나다', 'mdy'], [30, 39, '미국·캐나다', 'mdy'], [60, 139, '미국·캐나다', 'mdy'],
  [300, 379, '프랑스', 'dmy'], [400, 440, '독일', 'dmy'], [450, 459, '일본', 'ymd'], [490, 499, '일본', 'ymd'],
  [460, 469, '러시아', 'dmy'], [471, 471, '대만', 'ymd'], [489, 489, '홍콩', 'dmy'],
  [500, 509, '영국', 'dmy'], [520, 521, '그리스', 'dmy'], [539, 539, '아일랜드', 'dmy'], [540, 549, '벨기에', 'dmy'],
  [560, 560, '포르투갈', 'dmy'], [570, 579, '덴마크', 'dmy'], [590, 590, '폴란드', 'dmy'], [640, 649, '핀란드', 'dmy'],
  [690, 699, '중국', 'ymd'], [700, 709, '노르웨이', 'dmy'], [730, 739, '스웨덴', 'dmy'], [750, 750, '멕시코', 'dmy'],
  [760, 769, '스위스', 'dmy'], [789, 790, '브라질', 'dmy'], [800, 839, '이탈리아', 'dmy'], [840, 849, '스페인', 'dmy'],
  [859, 859, '체코', 'dmy'], [868, 869, '터키', 'dmy'], [870, 879, '네덜란드', 'dmy'], [880, 880, '한국', 'ymd'],
  [885, 885, '태국', 'dmy'], [888, 888, '싱가포르', 'dmy'], [893, 893, '베트남', 'dmy'], [899, 899, '인도네시아', 'dmy'],
  [900, 919, '오스트리아', 'dmy'], [930, 939, '호주', 'dmy'], [940, 949, '뉴질랜드', 'dmy'], [955, 955, '말레이시아', 'dmy'],
];

/** 바코드로 나라·날짜 순서 추천. 12자리(UPC-A)는 미국·캐나다. 중국은 제조일+보관 기간 표기가 많아 mfg로 알린다 */
export function dateOrderFromBarcode(
  barcode: string | null | undefined,
): { country: string; order: DateOcrOrder; mfg: boolean } | null {
  if (!barcode || !/^\d+$/.test(barcode)) return null;
  if (barcode.length === 12) return { country: '미국·캐나다', order: 'mdy', mfg: false };
  if (barcode.length !== 13) return null;
  const p = Number(barcode.slice(0, 3));
  const hit = GS1_RANGES.find(([lo, hi]) => p >= lo && p <= hi);
  return hit ? { country: hit[2], order: hit[3], mfg: hit[2] === '중국' } : null;
}

// ---------- 실시간 자동 인식(카메라 미리보기) ----------

export interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Size {
  width: number;
  height: number;
}

/** 화면 위 사각형(x,y,w,h)을 캡처 이미지 픽셀 좌표로. 미리보기가 이미지를 가운데 맞춰 꽉 채운다
 * (cover)고 보고, 이미지가 옆으로 누운 크기로 오면 화면 방향에 맞춰 돌려 본다. padRatio만큼
 * 사방으로 넓혀 손떨림·화각 차이를 흡수한다. */
export function viewRectToImage(
  rect: { x: number; y: number; width: number; height: number },
  view: Size,
  image: Size,
  padRatio = 0,
): Frame {
  const portrait = view.height >= view.width;
  const imgW = portrait === image.height >= image.width ? image.width : image.height;
  const imgH = imgW === image.width ? image.height : image.width;
  const s = Math.max(view.width / imgW, view.height / imgH);
  const ox = (view.width - imgW * s) / 2;
  const oy = (view.height - imgH * s) / 2;
  const padX = rect.width * padRatio;
  const padY = rect.height * padRatio;
  return {
    left: (rect.x - padX - ox) / s,
    top: (rect.y - padY - oy) / s,
    right: (rect.x + rect.width + padX - ox) / s,
    bottom: (rect.y + rect.height + padY - oy) / s,
  };
}

/** 인식된 글자 줄 중 가운데 점이 region 안에 있는 줄만 이어 붙인다 — 사각형 밖의 제조일·로트
 * 번호가 섞이면 엉뚱한 날짜가 잡힌다. */
export function textInRegion(lines: { text: string; frame: Frame }[], region: Frame): string {
  return lines
    .filter(({ frame: f }) => {
      const cx = (f.left + f.right) / 2;
      const cy = (f.top + f.bottom) / 2;
      return cx >= region.left && cx <= region.right && cy >= region.top && cy <= region.bottom;
    })
    .map((l) => l.text)
    .join('\n');
}

/** 최근 읽은 결과(null = 못 읽음)에서 확정할 날짜. 최근 3번 중 2번 이상 같은 날짜면 확정 —
 * '2번 연속'은 흔들린 한 장에 처음부터 다시 세야 해서 느렸다. 오인식 한 번으로는 확정되지 않는다. */
export function stableDate(recent: (string | null)[]): string | null {
  const last = recent.slice(-3).filter((d): d is string => !!d);
  for (const d of last) {
    if (last.filter((x) => x === d).length >= 2) return d;
  }
  return null;
}
