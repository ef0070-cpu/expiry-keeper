import { mergeRemoteOrderProducts, planBarcodeDedupe } from './order-dedupe';
import { OrderProduct } from './order-types';

const p = (id: string, barcode: string | null, extra: Partial<OrderProduct> = {}): OrderProduct => ({
  id,
  name: 'x',
  brand: '',
  price: 0,
  category: '',
  barcode,
  imageUri: null,
  ...extra,
});

// 재설치로 같은 바코드가 3개 — 빠른발주 배치에 쓰인 것(b)을 남기고, 사진·별칭은 중복에서 채운다
{
  const items = [p('a', '880'), p('b', '880'), p('c', '880', { imageUri: 'img', aliases: ['별'] }), p('d', '111')];
  const { items: next, idRemap } = planBarcodeDedupe(items, new Set(['b']));
  console.assert(next.length === 2, '880은 하나만: ' + next.length);
  const kept = next.find((x) => x.barcode === '880')!;
  console.assert(kept.id === 'b', '배치에 쓰인 상품을 남겨야 함: ' + kept.id);
  console.assert(kept.imageUri === 'img' && kept.aliases?.[0] === '별', '사진·별칭 보완');
  console.assert(idRemap.get('a') === 'b' && idRemap.get('c') === 'b', 'a,c → b로 옮김');
}
// 참조가 없으면 사진 있는 것, 그것도 없으면 먼저 있던 것
{
  const { items: next } = planBarcodeDedupe([p('a', '9'), p('b', '9', { imageUri: 'i' })], new Set());
  console.assert(next[0].id === 'b', '사진 있는 상품 우선');
  const { items: n2 } = planBarcodeDedupe([p('a', '9'), p('b', '9')], new Set());
  console.assert(n2.length === 1 && n2[0].id === 'a', '먼저 있던 상품');
}
// 바코드 없는 상품과 중복 없는 목록은 그대로
{
  const items = [p('a', null), p('b', null), p('c', '1')];
  const r = planBarcodeDedupe(items, new Set());
  console.assert(r.items.length === 3 && r.idRemap.size === 0, '건드리지 않음');
}

// 재발 방지(2026-09-29 실제 버그 재현): 앱을 새로 설치할 때마다 기본 상품이 새 id로 채워지고,
// 서버에 있던 이전 설치 상품이 id만 달라 또 추가돼 설치 횟수만큼 불어났다(1,425개 중 1,001개 중복).
// 설치를 3번 반복해도 바코드당 1개여야 하고, 서버에서 받아온 빠른발주 배치는 깨지면 안 된다.
{
  const barcodes = Array.from({ length: 50 }, (_, i) => `880${i}`);
  let seq = 0;
  const seed = () => barcodes.map((b) => p(`id${++seq}`, b)); // 설치 직후 기본 상품(매번 새 id)
  let server: OrderProduct[] = [];
  let serverAssignments: string[] = []; // 서버에 저장된 빠른발주 배치(상품 id)
  for (let install = 1; install <= 3; install++) {
    const local = seed();
    // 재설치 직후엔 배치도 서버에서 받아온다 — 서버 쪽 id를 가리킴
    const assignments = install === 1 ? [local[0].id, local[1].id] : serverAssignments;
    const merged = mergeRemoteOrderProducts(local, server, new Set());
    const { items, idRemap } = planBarcodeDedupe(merged, new Set(assignments));
    const liveAssignments = assignments.map((id) => idRemap.get(id) ?? id);
    console.assert(items.length === barcodes.length, `설치 ${install}회차: 중복이 쌓임 ${items.length}`);
    const ids = new Set(items.map((x) => x.id));
    console.assert(liveAssignments.every((id) => ids.has(id)), `설치 ${install}회차: 빠른발주 배치가 깨짐`);
    server = items; // 정리 결과가 서버와 맞춰진다(지운 id는 서버에서도 삭제)
    serverAssignments = liveAssignments;
  }
}
// 삭제 기록(tombstone)에 있는 서버 사본은 다시 받아오지 않는다
{
  const merged = mergeRemoteOrderProducts([p('a', '1')], [p('b', '1'), p('c', '2')], new Set(['b']));
  console.assert(merged.map((x) => x.id).join() === 'a,c', '삭제한 id가 되살아나면 안 됨');
}

console.log('order-dedupe selfcheck OK');
