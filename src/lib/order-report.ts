import { supabase } from './supabase';
import { uploadPhotoToBucket } from './storage';
import type { OrderProduct } from './order-types';

/** 신고/제안 첨부 사진을 Storage에 올리고 공개 URL을 돌려준다. 실패하면 null. */
function uploadReportPhoto(uri: string): Promise<string | null> {
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  return uploadPhotoToBucket(uri, 'order-report-images', path);
}

/**
 * 발주 상품 기본정보(가격 등) 오류를 신고한다.
 * 신고 내용은 order_product_reports 테이블에 쌓이고, 관리자가 Supabase 대시보드에서
 * 직접 확인 후 order-seed-data.ts를 고쳐 앱 업데이트로 반영한다 (별도 관리자 화면 없음).
 */
export async function reportOrderProductIssue(
  product: OrderProduct,
  message: string,
  photoUri?: string | null,
): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const photoUrl = photoUri ? await uploadReportPhoto(photoUri) : null;
  const { error } = await supabase.from('order_product_reports').insert({
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    price: product.price,
    category: product.category,
    message,
    photo_uri: photoUrl,
  });
  if (error) throw error;
}

/**
 * 사용자가 새로 등록한 발주 상품을 카탈로그 반영 제안(kind='new')으로 접수한다.
 * 정보 오류 신고와 달리 사람이 직접 값을 입력해 등록한 상품이라 위험이 낮으므로 즉시 승인 처리해
 * 다른 사용자의 "Update" 버튼에 바로 뜨게 한다 (오류 신고는 여전히 관리자 검토 후 승인).
 * 로그인/네트워크 문제로 실패해도 로컬 등록 자체는 이미 끝난 뒤라 조용히 무시한다(best-effort).
 */
export async function submitNewOrderProduct(product: OrderProduct): Promise<void> {
  if (!supabase) return;
  try {
    const photoUrl = product.imageUri ? await uploadReportPhoto(product.imageUri) : null;
    await supabase.from('order_product_reports').insert({
      kind: 'new',
      status: 'approved',
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      price: product.price,
      category: product.category,
      photo_uri: photoUrl,
    });
  } catch {
    // best-effort
  }
}

/**
 * 바코드 카탈로그에 아직 사진이 없는 상품에, 사용자가 자기 발주상품을 편집하며 추가한 사진을
 * 관리자 검토 없이 즉시 반영되는 카탈로그 수정 제안(kind:'photo_fill')으로 접수한다.
 * kind:'fix'(정보 오류 신고)는 RLS가 자동승인 insert를 막아둔 관리자 승인 전용 경로라 재사용할 수 없다.
 * name/brand/price/category는 비워 보내 기존 병합 로직(syncApprovedCatalogUpdates)이
 * 사진 외 다른 필드를 건드리지 않도록 한다. best-effort — 실패해도 로컬 저장 흐름을 막지 않는다.
 * 호출자(saveOrderProduct)는 로컬 기기의 이전 상태(사진 없음)만 보고 호출하므로, 그 사이 다른
 * 사용자가 이미 채운 사진을 덮어쓰지 않도록 여기서 공용 barcode_catalog 상태를 다시 한번 확인한다.
 */
export async function submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: cached } = await supabase
      .from('barcode_catalog')
      .select('image_uri')
      .eq('barcode', barcode)
      .maybeSingle();
    if (cached?.image_uri) return;

    const photoUrl = await uploadReportPhoto(photoUri);
    if (!photoUrl) return;
    await supabase.from('order_product_reports').insert({
      kind: 'photo_fill',
      status: 'approved',
      barcode,
      name: '',
      brand: '',
      price: null,
      category: '',
      photo_uri: photoUrl,
    });
  } catch {
    // best-effort
  }
}

const PHOTO_FLAG_THRESHOLD = 2;

/**
 * 카탈로그 사진이 실제 상품과 다르다는 신고를 접수한다.
 * 같은 바코드를 서로 다른 사용자 PHOTO_FLAG_THRESHOLD명 이상이 신고하면
 * 관리자 검토 없이 즉시 사진을 초기화(clear_photo:true)한다.
 * order_photo_flags의 PK가 (barcode, reporter_id)라 동일 유저의 중복 신고는
 * upsert(ignoreDuplicates)로 자동 무시된다 — INSERT 정책만으로 충분하고 UPDATE 정책은 필요 없다.
 * 임계치는 매 초기화 사이클마다 새로 채워야 한다: 직전 clear_photo:true 반영 이후에 달린
 * 신고만 세므로, 한 번 초기화된 바코드도 다시 2명의 합의가 있어야 재초기화된다.
 * (알려진 한계: 이전 사이클에 신고했던 유저는 PK 충돌로 다음 사이클에 재신고할 수 없다 — 별도 해결 대상 아님.)
 */
export async function flagCatalogPhoto(barcode: string): Promise<{ cleared: boolean }> {
  if (!supabase) throw new Error('로그인이 필요합니다.');

  const { error: insertError } = await supabase
    .from('order_photo_flags')
    .upsert({ barcode }, { onConflict: 'barcode,reporter_id', ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data: lastClear } = await supabase
    .from('order_product_reports')
    .select('created_at')
    .eq('barcode', barcode)
    .eq('clear_photo', true)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let countQuery = supabase
    .from('order_photo_flags')
    .select('reporter_id', { count: 'exact', head: true })
    .eq('barcode', barcode);
  if (lastClear) {
    countQuery = countQuery.gt('created_at', lastClear.created_at);
  }
  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  if ((count ?? 0) < PHOTO_FLAG_THRESHOLD) return { cleared: false };

  const { error: clearError } = await supabase.from('order_product_reports').insert({
    kind: 'photo_fill',
    status: 'approved',
    barcode,
    name: '',
    brand: '',
    price: null,
    category: '',
    photo_uri: null,
    clear_photo: true,
  });
  if (clearError) throw clearError;

  const { error: cacheClearError } = await supabase
    .from('barcode_catalog')
    .update({ image_uri: null })
    .eq('barcode', barcode);
  if (cacheClearError) {
    // best-effort 캐시 정리 — 핵심 초기화(clear_photo insert)는 이미 성공했으니 실패해도 무시한다.
  }

  return { cleared: true };
}
