import Fuse from 'fuse.js';
import { disassemble } from 'es-hangul';
import { matchesSearch } from './korean-search';
import type { OrderProduct } from './order-types';

/** 비교용 정규화: 소문자화 + 공백/흔한 구두점 제거. "메로나 아이스크림"과
 * "메로나아이스크림"처럼 띄어쓰기·구두점 차이를 무시하고 비교하기 위함. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\-_./·,]/g, '');
}

/**
 * 검색 매칭 등급. 숫자가 작을수록 더 정확한 일치 — 정렬 시 이 순서대로 위에 온다.
 * 0=완전일치 1=시작일치(prefix) 2=부분일치(substring) 3=초성/자모일치 4=오타허용(fuzzy)
 */
export type SearchTier = 0 | 1 | 2 | 3 | 4;

function candidatesOf(p: OrderProduct): string[] {
  return [p.name, p.brand, ...(p.aliases ?? [])].filter((s) => s.trim().length > 0);
}

/** 여러 후보 문자열(상품명/브랜드/별칭) 중 query와 가장 잘 맞는 등급을 찾는다.
 * 초성/자모 등급은 기존 matchesSearch(초성+완성형 혼합, target 맨 앞부터)에 더해,
 * 완전히 자모 단위로 풀어낸 문자열끼리의 부분일치(중성 포함)까지 본다. */
function deterministicTier(candidates: string[], query: string): SearchTier | null {
  const q = normalize(query);
  if (!q) return null;
  const qJamo = disassemble(q);
  let best: SearchTier | null = null;

  for (const raw of candidates) {
    const t = normalize(raw);
    if (!t) continue;
    if (t === q) return 0;
    if (best === null || best > 1) {
      if (t.startsWith(q)) best = 1;
    }
    if (best === null || best > 2) {
      if (t.includes(q)) best = 2;
    }
    if (best === null || best > 3) {
      if (matchesSearch(raw, query) || disassemble(t).includes(qJamo)) best = 3;
    }
  }
  return best;
}

/**
 * 발주 상품 검색 + 랭킹. query와 매칭되는 상품만, 우선순위(완전일치 > 시작일치 > 부분일치 >
 * 초성/자모일치)로 정렬해 반환한다. 위 어디에도 안 걸리면 마지막 안전망으로 오타 허용
 * (fuzzy) 검색을 한 번 더 시도한다 — "매로나"처럼 한 글자 틀려도 "메로나"를 찾아준다.
 * 입력이 비어 있으면 products를 그대로 돌려준다(정렬 없이 원래 순서 유지).
 */
export function searchOrderProducts(products: OrderProduct[], query: string): OrderProduct[] {
  const q = query.trim();
  if (!q) return products;

  const scored: { product: OrderProduct; tier: SearchTier }[] = [];
  const unmatched: OrderProduct[] = [];

  for (const p of products) {
    if ((p.barcode ?? '').includes(q)) {
      scored.push({ product: p, tier: 2 });
      continue;
    }
    const tier = deterministicTier(candidatesOf(p), q);
    if (tier !== null) scored.push({ product: p, tier });
    else unmatched.push(p);
  }

  if (unmatched.length > 0) {
    const fuse = new Fuse(unmatched, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'aliases', weight: 1.5 },
        { name: 'brand', weight: 1 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    });
    for (const result of fuse.search(q)) {
      scored.push({ product: result.item, tier: 4 });
    }
  }

  return scored.sort((a, b) => a.tier - b.tier).map((s) => s.product);
}
