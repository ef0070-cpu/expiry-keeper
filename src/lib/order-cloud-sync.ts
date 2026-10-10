import { fetchAll } from './paged';
import { supabase } from './supabase';
import type { FridgeAssignment, FridgeSection, OrderCart, OrderProduct, Store } from './order-types';

// ---------- 매장 ----------

export async function pushStore(store: Store): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('order_stores')
    .upsert({ id: store.id, name: store.name }, { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteStoreCloud(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('order_stores').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchMyStores(): Promise<{ id: string; name: string }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('order_stores').select('id, name');
  if (error || !data) return [];
  return data as { id: string; name: string }[];
}

// ---------- 매장별 레이아웃(구역/구분선/배정) ----------

type StoreLayoutPartial = Partial<{
  sections: FridgeSection[];
  dividers: Record<string, string[]>;
  assignments: FridgeAssignment[];
}>;

export async function pushStoreLayoutPart(storeId: string, partial: StoreLayoutPartial): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('order_store_layout')
    .upsert(
      { store_id: storeId, ...partial, updated_at: new Date().toISOString() },
      { onConflict: 'store_id' },
    );
  if (error) throw error;
}

export type StoreLayout = {
  sections: FridgeSection[];
  dividers: Record<string, string[]>;
  assignments: FridgeAssignment[];
};

export async function fetchStoreLayout(storeId: string): Promise<StoreLayout | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('order_store_layout')
    .select('sections, dividers, assignments')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data as StoreLayout;
}

// ---------- 매장별 장바구니 ----------

export async function pushCart(storeId: string, items: OrderCart): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('order_carts')
    .upsert({ store_id: storeId, items, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
  if (error) throw error;
}

export async function fetchCart(storeId: string): Promise<{ items: OrderCart } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('order_carts')
    .select('items')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { items: OrderCart };
}

// ---------- 발주 상품 목록 자체 ----------

type OrderProductRow = {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  image_uri: string | null;
  status: string;
  aliases: string[];
};

function toOrderProduct(row: OrderProductRow): OrderProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    price: row.price,
    category: row.category,
    barcode: row.barcode,
    imageUri: row.image_uri,
    status: (row.status as OrderProduct['status']) ?? 'active',
    aliases: row.aliases ?? [],
  };
}

const toOrderProductRow = (p: OrderProduct, now: string) => ({
  id: p.id,
  name: p.name,
  brand: p.brand,
  price: p.price,
  category: p.category,
  barcode: p.barcode,
  image_uri: p.imageUri,
  status: p.status ?? 'active',
  aliases: p.aliases ?? [],
  updated_at: now,
});

export async function pushOrderProduct(p: OrderProduct): Promise<void> {
  return pushOrderProducts([p]);
}

/** 여러 상품을 한 번에 올린다(예전엔 상품마다 요청 1개라 첫 동기화에 수백 번 왕복했다) */
export async function pushOrderProducts(list: OrderProduct[]): Promise<void> {
  if (!supabase || list.length === 0) return;
  const client = supabase;
  const now = new Date().toISOString();
  const upsert = (rows: OrderProduct[]) =>
    client.from('order_products').upsert(rows.map((p) => toOrderProductRow(p, now)), { onConflict: 'id' });
  let firstError: unknown = null;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const { error } = await upsert(chunk);
    if (!error) continue;
    // 묶음 안 한 건(제약·권한) 때문에 나머지까지 못 올리지 않게 — 그 묶음만 한 개씩 다시
    for (const p of chunk) {
      const r = await upsert([p]);
      if (r.error) firstError ??= r.error;
    }
  }
  if (firstError) throw firstError;
}

export async function deleteOrderProductCloud(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('order_products').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchMyOrderProducts(): Promise<OrderProduct[]> {
  if (!supabase) return [];
  const client = supabase;
  // 실패하면 빈 목록이 아니라 오류 — 빈 목록이면 "서버에 아무것도 없다"로 보고 로컬 상품을 전부 다시
  // 올려, 다른 기기에서 고친 값을 옛 값으로 덮어쓸 수 있다. 호출부(syncOrderStores)가 그 회차를 건너뛴다.
  const rows = await fetchAll<OrderProductRow>((from, to) =>
    client
      .from('order_products')
      .select('id, name, brand, price, category, barcode, image_uri, status, aliases')
      .order('id')
      .range(from, to),
  );
  return rows.map(toOrderProduct);
}

// ---------- 발주 카테고리(검색 필터 칩) ----------

export async function pushCategories(recordId: string, categories: string[]): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('order_categories')
    .upsert(
      { id: recordId, categories, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
  if (error) throw error;
}

export async function fetchMyCategories(): Promise<{ id: string; categories: string[] } | null> {
  if (!supabase) return null;
  // 기기마다 서로 다른 레코드를 만들어버린 경우에도 항상 같은 행을 골라야 여러 기기가
  // 한 레코드로 수렴한다 — order 없는 limit(1)은 호출마다 다른 행을 반환할 수 있다.
  const { data, error } = await supabase
    .from('order_categories')
    .select('id, categories')
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; categories: string[] };
}
