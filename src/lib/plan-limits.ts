// src/lib/plan-limits.ts — 매장용 무료 한도(docs/monetization.md). 넘어도 기존 데이터는 그대로, 막는 건 새로 추가뿐.
export const LIMITS = { products: 30, monthly: 5, alertsFree: 2, alertsPremium: 7 } as const;

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
  return {
    adFree: r.ad_free,
    retailPremium: r.retail_lifetime || (until !== null && until > now),
    retailUntil: r.retail_lifetime ? null : r.retail_until,
    retailSource: r.retail_source === 'subscription' || r.retail_source === 'promo' ? r.retail_source : null,
  };
}
export const canAddProduct = (activeCount: number, premium: boolean) => premium || activeCount < LIMITS.products;
export const canUseMonthly = (used: number, premium: boolean) => premium || used < LIMITS.monthly;
export const maxAlertCount = (premium: boolean) => (premium ? LIMITS.alertsPremium : LIMITS.alertsFree);
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
