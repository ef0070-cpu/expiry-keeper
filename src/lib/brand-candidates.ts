import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitBrandCandidate } from './order-report';

const SUBMITTED_BRAND_KEY = 'submittedBrandCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 제출한 브랜드. 투표로 대표 브랜드가 되기 전까지
 * syncOrderCatalog가 공용 값으로 덮어쓰지 않도록 이 값을 쓰지는 않는다(브랜드는 오버라이드
 * 없이 투표 결과를 그대로 받는다) — 순수하게 "같은 값 반복 제출 방지"용 기록이다. */
export async function getSubmittedBrandCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_BRAND_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedBrandCandidate(barcode: string, brand: string): Promise<void> {
  const map = await getSubmittedBrandCandidates();
  map.set(barcode, brand);
  await AsyncStorage.setItem(SUBMITTED_BRAND_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 브랜드와 다를 때만 새 후보로 제출한다(같은 값 반복 저장 시
 * 후보 중복 방지). 로컬 기록은 네트워크 제출 성공 여부와 무관하게 즉시 저장한다.
 */
export async function submitBrandCandidateIfChanged(barcode: string, brand: string): Promise<void> {
  const trimmed = brand.trim();
  if (!trimmed) return;
  const map = await getSubmittedBrandCandidates();
  if (map.get(barcode) === trimmed) return;
  await recordSubmittedBrandCandidate(barcode, trimmed);
  submitBrandCandidate(barcode, trimmed).catch(() => {});
}
