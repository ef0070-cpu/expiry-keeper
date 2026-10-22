// 빠른발주 텍스트 카드의 배경색·글자색·이름 나누기(2026-10-22 사장님 승인 미리보기 그대로).
// 사진 대신 색으로 냉동고 위치를 기억하게 한다 — 같은 상품은 어느 기기에서나 늘 같은 색.
// IO 없는 순수 함수(자가검사: npx tsx src/lib/tile-color.selfcheck.ts).

/** 맛 키워드 → 기본색. 위에 있는 줄이 우선. 맛 부분(이름 두 번째 단어부터)을 먼저 보고, 없으면 이름 전체를 본다. */
const FLAVORS: [string, string[]][] = [
  ['#3D3D3D', ['쿠키앤크림', '쿠앤크', '흑임자', '오레오', '블랙']],
  ['#6B3E26', ['초코', '초콜릿', '카카오', '퍼지', '브라우니']],
  ['#8A5A3B', ['커피', '모카', '라떼', '에스프레소', '아포가토']],
  ['#A0703F', ['누가', '호두', '피넛', '땅콩', '헤이즐넛', '카라멜', '캬라멜', '밤', '바밤바', '팥', '비비빅']],
  ['#E8457A', ['딸기', '체리', '라즈베리', '석류', '스크류']],
  ['#E0393E', ['수박', '자두', '레드']],
  ['#F08A4B', ['복숭아', '오렌지', '귤', '자몽', '살구', '망고']],
  ['#F2C230', ['바나나', '레몬', '유자', '옥수수', '파인', '꿀', '허니', '치즈']],
  ['#3FA34D', ['메론', '멜론', '메로나', '청포도', '키위', '녹차', '말차', '피스타치오']],
  ['#1AA39A', ['민트', '쿨리쉬']],
  ['#7B5CC4', ['포도', '블루베리', '아사이', '고구마', '라벤더']],
  ['#2E8BD8', ['소다', '캔디바', '죠스', '블루', '이온', '얼음', '아이스티']],
  ['#F3E9D2', ['바닐라', '우유', '밀크', '크림', '요거트', '요구르트', '코코넛', '연유', '쌀']],
];

/** 키워드가 없는 상품의 고정색 후보 */
const PALETTE = ['#4C6EF5', '#12B886', '#F76707', '#AE3EC9', '#E64980', '#1098AD', '#F59F00', '#5C7CFA', '#40C057', '#FA5252'];

/** 타일 설정에서 사장님이 직접 고르는 색 */
export const TILE_COLOR_CHOICES = [
  '#3FA34D', '#1AA39A', '#2E8BD8', '#4C6EF5', '#7B5CC4', '#E8457A',
  '#E0393E', '#F08A4B', '#F2C230', '#A0703F', '#6B3E26', '#3D3D3D', '#F3E9D2',
];

export type TileColor = { bg: string; fg: string };

/** "누가바 피넛버터" → ["누가바", "피넛버터"] — 큰 글씨는 이름, 작은 칸은 맛·용량 */
export function splitTileName(name: string): [string, string] {
  const n = name.trim();
  const i = n.indexOf(' ');
  return i < 0 ? [n, ''] : [n.slice(0, i), n.slice(i + 1).trim()];
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** 밝은 배경이면 검은 글씨, 어두우면 흰 글씨(명암 대비) */
function textOn(hex: string): string {
  return hexToHsl(hex)[2] > 62 ? '#1A1A1A' : '#FFFFFF';
}

/** 상품 이름으로 정한 자동 색. 같은 계열(예: 갈색)이 몰려도 구분되게 이름에 따라 밝기·색조를 조금씩 고정 이동. */
export function autoTileColor(name: string): TileColor {
  const [head, sub] = splitTileName(name);
  let base: string | null = null;
  for (const text of [sub, name]) {
    if (!text || base) continue;
    for (const [color, words] of FLAVORS) {
      if (words.some((w) => text.includes(w))) {
        base = color;
        break;
      }
    }
  }
  if (!base) base = PALETTE[hash(head) % PALETTE.length];
  const [h, s, l] = hexToHsl(base);
  const k = hash(name.trim());
  const dl = ((k % 5) - 2) * 5;
  const dh = (((k >> 3) % 5) - 2) * 4;
  const bg = hslToHex((h + dh + 360) % 360, s, Math.min(90, Math.max(22, l + dl)));
  return { bg, fg: textOn(bg) };
}

/** 사장님이 고른 색이 있으면 그 색, 없으면 자동 색 */
export function tileColor(name: string, override?: string | null): TileColor {
  if (override && /^#[0-9A-Fa-f]{6}$/.test(override)) return { bg: override, fg: textOn(override) };
  return autoTileColor(name);
}
