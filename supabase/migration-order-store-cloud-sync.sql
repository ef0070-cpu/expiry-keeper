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
