import AsyncStorage from '@react-native-async-storage/async-storage';

// 바코드별 보관 기간 기억 — 매장은 같은 상품을 반복해서 들이니, 한 번 "12개월"로 등록하면
// 다음엔 제조일만 찍으면 된다. 기기 안에만 저장(팀 공유 안 함).
// ponytail: 바코드 수만큼 계속 쌓임 — 수천 개여도 수십 KB라 정리하지 않음
export type MfgPeriod = { n: number; unit: 'month' | 'day' };

const KEY = 'mfgPeriodByBarcode:v1';
let cache: Record<string, MfgPeriod> | null = null;

async function load(): Promise<Record<string, MfgPeriod>> {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');
  } catch {
    cache = {};
  }
  return cache!;
}

export async function getMfgPeriod(barcode: string): Promise<MfgPeriod | null> {
  return (await load())[barcode] ?? null;
}

export async function saveMfgPeriod(barcode: string, period: MfgPeriod): Promise<void> {
  const all = await load();
  all[barcode] = period;
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}
