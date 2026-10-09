import { mergeRemoteOrderProducts, needsCloudCopy, planBarcodeDedupe } from './order-dedupe';
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

// 같은 바코드 3개 — 가장 먼저 만든 사본(id가 가장 작은 a)을 남기고, 사진·별칭은 중복에서 채운다
{
  const items = [p('b', '880'), p('a', '880'), p('c', '880', { imageUri: 'img', aliases: ['별'] }), p('d', '111')];
  const { items: next, idRemap } = planBarcodeDedupe(items);
  console.assert(next.length === 2, '880은 하나만: ' + next.length);
  const kept = next.find((x) => x.barcode === '880')!;
  console.assert(kept.id === 'a', '가장 먼저 만든 사본을 남겨야 함: ' + kept.id);
  console.assert(kept.imageUri === 'img' && kept.aliases?.[0] === '별', '사진·별칭 보완');
  console.assert(idRemap.get('b') === 'a' && idRemap.get('c') === 'a', 'b,c → a로 옮김');
}
// 기기 두 대가 목록 순서·사진 유무가 달라도 같은 사본을 남겨야 서로 번갈아 지우지 않는다
{
  const onA = planBarcodeDedupe([p('m2', '9', { imageUri: 'i' }), p('m1', '9')]).items[0].id;
  const onB = planBarcodeDedupe([p('m1', '9'), p('m2', '9')]).items[0].id;
  console.assert(onA === 'm1' && onB === 'm1', `기기마다 결과가 다름: ${onA} / ${onB}`);
}
// 바코드 없는 상품과 중복 없는 목록은 그대로
{
  const r = planBarcodeDedupe([p('a', null), p('b', null), p('c', '1')]);
  console.assert(r.items.length === 3 && r.idRemap.size === 0, '건드리지 않음');
}

// 재발 방지(2026-09-29 실제 버그 재현): 앱을 새로 설치할 때마다 기본 상품이 새 id로 채워지고,
// 서버에 있던 이전 설치 상품이 id만 달라 또 추가돼 설치 횟수만큼 불어났다(1,425개 중 1,001개 중복).
// 설치를 3번 반복해도 바코드당 1개여야 하고, 서버에서 받아온 빠른발주 배치는 깨지면 안 된다.
{
  const barcodes = Array.from({ length: 50 }, (_, i) => `880${i}`);
  let seq = 0;
  // 설치 직후 기본 상품(매번 새 id). 실제 id처럼 뒤에 만든 것이 글자순으로도 뒤에 오게 자리수를 맞춘다
  const seed = () => barcodes.map((b) => p(`id${String(++seq).padStart(5, '0')}`, b));
  let server: OrderProduct[] = [];
  let serverAssignments: string[] = []; // 서버에 저장된 빠른발주 배치(상품 id)
  for (let install = 1; install <= 3; install++) {
    const local = seed();
    // 재설치 직후엔 배치도 서버에서 받아온다 — 서버 쪽 id를 가리킴
    const assignments = install === 1 ? [local[0].id, local[1].id] : serverAssignments;
    const merged = mergeRemoteOrderProducts(local, server, new Set());
    const { items, idRemap } = planBarcodeDedupe(merged);
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

{
  // 서버에 올릴 상품: 공용 목록 사본(pub…)은 진열·장바구니에 쓰인 것만
  const none = new Set<string>();
  console.assert(needsCloudCopy(p('mabc', '1'), none, none), '직접 만든 상품은 올린다');
  console.assert(!needsCloudCopy(p('pubmabc', '1'), none, none), '손대지 않은 공용 사본은 안 올린다');
  console.assert(needsCloudCopy(p('pubmabc', '1'), none, new Set(['pubmabc'])), '진열·장바구니에 쓰인 공용 사본은 올린다');
  console.assert(!needsCloudCopy(p('mabc', '1'), new Set(['mabc']), none), '이미 서버에 있으면 안 올린다');
  // 서버의 예전 사본(m…)이 새 공용 사본(pub…)보다 먼저라 중복 정리 때 남는다 — 재설치해도 서버 진열이 맞는다
  const { idRemap } = planBarcodeDedupe([p('pubm1', '9'), p('mzzz', '9')]);
  console.assert(idRemap.get('pubm1') === 'mzzz', '서버 사본이 남는다');
}

console.log('order-dedupe selfcheck OK');
