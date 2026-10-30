// 사진 후보 삭제 규칙(사장님 결정 2026-10-30). IO 없는 순수 함수(자가검사: npx tsx src/lib/photo-delete-rule.selfcheck.ts).
// 사진 삭제는 모든 사용자의 목록에서 사라지므로, 다음을 모두 만족할 때만 내가 올린 사진을 지울 수 있다.
//  ① 내가 올린 사진 ② 다른 사람이 좋아요를 누르지 않았다(쓰는 사람이 없다) ③ 올린 지 24시간 안(실수 바로잡기용)

export const OWN_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeleteVerdict = { ok: true } | { ok: false; reason: 'not-mine' | 'used-by-others' | 'too-old' };

export function ownPhotoDeleteVerdict(
  c: { mine: boolean; likes: number; myVote: 1 | -1 | null; createdAt: string | null },
  now: number,
): DeleteVerdict {
  if (!c.mine) return { ok: false, reason: 'not-mine' };
  // 내가 사진을 고르면 내 좋아요가 자동으로 들어가므로 내 표는 빼고 센다
  const othersLikes = c.likes - (c.myVote === 1 ? 1 : 0);
  if (othersLikes > 0) return { ok: false, reason: 'used-by-others' };
  const t = c.createdAt ? Date.parse(c.createdAt) : Number.NaN;
  // 올린 시각을 모르면 안전한 쪽(삭제 불가)으로 본다
  if (!Number.isFinite(t) || now - t > OWN_DELETE_WINDOW_MS) return { ok: false, reason: 'too-old' };
  return { ok: true };
}
