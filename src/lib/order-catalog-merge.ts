import type { OrderProduct } from './order-types';

/** repo.ts의 newId()와 동일한 로직. 이 파일을 tsx로 단독 실행 가능한 순수 로직으로 유지하기 위해
 * (repo.ts는 AsyncStorage 등 RN 전용 모듈을 함께 import해 tsx 번들링이 깨짐) 별도로 둔다. */
function defaultId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

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
