// 날짜는 모두 YYYY-MM-DD 문자열(로컬 기준)로 다룬다.

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(): string {
  return formatDate(new Date());
}

export function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** 오늘부터 유통기한까지 남은 일수. 지났으면 음수. */
export function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function ddayLabel(days: number): string {
  if (days < 0) return `${-days}일 지남`;
  if (days === 0) return 'D-DAY';
  return `D-${days}`;
}

export type SectionKey = 'expired' | 'today' | 'soon' | 'week' | 'later';

export function sectionOf(days: number): SectionKey {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  expired: '유통기한 만료',
  today: '오늘까지',
  soon: '3일 이내',
  week: '7일 이내',
  later: '여유 있음',
};

export const SECTION_ORDER: SectionKey[] = ['expired', 'today', 'soon', 'week', 'later'];

/** YYYY-MM-DD 형식인지 + 실제 존재하는 날짜인지 검사 */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 숫자만 뽑아 YYYY-MM-DD로 자동 하이픈 삽입 */
export function autoFormatDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
