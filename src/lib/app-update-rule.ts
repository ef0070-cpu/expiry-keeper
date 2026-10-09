// 새 버전 안내 판정(순수 함수 — react-native 없이 자가검사 가능하게 분리)
export type UpdateRow = { latest_version_code: number; min_version_code: number; update_notes: string };
export type UpdateDecision = 'none' | 'optional' | 'force';

/** 현재 versionCode, 서버 값, "나중에"를 누른 버전으로 판정 */
export function decideUpdate(current: number, r: UpdateRow, dismissed: number): UpdateDecision {
  if (!current) return 'none'; // 개발 중 등 버전을 못 읽으면 안 띄움
  if (current < r.min_version_code) return 'force';
  if (current < r.latest_version_code && dismissed < r.latest_version_code) return 'optional';
  return 'none';
}
