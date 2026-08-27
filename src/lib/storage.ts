import { supabase } from './supabase';

/**
 * 로컬 사진(file:// 또는 content:// URI)을 Supabase Storage 버킷에 올리고 공개 URL을 돌려준다.
 * 이미 http(s) URL이면 그대로 돌려주고, 로그인 안 됐거나 업로드 실패하면 null.
 */
export async function uploadPhotoToBucket(
  uri: string,
  bucket: string,
  path: string,
): Promise<string | null> {
  if (!supabase) return null;
  if (uri.startsWith('http')) return uri;
  try {
    const res = await fetch(uri);
    const buffer = await res.arrayBuffer();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}
