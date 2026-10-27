import type { OrderProduct } from './order-types';

// 음성(받아쓰기) 발주 문장 → 상품명·수량. 승인된 미리보기 parseVoice/kor2num 규칙과 동일.
const KN: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 한: 1, 두: 2, 세: 3, 네: 4, 석: 3, 넉: 4 };

function kor2num(s: string): number {
  if (/^\d+$/.test(s)) return +s;
  if (s[0] === '열') {
    const o = s.length > 1 ? KN[s.slice(1)] : 0;
    return o == null ? NaN : 10 + o;
  }
  if (s.includes('십')) {
    const [a, b] = s.split('십');
    const t = a ? KN[a] : 1;
    const o = b ? KN[b] : 0;
    return t == null || o == null ? NaN : t * 10 + o;
  }
  return KN[s] ?? NaN;
}

const UNIT = '박스|상자|개|봉|팩';
const FILLER = /^(그리고|하고|랑|이랑|주문|발주|담아줘|담아|해줘|주세요|좀)$/;
const UNIT_ONLY = new RegExp('^(' + UNIT + ')$');
const NUMTOK = new RegExp(`^([0-9]+|[일이삼사오육칠팔구십한두세네석넉열]{1,3})(${UNIT})?$`);
const NAMEQTY = new RegExp(`^(.*?[^0-9])([0-9]+)(${UNIT})?$`);

/** 상품명 + 수량 + 단위 순서로 읽는다. 수량·단위가 없으면 1, 최대 99. */
export function parseVoiceOrder(text: string): { name: string; qty: number }[] {
  const out: { name: string; qty: number | null }[] = [];
  let cur: { name: string; qty: number | null } | null = null;
  for (const t of text.replace(/[,，]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (FILLER.test(t) || UNIT_ONLY.test(t)) continue;
    const m = NUMTOK.exec(t);
    if (m && cur && cur.qty == null) {
      const n = kor2num(m[1]);
      if (n > 0) {
        cur.qty = n;
        continue;
      }
    }
    const nq = NAMEQTY.exec(t);
    cur = { name: nq ? nq[1] : t, qty: nq ? +nq[2] : null };
    out.push(cur);
  }
  return out.map((o) => ({ name: o.name, qty: Math.min(99, o.qty || 1) }));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 상품명·별칭 부분 일치만 성공. 단종 제외, 같은 상품은 수량 합산(최대 99), 후보가 여럿이면 이름이 가장 짧은 것. */
export function matchVoiceItems(
  items: { name: string; qty: number }[],
  products: OrderProduct[],
): { matched: { product: OrderProduct; qty: number }[]; failed: { name: string; qty: number }[] } {
  const live = products.filter((p) => p.status !== 'discontinued');
  const sums = new Map<string, { product: OrderProduct; qty: number }>();
  const failed: { name: string; qty: number }[] = [];
  for (const it of items) {
    const q = norm(it.name);
    let best: OrderProduct | null = null;
    if (q.length >= 2) {
      for (const p of live) {
        if (![p.name, ...(p.aliases ?? [])].some((r) => norm(r).includes(q))) continue;
        if (!best || p.name.length < best.name.length) best = p;
      }
    }
    if (!best) {
      failed.push(it);
      continue;
    }
    const prev = sums.get(best.id);
    sums.set(best.id, { product: best, qty: Math.min(99, (prev?.qty ?? 0) + it.qty) });
  }
  return { matched: [...sums.values()], failed };
}
