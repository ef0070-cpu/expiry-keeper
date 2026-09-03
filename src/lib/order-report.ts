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
 *
 * isCopyright가 true면(저작권 신고) 통지-삭제 원칙에 따라 관리자 승인을 기다리지 않고
 * 접수 즉시 order_catalog_photos에서 해당 사진 후보 행을 삭제해 대표 사진 재계산 트리거가
 * 다음 순위 후보로 자동 교체하게 한다. 신고 자체는 is_copyright:true로 기록되어 관리자가
 * 나중에 대시보드에서 따로 확인할 수 있다.
 */
export async function reportOrderProductIssue(
  product: OrderProduct,
  message: string,
  photoUri?: string | null,
  isCopyright?: boolean,
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
    is_copyright: !!isCopyright,
  });
  if (error) throw error;

  if (isCopyright && product.barcode && product.imageUri) {
    await supabase
      .from('order_catalog_photos')
      .delete()
      .eq('barcode', product.barcode)
      .eq('photo_uri', product.imageUri);
    await supabase
      .from('barcode_catalog')
      .update({ image_uri: null })
      .eq('barcode', product.barcode);
  }
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
    const { error } = await supabase.from('order_product_reports').insert({
      kind: 'new',
      status: 'approved',
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      price: product.price,
      category: product.category,
      photo_uri: null,
    });
    if (error) return;
    // order_catalog 행이 생성된 뒤에 사진 후보를 넣어야 한다 — 먼저 넣으면 대표 사진
    // 재계산 UPDATE가 대상 행을 못 찾아 조용히 유실된다.
    if (product.imageUri && product.barcode) {
      await submitPhotoCandidate(product.barcode, product.imageUri);
    }
  } catch {
    // best-effort
  }
}

/**
 * 사진 후보를 order_catalog_photos에 추가한다. 검토 없이 즉시 접수되지만, 대표 사진이 되려면
 * 다른 사용자의 좋아요를 받아야 한다(대표 선정은 DB 트리거가 득표수로 자동 결정, 여기선 후보만 추가).
 * best-effort — 실패해도 로컬 저장 흐름을 막지 않는다. 성공 여부는 반환값으로 알려준다
 * (호출자가 "제출 완료"를 로컬에 기록할지 판단할 수 있도록).
 */
export async function submitPhotoCandidate(barcode: string, photoUri: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const photoUrl = await uploadReportPhoto(photoUri);
    if (!photoUrl) return false;
    const { error } = await supabase
      .from('order_catalog_photos')
      .insert({ barcode, photo_uri: photoUrl });
    return !error;
  } catch {
    return false;
  }
}

export type PhotoCandidate = {
  id: string;
  photoUri: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 사진 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listPhotoCandidates(barcode: string): Promise<PhotoCandidate[]> {
  if (!supabase) return [];
  const { data: photos, error } = await supabase
    .from('order_catalog_photos')
    .select('id, photo_uri')
    .eq('barcode', barcode)
    .order('created_at', { ascending: true });
  if (error || !photos || photos.length === 0) return [];

  const ids = photos.map((p) => p.id);
  const { data: votes } = await supabase
    .from('order_photo_votes')
    .select('photo_id, voter_id, vote')
    .in('photo_id', ids);
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  return photos.map((p) => {
    const photoVotes = (votes ?? []).filter((v) => v.photo_id === p.id);
    const likes = photoVotes.filter((v) => v.vote === 1).length;
    const dislikes = photoVotes.filter((v) => v.vote === -1).length;
    const mine = photoVotes.find((v) => v.voter_id === myId);
    return {
      id: p.id,
      photoUri: p.photo_uri,
      likes,
      dislikes,
      myVote: (mine?.vote as 1 | -1 | undefined) ?? null,
    };
  });
}

/** 사진에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnPhoto(photoId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: userData } = await supabase.auth.getUser();
  const voterId = userData.user?.id;
  if (!voterId) throw new Error('로그인이 필요합니다.');

  const { data: existing } = await supabase
    .from('order_photo_votes')
    .select('vote')
    .eq('photo_id', photoId)
    .eq('voter_id', voterId)
    .maybeSingle();

  if (existing?.vote === vote) {
    const { error } = await supabase
      .from('order_photo_votes')
      .delete()
      .eq('photo_id', photoId)
      .eq('voter_id', voterId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('order_photo_votes')
    .upsert({ photo_id: photoId, vote }, { onConflict: 'photo_id,voter_id' });
  if (error) throw error;
}
