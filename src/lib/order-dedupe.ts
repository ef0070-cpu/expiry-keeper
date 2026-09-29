import { OrderProduct } from './order-types';

/**
 * 같은 바코드의 발주 상품이 여러 개면 하나만 남긴다. 남길 것 고르는 순서:
 * 빠른발주 배치·장바구니에서 쓰는 상품(referencedIds) → 사진 있는 상품 → 먼저 있던 상품.
 * 배치에 쓰인 걸 남겨야 구역 진열이 깨지지 않는다(나머지 참조는 idRemap으로 옮긴다).
 * 남긴 상품의 빈 사진·별칭은 지워질 중복에서 채운다.
 */
export function planBarcodeDedupe(
  items: OrderProduct[],
  referencedIds: Set<string>,
): { items: OrderProduct[]; idRemap: Map<string, string> } {
  const groups = new Map<string, OrderProduct[]>();
  for (const p of items) {
    if (!p.barcode) continue;
    const list = groups.get(p.barcode) ?? [];
    list.push(p);
    groups.set(p.barcode, list);
  }

  const idRemap = new Map<string, string>(); // 지울 id -> 남길 id
  const keepers = new Map<string, OrderProduct>();
  for (const dupes of groups.values()) {
    if (dupes.length < 2) continue;
    const score = (p: OrderProduct) => (referencedIds.has(p.id) ? 2 : 0) + (p.imageUri ? 1 : 0);
    let keeper = dupes.reduce((best, p) => (score(p) > score(best) ? p : best));
    for (const dup of dupes) {
      if (dup.id === keeper.id) continue;
      keeper = {
        ...keeper,
        imageUri: keeper.imageUri ?? dup.imageUri,
        aliases: keeper.aliases?.length ? keeper.aliases : dup.aliases,
      };
      idRemap.set(dup.id, keeper.id);
    }
    keepers.set(keeper.id, keeper);
  }

  return {
    items: items.filter((p) => !idRemap.has(p.id)).map((p) => keepers.get(p.id) ?? p),
    idRemap,
  };
}

/** 서버에서 받은 상품 중 이 기기에 없는(id 기준) 것을 덧붙인다. 삭제 기록(tombstone)에 있는 id는
 * 되살리지 않는다. 바코드 중복은 여기서 거르지 않는다 — 재설치 직후엔 서버에서 받은 빠른발주
 * 배치가 서버 쪽 id를 가리키므로, 합친 뒤 planBarcodeDedupe가 배치에 쓰인 쪽을 남기게 해야 한다. */
export function mergeRemoteOrderProducts(
  local: OrderProduct[],
  remote: OrderProduct[],
  deletedIds: Set<string>,
): OrderProduct[] {
  const localIds = new Set(local.map((p) => p.id));
  return [...local, ...remote.filter((r) => !localIds.has(r.id) && !deletedIds.has(r.id))];
}
