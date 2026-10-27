import { addDaysYmd, frequentProductIds, hhmmKst, summarizeItems, ymdKst, type OrderHistoryEntry } from './order-history';

console.assert(summarizeItems(['메로나', '붕어싸만코', '월드콘']) === '메로나 외 2건', 'summarize 3');
console.assert(summarizeItems(['메로나']) === '메로나', 'summarize 1');
console.assert(summarizeItems(Array.from({ length: 25 }, (_, i) => (i === 0 ? '메로나' : `p${i}`))) === '메로나 외 24건', 'summarize 25');

console.assert(ymdKst('2026-10-26T16:00:00.000Z') === '2026-10-27', 'ymdKst');
console.assert(ymdKst('2026-10-26T14:59:00.000Z') === '2026-10-26', 'ymdKst before midnight');
console.assert(hhmmKst('2026-10-26T16:05:00.000Z') === '01:05', 'hhmmKst');
console.assert(addDaysYmd('2026-10-31', 1) === '2026-11-01', 'addDays');
console.assert(addDaysYmd('2026-03-01', -1) === '2026-02-28', 'addDays back');

const e = (ids: string[]): OrderHistoryEntry => ({
  id: 'x', ts: '', storeId: null, storeName: '', summary: '', deliveryDate: '', memo: '',
  items: ids.map((productId) => ({ productId, name: productId, qty: 1 })),
});
// 최신순: [a,b] [b,c] [c,b]  -> b:3, c:2, a:1
const f = frequentProductIds([e(['a', 'b']), e(['b', 'c']), e(['c', 'b'])]);
console.assert(f.join() === 'b,c,a', 'frequent order');
// 동률이면 최근 것 먼저: d(최신) e
console.assert(frequentProductIds([e(['d']), e(['z'])]).join() === 'd,z', 'frequent tie');
console.assert(frequentProductIds([e(['a', 'b', 'c'])], 2).length === 2, 'frequent limit');
console.assert(frequentProductIds([]).length === 0, 'frequent empty');

console.log('order-history selfcheck OK');
