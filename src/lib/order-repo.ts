import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { submitCatalogPhotoFill, submitNewOrderProduct } from './order-report';
import { newId } from './repo';
import { supabase } from './supabase';
import { OrderCart, OrderProduct } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';
const APPLIED_UPDATES_KEY = 'appliedCatalogUpdateIds:v1';

const DEFAULT_CATEGORIES = ['바', '콘', '튜브', '샌드/기타', '홈/컵'];

// ---------- 카탈로그 ----------

export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  const items = raw ? (JSON.parse(raw) as OrderProduct[]) : [];
  return items.map((p) => ({ status: 'active' as const, ...p }));
}

async function writeOrderProducts(items: OrderProduct[]): Promise<void> {
  await AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(items));
}

export async function getOrderProduct(id: string): Promise<OrderProduct | null> {
  const items = await listOrderProducts();
  return items.find((p) => p.id === id) ?? null;
}

export async function listOrderProductsByBarcode(barcode: string): Promise<OrderProduct[]> {
  const items = await listOrderProducts();
  return items.filter((p) => p.barcode === barcode);
}

/**
 * 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort).
 * 신규 등록(기존 id와 매칭 안 됨)이면 크라우드소싱 카탈로그 제안으로도 접수한다 (best-effort).
 */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const hadNoPhoto = !isNew && !items[idx].imageUri;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (hadNoPhoto && p.imageUri && p.barcode) {
    submitCatalogPhotoFill(p.barcode, p.imageUri).catch(() => {});
  }
  return p;
}

export async function deleteOrderProduct(id: string): Promise<void> {
  const items = await listOrderProducts();
  await writeOrderProducts(items.filter((p) => p.id !== id));
  const cart = await getOrderCart();
  if (id in cart) {
    const next = { ...cart };
    delete next[id];
    await writeOrderCart(next);
  }
}

// ---------- 제품유형 카테고리 ----------

export async function listOrderCategories(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : DEFAULT_CATEGORIES;
}

async function writeOrderCategories(items: string[]): Promise<void> {
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(items));
}

export async function addOrderCategory(name: string): Promise<string[]> {
  const items = await listOrderCategories();
  if (items.includes(name)) return items;
  const next = [...items, name];
  await writeOrderCategories(next);
  return next;
}

export async function renameOrderCategory(from: string, to: string): Promise<void> {
  const categories = await listOrderCategories();
  await writeOrderCategories(categories.map((c) => (c === from ? to : c)));
  const products = await listOrderProducts();
  await writeOrderProducts(
    products.map((p) => (p.category === from ? { ...p, category: to } : p)),
  );
}

export async function deleteOrderCategory(name: string): Promise<void> {
  const items = await listOrderCategories();
  await writeOrderCategories(items.filter((c) => c !== name));
}

// ---------- 장바구니 ----------

export async function getOrderCart(): Promise<OrderCart> {
  const raw = await AsyncStorage.getItem(CART_KEY);
  return raw ? (JSON.parse(raw) as OrderCart) : {};
}

export async function writeOrderCart(cart: OrderCart): Promise<void> {
  await AsyncStorage.setItem(CART_KEY, JSON.stringify(cart));
}

/** 수량을 절대값으로 설정한다 (0 이하면 항목 제거). 갱신된 전체 카트를 반환한다. */
export async function setOrderCartQuantity(productId: string, qty: number): Promise<OrderCart> {
  const cart = await getOrderCart();
  const next = { ...cart };
  if (qty <= 0) delete next[productId];
  else next[productId] = qty;
  await writeOrderCart(next);
  return next;
}

export async function clearOrderCart(): Promise<void> {
  await writeOrderCart({});
}

/**
 * 발주 카탈로그가 완전히 비어 있을 때만 icemoa.com 기반 기본 상품 목록을 채운다.
 * 이미 상품이 하나라도 있으면 아무것도 하지 않고 0을 반환한다 (사용자 데이터를 덮어쓰지 않기 위함).
 * 대량(388건) 삽입이므로 개별 저장(saveOrderProduct)과 달리 barcode_catalog 공용 캐시에는 쓰지 않는다
 * — 다수의 개별 네트워크 호출을 피하기 위한 의도적 단순화 (공용 캐시는 이후 스캔 시 자연히 채워짐).
 */
export async function seedDefaultOrderProducts(): Promise<number> {
  const existing = await listOrderProducts();
  if (existing.length > 0) return 0;
  const items: OrderProduct[] = DEFAULT_ORDER_PRODUCTS.map((p) => ({ ...p, id: newId() }));
  await writeOrderProducts(items);
  return items.length;
}

type ApprovedReportRow = {
  id: string;
  kind: 'new' | 'fix';
  barcode: string | null;
  name: string;
  brand: string | null;
  price: number | null;
  category: string | null;
  photo_uri: string | null;
};

/** 승인됐지만 아직 이 기기에 반영 안 한 행과, 반영 완료 기록(appliedCatalogUpdateIds) Set을 함께 돌려준다. */
async function fetchUnappliedApprovedRows(): Promise<{
  rows: ApprovedReportRow[];
  applied: Set<string>;
}> {
  const appliedRaw = await AsyncStorage.getItem(APPLIED_UPDATES_KEY);
  const applied = new Set<string>(appliedRaw ? (JSON.parse(appliedRaw) as string[]) : []);
  if (!supabase) return { rows: [], applied };

  const { data, error } = await supabase
    .from('order_product_reports')
    .select('id, kind, barcode, name, brand, price, category, photo_uri')
    .eq('status', 'approved');
  if (error) throw error;

  const rows = ((data as ApprovedReportRow[] | null) ?? []).filter((row) => !applied.has(row.id));
  return { rows, applied };
}

/** Update 버튼에 미리 보여줄 대기 건수. 로그인 안 됐거나 조회 실패하면 0(버튼 비활성 상태 유지). */
export async function countApprovedCatalogUpdates(): Promise<number> {
  try {
    return (await fetchUnappliedApprovedRows()).rows.length;
  } catch {
    return 0;
  }
}

/**
 * 관리자가 승인한 카탈로그 변경(신제품 등록 제안 + 정보 오류 신고 수정)을 받아와 로컬 카탈로그에 반영한다.
 * 한 번 반영한 건은 appliedCatalogUpdateIds에 기록해 다음 Update 때 중복 반영하지 않는다.
 */
export async function syncApprovedCatalogUpdates(): Promise<{ added: number; fixed: number }> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { rows: pending, applied } = await fetchUnappliedApprovedRows();
  if (pending.length === 0) return { added: 0, fixed: 0 };

  const items = await listOrderProducts();
  let added = 0;
  let fixed = 0;

  for (const row of pending) {
    if (row.kind === 'new') {
      const exists = row.barcode
        ? items.some((p) => p.barcode === row.barcode)
        : items.some((p) => p.name === row.name && p.brand === row.brand);
      if (!exists) {
        items.push({
          id: newId(),
          name: row.name,
          brand: row.brand ?? '',
          price: row.price ?? 0,
          category: row.category ?? '',
          barcode: row.barcode,
          imageUri: row.photo_uri,
          status: 'active',
        });
        added++;
      }
    } else {
      const idx = row.barcode ? items.findIndex((p) => p.barcode === row.barcode) : -1;
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          name: row.name || items[idx].name,
          brand: row.brand || items[idx].brand,
          price: row.price ?? items[idx].price,
          category: row.category || items[idx].category,
          imageUri: row.photo_uri || items[idx].imageUri,
        };
        fixed++;
      }
    }
    applied.add(row.id);
  }

  await writeOrderProducts(items);
  await AsyncStorage.setItem(APPLIED_UPDATES_KEY, JSON.stringify([...applied]));
  return { added, fixed };
}
