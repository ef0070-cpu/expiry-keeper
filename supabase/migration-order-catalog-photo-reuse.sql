-- 발주 카탈로그 사진 크라우드 재활용 (2026-08-31)
-- 사용자가 자기 발주상품을 편집하며 추가한 사진을, 카탈로그에 사진이 없던 항목에 한해
-- 관리자 승인 없이 즉시 반영한다. 기존 kind='fix'(정보 오류 신고)는 여전히 관리자 승인이
-- 필요하므로(migration-order-report-restrict-photo-url.sql 참고), 사진 전용 자동승인
-- 경로를 별도 kind='photo_fill'로 분리한다. 악의적인 클라이언트가 kind='photo_fill'을
-- 사칭해 이름/가격 등 다른 필드까지 검토 없이 밀어넣지 못하도록, 이 kind는 photo_uri/
-- clear_photo 외 필드가 전부 비어 있을 때만 status='approved' insert를 허용한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- (order_product_reports, order-report-images 버킷은 이미 존재해야 함)

alter table public.order_product_reports
  add column if not exists clear_photo boolean not null default false;

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (
    (
      status = 'pending'
      or (kind = 'new' and status = 'approved')
      or (
        kind = 'photo_fill' and status = 'approved'
        and name = '' and (brand is null or brand = '') and price is null
        and (category is null or category = '') and message is null
        and not (photo_uri is not null and clear_photo = true)
      )
    )
    and (
      photo_uri is null
      or photo_uri like 'https://ocbwjiziwzkgkwzzkvvf.supabase.co/storage/v1/object/public/order-report-images/%'
    )
  );

create table if not exists public.order_photo_flags (
  barcode text not null,
  reporter_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (barcode, reporter_id)
);

alter table public.order_photo_flags enable row level security;

drop policy if exists "order_photo_flags insert" on public.order_photo_flags;
create policy "order_photo_flags insert" on public.order_photo_flags
  for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "order_photo_flags select" on public.order_photo_flags;
create policy "order_photo_flags select" on public.order_photo_flags
  for select to authenticated using (true);
