import { supabase } from './supabase';
import type { OrderProduct } from './order-types';

/** 신고/제안 첨부 사진을 Storage에 올리고 공개 URL을 돌려준다. 실패하면 null. */
async function uploadReportPhoto(uri: string): Promise<string | null> {
  if (!supabase) return null;
  if (uri.startsWith('http')) return uri;
  try {
    const res = await fetch(uri);
    const buffer = await res.arrayBuffer();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await supabase.storage
      .from('order-report-images')
      .upload(path, buffer, { contentType: 'image/jpeg' });
    if (error) return null;
    const { data } = supabase.storage.from('order-report-images').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
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
 * 관리자 승인 전까지는 다른 사용자에게 보이지 않으며, 승인되면 "Update" 버튼으로 전체 반영된다.
 * 로그인/네트워크 문제로 실패해도 로컬 등록 자체는 이미 끝난 뒤라 조용히 무시한다(best-effort).
 */
export async function submitNewOrderProduct(product: OrderProduct): Promise<void> {
  if (!supabase) return;
  try {
    const photoUrl = product.imageUri ? await uploadReportPhoto(product.imageUri) : null;
    await supabase.from('order_product_reports').insert({
      kind: 'new',
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
