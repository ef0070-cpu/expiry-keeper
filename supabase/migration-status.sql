-- 소진/폐기 기록 기능 마이그레이션 (2026-07-09)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- status: active(보관 중) / consumed(소진) / discarded(폐기)

alter table public.products
  add column if not exists status text not null default 'active',
  add column if not exists resolved_at timestamptz;

alter table public.products
  drop constraint if exists products_status_check;

alter table public.products
  add constraint products_status_check
  check (status in ('active', 'consumed', 'discarded'));
