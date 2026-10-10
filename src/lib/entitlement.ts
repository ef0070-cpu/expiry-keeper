import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
  DEFAULT_CONFIG,
  FREE,
  canAddProduct,
  canUseMonthly,
  monthKey,
  monthlyRemaining,
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
    supabase.from('app_config').select('paywall_enabled, product_limit, monthly_limit').eq('id', 1).maybeSingle(),
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

/** 폰에 저장된 권한을 읽었는가 — 읽기 전엔 무료로 보이니 광고처럼 유료 사용자에게 깜빡이면 안 되는 곳은 기다린다 */
export const isEntitlementLoaded = (): boolean => row !== undefined;
export const whenEntitlementLoaded = (): Promise<void> => load();

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

/** 1회 사용 기록. 무료 한도가 있으면 남은 횟수 안내창을 띄운다(유료·스위치 꺼짐이면 조용히) */
export async function bumpMonthlyUsage(kind: MonthlyKind): Promise<void> {
  const used = (await getMonthlyUsage(kind)) + 1;
  await AsyncStorage.setItem(usageKey(kind), String(used));
  // 안내창은 부가 기능 — 여기서 실패해도 이미 끝난 공유·저장을 "실패"로 보이게 하지 않는다
  try {
    await load();
    const left = monthlyRemaining(used, current().retailPremium, config);
    if (left !== null) showMonthlyUsageNotice(kind, left);
  } catch {
    // 무시
  }
}

const KIND_NAME: Record<MonthlyKind, string> = { order: '발주서 공유', priceTag: '가격표 저장·공유' };

function showMonthlyUsageNotice(kind: MonthlyKind, left: number) {
  const total = config.monthlyLimit;
  const body =
    left > 0
      ? `이번 달 무료 ${KIND_NAME[kind]} ${total}회 중 1회를 썼어요.\n남은 횟수: ${left}회`
      : `이번 달 무료 ${KIND_NAME[kind]} ${total}회를 모두 썼어요.\n다음 달 1일에 다시 ${total}회가 생겨요.`;
  const ok = { text: '확인' };
  // 거의 다 썼을 때만 유료 안내 버튼 — 매번 권하면 귀찮다. 가격표 화면은 전체 화면 창(Modal) 위라
  // 유료 안내 화면으로 넘어가도 가려져 보이지 않아 버튼을 두지 않는다(다 쓰면 다음 시도 때 안내로 넘어감)
  const upsell = left <= 1 && kind !== 'priceTag';
  Alert.alert(
    left > 0 ? `${KIND_NAME[kind]} 1회 사용` : '무료 횟수를 모두 썼어요',
    body,
    upsell ? [ok, { text: '무제한으로 쓰기', onPress: () => router.push(`/premium?reason=${kind}`) }] : [ok],
  );
}

/** 매장 월 한도(발주서·가격표) 안인가 — 스위치 꺼짐·유료면 항상 true */
export async function withinMonthlyLimit(kind: MonthlyKind): Promise<boolean> {
  await load();
  return canUseMonthly(await getMonthlyUsage(kind), current().retailPremium, config);
}

/** 매장 상품을 하나 더 등록할 수 있는가(지금 관리 중인 개수 기준) */
export async function withinProductLimit(activeCount: number): Promise<boolean> {
  await load();
  return canAddProduct(activeCount, current().retailPremium, config);
}

/** 매장 팀을 새로 만들 수 있는가(무료는 혼자 사용) */
export async function withinTeamLimit(): Promise<boolean> {
  await load();
  return current().retailPremium || !config.paywallEnabled;
}
