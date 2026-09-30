import { supabase } from './supabase';

/**
 * 로컬 사진(file:// 또는 content:// URI)을 Supabase Storage 버킷에 올리고 공개 URL을 돌려준다.
 * 이미 http(s) URL이면 그대로 돌려주고(이미 우리 Storage에 있는 사진을 매 저장마다 다시 올리지
 * 않기 위한 최적화), 로그인 안 됐거나 업로드 실패하면 null.
 *
 * forceUpload:true면 http(s) URL이어도 무조건 fetch해서 재업로드한다. "웹에서 이미지 찾기"로 고른
 * 검색결과 링크처럼 우리 것이 아닌 외부 URL은 핫링크 차단·임시 링크 등으로 나중에 깨질 수 있어,
 * 후보로 고르는 시점에 우리 Storage로 옮겨 안정적인 URL로 바꿔야 한다.
 */
export async function uploadPhotoToBucket(
  uri: string,
  bucket: string,
  path: string,
  forceUpload = false,
): Promise<string | null> {
  if (!supabase) return null;
  if (!forceUpload && uri.startsWith('http')) return uri;
  try {
    // 사용자 폴더 아래에 올린다 — 서버는 덮어쓰기를 올린 본인에게만 허락하므로(보안 점검 2026-09-30),
    // 공용 경로(상품ID.jpg)에 올리면 팀원이 먼저 올린 같은 이름 사진을 바꿀 때 실패한다
    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user.id;
    if (!userId) return null;
    const fullPath = `${userId}/${path}`;
    const res = await fetch(uri);
    const buffer = await res.arrayBuffer();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(fullPath, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath);
    return data.publicUrl;
  } catch {
    return null;
  }
}
