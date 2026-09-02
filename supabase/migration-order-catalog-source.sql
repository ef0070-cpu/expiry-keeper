-- 발주 카탈로그 Supabase 기준 소스 전환 (2026-09-02)
-- order_catalog가 공용 발주 카탈로그의 정답 소스다. 일반 클라이언트는 이 테이블에
-- 직접 쓸 수 없고(insert/update 정책 없음), order_product_reports가 승인(approved)될
-- 때 아래 트리거가 SECURITY DEFINER로 자동 반영한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.order_catalog (
  barcode text primary key,
  name text not null,
  brand text,
  price numeric,
  category text,
  image_uri text,
  updated_at timestamptz not null default now()
);

alter table public.order_catalog enable row level security;

drop policy if exists "order_catalog select all" on public.order_catalog;
create policy "order_catalog select all" on public.order_catalog
  for select using (true);

create or replace function public.apply_approved_order_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'approved' or new.barcode is null then
    return new;
  end if;

  insert into public.order_catalog (barcode, name, brand, price, category, image_uri, updated_at)
  values (
    new.barcode,
    nullif(new.name, ''),
    nullif(new.brand, ''),
    new.price,
    nullif(new.category, ''),
    case when new.clear_photo then null else new.photo_uri end,
    now()
  )
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    brand = coalesce(nullif(excluded.brand, ''), order_catalog.brand),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    image_uri = case when new.clear_photo then null else coalesce(excluded.image_uri, order_catalog.image_uri) end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists order_product_reports_apply_approved on public.order_product_reports;
create trigger order_product_reports_apply_approved
  after insert or update of status on public.order_product_reports
  for each row
  when (new.status = 'approved')
  execute function public.apply_approved_order_report();
