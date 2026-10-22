import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'privatePhotoBarcodes:v1';

async function load(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** 사진 직접 등록에서 공유 동의를 끈 바코드 — 이 기기에서 찍은 사진을 공용 사진 후보로 올리지 않는다 */
export async function isPhotoPrivate(barcode: string): Promise<boolean> {
  return (await load()).has(barcode);
}

export async function setPhotoPrivate(barcode: string, priv: boolean): Promise<void> {
  const set = await load();
  if (set.has(barcode) === priv) return;
  if (priv) set.add(barcode);
  else set.delete(barcode);
  await AsyncStorage.setItem(KEY, JSON.stringify([...set])).catch(() => {});
}
