import { PUBLIC_ID_PREFIX } from './order-catalog-merge';
import { OrderProduct } from './order-types';

/**
 * 동기화 때 서버에 새로 올릴 상품인가. 서버에 이미 있으면 아니다. 공용 목록 사본(pub…)은 진열·장바구니에
 * 쓰인 것만 — 재설치 때 서버에서 받은 진열이 가리킬 상품이 있어야 하니까. 고친 사본은 저장할 때 따로 올라간다.
 */
export function needsCloudCopy(p: OrderProduct, remoteIds: Set<string>, referencedIds: Set<string>): boolean {
  if (remoteIds.has(p.id)) return false;
  return !p.id.startsWith(PUBLIC_ID_PREFIX) || referencedIds.has(p.id);
}

/**
 * 같은 바코드의 발주 상품이 여러 개면 가장 먼저 만든 사본(id가 가장 작은 것 — id 앞부분이 생성
 * 시각이라 글자순 = 생성순)만 남긴다. 어느 기기에서나 같은 결과가 나와야 한다 — 기기마다 다른
 * 기준(이 기기의 진열에 쓰였는지, 사진 유무)으로 고르면 두 기기가 동기화 때마다 서로의 사본을
 * 서버에서 번갈아 지운다. 재설치 땐 서버에 있던 옛 사본이 남아, 서버에서 받아온 진열과도 맞는다.
 * 지운 사본을 가리키던 진열·장바구니는 idRemap으로 옮기고, 남긴 상품의 빈 사진·별칭은 채운다.
 */
export function planBarcodeDedupe(items: OrderProduct[]): {
  items: OrderProduct[];
  idRemap: Map<string, string>;
} {
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
    let keeper = dupes.reduce((oldest, p) => (p.id < oldest.id ? p : oldest));
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
 * 배치가 서버 쪽(더 오래된) id를 가리키므로, 합친 뒤 planBarcodeDedupe가 오래된 쪽을 남기게 한다. */
export function mergeRemoteOrderProducts(
  local: OrderProduct[],
  remote: OrderProduct[],
  deletedIds: Set<string>,
): OrderProduct[] {
  const localIds = new Set(local.map((p) => p.id));
  return [...local, ...remote.filter((r) => !localIds.has(r.id) && !deletedIds.has(r.id))];
}
