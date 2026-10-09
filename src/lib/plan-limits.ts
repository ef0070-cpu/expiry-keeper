// 매장용 무료 한도(docs/monetization.md). 넘어도 기존 데이터는 그대로, 막는 건 새로 추가뿐.
// 상품별 알림 횟수는 한도 없음(2026-10-09 사장님 결정) — 누구나 1~7회.

export type EntitlementRow = {
  ad_free: boolean;
  retail_until: string | null;
  retail_lifetime: boolean;
  retail_source: string | null;
};
export type Entitlement = {
  adFree: boolean;
  retailPremium: boolean;
  retailUntil: string | null; // 평생이면 null
  retailSource: 'subscription' | 'promo' | null;
};
export const FREE: Entitlement = { adFree: false, retailPremium: false, retailUntil: null, retailSource: null };

export function toEntitlement(r: EntitlementRow, now = new Date()): Entitlement {
  const until = r.retail_until ? new Date(r.retail_until) : null;
  const retailPremium = r.retail_lifetime || (until !== null && until > now);
  return {
    // 매장 유료(구독·이벤트·테스터·팀장 권한 상속) 사용자는 가정용 광고 제거도 함께 — 같은 사장님이 집에서도 쓰니까
    adFree: r.ad_free || retailPremium,
    retailPremium,
    retailUntil: r.retail_lifetime ? null : r.retail_until,
    retailSource: r.retail_source === 'subscription' || r.retail_source === 'promo' ? r.retail_source : null,
  };
}
// 유료화 스위치·한도 숫자는 서버 app_config(사장님이 대시보드에서 바꿈). 받기 전·실패 시엔 꺼진 상태 = 무료 운영.
export type PlanConfig = { paywallEnabled: boolean; productLimit: number; monthlyLimit: number };
export type PlanConfigRow = { paywall_enabled: boolean; product_limit: number; monthly_limit: number };
export const DEFAULT_CONFIG: PlanConfig = { paywallEnabled: false, productLimit: 50, monthlyLimit: 5 };
export const toPlanConfig = (r: PlanConfigRow): PlanConfig => ({
  paywallEnabled: r.paywall_enabled,
  productLimit: r.product_limit,
  monthlyLimit: r.monthly_limit,
});

const unlimited = (premium: boolean, cfg: PlanConfig) => premium || !cfg.paywallEnabled;
export const canAddProduct = (activeCount: number, premium: boolean, cfg: PlanConfig) =>
  unlimited(premium, cfg) || activeCount < cfg.productLimit;
export const canUseMonthly = (used: number, premium: boolean, cfg: PlanConfig) =>
  unlimited(premium, cfg) || used < cfg.monthlyLimit;
/** 이번 달 남은 무료 횟수. 한도가 없으면(스위치 꺼짐·유료) null */
export const monthlyRemaining = (used: number, premium: boolean, cfg: PlanConfig): number | null =>
  unlimited(premium, cfg) ? null : Math.max(0, cfg.monthlyLimit - used);
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
