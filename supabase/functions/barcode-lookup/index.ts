import { corsHeaders } from '../_shared/cors.ts';
import { searchProductImage } from '../_shared/image-search.ts';

type BarcodeInfo = { name: string | null; imageUrl: string | null };

const containsHangul = (s: string) => /[가-힣]/.test(s);

async function lookupOpenFoodFacts(barcode: string): Promise<BarcodeInfo> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`,
      { headers: { 'User-Agent': 'ExpiryKeeper/1.0 (Android)' } },
    );
    if (!res.ok) return { name: null, imageUrl: null };
    const json = await res.json();
    if (json.status !== 1 || !json.product) return { name: null, imageUrl: null };
    const p = json.product;
    // ponytail: OFF는 크라우드소싱 DB라 한글명이 없는 상품은 영문/기타 언어로만 등록된
    // 경우가 많음. 확인 안 된 외국어 이름을 그대로 자동 입력하면 오히려 사용자 혼란을
    // 유발하므로, 한글이 없으면 이름은 비워서(null) 사용자가 직접 입력하게 한다.
    const rawName: string | undefined = p.product_name_ko || p.product_name;
    return {
      name: rawName && containsHangul(rawName) ? rawName : null,
      imageUrl: p.image_front_url || p.image_url || null,
    };
  } catch {
    return { name: null, imageUrl: null };
  }
}

async function lookupFoodSafetyKorea(barcode: string): Promise<BarcodeInfo> {
  const key = Deno.env.get('FOODSAFETY_API_KEY');
  if (!key) return { name: null, imageUrl: null };
  try {
    const res = await fetch(
      `https://openapi.foodsafetykorea.go.kr/api/${key}/C005/json/1/1/BAR_CD=${encodeURIComponent(barcode)}`,
    );
    if (!res.ok) return { name: null, imageUrl: null };
    const json = await res.json();
    const row = json?.C005?.row?.[0];
    return { name: row?.PRDLST_NM ?? null, imageUrl: null };
  } catch {
    return { name: null, imageUrl: null };
  }
}

const stripNaverHtml = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

// ponytail: 식품안전나라 C005는 2018년 이후 유통물류진흥원 쪽 데이터가 유료화되면서
// 갱신이 끊긴 상태라 최근 출시/리뉴얼된 국내 상품은 못 찾는 경우가 많다. 네이버쇼핑은
// 실시간으로 갱신되는 판매 데이터라 바코드 숫자를 검색어로 넣으면 최신 국내 상품도
// 잘 찾힌다 — 검색어가 바코드 숫자 자체라 상위 결과 정확도가 높은 편.
async function lookupNaverShopping(barcode: string): Promise<BarcodeInfo> {
  const clientId = Deno.env.get('NAVER_CLIENT_ID');
  const clientSecret = Deno.env.get('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { name: null, imageUrl: null };
  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(barcode)}&display=5`,
      { headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret } },
    );
    if (!res.ok) return { name: null, imageUrl: null };
    const json = await res.json();
    const items: { title?: string; image?: string }[] = json?.items ?? [];
    const hit = items.find((it) => it.title && containsHangul(stripNaverHtml(it.title)));
    if (!hit?.title) return { name: null, imageUrl: null };
    return { name: stripNaverHtml(hit.title), imageUrl: hit.image || null };
  } catch {
    return { name: null, imageUrl: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { barcode, brand } = await req.json();
    if (!barcode || typeof barcode !== 'string') {
      return new Response(JSON.stringify({ error: 'barcode required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const brandHint = typeof brand === 'string' ? brand.trim() : '';

    const [kr, naver, off] = await Promise.all([
      lookupFoodSafetyKorea(barcode),
      lookupNaverShopping(barcode),
      lookupOpenFoodFacts(barcode),
    ]);

    // name과 imageUrl은 항상 같은 소스에서 나온 한 쌍으로만 채택한다 — 소스를 섞으면
    // (예: 식품안전나라 이름 + 네이버 검색 이미지) 서로 다른 상품이 매칭될 수 있다.
    // 식품안전나라는 바코드로 직접 조회해 이름 정확도가 가장 높지만 이미지가 없으므로,
    // 이름이 확정된 뒤 그 이름으로 별도 이미지 검색을 한다.
    const best = kr.name ? kr : naver.name ? naver : off;
    const name = best.name;
    let imageUrl = best.imageUrl;
    if (name && !imageUrl) {
      const query = brandHint ? `${brandHint} ${name}` : name;
      imageUrl = await searchProductImage(query);
    }

    return new Response(JSON.stringify({ name, imageUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
