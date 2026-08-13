import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type AppMode = 'home' | 'retail';

const MODE_KEY = 'appMode:v1';

// undefined = 아직 로딩 전, null = 선택 안 함
let cached: AppMode | null | undefined;
const listeners = new Set<() => void>();

async function loadMode(): Promise<void> {
  if (cached !== undefined) return;
  const raw = await AsyncStorage.getItem(MODE_KEY);
  cached = raw === 'home' || raw === 'retail' ? raw : null;
}

export async function setAppMode(mode: AppMode): Promise<void> {
  cached = mode;
  listeners.forEach((fn) => fn());
  await AsyncStorage.setItem(MODE_KEY, mode);
}

/** 현재 앱 모드. undefined면 로딩 중, null이면 아직 선택 전. */
export function useAppMode(): AppMode | null | undefined {
  const [mode, setMode] = useState<AppMode | null | undefined>(cached);
  useEffect(() => {
    const update = () => setMode(cached);
    listeners.add(update);
    if (cached === undefined) loadMode().then(update);
    else update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return mode;
}

export const MODE_LABELS: Record<AppMode, string> = {
  home: '가정용',
  retail: '소매점용',
};

// ---------- 유통기한 알림 설정 ----------

export interface AlertSettings {
  count: number; // 1~7회
  hour: number; // 0~23
  minute: number; // 0~59
}

/** 횟수(1~7)별 알림 시점(D-day 기준 며칠 전). 인덱스 = 횟수 - 1. */
export const ALERT_OFFSETS: readonly number[][] = [
  [0],
  [0, 1],
  [0, 1, 3],
  [0, 1, 3, 7],
  [0, 1, 3, 7, 14],
  [0, 1, 3, 7, 14, 21],
  [0, 1, 3, 7, 14, 21, 30],
];

/** 지금까지 어떤 횟수 설정에서든 쓰일 수 있는 모든 오프셋(취소 시 사용) */
export const ALL_OFFSET_DAYS: readonly number[] = ALERT_OFFSETS[ALERT_OFFSETS.length - 1];

const ALERT_KEY = 'alertSettings:v1';
const DEFAULT_ALERT: AlertSettings = { count: 2, hour: 9, minute: 0 };

let alertCache: AlertSettings | undefined;
const alertListeners = new Set<() => void>();

async function loadAlertSettings(): Promise<void> {
  if (alertCache !== undefined) return;
  const raw = await AsyncStorage.getItem(ALERT_KEY);
  alertCache = raw ? { ...DEFAULT_ALERT, ...JSON.parse(raw) } : DEFAULT_ALERT;
}

export async function getAlertSettings(): Promise<AlertSettings> {
  await loadAlertSettings();
  return alertCache!;
}

export async function setAlertSettings(patch: Partial<AlertSettings>): Promise<void> {
  await loadAlertSettings();
  alertCache = { ...alertCache!, ...patch };
  alertListeners.forEach((fn) => fn());
  await AsyncStorage.setItem(ALERT_KEY, JSON.stringify(alertCache));
}

/** 로딩 중에도 기본값을 즉시 돌려준다 (알림 설정은 '미선택' 상태가 없음). */
export function useAlertSettings(): AlertSettings {
  const [settings, setSettings] = useState<AlertSettings>(alertCache ?? DEFAULT_ALERT);
  useEffect(() => {
    const update = () => setSettings(alertCache ?? DEFAULT_ALERT);
    alertListeners.add(update);
    if (alertCache === undefined) loadAlertSettings().then(update);
    else update();
    return () => {
      alertListeners.delete(update);
    };
  }, []);
  return settings;
}
