-- 발주 카테고리(검색 필터 칩) 클라우드 동기화 (2026-09-15)
-- 매장(order_stores)과 동일한 팀-또는-개인 소유 패턴. 한 팀(또는 개인)당 카테고리 목록 1행.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.order_categories (
  id text primary key,
  user_id uuid not null,
  team_id uuid references public.teams(id) on delete set null,
  categories jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_order_categories_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.team_id := public.my_team_id();
  return new;
end;
$$;

drop trigger if exists order_categories_set_owner on public.order_categories;
create trigger order_categories_set_owner
  before insert on public.order_categories
  for each row execute function public.set_order_categories_owner();

alter table public.order_categories enable row level security;

drop policy if exists "order_categories select" on public.order_categories;
create policy "order_categories select" on public.order_categories for select using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
drop policy if exists "order_categories insert" on public.order_categories;
create policy "order_categories insert" on public.order_categories for insert with check (user_id = auth.uid());
drop policy if exists "order_categories update" on public.order_categories;
create policy "order_categories update" on public.order_categories for update using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
) with check (team_id is null or team_id = public.my_team_id());
drop policy if exists "order_categories delete" on public.order_categories;
create policy "order_categories delete" on public.order_categories for delete using (
  user_id = auth.uid() or (team_id is not null and team_id = public.my_team_id())
);
