import { OrderHistoryEntry } from './order-types';

// AsyncStorage 없이 순수 로직(그룹핑/필터)만 재구현해 검증한다.
// (order-repo.ts의 실제 함수는 AsyncStorage에 의존해 RN 밖에서 직접 실행할 수 없음)

const sample: OrderHistoryEntry[] = [
  {
    id: '1',
    dateKey: '2026-08-30',
    sentAt: '2026-08-30T01:52:00.000Z',
    branch: '대방동',
    items: [{ productId: 'a', name: '가나 초코바', qty: 2 }],
    totalBoxes: 2,
  },
  {
    id: '2',
    dateKey: '2026-08-30',
    sentAt: '2026-08-30T04:10:00.000Z',
    branch: '남양동',
    items: [{ productId: 'b', name: '고구마루바', qty: 1 }],
    totalBoxes: 1,
  },
  {
    id: '3',
    dateKey: '2026-08-29',
    sentAt: '2026-08-29T02:00:00.000Z',
    branch: '사파동',
    items: [{ productId: 'c', name: '수박바', qty: 3 }],
    totalBoxes: 3,
  },
];

function orderDatesSet(entries: OrderHistoryEntry[]): Set<string> {
  return new Set(entries.map((e) => e.dateKey));
}

function dayHistory(entries: OrderHistoryEntry[], dateKey: string): OrderHistoryEntry[] {
  return entries.filter((e) => e.dateKey === dateKey);
}

function deleteHistory(entries: OrderHistoryEntry[], id: string): OrderHistoryEntry[] {
  return entries.filter((e) => e.id !== id);
}

console.assert(orderDatesSet(sample).size === 2, '날짜별 Set 크기 오류');
console.assert(orderDatesSet(sample).has('2026-08-30'), '발주 있는 날짜가 Set에 없음');
console.assert(!orderDatesSet(sample).has('2026-08-31'), '발주 없는 날짜가 Set에 잘못 포함됨');

console.assert(dayHistory(sample, '2026-08-30').length === 2, '같은 날짜 여러 건 그룹핑 실패');
console.assert(dayHistory(sample, '2026-08-29').length === 1, '단일 건 그룹핑 실패');
console.assert(dayHistory(sample, '2026-08-01').length === 0, '내역 없는 날짜는 빈 배열이어야 함');

console.assert(deleteHistory(sample, '1').length === 2, '삭제 후 개수 오류');
console.assert(
  !deleteHistory(sample, '1').some((e) => e.id === '1'),
  '삭제 대상이 여전히 남아있음',
);

console.log('order-history selfcheck OK');
