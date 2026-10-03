-- 발주 상품 수정 제안 (2026-10-04)
-- 사용자가 공용 상품(바코드 있음)의 상품명·브랜드·가격·바코드를 고쳐 저장할 때 "제안하고 저장"을 고르면
-- order_product_reports에 kind='fix', status='pending'으로 바꾸자는 칸만 proposed에 담겨 접수된다.
-- 사장님이 Table Editor에서 status를 'approved'로 바꾸면 아래 트리거가 order_catalog에 반영하고,
-- 각 사용자는 다음 동기화(앱 시작·발주 관리 진입) 때 받는다. 거절은 'rejected'.
--
-- 함께 고치는 것: 신규 등록(kind='new')은 승인 없이 들어오는데, 이미 공용 목록에 있는 바코드면
-- 가격·카테고리를 덮어써서 아무나 전체 사용자 값을 바꿀 수 있었다 → 없는 바코드만 새로 넣는다.
-- 신규 등록의 브랜드도 공용 목록에 넣는다(예전엔 빠졌음).
--
-- 이 트리거 함수는 여러 마이그레이션에서 다시 정의돼 왔다 — 이 파일이 최신 전체 정의다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.order_product_reports
  add column if not exists proposed jsonb,  -- 바꾸자는 칸만: {"name","brand","price","barcode"}
  add column if not exists original jsonb;  -- 제안 당시 공용 목록 값(비교용)

-- 승인된 바코드 변경 기록. 앱이 동기화 때 읽어, 예전 바코드로 저장된 내 상품을 새 바코드로 옮긴다
-- (안 옮기면 예전 상품은 그대로 남고 새 바코드 상품이 하나 더 생겨 중복된다).
create table if not exists public.order_barcode_moves (
  old_barcode text primary key,
  new_barcode text not null,
  created_at timestamptz not null default now()
);
alter table public.order_barcode_moves enable row level security;
drop policy if exists "order_barcode_moves select all" on public.order_barcode_moves;
create policy "order_barcode_moves select all" on public.order_barcode_moves for select using (true);

create or replace function public.apply_approved_order_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p jsonb := new.proposed;
  nb text;
begin
  if new.status <> 'approved' or new.barcode is null then
    return new;
  end if;

  if new.kind = 'new' then
    insert into public.order_catalog (barcode, name, brand, price, category, updated_at)
    values (new.barcode, nullif(new.name, ''), nullif(new.brand, ''), new.price, nullif(new.category, ''), now())
    on conflict (barcode) do nothing;
    return new;
  end if;

  if new.kind = 'fix' and p is not null then
    update public.order_catalog set
      name = coalesce(nullif(p->>'name', ''), name),
      brand = case when p ? 'brand' then nullif(p->>'brand', '') else brand end,
      price = coalesce((p->>'price')::numeric, price),
      updated_at = now()
    where barcode = new.barcode;

    nb := nullif(trim(p->>'barcode'), '');
    -- 새 바코드가 이미 공용 목록에 있으면 옮기지 않는다(다른 상품과 겹침 — 사장님이 직접 정리).
    if nb is not null and nb <> new.barcode
       and not exists (select 1 from public.order_catalog where barcode = nb) then
      update public.order_catalog set barcode = nb, updated_at = now() where barcode = new.barcode;
      update public.order_catalog_photos set barcode = nb where barcode = new.barcode;
      insert into public.order_barcode_moves (old_barcode, new_barcode) values (new.barcode, nb)
      on conflict (old_barcode) do update set new_barcode = excluded.new_barcode, created_at = now();
    end if;
    return new;
  end if;

  -- 글로 쓴 예전 방식 신고(구버전 앱 포함): 이전과 똑같이 가격·카테고리만 반영
  insert into public.order_catalog (barcode, name, price, category, updated_at)
  values (new.barcode, nullif(new.name, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();
  return new;
end;
$$;
