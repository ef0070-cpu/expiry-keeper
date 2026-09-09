import { Directory, File, Paths } from 'expo-file-system';

const PHOTOS_DIR_NAME = 'product-photos';

/** 카메라/앨범에서 고른 사진은 임시 캐시 경로(uri)를 가리켜서 앱 재시작이나 OS의 저장공간
 * 정리로 사라질 수 있다 — 저장하기 전에 앱 전용 영구 디렉터리로 복사해 안정적인 uri로 바꾼다.
 * 복사에 실패하면(드묾) 원본 uri라도 우선 쓴다. */
export function persistLocalPhoto(uri: string): string {
  try {
    const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** persistLocalPhoto로 만든 이전 사진 파일을 지운다 — 사진을 계속 바꾸면 고아 파일이
 * 쌓이는 것을 막는다. 우리가 관리하는 product-photos 디렉터리 안의 파일이 아니면
 * (원격 URL 등) 건드리지 않는다. */
export function deleteLocalPhotoIfOwned(uri: string | null | undefined): void {
  if (!uri || !uri.includes(`/${PHOTOS_DIR_NAME}/`)) return;
  try {
    new File(uri).delete();
  } catch {
    // 이미 없거나 접근 불가 — 무시
  }
}
