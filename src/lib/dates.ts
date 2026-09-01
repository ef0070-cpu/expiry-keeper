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

export type SignalKey = 'red' | 'yellow' | 'green';

export function signalOf(days: number): SignalKey {
  if (days <= 7) return 'red';
  if (days <= 30) return 'yellow';
  return 'green';
}

export const SIGNAL_TITLES: Record<SignalKey, string> = {
  red: '만료·7일 이내',
  yellow: '임박(한달 이내)',
  green: '여유 있음(한달 이상)',
};

export const SIGNAL_ORDER: SignalKey[] = ['red', 'yellow', 'green'];

// 배지/섹션 점/통계 카드에서 공통으로 사용하는 배경색
export const SIGNAL_BG: Record<SignalKey, string> = {
  red: 'bg-primary',
  yellow: 'bg-warn',
  green: 'bg-ok',
};

// 통계 카드 비활성 상태의 숫자 색
export const SIGNAL_TEXT: Record<SignalKey, string> = {
  red: 'text-primary',
  yellow: 'text-warn',
  green: 'text-ok',
};

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
