import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 사진 후보 목록에서 "내 폰에서만 숨긴" 사진(2026-10-30). 서버에서 지우지 않으므로 다른 사용자 화면은 그대로다.
 * 엉뚱한 사진이 내 목록에 보이는 것은 막되, 다른 사용자가 쓰는 사진을 지우지 않게 하려는 장치.
 */
const KEY = 'hiddenPhotoCandidates:v1';

type Store = Record<string, string[]>; // 바코드 → 숨긴 후보 id들

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

export async function getHiddenPhotoIds(barcode: string): Promise<Set<string>> {
  const ids = (await read())[barcode];
  return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
}

export async function hidePhotoCandidate(barcode: string, id: string): Promise<void> {
  try {
    const store = await read();
    store[barcode] = [...new Set([...(store[barcode] ?? []), id])];
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 저장 실패는 이번 화면에서만 숨겨지고 넘어간다
  }
}
