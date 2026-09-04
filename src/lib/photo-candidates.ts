import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitPhotoCandidate } from './order-report';

const SUBMITTED_PHOTO_KEY = 'submittedPhotoCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 골라 저장한 사진. 아직 투표로 대표사진이 안 됐어도
 * syncOrderCatalog가 공용 대표사진으로 도로 덮어쓰지 않도록 이 값을 오버라이드로 쓴다. */
export async function getSubmittedPhotoCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_PHOTO_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedPhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  map.set(barcode, photoUri);
  await AsyncStorage.setItem(SUBMITTED_PHOTO_KEY, JSON.stringify(Object.fromEntries(map)));
}

/** 사진을 제거했을 때 이 기기의 오버라이드도 지운다 — 안 지우면 다음 동기화 때 이미 지운 사진이
 * 되살아난다. */
export async function clearSubmittedPhotoCandidate(barcode: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  if (!map.delete(barcode)) return;
  await AsyncStorage.setItem(SUBMITTED_PHOTO_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 사진과 다를 때만 새 후보로 제출한다 (같은 사진 반복 저장 시 후보
 * 중복 방지). 사진 후보는 앱이 아니라 바코드 기준이라 발주(order-repo.ts)와 유통기한(repo.ts)
 * 양쪽에서 이 함수를 공유한다.
 *
 * 로컬 오버라이드 기록은 네트워크 제출 성공 여부와 무관하게 즉시 저장한다 — 네트워크 제출이 끝나야
 * 기록되면, 저장 직후 목록 화면으로 돌아가 syncOrderCatalog가 실행될 때 기록이 아직 없어 방금 고른
 * 사진이 도로 덮어써지는 경쟁 상태가 생긴다.
 */
export async function submitPhotoCandidateIfChanged(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  if (map.get(barcode) === photoUri) return;
  await recordSubmittedPhotoCandidate(barcode, photoUri);
  submitPhotoCandidate(barcode, photoUri)
    .then((uploadedUrl) => {
      // 카메라/앨범으로 고른 로컬 파일 경로처럼 업로드 과정에서 URL이 바뀌는 경우, 실제로 DB에
      // 들어간 URL로 오버라이드를 맞춰둔다 — 안 그러면 나중에 "사진 제거"가 로컬 경로로 매칭을
      // 시도해 실제 DB 행을 못 찾는다.
      if (uploadedUrl && uploadedUrl !== photoUri) return recordSubmittedPhotoCandidate(barcode, uploadedUrl);
    })
    .catch(() => {});
}
