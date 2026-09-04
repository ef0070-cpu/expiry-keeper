import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { mergeCatalogIntoProducts, type OrderCatalogRow } from './order-catalog-merge';
import { submitNewOrderProduct } from './order-report';
import { getSubmittedPhotoCandidates, submitPhotoCandidateIfChanged } from './photo-candidates';
import { newId } from './repo';
import { supabase } from './supabase';
import { FridgeAssignment, FridgeSection, OrderCart, OrderProduct, Store } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';
const REMOVED_BARCODES_KEY = 'removedOrderBarcodes:v1';
const CATEGORY_OVERRIDE_KEY = 'orderCategoryOverrides:v1';
const CATALOG_UPDATE_BADGE_KEY = 'orderCatalogUpdateBadges:v1';
const STORES_KEY = 'stores:v1';
const ACTIVE_STORE_KEY = 'activeStoreId:v1';

export type CatalogUpdateBadge = 'new' | 'updated';

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
    // 로컬 오버라이드 기록까지는 기다린다(빠른 로컬 저장) — 그래야 저장 직후 목록으로 돌아가
    // syncOrderCatalog가 실행돼도 방금 고른 사진이 도로 덮어써지지 않는다. 네트워크 후보 제출
    // 자체는 이 함수 내부에서 best-effort로 처리되어 여기서 더 기다리지 않는다. 이 로컬 기록이
    // 실패해도(예: AsyncStorage 오류) 이미 저장된 상품 자체는 살아있으니 저장 실패로 취급하지 않는다.
    await submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
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

// ---------- 매장 ----------

export async function listStores(): Promise<Store[]> {
  const raw = await AsyncStorage.getItem(STORES_KEY);
  return raw ? (JSON.parse(raw) as Store[]) : [];
}

async function writeStores(stores: Store[]): Promise<void> {
  await AsyncStorage.setItem(STORES_KEY, JSON.stringify(stores));
}

export async function addStore(name: string): Promise<Store[]> {
  const stores = await listStores();
  const next = [...stores, { id: newId(), name }];
  await writeStores(next);
  return next;
}

export async function renameStore(id: string, name: string): Promise<Store[]> {
  const stores = await listStores();
  const next = stores.map((s) => (s.id === id ? { ...s, name } : s));
  await writeStores(next);
  return next;
}

/** 매장을 삭제하고 그 매장의 장바구니도 함께 지운다. 삭제한 매장이 선택돼 있었으면 선택을 해제한다
 * (해제되면 매장 미선택 상태의 전역 장바구니를 쓰게 된다). */
export async function deleteStore(id: string): Promise<Store[]> {
  const stores = await listStores();
  const next = stores.filter((s) => s.id !== id);
  await writeStores(next);
  await AsyncStorage.removeItem(`orderCart:${id}`);
  await AsyncStorage.removeItem(fridgeAssignmentsKey(id));
  if ((await getActiveStoreId()) === id) await setActiveStoreId(null);
  return next;
}

export async function getActiveStoreId(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_STORE_KEY);
}

export async function setActiveStoreId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(ACTIVE_STORE_KEY, id);
  else await AsyncStorage.removeItem(ACTIVE_STORE_KEY);
}

// ---------- 냉장고 구역 (전체 공용, 편집 가능) ----------

const FRIDGE_SECTIONS_KEY = 'fridgeSections:v1';
const DEFAULT_FRIDGE_SECTIONS: FridgeSection[] = ['600바', '1400콘류', '1400샌드류', '홈류'];

export async function listFridgeSections(): Promise<FridgeSection[]> {
  const raw = await AsyncStorage.getItem(FRIDGE_SECTIONS_KEY);
  return raw ? (JSON.parse(raw) as FridgeSection[]) : DEFAULT_FRIDGE_SECTIONS;
}

async function writeFridgeSections(sections: FridgeSection[]): Promise<void> {
  await AsyncStorage.setItem(FRIDGE_SECTIONS_KEY, JSON.stringify(sections));
}

export async function addFridgeSection(name: string): Promise<FridgeSection[]> {
  const sections = await listFridgeSections();
  if (sections.includes(name)) return sections;
  const next = [...sections, name];
  await writeFridgeSections(next);
  return next;
}

/** 구역 탭이 보이는 순서를 사용자가 드래그로 정한 순서로 저장한다. */
export async function reorderFridgeSections(orderedSections: FridgeSection[]): Promise<FridgeSection[]> {
  await writeFridgeSections(orderedSections);
  return orderedSections;
}

/** 구역 이름을 바꾸고, 이미 그 구역에 배정된 상품들(모든 매장)의 배정 기록도 새 이름으로
 * 맞춰준다 — 안 그러면 이름을 바꾸는 순간 기존에 배정해둔 상품들이 전부 사라진 것처럼 보인다. */
export async function renameFridgeSection(from: string, to: string): Promise<FridgeSection[]> {
  const sections = await listFridgeSections();
  const next = sections.map((s) => (s === from ? to : s));
  await writeFridgeSections(next);
  const stores = await listStores();
  for (const store of stores) {
    const assignments = await listFridgeAssignments(store.id);
    if (assignments.some((a) => a.section === from)) {
      await writeFridgeAssignments(
        store.id,
        assignments.map((a) => (a.section === from ? { ...a, section: to } : a)),
      );
    }
  }
  return next;
}

/** 구역을 삭제하고, 모든 매장에서 그 구역에 배정돼 있던 상품들의 배정 기록도 함께 지운다
 * (배정 기록만 지워질 뿐 상품 자체나 장바구니는 그대로 남는다). */
export async function deleteFridgeSection(name: string): Promise<FridgeSection[]> {
  const sections = await listFridgeSections();
  const next = sections.filter((s) => s !== name);
  await writeFridgeSections(next);
  const stores = await listStores();
  for (const store of stores) {
    const assignments = await listFridgeAssignments(store.id);
    if (assignments.some((a) => a.section === name)) {
      await writeFridgeAssignments(
        store.id,
        assignments.filter((a) => a.section !== name),
      );
    }
  }
  return next;
}

// ---------- 냉장고 구역 배정 (매장별) ----------

function fridgeAssignmentsKey(storeId: string): string {
  return `fridgeAssignments:${storeId}`;
}

export async function listFridgeAssignments(storeId: string): Promise<FridgeAssignment[]> {
  const raw = await AsyncStorage.getItem(fridgeAssignmentsKey(storeId));
  return raw ? (JSON.parse(raw) as FridgeAssignment[]) : [];
}

async function writeFridgeAssignments(storeId: string, list: FridgeAssignment[]): Promise<void> {
  await AsyncStorage.setItem(fridgeAssignmentsKey(storeId), JSON.stringify(list));
}

/** 상품을 이 매장의 특정 구역에 배정한다. 이미 다른 구역에 있었으면 그 구역에서 빼고 새 구역으로
 * 옮긴다(한 상품은 매장당 한 구역에만 있을 수 있음). */
export async function assignToFridgeSection(
  storeId: string,
  productId: string,
  section: FridgeSection,
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const next = [...list.filter((a) => a.productId !== productId), { productId, section }];
  await writeFridgeAssignments(storeId, next);
  return next;
}

export async function removeFromFridgeSection(
  storeId: string,
  productId: string,
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const next = list.filter((a) => a.productId !== productId);
  await writeFridgeAssignments(storeId, next);
  return next;
}

/** 한 구역 안에서 상품이 보이는 순서를 사용자가 드래그로 정한 순서로 저장한다. 다른 구역의
 * 배정은 그대로 두고, 이 구역 몫만 orderedProductIds 순서로 다시 쓴다. */
export async function reorderFridgeAssignments(
  storeId: string,
  section: FridgeSection,
  orderedProductIds: string[],
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const others = list.filter((a) => a.section !== section);
  const reordered = orderedProductIds.map((productId) => ({ productId, section }));
  const next = [...others, ...reordered];
  await writeFridgeAssignments(storeId, next);
  return next;
}

// ---------- 장바구니 ----------
// 매장을 선택 중이면 매장별로 분리된 장바구니(`orderCart:{storeId}`)를, 선택 안 했으면 기존
// 전역 카트(`orderCart:v1`)를 그대로 쓴다 — 매장을 안 쓰는 사용자는 동작이 그대로 유지된다.

async function resolveCartKey(): Promise<string> {
  const storeId = await getActiveStoreId();
  return storeId ? `orderCart:${storeId}` : CART_KEY;
}

export async function getOrderCart(): Promise<OrderCart> {
  const raw = await AsyncStorage.getItem(await resolveCartKey());
  return raw ? (JSON.parse(raw) as OrderCart) : {};
}

export async function writeOrderCart(cart: OrderCart): Promise<void> {
  await AsyncStorage.setItem(await resolveCartKey(), JSON.stringify(cart));
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

    const [items, removedBarcodes, categoryOverrides, photoOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getCategoryOverrides(),
      getSubmittedPhotoCandidates(),
    ]);
    const rows = (data as OrderCatalogRow[]).map((row) => {
      const withCategory = categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row;
      // 이 기기에서 직접 고른 사진은 투표로 대표사진이 되기 전까지 공용 값이 덮어쓰지 않게 한다
      // (카테고리 오버라이드와 같은 이유).
      return photoOverrides.has(row.barcode)
        ? { ...withCategory, image_uri: photoOverrides.get(row.barcode)! }
        : withCategory;
    });
    const { items: merged, changed, newBarcodes, updatedBarcodes } = mergeCatalogIntoProducts(
      items,
      rows,
      removedBarcodes,
    );
    if (changed) await writeOrderProducts(merged);
    if (newBarcodes.length || updatedBarcodes.length) {
      const badges = await getCatalogUpdateBadges();
      for (const b of newBarcodes) badges.set(b, 'new');
      for (const b of updatedBarcodes) badges.set(b, 'updated');
      await writeCatalogUpdateBadges(badges);
    }
  } catch {
    // best-effort: 오프라인 등 실패 시 기존 로컬 상태 유지
  }
}

/** 공용 카탈로그 동기화로 새로 추가되거나(new) 필드가 바뀐(updated) 상품의 바코드 목록.
 * 발주 목록 화면이 이걸로 "신규"/"수정" 뱃지를 표시하고 최상단에 올린다. 사용자가 해당 상품을
 * 열어보면 clearCatalogUpdateBadge로 지운다 — 안 그러면 계속 최상단에 남는다. */
export async function getCatalogUpdateBadges(): Promise<Map<string, CatalogUpdateBadge>> {
  const raw = await AsyncStorage.getItem(CATALOG_UPDATE_BADGE_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, CatalogUpdateBadge>) : {}));
}

async function writeCatalogUpdateBadges(badges: Map<string, CatalogUpdateBadge>): Promise<void> {
  await AsyncStorage.setItem(CATALOG_UPDATE_BADGE_KEY, JSON.stringify(Object.fromEntries(badges)));
}

export async function clearCatalogUpdateBadge(barcode: string): Promise<void> {
  const badges = await getCatalogUpdateBadges();
  if (!badges.delete(barcode)) return;
  await writeCatalogUpdateBadges(badges);
}
