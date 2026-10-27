import { BADGE_ANIM_MS, isBadgeAnimating } from './order-badge-anim';

const now = 1_000_000_000_000;
console.assert(isBadgeAnimating(undefined, now) === true, 'seenAt 없음은 움직임');
console.assert(isBadgeAnimating(now, now) === true, '방금 본 것은 움직임');
console.assert(isBadgeAnimating(now - BADGE_ANIM_MS + 1, now) === true, '12시간 직전은 움직임');
console.assert(isBadgeAnimating(now - BADGE_ANIM_MS, now) === false, '12시간 정각은 정지');
console.assert(isBadgeAnimating(now - 20 * 60 * 60 * 1000, now) === false, '20시간은 정지');

console.log('order-badge-anim selfcheck OK');
