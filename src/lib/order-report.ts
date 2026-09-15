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
    await deletePhotoCandidate(product.barcode, product.imageUri);
  }
}

/**
 * 이 바코드의 사진 후보(photoUri와 일치하는 것)를 즉시 삭제한다. 관리자 승인 없이 바로 반영되며,
 * 대표 사진 재계산은 DB 트리거가 알아서 다음 순위 후보(있으면)로 넘긴다. 저작권 신고의 즉시삭제
 * 경로와 "사진 제거" 버튼이 함께 쓴다.
 */
export async function deletePhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase
    .from('order_catalog_photos')
    .delete()
    .eq('barcode', barcode)
    .eq('photo_uri', photoUri);
  if (error) throw error;
  await supabase.from('barcode_catalog').update({ image_uri: null }).eq('barcode', barcode);
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
    // 브랜드도 후보로 제출한다 — apply_approved_order_report 트리거는 더 이상 brand를
    // 쓰지 않으므로, 후보가 없으면 order_catalog.brand가 NULL로 남아 다음 동기화 때
    // 방금 입력한 브랜드가 지워진다. (사진과 마찬가지로 order_catalog 행이 생긴 뒤에 넣는다.)
    if (product.barcode && product.brand.trim()) {
      await submitBrandCandidate(product.barcode, product.brand.trim());
    }
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
/** 반환값은 실제로 DB에 들어간 사진 URL(업로드 후 URL, 실패 시 null) — 호출자가 로컬에 남겨둔
 * 원본 경로 대신 이 값으로 자기 기록을 맞출 수 있도록 한다(로컬 파일 경로와 실제 저장된 URL이
 * 달라 나중에 삭제 매칭이 안 되는 문제 방지). */
export async function submitPhotoCandidate(barcode: string, photoUri: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const photoUrl = await uploadReportPhoto(photoUri);
    if (!photoUrl) return null;
    const { error } = await supabase
      .from('order_catalog_photos')
      .insert({ barcode, photo_uri: photoUrl });
    return error ? null : photoUrl;
  } catch {
    return null;
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
  // photos 조회와 세션 조회는 서로 무관하니 병렬로 보낸다. getUser()는 매번 Auth 서버까지
  // 왕복하는 네트워크 호출이라 모바일에서 느리게 느껴지는 주 원인이었다 — 여기선 "내가 투표한
  // 후보 표시용" UI 정보일 뿐 권한 검사가 아니므로(실제 권한은 서버 RLS가 담당), 로컬 저장소만
  // 읽는 getSession()으로 충분하다.
  const [{ data: photos, error }, { data: sessionData }] = await Promise.all([
    supabase
      .from('order_catalog_photos')
      .select('id, photo_uri')
      .eq('barcode', barcode)
      .order('created_at', { ascending: true }),
    supabase.auth.getSession(),
  ]);
  if (error || !photos || photos.length === 0) return [];

  const ids = photos.map((p) => p.id);
  const { data: votes } = await supabase
    .from('order_photo_votes')
    .select('photo_id, voter_id, vote')
    .in('photo_id', ids);
  const myId = sessionData.session?.user.id;

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
  const { data: sessionData } = await supabase.auth.getSession();
  const voterId = sessionData.session?.user.id;
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

/** 브랜드 후보를 product_brand_candidates에 추가하고 제출자가 자동으로 좋아요를 누른다.
 * 자동 좋아요가 없으면 기존 브랜드(배포 시 0표로 백필됨)와 득표 동점이 되고, 동점이면
 * 먼저 등록된 후보가 우선하는 규칙 때문에 방금 낸 후보가 절대 대표값이 되지 못한다
 * (수정해서 저장해도 화면에 반영 안 되는 것처럼 보이는 원인). 자동 좋아요로 1표를 줘서
 * 기존 0표 후보를 즉시 앞서게 한다 — 다른 사용자가 다시 수정하면 마찬가지로 역전 가능
 * (득표제 취지 유지, "먼저 우긴 사람이 영구히 이김"이 되지 않게 함). */
export async function submitBrandCandidate(barcode: string, brand: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: inserted, error } = await supabase
      .from('product_brand_candidates')
      .insert({ barcode, brand })
      .select('id')
      .single();
    let candidateId = inserted?.id as string | undefined;
    if (error) {
      // 유니크 제약(barcode, lower(btrim(brand))) 충돌 = 이미 같은 텍스트의 후보가 있음.
      // 이 경우에도 그 기존 후보에 좋아요를 눌러줘야 자동 좋아요 효과가 있다.
      const { data: existing } = await supabase
        .from('product_brand_candidates')
        .select('id')
        .eq('barcode', barcode)
        .ilike('brand', brand.trim())
        .maybeSingle();
      candidateId = existing?.id;
    }
    if (!candidateId) return;
    await supabase
      .from('product_brand_votes')
      .upsert({ candidate_id: candidateId, vote: 1 }, { onConflict: 'candidate_id,voter_id' });
  } catch {
    // best-effort
  }
}

export type BrandCandidate = {
  id: string;
  brand: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 브랜드 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listBrandCandidates(barcode: string): Promise<BrandCandidate[]> {
  if (!supabase) return [];
  const [{ data: candidates, error }, { data: sessionData }] = await Promise.all([
    supabase
      .from('product_brand_candidates')
      .select('id, brand')
      .eq('barcode', barcode)
      .order('created_at', { ascending: true }),
    supabase.auth.getSession(),
  ]);
  if (error || !candidates || candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const { data: votes } = await supabase
    .from('product_brand_votes')
    .select('candidate_id, voter_id, vote')
    .in('candidate_id', ids);
  const myId = sessionData.session?.user.id;

  return candidates.map((c) => {
    const candidateVotes = (votes ?? []).filter((v) => v.candidate_id === c.id);
    const likes = candidateVotes.filter((v) => v.vote === 1).length;
    const dislikes = candidateVotes.filter((v) => v.vote === -1).length;
    const mine = candidateVotes.find((v) => v.voter_id === myId);
    return {
      id: c.id,
      brand: c.brand,
      likes,
      dislikes,
      myVote: (mine?.vote as 1 | -1 | undefined) ?? null,
    };
  });
}

/** 브랜드 후보에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnBrand(candidateId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: sessionData } = await supabase.auth.getSession();
  const voterId = sessionData.session?.user.id;
  if (!voterId) throw new Error('로그인이 필요합니다.');

  const { data: existing } = await supabase
    .from('product_brand_votes')
    .select('vote')
    .eq('candidate_id', candidateId)
    .eq('voter_id', voterId)
    .maybeSingle();

  if (existing?.vote === vote) {
    const { error } = await supabase
      .from('product_brand_votes')
      .delete()
      .eq('candidate_id', candidateId)
      .eq('voter_id', voterId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('product_brand_votes')
    .upsert({ candidate_id: candidateId, vote }, { onConflict: 'candidate_id,voter_id' });
  if (error) throw error;
}
