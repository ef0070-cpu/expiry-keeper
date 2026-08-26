-- 바코드 카탈로그 수정자 추적 마이그레이션 (2026-08-26)
-- 공용 캐시(barcode_catalog)를 누가 마지막으로 덮어썼는지 기록해, 잘못된 이미지/이름이
-- 등록됐을 때 추적할 수 있게 한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.barcode_catalog
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

create or replace function public.set_barcode_catalog_updater()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists barcode_catalog_set_updater on public.barcode_catalog;
create trigger barcode_catalog_set_updater
  before insert or update on public.barcode_catalog
  for each row execute function public.set_barcode_catalog_updater();
