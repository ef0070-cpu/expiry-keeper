import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  DEFAULT_CONFIG,
  FREE,
  monthKey,
  toEntitlement,
  toPlanConfig,
  type Entitlement,
  type EntitlementRow,
  type PlanConfig,
  type PlanConfigRow,
} from './plan-limits';
import { supabase } from './supabase';

// 유료 권한(광고 제거·매장용 유료). 서버 get_my_entitlement()가 원본이고, 마지막으로 받은 값을
// 저장해 두었다가 오프라인에서도 그대로 쓴다 — 유료 사용자가 인터넷이 끊겼다고 광고·한도를 보면 안 된다.
const KEY = 'entitlement:v1';
const CONFIG_KEY = 'planConfig:v1';

let row: EntitlementRow | null | undefined; // undefined = 로딩 전, null = 받은 적 없음
let config: PlanConfig = DEFAULT_CONFIG;
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  if (row !== undefined) return;
  const [raw, rawConfig] = await Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(CONFIG_KEY)]);
  row = raw ? JSON.parse(raw) : null;
  if (rawConfig) config = toPlanConfig(JSON.parse(rawConfig));
}

// 만료는 읽을 때마다 다시 판정(이벤트·구독 기간이 앱을 켜 둔 사이 끝날 수 있음)
const current = (): Entitlement => (row ? toEntitlement(row) : FREE);

async function store(next: EntitlementRow | null): Promise<void> {
  row = next;
  listeners.forEach((fn) => fn());
  if (next) await AsyncStorage.setItem(KEY, JSON.stringify(next));
  else await AsyncStorage.removeItem(KEY);
}

export function getCachedEntitlement(): Entitlement {
  return current();
}

export function getCachedPlanConfig(): PlanConfig {
  return config;
}

/** 서버에서 권한·유료화 스위치를 다시 받는다. 실패(오프라인 등)하면 마지막 값을 그대로 둔다. */
export async function refreshEntitlement(): Promise<Entitlement> {
  await load();
  if (!supabase) return current();
  const [ent, cfg] = await Promise.all([
    supabase.rpc('get_my_entitlement'),
    supabase.from('app_config').select('paywall_enabled, product_limit, monthly_limit, alert_limit').eq('id', 1).maybeSingle(),
  ]);
  if (!cfg.error && cfg.data) {
    config = toPlanConfig(cfg.data as PlanConfigRow);
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg.data));
  }
  const next = (ent.data as EntitlementRow[] | null)?.[0];
  if (!ent.error && next) await store(next);
  else listeners.forEach((fn) => fn()); // 스위치만 바뀌었어도 화면 갱신
  return current();
}

/** 로그아웃하면 다른 계정이 이전 권한을 물려받지 않게 비운다. */
export function clearEntitlement(): Promise<void> {
  return store(null);
}

export function useEntitlement(): Entitlement {
  const [ent, setEnt] = useState<Entitlement>(current);
  useEffect(() => {
    const update = () => setEnt(current());
    listeners.add(update);
    if (row === undefined) load().then(update);
    else update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return ent;
}

/** 유료화 스위치·한도 숫자. 권한과 같은 시점에 갱신된다. */
export function usePlanConfig(): PlanConfig {
  const [cfg, setCfg] = useState<PlanConfig>(config);
  useEffect(() => {
    const update = () => setCfg(config);
    listeners.add(update);
    if (row === undefined) load().then(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return cfg;
}

// ---------- 매장용 월 사용량(발주서·가격표) ----------

export type MonthlyKind = 'order' | 'priceTag';
const usageKey = (kind: MonthlyKind) => `usage:${kind}:${monthKey(new Date())}`;

export async function getMonthlyUsage(kind: MonthlyKind): Promise<number> {
  return Number((await AsyncStorage.getItem(usageKey(kind))) ?? 0);
}

export async function bumpMonthlyUsage(kind: MonthlyKind): Promise<void> {
  await AsyncStorage.setItem(usageKey(kind), String((await getMonthlyUsage(kind)) + 1));
}
