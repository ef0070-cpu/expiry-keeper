import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { getCachedAppMode } from './settings';
import { supabase } from './supabase';
import { Product, ProductStatus } from './types';

const LOCAL_KEY = 'products:v1';

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- 로컬 저장 (AsyncStorage) ----------

async function localList(): Promise<Product[]> {
  const raw = await AsyncStorage.getItem(LOCAL_KEY);
  type LegacyProduct = Product & { category?: string | null; categories?: string[] };
  const items = raw ? (JSON.parse(raw) as LegacyProduct[]) : [];
  // 상태 필드 추가 전 상품은 '보관 중'으로, 카테고리가 단일값(category)이던 상품은
  // 배열(categories)로 변환해 취급한다.
  return items.map((p) => ({
    ...p,
    status: p.status ?? ('active' as ProductStatus),
    resolvedAt: p.resolvedAt ?? null,
    categories: p.categories ?? (p.category ? [p.category] : []),
    mode: p.mode ?? 'retail',
  }));
}

async function localWrite(items: Product[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(items));
}

// ---------- 클라우드 저장 (Supabase) ----------

interface ProductRow {
  id: string;
  barcode: string | null;
  name: string;
  image_uri: string | null;
  expiry_date: string;
  categories: string[] | null;
  memo: string | null;
  quantity: number;
  status: ProductStatus;
  resolved_at: string | null;
  created_at: string;
  mode: 'home' | 'retail';
}

function fromRow(r: ProductRow): Product {
  return {
    id: r.id,
    barcode: r.barcode,
    name: r.name,
    imageUri: r.image_uri,
    expiryDate: r.expiry_date,
    categories: r.categories ?? [],
    memo: r.memo,
    quantity: r.quantity,
    status: r.status ?? 'active',
    resolvedAt: r.resolved_at ?? null,
    createdAt: r.created_at,
    mode: r.mode ?? 'retail',
  };
}

function toRow(p: Product): ProductRow {
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    image_uri: p.imageUri,
    expiry_date: p.expiryDate,
    categories: p.categories,
    memo: p.memo,
    quantity: p.quantity,
    status: p.status,
    resolved_at: p.resolvedAt,
    created_at: p.createdAt,
    mode: p.mode,
  };
}

/** 로컬 사진(file:// 또는 content:// URI)을 Supabase Storage에 올리고 공개 URL을 돌려준다. */
async function uploadImageIfNeeded(p: Product): Promise<Product> {
  if (!supabase || !p.imageUri || p.imageUri.startsWith('http')) return p;
  try {
    const res = await fetch(p.imageUri);
    const buffer = await res.arrayBuffer();
    const path = `${p.id}.jpg`;
    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return p;
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return { ...p, imageUri: data.publicUrl };
  } catch {
    return p;
  }
}

// ---------- 공용 API ----------

export type ListFilter = 'active' | 'resolved' | 'all';

export async function listProducts(filter: ListFilter = 'active'): Promise<Product[]> {
  const mode = getCachedAppMode() ?? 'retail';
  if (supabase) {
    let query = supabase
      .from('products')
      .select('*')
      .eq('mode', mode)
      .order('expiry_date', { ascending: true });
    if (filter === 'active') query = query.eq('status', 'active');
    if (filter === 'resolved') query = query.neq('status', 'active');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as ProductRow[]).map(fromRow);
  }
  const items = await localList();
  const filtered = items.filter((p) => {
    if (p.mode !== mode) return false;
    if (filter === 'active') return p.status === 'active';
    if (filter === 'resolved') return p.status !== 'active';
    return true;
  });
  return filtered.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

/** 상품을 소진/폐기 처리한다. */
export async function resolveProduct(
  id: string,
  status: 'consumed' | 'discarded',
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  if (supabase) {
    const { error } = await supabase
      .from('products')
      .update({ status, resolved_at: resolvedAt })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  const items = await localList();
  await localWrite(items.map((p) => (p.id === id ? { ...p, status, resolvedAt } : p)));
}

/** 소진/폐기 처리를 취소하고 보관 중으로 되돌린다. */
export async function restoreProduct(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase
      .from('products')
      .update({ status: 'active', resolved_at: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  const items = await localList();
  await localWrite(
    items.map((p) => (p.id === id ? { ...p, status: 'active' as ProductStatus, resolvedAt: null } : p)),
  );
}

export async function getProduct(id: string): Promise<Product | null> {
  if (supabase) {
    const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data as ProductRow) : null;
  }
  const items = await localList();
  return items.find((p) => p.id === id) ?? null;
}

/** 추가/수정 겸용 저장 */
export async function saveProduct(p: Product): Promise<Product> {
  if (supabase) {
    const uploaded = await uploadImageIfNeeded(p);
    const { error } = await supabase.from('products').upsert(toRow(uploaded));
    if (error) throw new Error(error.message);
    // 실패해도 상품 저장 자체는 이미 끝났으니 조용히 무시한다 (best-effort).
    upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
    return uploaded;
  }
  const items = await localList();
  const idx = items.findIndex((x) => x.id === p.id);
  if (idx >= 0) items[idx] = p;
  else items.push(p);
  await localWrite(items);
  return p;
}

export async function deleteProduct(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  const items = await localList();
  await localWrite(items.filter((p) => p.id !== id));
}

/** 같은 바코드로 이미 등록된(보관중) 상품 목록을 조회한다. 실패 시 조용히 빈 배열을 반환한다. */
export async function listProductsByBarcode(barcode: string): Promise<Product[]> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('barcode', barcode)
        .eq('status', 'active')
        .order('expiry_date', { ascending: true });
      if (error) return [];
      return (data as ProductRow[]).map(fromRow);
    }
    const items = await localList();
    return items
      .filter((p) => p.barcode === barcode && p.status === 'active')
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  } catch {
    return [];
  }
}

/** 재고관리 상품들에 쓰인 카테고리(매장 등)를 중복 없이 정렬해 반환한다. */
export async function listProductCategories(): Promise<string[]> {
  try {
    const items = await listProducts();
    const set = new Set<string>();
    items.forEach((p) => p.categories.forEach((c) => set.add(c)));
    return [...set].sort();
  } catch {
    return [];
  }
}
