-- 발주 상품 기본정보 오류 신고 테이블 (2026-08-27)
-- 발주 카탈로그(가격/이름/카테고리 등)는 기기 로컬에만 있어 서로 다른 사용자가 보는 값이
-- 다를 수 있다. 사용자가 틀린 정보를 신고하면 이 테이블에 쌓이고, 관리자(개발자)가
-- Supabase 대시보드 Table Editor에서 직접 확인 후 order-seed-data.ts를 고쳐 앱을 업데이트한다.
-- 별도 관리자 화면은 만들지 않는다 — 대시보드에서 표로 보는 것으로 충분.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.order_product_reports (
  id uuid primary key default gen_random_uuid(),
  barcode text,
  name text not null,
  brand text,
  price numeric,
  category text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.order_product_reports enable row level security;

-- 신고 접수만 하면 되므로 insert만 허용한다. select 정책을 두지 않아 일반 사용자는
-- 다른 사람이 제출한 신고 내용을 볼 수 없다 (관리자는 대시보드에서 RLS 우회로 확인).
drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated with check (true);
