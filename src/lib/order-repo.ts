import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { mergeCatalogIntoProducts, type OrderCatalogRow } from './order-catalog-merge';
import { reportOrderProductIssue, submitNewOrderProduct } from './order-report';
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
  fetchMyCategories,
  fetchMyOrderProducts,
  fetchMyStores,
  fetchStoreLayout,
  pushCart,
  pushCategories,
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
const BRAND_OVERRIDE_KEY = 'orderBrandOverrides:v1';
const NAME_OVERRIDE_KEY = 'orderNameOverrides:v1';
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
export async function saveOrderProduct(rawP: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  // 신규 등록인데 같은 바코드의 상품이 이미 있으면 새로 만들지 않고 그 상품을 갱신한다 —
  // 그렇지 않으면 같은 바코드를 여러 번 등록할 때마다(재스캔, 중복 탭 등) id만 다른 중복
  // 상품이 계속 쌓인다(검색 결과에 같은 이름이 여러 줄 나오던 원인).
  const existingByBarcode =
    !items.some((x) => x.id === rawP.id) && rawP.barcode
      ? items.find((x) => x.barcode === rawP.barcode)
      : undefined;
  const p = existingByBarcode ? { ...rawP, id: existingByBarcode.id } : rawP;
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const categoryChanged = !isNew && items[idx].category !== p.category;
  const priceChanged = !isNew && items[idx].price !== p.price;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else {
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
  // 상품명 후보/투표 기능 제거됨 — apply_approved_order_report 트리거가 order_catalog.name을
  // 갱신하지 않으므로, 브랜드와 동일하게 로컬 오버라이드로 이 기기가 입력한 이름을 기억해둔다.
  if (p.barcode && p.name.trim()) {
    recordNameOverride(p.barcode, p.name).catch(() => {});
  }
  // 브랜드 후보/투표 기능 제거됨 — apply_approved_order_report 트리거가 order_catalog.brand를
  // 갱신하지 않으므로, 카테고리/가격과 동일하게 로컬 오버라이드로 이 기기가 입력한 브랜드를
  // 기억해둔다(없으면 다음 syncOrderCatalog가 빈 값으로 덮어쓴다).
  if (p.barcode && p.brand.trim()) {
    recordBrandOverride(p.barcode, p.brand).catch(() => {});
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

/** 바코드→사용자가 이 기기에서 직접 지정한 브랜드(브랜드 후보/투표 기능 제거로 도입 —
 * 카테고리 오버라이드와 동일한 이유). syncOrderCatalog가 공용 값(대부분 빈 값)으로 덮어쓰지 않게 막는다. */
export async function getBrandOverrides(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(BRAND_OVERRIDE_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordBrandOverride(barcode: string, brand: string): Promise<void> {
  const overrides = await getBrandOverrides();
  overrides.set(barcode, brand);
  await AsyncStorage.setItem(BRAND_OVERRIDE_KEY, JSON.stringify(Object.fromEntries(overrides)));
}

/** 바코드→사용자가 이 기기에서 직접 지정한 상품명(상품명 후보/투표 기능 제거로 도입 —
 * 브랜드 오버라이드와 동일한 이유). syncOrderCatalog가 공용 값으로 덮어쓰지 않게 막는다. */
export async function getNameOverrides(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(NAME_OVERRIDE_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordNameOverride(barcode: string, name: string): Promise<void> {
  const overrides = await getNameOverrides();
  overrides.set(barcode, name);
  await AsyncStorage.setItem(NAME_OVERRIDE_KEY, JSON.stringify(Object.fromEntries(overrides)));
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

const DELETED_ORDER_PRODUCT_IDS_KEY = 'deletedOrderProductIds:v1';

/** 삭제했지만 클라우드 삭제가 아직 확인 안 된 발주상품 id 목록(tombstone). syncOrderStores()의
 * pull 병합이 이 목록의 id는 서버에 남아있어도 로컬에 다시 추가하지 않게 막는다 — REMOVED_BARCODES_KEY와
 * 같은 목적(로컬 삭제가 다음 동기화에서 되살아나는 것 방지). */
async function getDeletedOrderProductIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(DELETED_ORDER_PRODUCT_IDS_KEY);
  return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
}

async function recordDeletedOrderProductId(id: string): Promise<void> {
  const ids = await getDeletedOrderProductIds();
  ids.add(id);
  await AsyncStorage.setItem(DELETED_ORDER_PRODUCT_IDS_KEY, JSON.stringify([...ids]));
}

async function clearDeletedOrderProductId(id: string): Promise<void> {
  const ids = await getDeletedOrderProductIds();
  if (!ids.delete(id)) return;
  await AsyncStorage.setItem(DELETED_ORDER_PRODUCT_IDS_KEY, JSON.stringify([...ids]));
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
  await recordDeletedOrderProductId(id);
  deleteOrderProductCloud(id)
    .then(() => clearDeletedOrderProductId(id))
    .catch(() => {});
}

/** 사진 후보에 좋아요를 눌러 그 사진을 내 상품 사진으로 즉시 반영한다. saveOrderProduct를
 * 쓰지 않는 이유: saveOrderProduct는 imageUri가 바뀌면 submitPhotoCandidateIfChanged로 "새
 * 후보 제출"까지 같이 하는데, 여기 photoUri는 이미 등록된 후보라 그러면 중복 후보 행이 생긴다.
 * 로컬 표시만 바꾸고, 오버라이드만 남겨 다음 syncOrderCatalog가 이 선택을 덮어쓰지 않게 한다. */
export async function applyOrderProductPhoto(barcode: string, photoUri: string): Promise<void> {
  const items = await listOrderProducts();
  const changedItems: OrderProduct[] = [];
  const next = items.map((p) => {
    if (p.barcode !== barcode || p.imageUri === photoUri) return p;
    const updated = { ...p, imageUri: photoUri };
    changedItems.push(updated);
    return updated;
  });
  if (changedItems.length > 0) {
    await writeOrderProducts(next);
    for (const p of changedItems) pushOrderProduct(p).catch(() => {});
  }
  await recordSubmittedPhotoCandidate(barcode, photoUri);
}

// ---------- 제품유형 카테고리 ----------

export async function listOrderCategories(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : DEFAULT_CATEGORIES;
}

const CATEGORIES_RECORD_ID_KEY = 'orderCategoriesRecordId:v1';

/** 이 팀(또는 개인)의 카테고리 레코드 id. 최초 한 번 생성해 로컬에 캐시하고 재사용한다 —
 * 팀 id를 그대로 PK로 쓰면 팀 탈퇴/가입 시 끊기므로 클라이언트가 독립적으로 생성한다. */
async function getOrCreateCategoriesRecordId(): Promise<string> {
  const existing = await AsyncStorage.getItem(CATEGORIES_RECORD_ID_KEY);
  if (existing) return existing;
  const id = newId();
  await AsyncStorage.setItem(CATEGORIES_RECORD_ID_KEY, id);
  return id;
}

async function writeOrderCategories(items: string[]): Promise<void> {
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(items));
  const recordId = await getOrCreateCategoriesRecordId();
  pushCategories(recordId, items).catch(() => {});
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
  const changed = products.filter((p) => p.category === from);
  if (changed.length === 0) return;
  await writeOrderProducts(
    products.map((p) => (p.category === from ? { ...p, category: to } : p)),
  );
  for (const p of changed) pushOrderProduct({ ...p, category: to }).catch(() => {});
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

const DELETED_STORE_IDS_KEY = 'deletedStoreIds:v1';

/** 삭제했지만 클라우드 삭제가 아직 확인 안 된 매장 id 목록(tombstone) — DELETED_ORDER_PRODUCT_IDS_KEY와
 * 동일 목적. */
async function getDeletedStoreIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(DELETED_STORE_IDS_KEY);
  return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
}

async function recordDeletedStoreId(id: string): Promise<void> {
  const ids = await getDeletedStoreIds();
  ids.add(id);
  await AsyncStorage.setItem(DELETED_STORE_IDS_KEY, JSON.stringify([...ids]));
}

async function clearDeletedStoreId(id: string): Promise<void> {
  const ids = await getDeletedStoreIds();
  if (!ids.delete(id)) return;
  await AsyncStorage.setItem(DELETED_STORE_IDS_KEY, JSON.stringify([...ids]));
}

export async function addStore(name: string): Promise<Store[]> {
  const stores = await listStores();
  const store = { id: newId(), name };
  const next = [...stores, store];
  await writeStores(next);
  // 매장 생성 직후 곧바로 구역/장바구니를 추가할 수 있어, 서버에 order_stores 행이 아직
  // 없는 상태로 그 push들이 도착해 FK 위반으로 조용히 실패하는 걸 막기 위해 await한다
  // (fire-and-forget이면 이 함수가 반환된 뒤에도 push가 안 끝났을 수 있다).
  await pushStore(store).catch(() => {});
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
  await recordDeletedStoreId(id);
  deleteStoreCloud(id)
    .then(() => clearDeletedStoreId(id))
    .catch(() => {});
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

    const [items, removedBarcodes, categoryOverrides, priceOverrides, brandOverrides, nameOverrides, photoOverrides] =
      await Promise.all([
        listOrderProducts(),
        getRemovedBarcodes(),
        getCategoryOverrides(),
        getPriceOverrides(),
        getBrandOverrides(),
        getNameOverrides(),
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
      const withBrand = brandOverrides.has(row.barcode)
        ? { ...withPrice, brand: brandOverrides.get(row.barcode)! }
        : withPrice;
      const withName = nameOverrides.has(row.barcode)
        ? { ...withBrand, name: nameOverrides.get(row.barcode)! }
        : withBrand;
      // 이 기기에서 직접 고른 사진은 투표로 대표사진이 되기 전까지 공용 값이 덮어쓰지 않게 한다
      // (카테고리/브랜드/상품명 오버라이드와 같은 이유).
      return photoOverrides.has(row.barcode)
        ? { ...withName, image_uri: photoOverrides.get(row.barcode)! }
        : withName;
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
    // 레코드 id를 아직 이 기기가 모른다면(신규 설치, 또는 이 기능 이전부터 쓰던 기기) 원격에
    // 이미 있는 레코드를 그대로 채택한다 — 로컬 카테고리가 이미 있어도 마찬가지다. 그렇지 않으면
    // 이 기기가 나중에 writeOrderCategories()에서 자기 것을 새로 만들어버려, 같은 계정을 쓰는
    // 다른 기기와 카테고리 목록이 영구히 갈라진다.
    const existingRecordId = await AsyncStorage.getItem(CATEGORIES_RECORD_ID_KEY);
    if (existingRecordId === null) {
      const remoteCategories = await fetchMyCategories();
      if (remoteCategories) {
        const localCategories = await listOrderCategories();
        const merged = Array.from(new Set([...localCategories, ...remoteCategories.categories]));
        await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(merged));
        await AsyncStorage.setItem(CATEGORIES_RECORD_ID_KEY, remoteCategories.id);
      }
    }
    const deletedStoreIds = await getDeletedStoreIds();
    for (const id of deletedStoreIds) {
      deleteStoreCloud(id).then(() => clearDeletedStoreId(id)).catch(() => {});
    }

    const [remoteStores, localStores] = await Promise.all([fetchMyStores(), listStores()]);
    const localStoreIds = new Set(localStores.map((s) => s.id));
    const remoteStoreIds = new Set(remoteStores.map((s) => s.id));

    const newFromRemote = remoteStores
      .filter((r) => !localStoreIds.has(r.id) && !deletedStoreIds.has(r.id))
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

    const deletedProductIds = await getDeletedOrderProductIds();
    for (const id of deletedProductIds) {
      deleteOrderProductCloud(id).then(() => clearDeletedOrderProductId(id)).catch(() => {});
    }

    const [remoteProducts, localProducts] = await Promise.all([fetchMyOrderProducts(), listOrderProducts()]);
    const localProductIds = new Set(localProducts.map((p) => p.id));
    const remoteProductIds = new Set(remoteProducts.map((p) => p.id));

    const newProductsFromRemote = remoteProducts.filter(
      (r) => !localProductIds.has(r.id) && !deletedProductIds.has(r.id),
    );
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

const ORDER_CLOUD_MIGRATED_KEY = 'orderCloudMigrated:v1';

/**
 * 이 기능 도입 이전부터 로컬에 있던 매장/레이아웃/장바구니/발주상품을 1회성으로 Supabase에
 * 올린다. 로그인 상태에서만 실행한다. 전부 성공해야 완료 플래그를 세운다 — 부분 실패 시
 * 플래그를 세우지 않아 다음 실행 때 안전하게 재시도한다(전부 PK 기준 upsert라 멱등).
 */
export async function migrateLocalOrderDataToCloud(): Promise<void> {
  if (!supabase) return;
  if (await AsyncStorage.getItem(ORDER_CLOUD_MIGRATED_KEY)) return;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;

  try {
    const categories = await listOrderCategories();
    const categoriesRecordId = await getOrCreateCategoriesRecordId();
    await pushCategories(categoriesRecordId, categories);

    const stores = await listStores();
    for (const store of stores) {
      await pushStore(store);
      const [sections, dividers, assignments, cartRaw] = await Promise.all([
        listFridgeSections(store.id),
        listFridgeSectionDividers(store.id),
        listFridgeAssignments(store.id),
        AsyncStorage.getItem(`orderCart:${store.id}`),
      ]);
      await pushStoreLayoutPart(store.id, { sections, dividers, assignments });
      if (cartRaw !== null) {
        await pushCart(store.id, JSON.parse(cartRaw) as OrderCart);
      }
    }
    const products = await listOrderProducts();
    for (const p of products) {
      await pushOrderProduct(p);
    }
    await AsyncStorage.setItem(ORDER_CLOUD_MIGRATED_KEY, '1');
  } catch {
    // 부분 실패 — 플래그를 세우지 않아 다음 실행 때 재시도
  }
}

const ORDER_PRODUCTS_DEDUPED_KEY = 'orderProductsDedupedByBarcode:v1';

/**
 * 과거 saveOrderProduct 버그(같은 바코드를 재등록할 때마다 id만 다른 새 상품이 생기던 문제,
 * 이제는 위 saveOrderProduct에서 막힘)로 이미 쌓인 중복 상품을 바코드 기준 1회성으로 정리한다.
 * 바코드별로 가장 먼저 등록된 걸 대표로 남기고(빈 사진/별칭은 중복 항목에서 보완), 나머지는
 * 지운다. 모든 매장(+ 매장 미선택 전역) 장바구니 수량은 대표 상품으로 합산하고, 냉장고 배정은
 * 매장별로 대표 상품 배정이 이미 있으면 중복 배정을 버린다.
 */
export async function dedupeOrderProductsByBarcode(): Promise<void> {
  if (await AsyncStorage.getItem(ORDER_PRODUCTS_DEDUPED_KEY)) return;

  const items = await listOrderProducts();
  const byBarcode = new Map<string, OrderProduct[]>();
  for (const p of items) {
    if (!p.barcode) continue;
    const list = byBarcode.get(p.barcode) ?? [];
    list.push(p);
    byBarcode.set(p.barcode, list);
  }

  const idRemap = new Map<string, string>(); // 제거될 id -> 대표 id
  const keepers = new Map<string, OrderProduct>(); // 대표 id -> 병합된 상품

  for (const dupes of byBarcode.values()) {
    if (dupes.length < 2) continue;
    let keeper = dupes[0];
    for (const dup of dupes.slice(1)) {
      keeper = {
        ...keeper,
        imageUri: keeper.imageUri ?? dup.imageUri,
        aliases: keeper.aliases?.length ? keeper.aliases : dup.aliases,
      };
      idRemap.set(dup.id, keeper.id);
    }
    keepers.set(keeper.id, keeper);
  }

  if (idRemap.size === 0) {
    await AsyncStorage.setItem(ORDER_PRODUCTS_DEDUPED_KEY, '1');
    return;
  }

  const removedIds = new Set(idRemap.keys());
  await writeOrderProducts(items.filter((p) => !removedIds.has(p.id)).map((p) => keepers.get(p.id) ?? p));

  const cartKeys = [CART_KEY, ...(await listStores()).map((s) => `orderCart:${s.id}`)];
  for (const key of cartKeys) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    const cart = JSON.parse(raw) as OrderCart;
    let changed = false;
    const next: OrderCart = {};
    for (const [productId, qty] of Object.entries(cart)) {
      const keeperId = idRemap.get(productId) ?? productId;
      if (keeperId !== productId) changed = true;
      next[keeperId] = (next[keeperId] ?? 0) + qty;
    }
    if (changed) await AsyncStorage.setItem(key, JSON.stringify(next));
  }

  for (const store of await listStores()) {
    const assignments = await listFridgeAssignments(store.id);
    if (assignments.length === 0) continue;
    const seen = new Set<string>();
    let changed = false;
    const next: FridgeAssignment[] = [];
    for (const a of assignments) {
      const keeperId = idRemap.get(a.productId) ?? a.productId;
      if (keeperId !== a.productId) changed = true;
      if (seen.has(keeperId)) {
        changed = true;
        continue; // 대표 상품이 이미 배정돼 있으면 중복 배정은 버린다
      }
      seen.add(keeperId);
      next.push(keeperId === a.productId ? a : { ...a, productId: keeperId });
    }
    if (changed) await AsyncStorage.setItem(fridgeAssignmentsKey(store.id), JSON.stringify(next));
  }

  for (const removedId of removedIds) deleteOrderProductCloud(removedId).catch(() => {});
  for (const keeper of keepers.values()) pushOrderProduct(keeper).catch(() => {});

  await AsyncStorage.setItem(ORDER_PRODUCTS_DEDUPED_KEY, '1');
}
