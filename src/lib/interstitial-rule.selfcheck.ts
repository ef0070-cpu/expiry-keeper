import { shouldShowInterstitial } from './interstitial-rule';
const D = 86_400_000;
const t0 = new Date(2026, 9, 1, 12).getTime();
console.assert(!shouldShowInterstitial({ adFree: false, installedAt: t0, lastShownAt: null, now: t0 + 2 * D }), '설치 3일 안엔 없음');
console.assert(shouldShowInterstitial({ adFree: false, installedAt: t0, lastShownAt: null, now: t0 + 3 * D }), '3일 지나면 표시');
console.assert(!shouldShowInterstitial({ adFree: false, installedAt: t0, lastShownAt: t0 + 3 * D, now: t0 + 3 * D + 3_600_000 }), '같은 날 두 번 없음');
console.assert(shouldShowInterstitial({ adFree: false, installedAt: t0, lastShownAt: t0 + 3 * D, now: t0 + 4 * D }), '다음 날 다시 표시');
console.assert(!shouldShowInterstitial({ adFree: true, installedAt: t0, lastShownAt: null, now: t0 + 9 * D }), '광고 제거 구매자 없음');
console.log('interstitial selfcheck OK');
