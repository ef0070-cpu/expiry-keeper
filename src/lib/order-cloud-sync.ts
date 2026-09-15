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

export async function pushOrderProduct(p: OrderProduct): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('order_products').upsert(
    {
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      category: p.category,
      barcode: p.barcode,
      image_uri: p.imageUri,
      status: p.status ?? 'active',
      aliases: p.aliases ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

export async function deleteOrderProductCloud(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('order_products').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchMyOrderProducts(): Promise<OrderProduct[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('order_products')
    .select('id, name, brand, price, category, barcode, image_uri, status, aliases');
  if (error || !data) return [];
  return (data as OrderProductRow[]).map(toOrderProduct);
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
  const { data, error } = await supabase
    .from('order_categories')
    .select('id, categories')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; categories: string[] };
}
