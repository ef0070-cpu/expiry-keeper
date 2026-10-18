// 네이버 쇼핑 검색 결과에서 상품 사진으로 쓸 항목 순서를 정한다. Deno 전역을 쓰지 않아
// `npx tsx supabase/functions/_shared/naver-pick.selfcheck.ts`로 바로 검사할 수 있다.

export type NaverShopItem = { title?: string; image?: string; productType?: string | number };

export const stripNaverHtml = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

const containsHangul = (s: string) => /[가-힣]/.test(s);

// 판매자가 여러 개를 묶어 파는 글은 사진도 묶음·박스 사진이라 단품 사진보다 뒤로 미룬다.
// "1개", "500ml" 같은 단품 표기는 걸리지 않게 2개 이상만 본다.
const BUNDLE_RE = /[x×X*]\s*\d+|(?:[2-9]|\d{2,})\s*(?:개|팩|봉|병|캔|박스|box)(?![가-힣])|박스|묶음|세트|기획|증정|대용량/i;

// productType(네이버 쇼핑 API): 1~3 일반, 4~6 중고, 7~9 단종, 10~12 판매예정.
// 1(가격비교 카탈로그)은 네이버가 정리한 대표 사진이라 가장 깨끗하다. 중고는 실물 촬영 사진이라 뺀다.
function score(item: NaverShopItem): number {
  const type = Number(item.productType);
  if (type >= 4 && type <= 6) return -1;
  const title = stripNaverHtml(item.title ?? '');
  let s = 0;
  if (type === 1) s += 2;
  if (!BUNDLE_RE.test(title)) s += 1;
  return s;
}

/** 사진·한글 상품명이 있는 항목만 남기고 점수 높은 순(같으면 네이버 원래 순서)으로 정렬한다. */
export function rankNaverItems<T extends NaverShopItem>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .filter(({ item, s }) => s >= 0 && !!item.image && containsHangul(stripNaverHtml(item.title ?? '')))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ item }) => item);
}
