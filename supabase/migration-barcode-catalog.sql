-- 바코드 카탈로그 마이그레이션 (2026-08-14)
-- 사용자가 등록한 상품명·사진을 재사용해 다음 스캔 때 더 정확하게 자동 입력한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.barcode_catalog (
  barcode text primary key,
  name text not null,
  image_uri text,
  updated_at timestamptz not null default now()
);

alter table public.barcode_catalog enable row level security;

-- ponytail: 등록자 구분 없이 로그인 사용자 누구나 덮어쓸 수 있는 단순 공용 캐시.
-- 악의적 오염 방지가 필요해지면 등록자 신고/롤백 기능으로 확장할 것.
drop policy if exists "barcode_catalog select" on public.barcode_catalog;
create policy "barcode_catalog select" on public.barcode_catalog
  for select to authenticated using (true);

drop policy if exists "barcode_catalog insert" on public.barcode_catalog;
create policy "barcode_catalog insert" on public.barcode_catalog
  for insert to authenticated with check (true);

drop policy if exists "barcode_catalog update" on public.barcode_catalog;
create policy "barcode_catalog update" on public.barcode_catalog
  for update to authenticated using (true) with check (true);
