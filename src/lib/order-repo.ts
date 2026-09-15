import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { mergeCatalogIntoProducts, type OrderCatalogRow } from './order-catalog-merge';
import { reportOrderProductIssue, submitNewOrderProduct } from './order-report';
import { submitBrandCandidateIfChanged } from './brand-candidates';
import { submitNameCandidateIfChanged } from './name-candidates';
import {
  getSubmittedPhotoCandidates,
  recordSubmittedPhotoCandidate,
  submitPhotoCandidateIfChanged,
} from './photo-candidates';
import { newId } from './repo';
import { supabase } from './supabase';
import {
  deleteOrderProductCloud,
  deleteStoreCloud,
  fetchCart,
  fetchMyOrderProducts,
  fetchMyStores,
  fetchStoreLayout,
  pushCart,
  pushOrderProduct,
  pushStore,
  pushStoreLayoutPart,
} from './order-cloud-sync';
import { FridgeAssignment, FridgeSection, OrderCart, OrderProduct, Store } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';
const REMOVED_BARCODES_KEY = 'removedOrderBarcodes:v1';
const CATEGORY_OVERRIDE_KEY = 'orderCategoryOverrides:v1';
const PRICE_OVERRIDE_KEY = 'orderPriceOverrides:v1';
const CATALOG_REFERENCE_PRICE_KEY = 'orderCatalogReferencePrice:v1';
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
  const brandChanged = !isNew && items[idx].brand !== p.brand;
  const priceChanged = !isNew && items[idx].price !== p.price;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else {
    // 신규 등록은 submitNewOrderProduct 내부에서 order_catalog 행 생성 뒤에 제출한다
    // (먼저 넣으면 대표 이름 재계산 UPDATE가 대상 행을 못 찾아 조용히 유실된다).
    if (p.barcode) {
      submitNameCandidateIfChanged(p.barcode, p.name).catch(() => {});
    }
    if (p.barcode && p.imageUri) {
      // 로컬 오버라이드 기록까지는 기다린다(빠른 로컬 저장) — 그래야 저장 직후 목록으로 돌아가
      // syncOrderCatalog가 실행돼도 방금 고른 사진이 도로 덮어써지지 않는다. 네트워크 후보 제출
      // 자체는 이 함수 내부에서 best-effort로 처리되어 여기서 더 기다리지 않는다. 이 로컬 기록이
      // 실패해도(예: AsyncStorage 오류) 이미 저장된 상품 자체는 살아있으니 저장 실패로 취급하지 않는다.
      await submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
    }
  }
  // 카테고리 수정은 공용 카탈로그 승인 절차를 안 거치므로, 다음 syncOrderCatalog가
  // 공용 값으로 도로 덮어쓰지 않도록 이 바코드의 로컬 지정값을 기억해둔다.
  if (categoryChanged && p.barcode) {
    recordCategoryOverride(p.barcode, p.category).catch(() => {});
  }
  // 브랜드는 이제 투표로 대표값이 결정되므로, 로컬 오버라이드 대신 후보로 제출한다(다른 후보와
  // 동률/신규일 때만 즉시 대표가 되고, 그 외엔 투표를 받아야 한다).
  if (brandChanged && p.barcode) {
    submitBrandCandidateIfChanged(p.barcode, p.brand).catch(() => {});
  }
  // 가격 수정은 매장마다 실제로 다를 수 있어(가맹점별 판매가 차이) 대표값으로 만들지 않는다.
  // 로컬 오버라이드만 남겨 동기화가 내 가격을 덮어쓰지 못하게 하고, 참고용 신고만 접수한다.
  if (priceChanged && p.barcode) {
    recordPriceOverride(p.barcode, p.price).catch(() => {});
    reportOrderProductIssue(p, '가격 수정 (앱에서 자동 제출됨)').catch(() => {});
  }
  pushOrderProduct(p).catch(() => {});
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

/** 바코드→사용자가 이 기기에서 직접 지정한 가격. syncOrderCatalog가 공용 값으로 덮어쓰지 않게 막는다. */
export async function getPriceOverrides(): Promise<Map<string, number>> {
  const raw = await AsyncStorage.getItem(PRICE_OVERRIDE_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, number>) : {}));
}

async function recordPriceOverride(barcode: string, price: number): Promise<void> {
  const overrides = await getPriceOverrides();
  overrides.set(barcode, price);
  await AsyncStorage.setItem(PRICE_OVERRIDE_KEY, JSON.stringify(Object.fromEntries(overrides)));
}

/** 공용 카탈로그(order_catalog)에 등록된 참고 가격 — 매장마다 실제 가격이 다를 수 있어
 * 내 가격에 자동 반영하지 않고, 화면에 "다른 매장 참고가"로만 보여주는 용도. */
export async function getCatalogReferencePrice(barcode: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(CATALOG_REFERENCE_PRICE_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[barcode] ?? null;
}

async function writeCatalogReferencePrices(map: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(CATALOG_REFERENCE_PRICE_KEY, JSON.stringify(map));
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
  deleteOrderProductCloud(id).catch(() => {});
}

/** 사진 후보에 좋아요를 눌러 그 사진을 내 상품 사진으로 즉시 반영한다. saveOrderProduct를
 * 쓰지 않는 이유: saveOrderProduct는 imageUri가 바뀌면 submitPhotoCandidateIfChanged로 "새
 * 후보 제출"까지 같이 하는데, 여기 photoUri는 이미 등록된 후보라 그러면 중복 후보 행이 생긴다.
 * 로컬 표시만 바꾸고, 오버라이드만 남겨 다음 syncOrderCatalog가 이 선택을 덮어쓰지 않게 한다. */
export async function applyOrderProductPhoto(barcode: string, photoUri: string): Promise<void> {
  const items = await listOrderProducts();
  let changed = false;
  const next = items.map((p) => {
    if (p.barcode !== barcode || p.imageUri === photoUri) return p;
    changed = true;
    return { ...p, imageUri: photoUri };
  });
  if (changed) await writeOrderProducts(next);
  await recordSubmittedPhotoCandidate(barcode, photoUri);
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
  const store = { id: newId(), name };
  const next = [...stores, store];
  await writeStores(next);
  pushStore(store).catch(() => {});
  return next;
}

export async function renameStore(id: string, name: string): Promise<Store[]> {
  const stores = await listStores();
  const next = stores.map((s) => (s.id === id ? { ...s, name } : s));
  await writeStores(next);
  const updated = next.find((s) => s.id === id);
  if (updated) pushStore(updated).catch(() => {});
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
  deleteStoreCloud(id).catch(() => {});
  return next;
}

export async function getActiveStoreId(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_STORE_KEY);
}

export async function setActiveStoreId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(ACTIVE_STORE_KEY, id);
  else await AsyncStorage.removeItem(ACTIVE_STORE_KEY);
}

// ---------- 냉장고 구역 (매장별, 편집 가능) ----------
// 매장마다 실제 냉동고 구성이 달라 구역 목록도 매장별로 따로 관리한다. 아직 이 저장소가 없는
// 매장(신규 매장, 또는 이 기능 이전부터 쓰던 기존 매장)은 DEFAULT_FRIDGE_SECTIONS로 시작한다.

const DEFAULT_FRIDGE_SECTIONS: FridgeSection[] = [
  '600바-1',
  '600바-2',
  '800바/1000바',
  '콘류',
  '샌드류',
  '홈류/상자류',
];

function fridgeSectionsKey(storeId: string): string {
  return `fridgeSections:${storeId}`;
}

export async function listFridgeSections(storeId: string): Promise<FridgeSection[]> {
  const raw = await AsyncStorage.getItem(fridgeSectionsKey(storeId));
  return raw ? (JSON.parse(raw) as FridgeSection[]) : DEFAULT_FRIDGE_SECTIONS;
}

async function writeFridgeSections(storeId: string, sections: FridgeSection[]): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionsKey(storeId), JSON.stringify(sections));
  pushStoreLayoutPart(storeId, { sections }).catch(() => {});
}

export async function addFridgeSection(storeId: string, name: string): Promise<FridgeSection[]> {
  const sections = await listFridgeSections(storeId);
  if (sections.includes(name)) return sections;
  const next = [...sections, name];
  await writeFridgeSections(storeId, next);
  return next;
}

/** 구역 탭이 보이는 순서를 사용자가 드래그로 정한 순서로 저장한다. */
export async function reorderFridgeSections(
  storeId: string,
  orderedSections: FridgeSection[],
): Promise<FridgeSection[]> {
  await writeFridgeSections(storeId, orderedSections);
  return orderedSections;
}

/** 구역 이름을 바꾸고, 이 매장에서 이미 그 구역에 배정된 상품들의 배정 기록도 새 이름으로
 * 맞춰준다 — 안 그러면 이름을 바꾸는 순간 기존에 배정해둔 상품들이 전부 사라진 것처럼 보인다. */
export async function renameFridgeSection(
  storeId: string,
  from: string,
  to: string,
): Promise<FridgeSection[]> {
  const sections = await listFridgeSections(storeId);
  const next = sections.map((s) => (s === from ? to : s));
  await writeFridgeSections(storeId, next);
  const assignments = await listFridgeAssignments(storeId);
  if (assignments.some((a) => a.section === from)) {
    await writeFridgeAssignments(
      storeId,
      assignments.map((a) => (a.section === from ? { ...a, section: to } : a)),
    );
  }
  const dividers = await listFridgeSectionDividers(storeId);
  if (from in dividers) {
    const { [from]: fromDividers, ...restDividers } = dividers;
    await writeFridgeSectionDividers(storeId, { ...restDividers, [to]: fromDividers });
  }
  return next;
}

/** 구역을 삭제하고, 이 매장에서 그 구역에 배정돼 있던 상품들의 배정 기록도 함께 지운다
 * (배정 기록만 지워질 뿐 상품 자체나 장바구니는 그대로 남는다). */
export async function deleteFridgeSection(storeId: string, name: string): Promise<FridgeSection[]> {
  const sections = await listFridgeSections(storeId);
  const next = sections.filter((s) => s !== name);
  await writeFridgeSections(storeId, next);
  const assignments = await listFridgeAssignments(storeId);
  if (assignments.some((a) => a.section === name)) {
    await writeFridgeAssignments(
      storeId,
      assignments.filter((a) => a.section !== name),
    );
  }
  const dividers = await listFridgeSectionDividers(storeId);
  if (name in dividers) {
    const { [name]: _removedDividers, ...restDividers } = dividers;
    await writeFridgeSectionDividers(storeId, restDividers);
  }
  return next;
}

/** 구역은 남기고, 이 매장에서 그 구역에 배정된 상품들만 전부 뺀다(진열 초기화).
 * deleteFridgeSection과 달리 구역 이름 자체는 목록에 그대로 남는다. */
export async function clearFridgeSection(storeId: string, name: string): Promise<FridgeAssignment[]> {
  const assignments = await listFridgeAssignments(storeId);
  const next = assignments.filter((a) => a.section !== name);
  await writeFridgeAssignments(storeId, next);
  const dividers = await listFridgeSectionDividers(storeId);
  if (name in dividers) {
    const { [name]: _removedDividers, ...restDividers } = dividers;
    await writeFridgeSectionDividers(storeId, restDividers);
  }
  return next;
}

// ---------- 구역별 가로 구분선 (매장별) ----------
// 실제 냉동고의 상/하단 선반 구분(가로 철망)을 화면에도 표시하기 위한 순수 시각 요소.
// 순서/열 개수와 달리 진열 순서에는 아무 영향을 주지 않는다. 그 줄(row)의 마지막 상품 id를
// 저장해서, 어느 상품에서 토글하든 항상 줄 전체 아래에 온전한 구분선이 그려지게 한다.

function fridgeSectionDividersKey(storeId: string): string {
  return `fridgeSectionDividers:${storeId}`;
}

export async function listFridgeSectionDividers(storeId: string): Promise<Record<string, string[]>> {
  const raw = await AsyncStorage.getItem(fridgeSectionDividersKey(storeId));
  return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
}

async function writeFridgeSectionDividers(storeId: string, map: Record<string, string[]>): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionDividersKey(storeId), JSON.stringify(map));
  pushStoreLayoutPart(storeId, { dividers: map }).catch(() => {});
}

export async function toggleFridgeSectionDivider(
  storeId: string,
  section: string,
  rowLastProductId: string,
): Promise<Record<string, string[]>> {
  const map = await listFridgeSectionDividers(storeId);
  const current = map[section] ?? [];
  const nextList = current.includes(rowLastProductId)
    ? current.filter((id) => id !== rowLastProductId)
    : [...current, rowLastProductId];
  const next = { ...map, [section]: nextList };
  await writeFridgeSectionDividers(storeId, next);
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
  pushStoreLayoutPart(storeId, { assignments: list }).catch(() => {});
}

/** 상품을 이 매장의 특정 구역에 배정한다.
 * mode 'move'(기본): 이미 다른 구역에 있었으면 그 구역에서 빼고 새 구역으로 옮긴다(한 상품이
 * 한 구역에만 있는 기존 동작).
 * mode 'duplicate': 다른 구역의 배정은 그대로 두고 이 구역에도 추가한다(실제 냉동고에 같은
 * 상품을 두 군데 진열해둔 경우처럼, 한 상품이 여러 구역에 동시에 있을 수 있게 함). */
export async function assignToFridgeSection(
  storeId: string,
  productId: string,
  section: FridgeSection,
  mode: 'move' | 'duplicate' = 'move',
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const withoutThisSection = list.filter((a) => !(a.productId === productId && a.section === section));
  const base = mode === 'move' ? withoutThisSection.filter((a) => a.productId !== productId) : withoutThisSection;
  const next = [...base, { productId, section }];
  await writeFridgeAssignments(storeId, next);
  return next;
}

/** mode 'duplicate'로 한 상품이 여러 구역에 동시에 배정될 수 있어, 특정 구역에서만 빼려면
 * section을 지정해야 한다 — 안 그러면 다른 구역의 배정까지 같이 사라진다. */
export async function removeFromFridgeSection(
  storeId: string,
  productId: string,
  section: FridgeSection,
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const next = list.filter((a) => !(a.productId === productId && a.section === section));
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
  const storeId = await getActiveStoreId();
  if (storeId) pushCart(storeId, cart).catch(() => {});
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

    const [items, removedBarcodes, categoryOverrides, priceOverrides, photoOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getCategoryOverrides(),
      getPriceOverrides(),
      getSubmittedPhotoCandidates(),
    ]);
    const referencePrices: Record<string, number> = {};
    for (const row of data as OrderCatalogRow[]) {
      if (row.price != null) referencePrices[row.barcode] = row.price;
    }
    writeCatalogReferencePrices(referencePrices).catch(() => {});

    const rows = (data as OrderCatalogRow[]).map((row) => {
      const withCategory = categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row;
      const withPrice = priceOverrides.has(row.barcode)
        ? { ...withCategory, price: priceOverrides.get(row.barcode)! }
        : withCategory;
      // 이 기기에서 직접 고른 사진은 투표로 대표사진이 되기 전까지 공용 값이 덮어쓰지 않게 한다
      // (카테고리 오버라이드와 같은 이유). 브랜드는 이제 오버라이드 없이 공용 값(투표 결과)을 그대로 쓴다.
      return photoOverrides.has(row.barcode)
        ? { ...withPrice, image_uri: photoOverrides.get(row.barcode)! }
        : withPrice;
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
 * 발주 목록 화면이 이걸로 "신규"/"수정" 뱃지를 표시하고 최상단에 올린다. 상품을 하나하나 열어봐야
 * 지워지면 사용자가 그렇게까지 안 하므로, 발주 화면을 한 번 띄운 것 자체를 "확인함"으로 보고
 * clearAllCatalogUpdateBadges로 한꺼번에 지운다(이번 화면엔 그대로 보이고, 다음부터 안 뜬다). */
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

/** 발주 화면을 한 번 확인한 것으로 보고 신규/수정 뱃지를 전부 지운다(개별 상품 열람 불필요). */
export async function clearAllCatalogUpdateBadges(): Promise<void> {
  await AsyncStorage.removeItem(CATALOG_UPDATE_BADGE_KEY);
}

// ---------- 매장/레이아웃/장바구니/발주상품 클라우드 동기화 ----------

/** 이 매장의 레이아웃(구역/구분선/배정)을 클라우드에서 당겨온다. 세 로컬 키 중 하나라도 이미
 * 이 기기에 쓰인 적 있으면(재설치 직후가 아니라면 거의 항상 그렇다) 건드리지 않는다 — 매
 * 수정마다 이미 push가 따라붙으므로 로컬이 서버보다 뒤처질 일이 없다. */
async function pullStoreLayoutIfLocalEmpty(storeId: string): Promise<void> {
  const [sectionsRaw, dividersRaw, assignmentsRaw] = await Promise.all([
    AsyncStorage.getItem(fridgeSectionsKey(storeId)),
    AsyncStorage.getItem(fridgeSectionDividersKey(storeId)),
    AsyncStorage.getItem(fridgeAssignmentsKey(storeId)),
  ]);
  if (sectionsRaw !== null && dividersRaw !== null && assignmentsRaw !== null) return;
  const layout = await fetchStoreLayout(storeId);
  if (!layout) return;
  if (sectionsRaw === null) {
    await AsyncStorage.setItem(fridgeSectionsKey(storeId), JSON.stringify(layout.sections));
  }
  if (dividersRaw === null) {
    await AsyncStorage.setItem(fridgeSectionDividersKey(storeId), JSON.stringify(layout.dividers));
  }
  if (assignmentsRaw === null) {
    await AsyncStorage.setItem(fridgeAssignmentsKey(storeId), JSON.stringify(layout.assignments));
  }
}

/** 이 매장의 장바구니를 클라우드에서 당겨온다. 로컬에 이미 있으면 건드리지 않는다. */
async function pullCartIfLocalEmpty(storeId: string): Promise<void> {
  const key = `orderCart:${storeId}`;
  const raw = await AsyncStorage.getItem(key);
  if (raw !== null) return;
  const cart = await fetchCart(storeId);
  if (!cart) return;
  await AsyncStorage.setItem(key, JSON.stringify(cart.items));
}

/**
 * 매장/레이아웃/장바구니/발주상품을 Supabase에서 당겨와 로컬과 합친다. 로컬에 없는 서버
 * 레코드는 추가하고, 로컬에 이미 있는 레코드는 그대로 둔다(이미 매 수정마다 push가 따라붙어
 * 로컬이 최신이라고 신뢰). 로컬에만 있고 서버에 없는 레코드(아직 push 안 됐거나 실패한 경우)는
 * 재push를 시도한다. 실패(오프라인 등)하면 조용히 무시 — 로컬 캐시를 그대로 쓴다.
 */
export async function syncOrderStores(): Promise<void> {
  if (!supabase) return;
  try {
    const [remoteStores, localStores] = await Promise.all([fetchMyStores(), listStores()]);
    const localStoreIds = new Set(localStores.map((s) => s.id));
    const remoteStoreIds = new Set(remoteStores.map((s) => s.id));

    const newFromRemote = remoteStores
      .filter((r) => !localStoreIds.has(r.id))
      .map((r) => ({ id: r.id, name: r.name }));
    if (newFromRemote.length > 0) {
      await writeStores([...localStores, ...newFromRemote]);
    }
    for (const local of localStores) {
      if (!remoteStoreIds.has(local.id)) pushStore(local).catch(() => {});
    }

    const allStoreIds = new Set([...localStoreIds, ...remoteStoreIds]);
    for (const storeId of allStoreIds) {
      await pullStoreLayoutIfLocalEmpty(storeId);
      await pullCartIfLocalEmpty(storeId);
    }

    const [remoteProducts, localProducts] = await Promise.all([fetchMyOrderProducts(), listOrderProducts()]);
    const localProductIds = new Set(localProducts.map((p) => p.id));
    const remoteProductIds = new Set(remoteProducts.map((p) => p.id));

    const newProductsFromRemote = remoteProducts.filter((r) => !localProductIds.has(r.id));
    if (newProductsFromRemote.length > 0) {
      await writeOrderProducts([...localProducts, ...newProductsFromRemote]);
    }
    for (const local of localProducts) {
      if (!remoteProductIds.has(local.id)) pushOrderProduct(local).catch(() => {});
    }
  } catch {
    // best-effort
  }
}
