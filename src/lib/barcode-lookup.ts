import { supabase, isCloudMode } from './supabase';
import { BarcodeInfo } from './types';

/**
 * 바코드로 상품 정보(이름·이미지)를 자동 조회한다.
 * 실제 조회(식품안전나라/Open Food Facts/이미지 검색)는 Supabase Edge Function `barcode-lookup`이
 * 서버 측에서 수행한다 — API 키가 앱 번들에 포함되지 않도록 하기 위함.
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeInfo> {
  if (!supabase) return { name: null, imageUrl: null };

  // 우리 앱 사용자가 이미 등록해둔 상품이면 외부 API보다 먼저, 무료로, 더 정확하게 찾는다.
  const { data: cached } = await supabase
    .from('barcode_catalog')
    .select('name, image_uri')
    .eq('barcode', barcode)
    .maybeSingle();
  if (cached) return { name: cached.name, imageUrl: cached.image_uri };

  const { data, error } = await supabase.functions.invoke('barcode-lookup', {
    body: { barcode },
  });
  if (error || !data) return { name: null, imageUrl: null };
  return { name: data.name ?? null, imageUrl: data.imageUrl ?? null };
}

/** 상품명으로 웹 이미지 검색 (Edge Function `image-search` 경유, 네이버 우선·카카오 폴백) */
export async function searchProductImage(query: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.functions.invoke('image-search', {
    body: { query },
  });
  if (error || !data) return null;
  return data.imageUrl ?? null;
}

/** 이미지 검색 기능을 쓸 수 있는지 (Edge Function 호출에는 클라우드 모드가 필요) */
export function hasImageSearchKeys(): boolean {
  return isCloudMode;
}
