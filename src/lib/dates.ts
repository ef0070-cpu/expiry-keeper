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
// 색 값은 tailwind.config.js의 sig-* (유통기한 상태 전용 색)
export const SIGNAL_BG: Record<SignalKey, string> = {
  red: 'bg-sig-red',
  yellow: 'bg-sig-yellow',
  green: 'bg-sig-green',
};

// 통계 카드 비활성 상태의 숫자 색
export const SIGNAL_TEXT: Record<SignalKey, string> = {
  red: 'text-sig-red',
  yellow: 'text-sig-yellow',
  green: 'text-sig-green',
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

type DateOrder = 'ymd' | 'dmy' | 'mdy'; // settings.ts DateOcrOrder와 같음(순환 import 피함)

/** 직접 입력 숫자를 고른 순서로 서식 — 년/월/일 2026-09-10, 일/월/년 10-09-2026, 월/일/년 09-10-2026 */
export function autoFormatDateByOrder(input: string, order: DateOrder): string {
  if (order === 'ymd') return autoFormatDate(input);
  const d = input.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/** 순서대로 입력한 글자 → 저장용 YYYY-MM-DD. 덜 입력했거나 없는 날짜면 null */
export function orderedInputToIso(text: string, order: DateOrder): string | null {
  const d = text.replace(/\D/g, '');
  if (d.length !== 8) return null;
  const iso =
    order === 'ymd'
      ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
      : order === 'dmy'
        ? `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`
        : `${d.slice(4)}-${d.slice(0, 2)}-${d.slice(2, 4)}`;
  return isValidDateStr(iso) ? iso : null;
}

/** 저장용 YYYY-MM-DD → 고른 순서의 표시 글자. 올바른 날짜가 아니면 년/월/일은 그대로, 나머지는 빈칸 */
export function isoToOrderedInput(iso: string, order: DateOrder): string {
  if (order === 'ymd') return iso;
  if (!isValidDateStr(iso)) return '';
  const [y, m, d] = iso.split('-');
  return order === 'dmy' ? `${d}-${m}-${y}` : `${m}-${d}-${y}`;
}

/** dateStr에 개월 수를 더한다. 말일을 초과하면 그 달의 마지막 날로 클램프한다. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = m - 1 + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return formatDate(new Date(targetYear, targetMonth, Math.min(d, lastDay)));
}

/** 제조일+보관 기간 → 유통기한. 중국 기준(GB 7718)은 제조 당일·다음 날 시작을 둘 다 허용해서
 * 보수적으로 하루 전으로 계산한다(12개월이면 2026-03-10 → 2027-03-09). 잘못된 입력이면 null */
export function expiryFromManufacture(mfg: string, n: number, unit: 'month' | 'day'): string | null {
  if (!isValidDateStr(mfg) || !Number.isInteger(n) || n <= 0) return null;
  const [y, m, d] = mfg.split('-').map(Number);
  const end = unit === 'month' ? addMonths(mfg, n) : addDays(new Date(y, m - 1, d), n);
  const [ey, em, ed] = end.split('-').map(Number);
  return addDays(new Date(ey, em - 1, ed), -1);
}
