// 상품 사진일 가능성이 낮은 출처(블로그·카페·SNS·지도/플레이스 후기 등)는 걸러낸다.
// (예: "호떡"을 검색하면 호떡집 후기 블로그 사진이 상위로 잡히는 문제)
const NON_PRODUCT_DOC_HOSTS = [
  'blog.naver.com',
  'blog.daum.net',
  'tistory.com',
  'cafe.naver.com',
  'cafe.daum.net',
  'instagram.com',
  'post.naver.com',
  'brunch.co.kr',
  'place.map.kakao.com',
  'map.naver.com',
  'youtube.com',
];

function isLikelyProductImage(sourceUrl: string | undefined | null): boolean {
  if (!sourceUrl) return true; // 출처를 알 수 없으면 배제하지 않는다
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
    return !NON_PRODUCT_DOC_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
  } catch {
    return true;
  }
}

function pickBest<T extends { doc_url?: string }>(items: T[]): T | undefined {
  return items.find((it) => isLikelyProductImage(it.doc_url)) ?? items[0];
}

/** 상품명으로 웹 이미지 검색 (네이버 우선, 카카오 폴백). 키는 서버(Edge Function) 환경변수에만 존재한다. */
export async function searchProductImage(query: string): Promise<string | null> {
  const naverId = Deno.env.get('NAVER_CLIENT_ID');
  const naverSecret = Deno.env.get('NAVER_CLIENT_SECRET');
  if (naverId && naverSecret) {
    try {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=10&filter=medium`,
        { headers: { 'X-Naver-Client-Id': naverId, 'X-Naver-Client-Secret': naverSecret } },
      );
      if (res.ok) {
        const json = await res.json();
        const items: { link?: string; doc_url?: string }[] = json?.items ?? [];
        const best = pickBest(items);
        if (best?.link) return best.link;
      }
    } catch {
      // fall through to kakao
    }
  }

  const kakaoKey = Deno.env.get('KAKAO_REST_KEY');
  if (kakaoKey) {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(query)}&size=10`,
        { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
      );
      if (res.ok) {
        const json = await res.json();
        const docs: { image_url?: string; doc_url?: string }[] = json?.documents ?? [];
        const best = pickBest(docs);
        if (best?.image_url) return best.image_url;
      }
    } catch {
      // no more fallbacks
    }
  }

  return null;
}

/**
 * 상품명으로 웹 이미지 후보 여러 개를 검색해 반환한다(사용자가 직접 골라 적용하는 UI용).
 * searchProductImage(단일 자동 선택)와 달리 결과를 좁히지 않고 상위 후보를 그대로 돌려준다.
 */
export async function searchProductImageCandidates(query: string, limit = 6): Promise<string[]> {
  const naverId = Deno.env.get('NAVER_CLIENT_ID');
  const naverSecret = Deno.env.get('NAVER_CLIENT_SECRET');
  if (naverId && naverSecret) {
    try {
      const res = await fetch(
        `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=${limit}&filter=medium`,
        { headers: { 'X-Naver-Client-Id': naverId, 'X-Naver-Client-Secret': naverSecret } },
      );
      if (res.ok) {
        const json = await res.json();
        const items: { link?: string; doc_url?: string }[] = json?.items ?? [];
        const urls = items
          .filter((it) => it.link && isLikelyProductImage(it.doc_url))
          .map((it) => it.link!);
        if (urls.length > 0) return urls.slice(0, limit);
      }
    } catch {
      // fall through to kakao
    }
  }

  const kakaoKey = Deno.env.get('KAKAO_REST_KEY');
  if (kakaoKey) {
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(query)}&size=${limit}`,
        { headers: { Authorization: `KakaoAK ${kakaoKey}` } },
      );
      if (res.ok) {
        const json = await res.json();
        const docs: { image_url?: string; doc_url?: string }[] = json?.documents ?? [];
        const urls = docs
          .filter((d) => d.image_url && isLikelyProductImage(d.doc_url))
          .map((d) => d.image_url!);
        if (urls.length > 0) return urls.slice(0, limit);
      }
    } catch {
      // no more fallbacks
    }
  }

  return [];
}
