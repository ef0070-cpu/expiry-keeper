import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { mergeCatalogIntoProducts, type OrderCatalogRow } from './order-catalog-merge';
import { submitNewOrderProduct, submitPhotoCandidate } from './order-report';
import { newId } from './repo';
import { supabase } from './supabase';
import { OrderCart, OrderProduct } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';
const REMOVED_BARCODES_KEY = 'removedOrderBarcodes:v1';
const SUBMITTED_PHOTO_KEY = 'submittedPhotoCandidates:v1';
const CATEGORY_OVERRIDE_KEY = 'orderCategoryOverrides:v1';

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

async function getSubmittedPhotoCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_PHOTO_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedPhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  map.set(barcode, photoUri);
  await AsyncStorage.setItem(SUBMITTED_PHOTO_KEY, JSON.stringify(Object.fromEntries(map)));
}

/** 이 바코드에 마지막으로 제출한 사진과 다를 때만 새 후보로 제출한다 (같은 사진 반복 저장 시 후보 중복 방지). */
async function submitPhotoCandidateIfChanged(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  if (map.get(barcode) === photoUri) return;
  const submitted = await submitPhotoCandidate(barcode, photoUri);
  if (submitted) await recordSubmittedPhotoCandidate(barcode, photoUri);
}

/**
 * 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort).
 * 신규 등록(기존 id와 매칭 안 됨)이면 크라우드소싱 카탈로그 제안으로도 접수한다 (best-effort).
 * 사진이 이전 제출과 달라졌으면 새 사진 후보로 접수한다(submitPhotoCandidateIfChanged, best-effort) —
 * 대표 사진이 되려면 다른 사용자의 좋아요를 받아야 한다.
 */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const categoryChanged = !isNew && items[idx].category !== p.category;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
    submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
  }
  // 카테고리 수정은 공용 카탈로그 승인 절차를 안 거치므로, 다음 syncOrderCatalog가
  // 공용 값으로 도로 덮어쓰지 않도록 이 바코드의 로컬 지정값을 기억해둔다.
  if (categoryChanged && p.barcode) {
    recordCategoryOverride(p.barcode, p.category).catch(() => {});
  }
  return p;
}

export async function getRemovedBarcodes(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(REMOVED_BARCODES_KEY);
  return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
}

/** 바코드→사용자가 이 기기에서 직접 지정한 카테고리. syncOrderCatalog가 공용 값으로 덮어쓰지 않게 막는다. */
export async function getCategoryOverrides(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(CATEGORY_OVERRIDE_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordCategoryOverride(barcode: string, category: string): Promise<void> {
  const overrides = await getCategoryOverrides();
  overrides.set(barcode, category);
  await AsyncStorage.setItem(CATEGORY_OVERRIDE_KEY, JSON.stringify(Object.fromEntries(overrides)));
}

async function recordRemovedBarcode(barcode: string | null): Promise<void> {
  if (!barcode) return;
  const removed = await getRemovedBarcodes();
  removed.add(barcode);
  await AsyncStorage.setItem(REMOVED_BARCODES_KEY, JSON.stringify([...removed]));
}

export async function deleteOrderProduct(id: string): Promise<void> {
  const items = await listOrderProducts();
  const removed = items.find((p) => p.id === id);
  await writeOrderProducts(items.filter((p) => p.id !== id));
  if (removed) await recordRemovedBarcode(removed.barcode);
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

/** 공용 카탈로그(order_catalog)를 받아와 로컬 발주 상품 목록에 병합한다. 실패(오프라인 등)하면 조용히 무시. */
export async function syncOrderCatalog(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('order_catalog')
      .select('barcode, name, brand, price, category, image_uri');
    if (error || !data) return;

    const [items, removedBarcodes, categoryOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getCategoryOverrides(),
    ]);
    const rows = (data as OrderCatalogRow[]).map((row) =>
      categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row,
    );
    const { items: merged, changed } = mergeCatalogIntoProducts(items, rows, removedBarcodes);
    if (changed) await writeOrderProducts(merged);
  } catch {
    // best-effort: 오프라인 등 실패 시 기존 로컬 상태 유지
  }
}
