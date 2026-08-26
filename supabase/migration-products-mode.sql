-- 가정용/소매용 완전 분리 마이그레이션 (2026-08-26)
-- products에 mode를 추가해, 등록 당시 앱 모드로 상품을 구분한다.
-- 기존에 이미 등록된 상품은 전부 retail(소매용)로 배정된다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.products
  add column if not exists mode text not null default 'retail' check (mode in ('home', 'retail'));
