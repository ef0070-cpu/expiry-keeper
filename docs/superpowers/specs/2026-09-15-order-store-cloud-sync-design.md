# 발주 매장/레이아웃/장바구니/상품목록 클라우드 동기화

**날짜:** 2026-09-15
**대상 프로젝트:** expiry-keeper

## 배경

발주(order) 기능의 로컬 데이터가 전부 AsyncStorage 전용이라, 앱을 삭제 후 재설치하면 통째로 사라진다. 사용자가 매장을 추가해 기록했는데 재설치 후 없어지는 걸 보고 이 설계를 시작했다.

전수 조사 결과 (`src/lib/order-repo.ts`), 로컬 전용 데이터는 6종류:

| AsyncStorage 키 | 내용 | 매장별? |
|---|---|---|
| `stores:v1` | 매장 목록 | - |
| `fridgeSections:{storeId}` | 구역 이름 목록 | ✅ |
| `fridgeSectionDividers:{storeId}` | 구역 내 가로 구분선(순수 시각) | ✅ |
| `fridgeAssignments:{storeId}` | 상품→구역 배정 | ✅ |
| `orderCart:{storeId}` / `orderCart:v1` | 장바구니 | ✅(매장 미선택 시 전역) |
| `orderProducts:v1` | 발주 상품 목록 자체 | 전역(매장 무관) |

사진(재고 상품 사진 로컬 저장, 발주 상품 사진 투표 미승격 문제)은 별도 조사에서 같은 근본 원인(로컬 전용 저장소는 앱 삭제 시 전부 사라짐)으로 확인됐지만, 메커니즘이 다르므로(테이블/RLS가 아니라 업로드 플로우) 이번 스펙의 범위에서 제외하고 별도 스펙으로 다룬다.

## 범위

1. 위 6종류 중 `stores:v1`, `fridgeSections`, `fridgeSectionDividers`, `fridgeAssignments`, 매장별 `orderCart`, `orderProducts:v1`을 Supabase에 동기화한다.
2. **매장 미선택 상태의 전역 장바구니(`orderCart:v1`)는 제외** — 매장 도입 전 과도기용 fallback이라 동기화 가치가 낮다. 로컬 전용으로 그대로 둔다.
3. 소유권은 재고 상품(`products` 테이블)과 동일한 패턴: 팀이 있으면 `team_id`로 팀 공유, 없으면 `user_id`로 개인 소유. 팀 가입/생성을 강제하지 않는다.
4. 동기화는 로컬 우선 + 백그라운드(실시간 구독 없음), 기존 `syncOrderCatalog()`와 같은 패턴. 실시간 공동편집이나 필드 단위 병합은 범위 밖(YAGNI) — 동시 편집 시 `updated_at` 최신 쪽이 전체를 덮어쓴다.
5. 이 기능 도입 이전부터 로컬에 쌓여있던 기존 사용자 데이터를 1회성으로 클라우드에 올리는 마이그레이션을 포함한다.
6. 사진 동기화, 실시간 협업, 필드별 병합은 범위 밖.

## 데이터 모델

테이블 4개, `products`/`teams` 기존 패턴을 그대로 따른다. `id`는 로컬에서 이미 쓰던 `newId()`(타임스탬프36+랜덤 문자열, UUID 아님) 형식을 그대로 서버 PK로 재사용하기 위해 `uuid` 대신 `text`로 둔다 — 별도 id 매핑 테이블이 필요 없어진다.

```sql
-- 매장
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
language plpgsql security definer
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

create policy "order_stores select" on public.order_stores for select using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
create policy "order_stores insert" on public.order_stores for insert with check (user_id = auth.uid());
create policy "order_stores update" on public.order_stores for update using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
) with check (team_id is null or team_id = public.my_team_id());
create policy "order_stores delete" on public.order_stores for delete using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);

-- 매장별 레이아웃(구역/구분선/배정) — 통짜 JSONB, 서버 쿼리 필요 없어 정규화하지 않음
create table if not exists public.order_store_layout (
  store_id text primary key references public.order_stores(id) on delete cascade,
  sections jsonb not null default '[]'::jsonb,
  dividers jsonb not null default '{}'::jsonb,
  assignments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.order_store_layout enable row level security;

create policy "order_store_layout select" on public.order_store_layout for select using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_store_layout insert" on public.order_store_layout for insert with check (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_store_layout update" on public.order_store_layout for update using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_store_layout delete" on public.order_store_layout for delete using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);

-- 매장별 장바구니
create table if not exists public.order_carts (
  store_id text primary key references public.order_stores(id) on delete cascade,
  items jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.order_carts enable row level security;

create policy "order_carts select" on public.order_carts for select using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_carts insert" on public.order_carts for insert with check (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_carts update" on public.order_carts for update using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);
create policy "order_carts delete" on public.order_carts for delete using (
  exists (
    select 1 from public.order_stores s where s.id = store_id
      and (s.user_id = auth.uid() or (s.team_id is not null and s.team_id = public.my_team_id()))
  )
);

-- 발주 상품 목록 자체 (재고 products 테이블과 대칭)
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
language plpgsql security definer
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

create policy "order_products select" on public.order_products for select using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
create policy "order_products insert" on public.order_products for insert with check (user_id = auth.uid());
create policy "order_products update" on public.order_products for update using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
) with check (team_id is null or team_id = public.my_team_id());
create policy "order_products delete" on public.order_products for delete using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
```

`set_order_store_owner`/`set_order_product_owner` 트리거는 `products` 테이블의 `set_product_owner`와 동일한 목적 — 클라이언트는 `user_id`/`team_id`를 신경 쓰지 않고 insert하면 트리거가 자동으로 채운다.

## 동기화 메커니즘

기존 `syncOrderCatalog()`(발주 카탈로그)와 동일한 로컬 우선 + 백그라운드 패턴을 그대로 따른다.

- **쓰기**: `addStore`/`renameStore`/`deleteStore`, `addFridgeSection`/`renameFridgeSection`/`deleteFridgeSection`/`reorderFridgeSections`, `assignToFridgeSection`, 장바구니 변경, `saveOrderProduct` 등 기존 함수들은 지금처럼 AsyncStorage에 즉시 반영하고, 그 뒤에 Supabase upsert를 best-effort로 붙인다(`.catch(() => {})`) — 실패해도 로컬 흐름을 막지 않는다.
- **읽기(pull)**: 앱 실행 시(`src/app/_layout.tsx`, 기존 `syncOrderCatalog()` 호출 옆) + 매장 발주 화면(`src/app/order.tsx`) 진입 시 새 `syncOrderStores()` 함수를 호출한다. 로직: 서버에서 내 매장/레이아웃/장바구니/발주상품을 전부 가져와, 로컬에 없는 서버 레코드는 추가하고, 로컬과 서버 둘 다 있으면 `updated_at`이 더 최신인 쪽을 채택한다. 로컬에만 있고 서버에 없는 레코드(아직 push 안 됐거나 실패한 경우)는 그대로 두고 이번 pull 끝에 재push를 시도한다.
- **동시 편집 한계**: `order_store_layout`은 매장당 한 행짜리 JSONB 통짜 값이라 부분 병합이 없다. 두 팀원이 동시에 다른 구역을 고치면 나중에 저장한 쪽이 통째로 이긴다. 매장 하나를 보통 소수 인원이 드물게 관리한다고 보고 수용하는 트레이드오프이며, 복잡한 필드별 병합 로직은 만들지 않는다.

## 기존 로컬 사용자 마이그레이션

앱 업데이트 후 로그인 상태에서 첫 실행 시 1회, 로컬에 있는 매장/레이아웃/장바구니/발주상품을 전부 Supabase에 upsert한다.

- 완료 플래그: `orderCloudMigrated:v1` (AsyncStorage). 마이그레이션이 전부 성공한 뒤에만 세운다.
- 부분 실패 시 플래그를 세우지 않아 다음 실행 때 안전하게 재시도한다(모든 upsert가 PK 기준 idempotent라 중복 걱정 없음).
- 비로그인 상태면 스킵하고, 다음 로그인 때 시도한다.
- 이 마이그레이션이 끝나면 평소 동기화(`syncOrderStores()`)가 이어받는다 — 별도 코드 경로가 계속 남지 않는다.

## 에러 처리

기존 관례 그대로 — push는 전부 best-effort, pull 실패(오프라인 등)는 조용히 무시하고 로컬 캐시를 그대로 쓴다.

## 테스트

자동화 테스트 스위트가 없는 수동 QA 앱(기존 관례). 구현 후 아래 시나리오를 수동으로 확인한다.

1. 매장 추가 → 앱 재실행 → Supabase 대시보드에서 `order_stores`에 행이 생겼는지 확인
2. 매장 추가 → 앱 삭제 → 재설치 → 로그인 → 매장 목록이 복원되는지 확인 (원래 문제 재현/해결 확인)
3. 매장에 구역 추가 + 상품 배정 + 장바구니에 담기 → 재설치 후 전부 복원되는지 확인
4. 팀에 속한 사용자 2명이 같은 매장을 각자 폰에서 열었을 때, 한쪽에서 추가한 구역/배정이 (앱 재실행 또는 화면 재진입 후) 다른 쪽에도 보이는지 확인
5. 팀 없는 개인 사용자 → 매장 추가 → 정상 동작, 팀 사용자의 매장이 안 보이는지 확인(RLS 격리 확인)
6. 오프라인 상태에서 매장 추가/구역 편집 → 정상 동작(로컬은 즉시 반영) → 온라인 복귀 후 다음 동기화에서 서버에 반영되는지 확인
7. 기존 로컬 데이터가 있는 사용자가 업데이트 후 처음 로그인 → 마이그레이션으로 기존 데이터가 서버에 올라가는지, 재실행해도 중복 안 생기는지 확인
