import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitPhotoCandidate } from './order-report';

const SUBMITTED_PHOTO_KEY = 'submittedPhotoCandidates:v1';

async function getSubmittedPhotoCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_PHOTO_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedPhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  map.set(barcode, photoUri);
  await AsyncStorage.setItem(SUBMITTED_PHOTO_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 사진과 다를 때만 새 후보로 제출한다 (같은 사진 반복 저장 시 후보
 * 중복 방지). 사진 후보는 앱이 아니라 바코드 기준이라 발주(order-repo.ts)와 유통기한(repo.ts)
 * 양쪽에서 이 함수를 공유한다.
 */
export async function submitPhotoCandidateIfChanged(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  if (map.get(barcode) === photoUri) return;
  const submitted = await submitPhotoCandidate(barcode, photoUri);
  if (submitted) await recordSubmittedPhotoCandidate(barcode, photoUri);
}
