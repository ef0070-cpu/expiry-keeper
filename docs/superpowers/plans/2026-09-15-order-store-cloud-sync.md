# 발주 매장/레이아웃/장바구니/상품목록 클라우드 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주(order) 기능의 매장/냉장고 레이아웃/장바구니/발주상품목록을 Supabase에 동기화해, 앱 재설치 시 사라지던 로컬 전용 데이터를 클라우드에서 복원할 수 있게 한다.

**Architecture:** `products` 테이블과 동일한 팀-또는-개인 소유 패턴으로 4개 Supabase 테이블(`order_stores`/`order_store_layout`/`order_carts`/`order_products`)을 신설한다. 클라이언트는 `order-cloud-sync.ts`(순수 Supabase I/O)와 `order-repo.ts`(로컬 읽기/쓰기 + 오케스트레이션)로 계층을 나누고, 기존 `syncOrderCatalog()`와 동일한 로컬 우선 + 백그라운드 best-effort push, 화면 진입 시 pull 패턴을 따른다.

**Tech Stack:** React Native (Expo Router), TypeScript, Supabase(Postgres + RLS + 트리거), AsyncStorage.

## Global Constraints

- 자동화 테스트 스위트 없음(기존 관례). 각 코드 작업 후 `npx tsc --noEmit`로 타입 체크. **베이스라인**: `src/app/login.tsx(115,45): error TS18047: 'supabase' is possibly 'null'.` 1건은 이 플랜과 무관한 기존 에러 — 이 한 줄 외에 새 에러가 없는지만 확인한다.
- **동기화 병합 규칙(스펙의 "updated_at 최신 채택"을 아래로 단순화함 — 이 플랜 작성 중의 의도적 판단)**: 로컬 컬렉션(매장 목록/발주상품 목록)은 id 기준으로 합치되, 로컬에 이미 있는 레코드는 항상 로컬을 신뢰하고(이미 매 수정마다 백그라운드 push가 따라붙으므로) 서버에만 있는 레코드만 새로 추가한다. 레이아웃(구역/구분선/배정)과 장바구니(매장당 통짜 값)는 해당 AsyncStorage 키가 이 기기에서 **한 번도 쓰인 적 없을 때만**(`getItem`이 `null`) 서버 값을 채택하고, 조금이라도 로컬에 쓰인 적 있으면 그대로 둔다. 별도의 `updated_at` 섀도 타임스탬프 키를 만들지 않는다 — 실제 문제(재설치 시 데이터 소실)를 해결하는 데는 이 단순 규칙으로 충분하고, 동시편집 시 정밀한 타임스탬프 비교보다 코드가 훨씬 적고 버그 표면도 작다.
- Supabase 마이그레이션 SQL은 대시보드 SQL Editor에 직접 붙여넣어 실행하는 방식(기존 관례). 이 플랜의 SQL 작업(Task 1)은 사람이 대시보드에서 직접 실행해야 하며, 에이전트가 대신 실행할 수 없다.
- 모든 cloud push 함수(`order-cloud-sync.ts`)는 **실패 시 에러를 던진다**(swallow하지 않음) — 호출부가 용도에 따라 다르게 처리한다: 로컬 쓰기 지점(Task 3·4)에서는 `.catch(() => {})`로 best-effort 처리하고, 1회성 마이그레이션(Task 6)에서는 던져지게 둬서 부분 실패를 감지해 완료 플래그를 세우지 않는다.
- `id`는 로컬 `newId()`(타임스탬프36+랜덤 문자열, UUID 아님) 형식을 그대로 서버 PK로 쓴다 — 새 테이블 `id`/`store_id` 컬럼은 전부 `text`.

---

### Task 1: Supabase 마이그레이션 — 매장/레이아웃/장바구니/발주상품 테이블

**Files:**
- Create: `supabase/migration-order-store-cloud-sync.sql`

**Interfaces:**
- Consumes: 기존 `public.teams`(컬럼 `id`), `public.my_team_id()` 함수(이미 존재, `schema.sql`에서 `products` 테이블 RLS가 쓰는 것과 동일한 함수를 재사용).
- Produces: 테이블 `order_stores(id, user_id, team_id, name, created_at, updated_at)`, `order_store_layout(store_id, sections, dividers, assignments, updated_at)`, `order_carts(store_id, items, updated_at)`, `order_products(id, user_id, team_id, name, brand, price, category, barcode, image_uri, status, aliases, created_at, updated_at)`. Task 2가 이 4개 테이블에 직접 쿼리한다 — 컬럼명이 정확히 일치해야 한다.

- [ ] **Step 1: SQL 파일 작성**

`supabase/migration-order-store-cloud-sync.sql` 생성:

```sql
-- 발주 매장/레이아웃/장바구니/상품목록 클라우드 동기화 (2026-09-15)
-- products 테이블과 동일한 팀-또는-개인 소유 패턴(team_id 있으면 팀 공유, 없으면 user_id로
-- 개인 소유). 클라이언트는 user_id/team_id를 신경 쓰지 않고 insert하면 트리거가 채운다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- ---------- 매장 ----------

create table if not exists public.order_stores (
  id text primary key,
  user_id uuid not null,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_order_store_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.team_id := public.my_team_id();
  return new;
end;
$$;

drop trigger if exists order_stores_set_owner on public.order_stores;
create trigger order_stores_set_owner
  before insert on public.order_stores
  for each row execute function public.set_order_store_owner();

alter table public.order_stores enable row level security;

drop policy if exists "order_stores select" on public.order_stores;
create policy "order_stores select" on public.order_stores for select using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
drop policy if exists "order_stores insert" on public.order_stores;
create policy "order_stores insert" on public.order_stores for insert with check (user_id = auth.uid());
drop policy if exists "order_stores update" on public.order_stores;
create policy "order_stores update" on public.order_stores for update using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
) with check (team_id is null or team_id = public.my_team_id());
drop policy if exists "order_stores delete" on public.order_stores;
create policy "order_stores delete" on public.order_stores for delete using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);

-- ---------- 매장별 레이아웃(구역/구분선/배정) ----------
-- 통짜 JSONB 3컬럼 — 서버에서 개별 검색할 일이 없고 항상 통째로 읽고 쓰므로 정규화하지 않는다.

create table if not exists public.order_store_layout (
  store_id text primary key references public.order_stores(id) on delete cascade,
  sections jsonb not null default '[]'::jsonb,
  dividers jsonb not null default '{}'::jsonb,
  assignments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.order_store_layout enable row level security;

drop policy if exists "order_store_layout select" on public.order_store_layout;
create policy "order_store_layout select" on public.order_store_layout for select using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_store_layout insert" on public.order_store_layout;
create policy "order_store_layout insert" on public.order_store_layout for insert with check (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_store_layout update" on public.order_store_layout;
create policy "order_store_layout update" on public.order_store_layout for update using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_store_layout delete" on public.order_store_layout;
create policy "order_store_layout delete" on public.order_store_layout for delete using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);

-- ---------- 매장별 장바구니 ----------

create table if not exists public.order_carts (
  store_id text primary key references public.order_stores(id) on delete cascade,
  items jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.order_carts enable row level security;

drop policy if exists "order_carts select" on public.order_carts;
create policy "order_carts select" on public.order_carts for select using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_carts insert" on public.order_carts;
create policy "order_carts insert" on public.order_carts for insert with check (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_carts update" on public.order_carts;
create policy "order_carts update" on public.order_carts for update using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
drop policy if exists "order_carts delete" on public.order_carts;
create policy "order_carts delete" on public.order_carts for delete using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);

-- ---------- 발주 상품 목록 자체 (재고 products 테이블과 대칭) ----------

create table if not exists public.order_products (
  id text primary key,
  user_id uuid not null,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  brand text not null default '',
  price numeric not null default 0,
  category text not null default '',
  barcode text,
  image_uri text,
  status text not null default 'active',
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_order_product_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.team_id := public.my_team_id();
  return new;
end;
$$;

drop trigger if exists order_products_set_owner on public.order_products;
create trigger order_products_set_owner
  before insert on public.order_products
  for each row execute function public.set_order_product_owner();

alter table public.order_products enable row level security;

drop policy if exists "order_products select" on public.order_products;
create policy "order_products select" on public.order_products for select using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
drop policy if exists "order_products insert" on public.order_products;
create policy "order_products insert" on public.order_products for insert with check (user_id = auth.uid());
drop policy if exists "order_products update" on public.order_products;
create policy "order_products update" on public.order_products for update using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
) with check (team_id is null or team_id = public.my_team_id());
drop policy if exists "order_products delete" on public.order_products;
create policy "order_products delete" on public.order_products for delete using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
```

- [ ] **Step 2: Supabase 대시보드에서 실행**

대시보드 → SQL Editor → 위 SQL 전체 실행. 에러 없이 완료되는지 확인.

- [ ] **Step 3: 확인 쿼리**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in
  ('order_stores', 'order_store_layout', 'order_carts', 'order_products');
```

4행이 나오는지 확인.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-order-store-cloud-sync.sql
git commit -m "feat: 발주 매장/레이아웃/장바구니/상품목록 Supabase 마이그레이션 추가"
```

---

### Task 2: `order-cloud-sync.ts` 신규 — 순수 Supabase I/O

**Files:**
- Create: `src/lib/order-cloud-sync.ts`

**Interfaces:**
- Consumes: Task 1이 만든 4개 테이블. `@/lib/supabase`의 `supabase` 클라이언트. `@/lib/order-types`의 `Store`, `FridgeSection`, `FridgeAssignment`, `OrderCart`, `OrderProduct` 타입.
- Produces: `pushStore(store: Store): Promise<void>`, `deleteStoreCloud(id: string): Promise<void>`, `pushStoreLayoutPart(storeId: string, partial: Partial<{sections: FridgeSection[]; dividers: Record<string, string[]>; assignments: FridgeAssignment[]}>): Promise<void>`, `pushCart(storeId: string, items: OrderCart): Promise<void>`, `pushOrderProduct(p: OrderProduct): Promise<void>`, `deleteOrderProductCloud(id: string): Promise<void>`, `fetchMyStores(): Promise<{id: string; name: string}[]>`, `fetchStoreLayout(storeId: string): Promise<{sections: FridgeSection[]; dividers: Record<string, string[]>; assignments: FridgeAssignment[]} | null>`, `fetchCart(storeId: string): Promise<{items: OrderCart} | null>`, `fetchMyOrderProducts(): Promise<(OrderProduct)[]>`. **모든 push*/delete* 함수는 실패 시 에러를 던진다(swallow하지 않음)** — Task 3·4·6이 용도에 따라 다르게 처리한다.
- **이 파일은 `@/lib/order-repo`를 import하지 않는다** (순환 참조 방지 — order-repo.ts가 이 파일을 import하므로 반대 방향은 없어야 한다).

이 파일은 이 프로젝트의 `src/lib/order-report.ts`(브랜드/상품명 후보 CRUD의 "순수 Supabase I/O" 계층)와 동일한 역할 — 로컬 읽기/쓰기는 전혀 하지 않는다.

- [ ] **Step 1: 파일 작성**

```ts
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
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/order-cloud-sync.ts
git commit -m "feat: order-cloud-sync.ts 신규 (매장/레이아웃/장바구니/발주상품 Supabase I/O)"
```

---

### Task 3: `order-repo.ts` — 매장/레이아웃/장바구니 쓰기 지점에 push 연결

**Files:**
- Modify: `src/lib/order-repo.ts:13` (import), `:229-253` (addStore/renameStore/deleteStore), `:286-288`(writeFridgeSections), `:381-383`(writeFridgeSectionDividers), `:411-413`(writeFridgeAssignments), `:476-478`(writeOrderCart)

**Interfaces:**
- Consumes: Task 2의 `pushStore`, `deleteStoreCloud`, `pushStoreLayoutPart`, `pushCart`.
- Produces: 없음(배선만) — 매장 추가/이름변경/삭제, 구역/구분선/배정 변경, 장바구니 변경이 자동으로 클라우드에 best-effort 반영됨.

- [ ] **Step 1: import 추가**

`src/lib/order-repo.ts` 13번째 줄(`import { supabase } from './supabase';`) 바로 아래에 추가:

```ts
import { deleteStoreCloud, pushCart, pushStore, pushStoreLayoutPart } from './order-cloud-sync';
```

- [ ] **Step 2: 매장 CRUD 3개 함수 교체**

기존(229~253줄):

```ts
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
```

교체:

```ts
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
```

- [ ] **Step 3: 레이아웃 3개 private 쓰기 함수 교체**

기존(286~288줄):

```ts
async function writeFridgeSections(storeId: string, sections: FridgeSection[]): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionsKey(storeId), JSON.stringify(sections));
}
```

교체:

```ts
async function writeFridgeSections(storeId: string, sections: FridgeSection[]): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionsKey(storeId), JSON.stringify(sections));
  pushStoreLayoutPart(storeId, { sections }).catch(() => {});
}
```

기존(381~383줄):

```ts
async function writeFridgeSectionDividers(storeId: string, map: Record<string, string[]>): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionDividersKey(storeId), JSON.stringify(map));
}
```

교체:

```ts
async function writeFridgeSectionDividers(storeId: string, map: Record<string, string[]>): Promise<void> {
  await AsyncStorage.setItem(fridgeSectionDividersKey(storeId), JSON.stringify(map));
  pushStoreLayoutPart(storeId, { dividers: map }).catch(() => {});
}
```

기존(411~413줄):

```ts
async function writeFridgeAssignments(storeId: string, list: FridgeAssignment[]): Promise<void> {
  await AsyncStorage.setItem(fridgeAssignmentsKey(storeId), JSON.stringify(list));
}
```

교체:

```ts
async function writeFridgeAssignments(storeId: string, list: FridgeAssignment[]): Promise<void> {
  await AsyncStorage.setItem(fridgeAssignmentsKey(storeId), JSON.stringify(list));
  pushStoreLayoutPart(storeId, { assignments: list }).catch(() => {});
}
```

- [ ] **Step 4: 장바구니 쓰기 함수 교체**

기존(476~478줄):

```ts
export async function writeOrderCart(cart: OrderCart): Promise<void> {
  await AsyncStorage.setItem(await resolveCartKey(), JSON.stringify(cart));
}
```

교체:

```ts
export async function writeOrderCart(cart: OrderCart): Promise<void> {
  await AsyncStorage.setItem(await resolveCartKey(), JSON.stringify(cart));
  const storeId = await getActiveStoreId();
  if (storeId) pushCart(storeId, cart).catch(() => {});
}
```

(매장 미선택 상태의 전역 장바구니는 스펙에 따라 동기화 대상이 아니므로 `storeId`가 없으면 push하지 않는다.)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 6: 수동 QA**

앱 실행 → 재고/발주 화면에서 로그인 → 매장 추가 → Supabase 대시보드에서 `select * from order_stores;` 확인 → 매장 안에 구역 추가 → `select * from order_store_layout;`에 sections가 채워지는지 확인.

- [ ] **Step 7: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 매장/레이아웃/장바구니 쓰기 지점에 클라우드 push 연결"
```

---

### Task 4: `order-repo.ts` — 발주 상품 CRUD에 push 연결

**Files:**
- Modify: `src/lib/order-repo.ts:13`(import 추가분에 이어서), `:62-98`(saveOrderProduct), `:156-167`(deleteOrderProduct)

**Interfaces:**
- Consumes: Task 2의 `pushOrderProduct`, `deleteOrderProductCloud`.
- Produces: 없음(배선만) — 발주 상품 추가/수정/삭제가 자동으로 클라우드에 best-effort 반영됨.

- [ ] **Step 1: import 추가**

Task 3의 import 줄을 다음으로 교체(같은 줄, 함수만 추가):

```ts
import { deleteOrderProductCloud, deleteStoreCloud, pushCart, pushOrderProduct, pushStore, pushStoreLayoutPart } from './order-cloud-sync';
```

- [ ] **Step 2: `saveOrderProduct` 끝에 push 추가**

기존(94~98줄, 함수 끝부분):

```ts
  if (priceChanged && p.barcode) {
    recordPriceOverride(p.barcode, p.price).catch(() => {});
    reportOrderProductIssue(p, '가격 수정 (앱에서 자동 제출됨)').catch(() => {});
  }
  return p;
}
```

교체:

```ts
  if (priceChanged && p.barcode) {
    recordPriceOverride(p.barcode, p.price).catch(() => {});
    reportOrderProductIssue(p, '가격 수정 (앱에서 자동 제출됨)').catch(() => {});
  }
  pushOrderProduct(p).catch(() => {});
  return p;
}
```

- [ ] **Step 3: `deleteOrderProduct`에 push 추가**

기존(156~167줄):

```ts
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
```

교체:

```ts
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
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 5: 수동 QA**

발주 상품 하나 등록/수정 → `select * from order_products where id = '<id>';`로 반영 확인. 그 상품 삭제 → 행이 사라지는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 발주 상품 CRUD에 클라우드 push 연결"
```

---

### Task 5: `order-repo.ts` — `syncOrderStores()` pull + 병합 구현

**Files:**
- Modify: `src/lib/order-repo.ts:13`(import에 fetch* 함수 추가), 파일 끝(새 함수 3개 추가)

**Interfaces:**
- Consumes: Task 2의 `fetchMyStores`, `fetchStoreLayout`, `fetchCart`, `fetchMyOrderProducts`, Task 2의 `pushStore`/`pushOrderProduct`(재push용). 같은 파일의 `listStores`/`writeStores`/`listOrderProducts`/`writeOrderProducts`/`fridgeSectionsKey`/`fridgeSectionDividersKey`/`fridgeAssignmentsKey`(전부 이미 이 파일에 있음).
- Produces: `syncOrderStores(): Promise<void>`. Task 7이 `_layout.tsx`/`order.tsx`에서 이 함수를 호출한다.

병합 규칙은 Global Constraints에 명시된 대로: 컬렉션(매장/발주상품)은 로컬에 이미 있는 id는 그대로 두고 서버에만 있는 id만 추가, 레이아웃/장바구니(매장당 통짜 값)는 로컬 AsyncStorage 키가 **한 번도 쓰인 적 없을 때만**(`getItem`이 `null`) 서버 값을 채택한다.

- [ ] **Step 1: import 교체**

Task 4에서 만든 import 줄을 다음으로 교체(fetch* 함수 추가):

```ts
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
```

- [ ] **Step 2: 파일 끝에 `syncOrderStores()` 추가**

`src/lib/order-repo.ts` 파일 끝(`clearAllCatalogUpdateBadges` 함수 뒤)에 추가:

```ts

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
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: syncOrderStores() pull + 병합 구현"
```

---

### Task 6: `order-repo.ts` — 기존 로컬 사용자 1회성 마이그레이션

**Files:**
- Modify: 파일 끝(새 함수 1개 추가)

**Interfaces:**
- Consumes: Task 2의 `pushStore`, `pushStoreLayoutPart`, `pushCart`, `pushOrderProduct`(전부 실패 시 던지는 버전을 그대로 사용 — `.catch()` 없이 호출해 실패가 바깥 try/catch로 전파되게 한다). 같은 파일의 `listStores`/`listFridgeSections`/`listFridgeSectionDividers`/`listFridgeAssignments`/`listOrderProducts`.
- Produces: `migrateLocalOrderDataToCloud(): Promise<void>`. Task 7이 `_layout.tsx`에서 로그인 시 호출한다.

- [ ] **Step 1: 파일 끝에 마이그레이션 함수 추가**

Task 5에서 추가한 코드 뒤에 이어서 추가:

```ts

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
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 기존 로컬 발주 데이터 1회성 클라우드 마이그레이션 추가"
```

---

### Task 7: `_layout.tsx`/`order.tsx` 배선 + 수동 QA

**Files:**
- Modify: `src/app/_layout.tsx:10-31`, `src/app/order.tsx:247-255`

**Interfaces:**
- Consumes: Task 5의 `syncOrderStores`, Task 6의 `migrateLocalOrderDataToCloud` (둘 다 `@/lib/order-repo`에서 import — 이미 `syncOrderCatalog`를 그 경로로 import하고 있으므로 같은 import 문에 추가).
- Produces: 없음(트리거 배선) — 앱 실행/로그인 시 마이그레이션+동기화, 발주 화면 진입 시 동기화가 일어남.

- [ ] **Step 1: `_layout.tsx` import 교체**

기존(11줄):

```ts
import { syncOrderCatalog } from '@/lib/order-repo';
```

교체:

```ts
import { migrateLocalOrderDataToCloud, syncOrderCatalog, syncOrderStores } from '@/lib/order-repo';
```

- [ ] **Step 2: `_layout.tsx`의 `useEffect` 교체**

기존(22~31줄):

```tsx
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    syncOrderCatalog();
    return () => sub.subscription.unsubscribe();
  }, []);
```

교체:

```tsx
  useEffect(() => {
    if (!supabase) return;
    const syncOrderStoreData = () => {
      migrateLocalOrderDataToCloud().then(() => syncOrderStores());
    };
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
      if (data.session) syncOrderStoreData();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) syncOrderStoreData();
    });
    syncOrderCatalog();
    return () => sub.subscription.unsubscribe();
  }, []);
```

- [ ] **Step 3: `order.tsx` import 확인 + `load()` 교체**

`src/app/order.tsx`에서 `syncOrderCatalog`를 import하는 줄에 `syncOrderStores`를 추가한다(정확한 import 문 위치는 파일을 열어 `syncOrderCatalog`를 import하는 줄을 찾아 같은 자리에서 `, syncOrderStores`를 추가).

기존(247~255줄):

```ts
  const load = useCallback(async () => {
    setSyncing(true);
    try {
      await syncOrderCatalog();
      await loadCatalog();
    } finally {
      setSyncing(false);
    }
  }, [loadCatalog]);
```

교체:

```ts
  const load = useCallback(async () => {
    setSyncing(true);
    try {
      await syncOrderCatalog();
      await syncOrderStores();
      await loadCatalog();
    } finally {
      setSyncing(false);
    }
  }, [loadCatalog]);
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 5: 수동 QA — 전체 시나리오**

1. 매장 추가 → 앱 재실행 → Supabase 대시보드에서 `order_stores`에 행이 생겼는지 확인
2. 매장 추가 + 구역 추가 + 상품 배정 + 장바구니에 담기 → 앱 삭제 → 재설치 → 로그인 → 발주 화면 진입 → 매장/구역/배정/장바구니가 전부 복원되는지 확인 (원래 문제 해결 확인)
3. 팀에 속한 사용자 2명이 같은 매장을 각자 폰에서 열었을 때, 한쪽에서 추가한 구역/배정이 (앱 재실행 또는 발주 화면 재진입 후) 다른 쪽에도 보이는지 확인
4. 팀 없는 개인 사용자 → 매장 추가 → 정상 동작, 팀 사용자의 매장이 안 보이는지 확인(RLS 격리 확인)
5. 오프라인 상태에서 매장 추가/구역 편집 → 정상 동작(로컬은 즉시 반영) → 온라인 복귀 후 다음 동기화에서 서버에 반영되는지 확인
6. 기존 로컬 데이터가 있는 사용자가 업데이트 후 처음 로그인 → 마이그레이션으로 기존 데이터가 서버에 올라가는지, 재실행해도 중복 안 생기는지 확인

- [ ] **Step 6: Commit**

```bash
git add src/app/_layout.tsx src/app/order.tsx
git commit -m "feat: 앱 실행/로그인/발주 화면 진입 시 매장 클라우드 동기화 트리거 연결"
```

---

## Self-Review Notes (계획 작성자용, 실행 불필요)

- **스펙 커버리지**: 09-15 스펙의 데이터 모델(4테이블) → Task 1, 동기화 메커니즘 → Task 3·4·5, 마이그레이션 → Task 6, 트리거 배선 → Task 7. 전부 대응됨. 단, "updated_at 최신 채택" 병합 규칙은 Global Constraints에 명시한 대로 더 단순한 "로컬에 있으면 로컬 신뢰" 규칙으로 대체했다(실제 문제 해결엔 충분하고 코드가 훨씬 적음) — 스펙 문서 자체는 수정하지 않았으나, 이 플랜이 실제로 구현하는 최종 규칙이다.
- **플레이스홀더 스캔**: 없음.
- **타입 일관성**: `order-cloud-sync.ts`의 `pushStore`/`fetchMyStores` 등이 반환/소비하는 필드명(`id`, `name`)이 `order-repo.ts`의 `Store` 타입과 일치. `OrderProductRow`→`OrderProduct` 변환(`toOrderProduct`)이 `image_uri`→`imageUri` 등 필드명 매핑을 정확히 반영. `syncOrderStores()`가 Task 2의 `fetchMyOrderProducts()`(이미 `OrderProduct[]`로 변환된 값을 반환)를 그대로 쓰는 것과 Task 6의 `pushOrderProduct(p: OrderProduct)`가 서로 대칭되는지 확인함 — 일치.
