// 전면 광고 노출 규칙(docs/monetization.md 1-2). 광고 모듈 없이 검사하려고 분리.
const GRACE_MS = 3 * 86_400_000;
export function shouldShowInterstitial(s: { adFree: boolean; installedAt: number; lastShownAt: number | null; now: number }): boolean {
  if (s.adFree) return false;
  if (s.now - s.installedAt < GRACE_MS) return false;
  if (s.lastShownAt !== null && new Date(s.lastShownAt).toDateString() === new Date(s.now).toDateString()) return false;
  return true;
}
