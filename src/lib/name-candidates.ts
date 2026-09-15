import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitNameCandidate } from './order-report';

const SUBMITTED_NAME_KEY = 'submittedNameCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 제출한 이름. 순수하게 "같은 값 반복 제출 방지"용
 * 기록이다(브랜드와 동일 구조 — brand-candidates.ts 참고). */
export async function getSubmittedNameCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_NAME_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedNameCandidate(barcode: string, name: string): Promise<void> {
  const map = await getSubmittedNameCandidates();
  map.set(barcode, name);
  await AsyncStorage.setItem(SUBMITTED_NAME_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 이름과 다를 때만 새 후보로 제출한다(같은 값 반복 저장 시
 * 후보 중복 방지). 로컬 기록은 네트워크 제출 성공 여부와 무관하게 즉시 저장한다.
 */
export async function submitNameCandidateIfChanged(barcode: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = await getSubmittedNameCandidates();
  if (map.get(barcode) === trimmed) return;
  await recordSubmittedNameCandidate(barcode, trimmed);
  submitNameCandidate(barcode, trimmed).catch(() => {});
}
