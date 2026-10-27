/** 신규·수정 뱃지는 24시간(BADGE_KEEP_MS) 보이지만, 움직이는 건 화면을 처음 본 뒤 12시간까지만. IO 없는 순수 함수. */
export const BADGE_ANIM_MS = 12 * 60 * 60 * 1000;

/** seenAt 없음 = 아직 한 번도 못 본 표시(지금 보는 중) → 움직임. 12시간 정각부터는 정지. */
export function isBadgeAnimating(seenAt: number | undefined, now: number): boolean {
  return seenAt === undefined || now - seenAt < BADGE_ANIM_MS;
}
