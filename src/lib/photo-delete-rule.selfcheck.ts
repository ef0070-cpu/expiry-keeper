// npx tsx src/lib/photo-delete-rule.selfcheck.ts — 사진 삭제 규칙이 깨지지 않았는지 확인(파일·API 없음)
import assert from 'node:assert/strict';
import { OWN_DELETE_WINDOW_MS, ownPhotoDeleteVerdict } from './photo-delete-rule';

const now = Date.parse('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const base = { mine: true, likes: 0, myVote: null as 1 | -1 | null, createdAt: hoursAgo(1) };
const reason = (c: Parameters<typeof ownPhotoDeleteVerdict>[0]) => {
  const v = ownPhotoDeleteVerdict(c, now);
  return v.ok ? 'ok' : v.reason;
};

// 지울 수 있는 경우: 내 사진, 좋아요 없음 또는 내 좋아요뿐, 24시간 안
assert.equal(reason(base), 'ok');
assert.equal(reason({ ...base, likes: 1, myVote: 1 }), 'ok'); // 내 자동 좋아요 한 표는 센 것이 아님
assert.equal(reason({ ...base, createdAt: hoursAgo(23) }), 'ok');

// 지울 수 없는 경우
assert.equal(reason({ ...base, mine: false }), 'not-mine');
assert.equal(reason({ ...base, likes: 1, myVote: null }), 'used-by-others'); // 남이 누른 좋아요
assert.equal(reason({ ...base, likes: 2, myVote: 1 }), 'used-by-others'); // 내 표 말고도 있음
assert.equal(reason({ ...base, createdAt: hoursAgo(25) }), 'too-old');
assert.equal(reason({ ...base, createdAt: null }), 'too-old'); // 올린 시각을 모르면 안전한 쪽
assert.equal(reason({ ...base, createdAt: 'not-a-date' }), 'too-old');
assert.equal(OWN_DELETE_WINDOW_MS, 24 * 3600_000);

// 남이 쓰는 것이 시간보다 먼저 판단된다(둘 다 해당하면 '다른 분도 쓰는 사진' 안내)
assert.equal(reason({ ...base, likes: 3, myVote: null, createdAt: hoursAgo(100) }), 'used-by-others');

console.log('photo-delete-rule 자가검사 통과');
