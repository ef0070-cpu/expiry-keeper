-- 발주 상품 기본정보 오류 신고 테이블 (2026-08-27)
-- 발주 카탈로그(가격/이름/카테고리 등)는 기기 로컬에만 있어 서로 다른 사용자가 보는 값이
-- 다를 수 있다. 사용자가 틀린 정보를 신고하면 이 테이블에 쌓이고, 관리자(개발자)가
-- Supabase 대시보드 Table Editor에서 직접 확인 후 order-seed-data.ts를 고쳐 앱을 업데이트한다.
-- 별도 관리자 화면은 만들지 않는다 — 대시보드에서 표로 보는 것으로 충분.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- kind: 'new'(신규 상품 등록 제안) | 'fix'(기존 상품 정보 오류 신고)
-- status: 'pending'(대기, 기본값) | 'approved'(관리자 승인 — 승인 시 이 행의 필드값이 최종 반영값)
--         | 'rejected'(반려)
-- 승인 흐름: 사용자 제출 -> 이 표에 pending으로 쌓임 -> 관리자가 대시보드 Table Editor에서
-- (fix 건은 필요시 name/price/category/photo_uri를 실제 정답값으로 고친 뒤) status를 approved로 변경
-- -> 사용자가 발주 화면 "Update" 버튼을 누르면 approved 행을 읽어 로컬 카탈로그에 반영한다.
create table if not exists public.order_product_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'fix',
  status text not null default 'pending',
  barcode text,
  name text not null,
  brand text,
  price numeric,
  category text,
  message text,
  photo_uri text,
  created_at timestamptz not null default now()
);

alter table public.order_product_reports enable row level security;

-- 신고/제안 접수는 누구나(로그인 사용자) 가능하다.
drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated with check (true);

-- 승인된(status = 'approved') 행만 읽을 수 있다 — "Update" 버튼이 이걸로 카탈로그를 갱신한다.
-- pending/rejected는 select 정책이 없어 일반 사용자에게 노출되지 않는다
-- (관리자는 대시보드에서 RLS 우회로 전체 확인 가능).
drop policy if exists "order_product_reports select approved" on public.order_product_reports;
create policy "order_product_reports select approved" on public.order_product_reports
  for select to authenticated using (status = 'approved');

-- 신고 첨부 사진 저장용 Storage 버킷 (공개 읽기 — product-images 버킷과 동일한 패턴)
insert into storage.buckets (id, name, public)
values ('order-report-images', 'order-report-images', true)
on conflict (id) do nothing;

drop policy if exists "order_report_images insert" on storage.objects;
create policy "order_report_images insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'order-report-images');

drop policy if exists "order_report_images read" on storage.objects;
create policy "order_report_images read" on storage.objects
  for select using (bucket_id = 'order-report-images');
