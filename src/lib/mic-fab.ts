import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 발주 화면 "화면에 띄우는 마이크 버튼" 설정(2026-10-29): 켬/끔과, 사용자가 옮긴 위치(없으면 기본 위치).
 * 이 기기에만 저장한다 — 화면 크기·손 모양이 사람마다 달라 서버로 맞출 값이 아니다.
 */
export type MicFabSettings = { enabled: boolean; x: number | null; y: number | null };

const KEY = 'orderMicFab:v1';

export const DEFAULT_MIC_FAB: MicFabSettings = { enabled: false, x: null, y: null };

export async function getMicFab(): Promise<MicFabSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_MIC_FAB;
    const v = JSON.parse(raw) as Partial<MicFabSettings>;
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
    return { enabled: v.enabled === true, x: num(v.x), y: num(v.y) };
  } catch {
    return DEFAULT_MIC_FAB;
  }
}

export async function setMicFab(next: MicFabSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 실패는 이번 실행에서만 유지되고 넘어간다
  }
}
