import AsyncStorage from '@react-native-async-storage/async-storage';

export type OrderHistoryItem = { productId: string; name: string; qty: number };
export type OrderHistoryEntry = {
  id: string;
  ts: string; // ISO(UTC)
  storeId: string | null;
  storeName: string;
  items: OrderHistoryItem[]; // 상품명은 저장 시점 스냅샷
  summary: string;
  deliveryDate: string; // 'YYYY-MM-DD' 또는 ''
  memo: string;
};

const KEY = 'orderHistory:v1';
const MAX = 500;
const KST_MS = 9 * 3600 * 1000;

export function summarizeItems(names: string[]): string {
  if (names.length === 0) return '';
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}건`;
}

const kstIso = (d: Date | number | string) => new Date(new Date(d).getTime() + KST_MS).toISOString();

/** 한국 시간(KST) 기준 'YYYY-MM-DD' — 기기 시간대와 무관 */
export function ymdKst(d: Date | number | string): string {
  return kstIso(d).slice(0, 10);
}

export function hhmmKst(d: Date | number | string): string {
  return kstIso(d).slice(11, 16);
}

export function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function kstNow(): { ymd: string; hour: number; minute: number } {
  const s = kstIso(Date.now());
  return { ymd: s.slice(0, 10), hour: Number(s.slice(11, 13)), minute: Number(s.slice(14, 16)) };
}

export async function listOrderHistory(): Promise<OrderHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return (arr as OrderHistoryEntry[])
      .filter((e) => e && typeof e.ts === 'string' && Array.isArray(e.items))
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  } catch {
    return [];
  }
}

export async function addOrderHistory(e: {
  storeId: string | null;
  storeName: string;
  items: OrderHistoryItem[];
  deliveryDate: string;
  memo: string;
}): Promise<OrderHistoryEntry> {
  const ts = new Date().toISOString();
  const entry: OrderHistoryEntry = {
    ...e,
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    ts,
    summary: summarizeItems(e.items.map((i) => i.name)),
  };
  const list = await listOrderHistory();
  const next = [entry, ...list].slice(0, MAX); // 최신순 유지, 오래된 것부터 버림
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return entry;
}

/** entries는 최신순. 발주 횟수 많은 순, 같으면 더 최근에 나온 순 */
export function frequentProductIds(entries: OrderHistoryEntry[], limit = 20): string[] {
  const stat = new Map<string, { n: number; first: number }>();
  entries.forEach((en, idx) => {
    for (const id of new Set(en.items.map((i) => i.productId))) {
      const s = stat.get(id);
      if (s) s.n += 1;
      else stat.set(id, { n: 1, first: idx });
    }
  });
  return [...stat.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, limit)
    .map(([id]) => id);
}
