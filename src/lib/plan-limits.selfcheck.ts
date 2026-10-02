import { canAddProduct, canUseMonthly, maxAlertCount, monthKey, toEntitlement } from './plan-limits';

console.assert(canAddProduct(29, false) === true, '무료 29개 → 추가 가능');
console.assert(canAddProduct(30, false) === false, '무료 30개 → 추가 불가');
console.assert(canAddProduct(500, true) === true, '유료는 무제한');
console.assert(canUseMonthly(4, false) === true && canUseMonthly(5, false) === false, '월 5회');
console.assert(canUseMonthly(99, true) === true, '유료 월 무제한');
console.assert(maxAlertCount(false) === 2 && maxAlertCount(true) === 7, '알림 상한');
console.assert(monthKey(new Date(2026, 0, 31, 23, 59)) === '2026-01', '현지 달력 월');
const now = new Date('2026-10-02T00:00:00Z');
const row = (o: object) => ({ ad_free: false, retail_until: null, retail_lifetime: false, retail_source: null, ...o });
console.assert(toEntitlement(row({ retail_until: '2026-10-01T00:00:00Z', retail_source: 'promo' }), now).retailPremium === false, '만료된 이벤트');
console.assert(toEntitlement(row({ retail_until: '2027-04-01T00:00:00Z', retail_source: 'promo' }), now).retailPremium === true, '진행 중 이벤트');
console.assert(toEntitlement(row({ ad_free: true, retail_lifetime: true }), now).retailPremium === true, '테스터 평생');
console.log('plan-limits selfcheck OK');
