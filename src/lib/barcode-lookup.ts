import { useEffect, useState } from 'react';
import { supabase, isCloudMode } from './supabase';
import { BarcodeInfo } from './types';

/**
 * 바코드로 상품 정보(이름·이미지)를 자동 조회한다.
 * 실제 조회(식품안전나라/Open Food Facts/이미지 검색)는 Supabase Edge Function `barcode-lookup`이
 * 서버 측에서 수행한다 — API 키가 앱 번들에 포함되지 않도록 하기 위함.
 */
export async function lookupBarcode(barcode: string, brand?: string): Promise<BarcodeInfo> {
  if (!supabase) return { name: null, imageUrl: null };

  // 우리 앱 사용자가 이미 등록해둔 상품(공용 목록)이 외부 API보다 정확해 우선한다. 공용 목록에 있으면
  // 외부 조회(서버 함수 → 식품안전나라·네이버·오픈푸드팩트 3~4곳)를 아예 부르지 않는다 — 예전엔 동시에
  // 시작해 이미 아는 바코드도 매번 외부 API 하루 한도를 깎았다. 등록 화면은 조회를 뒤에서 하므로 기다림은 없다.
  const { data: cached } = await supabase.from('barcode_catalog').select('name, image_uri').eq('barcode', barcode).maybeSingle();
  if (cached?.image_uri) return { name: cached.name, imageUrl: cached.image_uri };
  // 공용 목록에 이름만 있고 사진이 없으면(사진 없이 저장·신고로 지워짐) 외부에서 사진만 찾아온다.
  // 이름은 사용자가 등록한 값이 더 정확하니 그대로 둔다.
  const { data, error } = await supabase.functions.invoke('barcode-lookup', { body: { barcode, brand } });
  if (error || !data) return { name: cached?.name ?? null, imageUrl: null };
  return { name: cached?.name ?? data.name ?? null, imageUrl: data.imageUrl ?? null };
}

/**
 * 등록 화면이 열린 뒤 바코드 상품 정보를 뒤에서 찾아 넘겨준다(fill에서 빈칸만 채울 것). 스캔 직후
 * 조회(1~3초)가 끝날 때까지 "조회하는 중" 화면에서 기다리던 것을 없애기 위함 — 그동안 유통기한부터
 * 입력할 수 있다. 찾는 중이면 true.
 */
export function useBarcodeAutoFill(
  barcode: string | undefined,
  enabled: boolean,
  fill: (info: BarcodeInfo) => void,
): boolean {
  const [loading, setLoading] = useState(enabled && !!barcode);
  useEffect(() => {
    if (!enabled || !barcode) return;
    let cancelled = false;
    lookupBarcode(barcode)
      .then((info) => {
        if (!cancelled) fill(info);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fill은 매 렌더 새로 만들어지지만 바코드당 한 번만 조회하면 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode, enabled]);
  return loading;
}

/**
 * 상품명으로 웹 이미지 후보 여러 개를 검색한다(Edge Function `image-search` 경유, 네이버
 * 우선·카카오 폴백). 사용자가 직접 골라 적용하도록 자동 선택 없이 후보 목록만 돌려준다.
 */
export async function searchProductImageCandidates(query: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.functions.invoke('image-search', {
    body: { query },
  });
  if (error || !data) return [];
  return data.imageUrls ?? [];
}

/** 이미지 검색 기능을 쓸 수 있는지 (Edge Function 호출에는 클라우드 모드가 필요) */
export function hasImageSearchKeys(): boolean {
  return isCloudMode;
}
