import type { OrderProduct } from './order-types';

/** repo.ts의 newId()와 동일한 로직. 이 파일을 tsx로 단독 실행 가능한 순수 로직으로 유지하기 위해
 * (repo.ts는 AsyncStorage 등 RN 전용 모듈을 함께 import해 tsx 번들링이 깨짐) 별도로 둔다. */
function defaultId(): string {
  return PUBLIC_ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 기본 상품·공용 카탈로그에서 그대로 만든 사본의 id 접두사. 이런 사본은 공용 목록에서 언제든 다시
 * 만들 수 있어 서버(order_products)에 올리지 않는다 — 예전엔 설치마다 약 400행이 올라가 표가 폭증했다.
 * 진열·장바구니에 쓰였거나 사용자가 고친 사본만 올린다(order-dedupe.ts needsCloudCopy).
 * 'p'는 시각 기반 일반 id(현재 'm…')보다 글자순으로 뒤라, 바코드 중복 정리 때 서버의 기존 사본이 남는다.
 */
export const PUBLIC_ID_PREFIX = 'pub';

export type OrderCatalogRow = {
  barcode: string;
  name: string;
  brand: string | null;
  price: number | null;
  category: string | null;
  image_uri: string | null;
};

/**
 * 로컬 발주 상품 목록에 공용 카탈로그(Supabase order_catalog) 값을 병합한다. IO 없는 순수 함수.
 * 바코드로 매칭되면 공용 필드(name/brand/price/category/imageUri)를 카탈로그 값으로 덮어쓴다
 * (공용 값이 항상 이김). 매칭 안 되고 removedBarcodes에도 없으면 신규 상품으로 추가한다
 * (사용자가 직접 삭제한 바코드는 재생성하지 않음).
 */
export function mergeCatalogIntoProducts(
  items: OrderProduct[],
  catalogRows: OrderCatalogRow[],
  removedBarcodes: Set<string>,
  makeId: () => string = defaultId,
): { items: OrderProduct[]; changed: boolean; newBarcodes: string[]; updatedBarcodes: string[] } {
  const next = items.map((p) => ({ ...p }));
  const byBarcode = new Map(
    next.filter((p): p is OrderProduct & { barcode: string } => !!p.barcode).map((p) => [p.barcode, p]),
  );
  let changed = false;
  const newBarcodes: string[] = [];
  const updatedBarcodes: string[] = [];

  for (const row of catalogRows) {
    const local = byBarcode.get(row.barcode);
    if (local) {
      const nextBrand = row.brand ?? '';
      const nextPrice = row.price ?? local.price;
      const nextCategory = row.category ?? local.category;
      if (
        local.name !== row.name ||
        local.brand !== nextBrand ||
        local.price !== nextPrice ||
        local.category !== nextCategory ||
        local.imageUri !== row.image_uri
      ) {
        local.name = row.name;
        local.brand = nextBrand;
        local.price = nextPrice;
        local.category = nextCategory;
        local.imageUri = row.image_uri;
        changed = true;
        updatedBarcodes.push(row.barcode);
      }
    } else if (!removedBarcodes.has(row.barcode)) {
      next.push({
        id: makeId(),
        name: row.name,
        brand: row.brand ?? '',
        price: row.price ?? 0,
        category: row.category ?? '',
        barcode: row.barcode,
        imageUri: row.image_uri,
        status: 'active',
      });
      changed = true;
      newBarcodes.push(row.barcode);
    }
  }

  return { items: next, changed, newBarcodes, updatedBarcodes };
}

// ---------- 발주 목록 "신규"·"수정" 표시 ----------

export type CatalogUpdateBadge = 'new' | 'updated';
/** seenAt: 화면에 처음 보인 시각(ms). 없으면 아직 못 봄 */
export type BadgeEntry = { kind: CatalogUpdateBadge; seenAt?: number };
/** 처음 본 뒤 이만큼 유지(사장님 결정 2026-10-10: 최소 하루). 예전엔 화면을 한 번 열면 바로 지워졌다 */
export const BADGE_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * 저장된 표시 정리. 처음 본 지 BADGE_KEEP_MS가 지난 것은 지우고, markSeen이면 아직 못 본 것에 지금 시각을
 * 찍는다(앱을 며칠 안 열어도 처음 볼 때부터 하루를 센다). 예전 형식({바코드: 'new'})도 읽는다. IO 없는 순수 함수.
 */
export function pruneBadges(
  raw: Record<string, BadgeEntry | CatalogUpdateBadge>,
  now: number,
  markSeen: boolean,
): Record<string, BadgeEntry> {
  const out: Record<string, BadgeEntry> = {};
  for (const [barcode, v] of Object.entries(raw)) {
    const e: BadgeEntry = typeof v === 'string' ? { kind: v } : v;
    if (e.seenAt !== undefined && now - e.seenAt >= BADGE_KEEP_MS) continue;
    out[barcode] = markSeen && e.seenAt === undefined ? { ...e, seenAt: now } : e;
  }
  return out;
}

export type BarcodeMove = { old_barcode: string; new_barcode: string };

/**
 * 공용 목록에서 승인된 바코드 변경(order_barcode_moves)을 로컬 상품에 적용한다. IO 없는 순수 함수.
 * 안 옮기면 예전 바코드 상품은 그대로 남고, 새 바코드 상품이 신규로 하나 더 생겨 중복된다.
 * 이미 새 바코드 상품이 로컬에 있으면 옮기지 않는다(중복은 dedupe가 정리) — 그대로 둔다.
 */
export function applyBarcodeMoves(
  items: OrderProduct[],
  moves: BarcodeMove[],
): { items: OrderProduct[]; moved: OrderProduct[] } {
  if (moves.length === 0) return { items, moved: [] };
  const to = new Map(moves.map((m) => [m.old_barcode, m.new_barcode]));
  const have = new Set(items.map((p) => p.barcode).filter(Boolean));
  const moved: OrderProduct[] = [];
  const next = items.map((p) => {
    const nb = p.barcode ? to.get(p.barcode) : undefined;
    if (!nb || have.has(nb)) return p;
    have.add(nb);
    const updated = { ...p, barcode: nb };
    moved.push(updated);
    return updated;
  });
  return { items: next, moved };
}
