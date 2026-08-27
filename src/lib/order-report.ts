import { supabase } from './supabase';
import type { OrderProduct } from './order-types';

/**
 * 발주 상품 기본정보(가격 등) 오류를 신고한다.
 * 신고 내용은 order_product_reports 테이블에 쌓이고, 관리자가 Supabase 대시보드에서
 * 직접 확인 후 order-seed-data.ts를 고쳐 앱 업데이트로 반영한다 (별도 관리자 화면 없음).
 */
export async function reportOrderProductIssue(product: OrderProduct, message: string): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('order_product_reports').insert({
    barcode: product.barcode,
    name: product.name,
    brand: product.brand,
    price: product.price,
    category: product.category,
    message,
  });
  if (error) throw error;
}
