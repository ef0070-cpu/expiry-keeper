import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { newId } from './repo';
import { OrderCart, OrderProduct } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';

const DEFAULT_CATEGORIES = ['바', '콘', '튜브', '샌드/기타', '홈/컵'];

// ---------- 카탈로그 ----------

export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  return raw ? (JSON.parse(raw) as OrderProduct[]) : [];
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

/** 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort). */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  if (idx >= 0) items[idx] = p;
  else items.push(p);
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
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

async function writeOrderCart(cart: OrderCart): Promise<void> {
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
