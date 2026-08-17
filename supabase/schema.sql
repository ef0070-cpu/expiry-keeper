-- 유통기한 지킴이 — Supabase 스키마 (팀 기능 포함)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- ============================================================
-- 1) 팀 (매장)
-- ============================================================
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 팀 멤버 (한 사람은 한 팀에만 소속)
create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (user_id)
);

-- 내가 속한 팀 id (RLS 정책에서 재귀 없이 쓰기 위한 함수)
create or replace function public.my_team_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select team_id from public.team_members where user_id = auth.uid() limit 1;
$$;

-- ============================================================
-- 2) 상품 테이블 (team_id가 있으면 팀 공유, 없으면 개인)
-- ============================================================
create table public.products (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  barcode text,
  name text not null,
  image_uri text,
  expiry_date date not null,
  categories text[] not null default '{}',
  memo text,
  quantity integer not null default 1,
  status text not null default 'active' check (status in ('active', 'consumed', 'discarded')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index products_user_expiry_idx on public.products (user_id, expiry_date);
create index products_team_expiry_idx on public.products (team_id, expiry_date);

-- 새 상품 등록 시 소속 팀을 자동으로 채운다 (앱 코드는 신경 쓸 필요 없음)
create or replace function public.set_product_owner()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.team_id := public.my_team_id();
  return new;
end;
$$;

create trigger products_set_owner
  before insert on public.products
  for each row execute function public.set_product_owner();

-- ============================================================
-- 3) 행 수준 보안 (RLS)
-- ============================================================
alter table public.products enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- 상품: 내 개인 상품 + 우리 팀 상품
create policy "products select" on public.products
  for select using (
    user_id = auth.uid()
    or (team_id is not null and team_id = public.my_team_id())
  );

create policy "products insert" on public.products
  for insert with check (user_id = auth.uid());

create policy "products update" on public.products
  for update using (
    user_id = auth.uid()
    or (team_id is not null and team_id = public.my_team_id())
  ) with check (
    team_id is null or team_id = public.my_team_id()
  );

create policy "products delete" on public.products
  for delete using (
    user_id = auth.uid()
    or (team_id is not null and team_id = public.my_team_id())
  );

-- 팀: 내가 속한 팀만 조회 가능
create policy "teams select" on public.teams
  for select using (id = public.my_team_id());

-- 멤버 목록: 우리 팀 멤버만 조회 가능
create policy "members select" on public.team_members
  for select using (team_id = public.my_team_id());

-- 팀 생성/참여/탈퇴는 아래 함수로만 가능 (직접 insert/delete 불가)

-- ============================================================
-- 4) 팀 관리 함수 (앱에서 rpc로 호출)
-- ============================================================

-- 팀 만들기: 6자리 초대 코드를 만들어 돌려준다
create or replace function public.create_team(team_name text)
returns table (id uuid, name text, invite_code text)
language plpgsql security definer
set search_path = public
as $$
declare
  code text;
  new_team public.teams;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if exists (select 1 from public.team_members m where m.user_id = auth.uid()) then
    raise exception '이미 팀에 소속되어 있습니다. 먼저 팀을 나가주세요.';
  end if;
  if length(trim(team_name)) < 1 then
    raise exception '팀 이름을 입력해 주세요';
  end if;

  -- 겹치지 않는 초대 코드 생성
  loop
    code := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from public.teams t where t.invite_code = code);
  end loop;

  insert into public.teams (name, invite_code, owner_id)
  values (trim(team_name), code, auth.uid())
  returning * into new_team;

  insert into public.team_members (team_id, user_id, email)
  values (new_team.id, auth.uid(), (select u.email from auth.users u where u.id = auth.uid()));

  return query select new_team.id, new_team.name, new_team.invite_code;
end;
$$;

-- 초대 코드로 팀 참여
create or replace function public.join_team_by_code(code text)
returns table (id uuid, name text, invite_code text)
language plpgsql security definer
set search_path = public
as $$
declare
  found_team public.teams;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if exists (select 1 from public.team_members m where m.user_id = auth.uid()) then
    raise exception '이미 팀에 소속되어 있습니다. 먼저 팀을 나가주세요.';
  end if;

  select * into found_team from public.teams t where t.invite_code = upper(trim(code));
  if not found then
    raise exception '초대 코드가 올바르지 않습니다';
  end if;

  insert into public.team_members (team_id, user_id, email)
  values (found_team.id, auth.uid(), (select u.email from auth.users u where u.id = auth.uid()));

  return query select found_team.id, found_team.name, found_team.invite_code;
end;
$$;

-- 팀 나가기
--  · 마지막 멤버가 나가면 팀 자체가 삭제되고, 팀 상품은 각자 개인 상품으로 돌아간다
--  · 팀장이 나가려면 다른 멤버가 없어야 한다 (실수로 팀이 사라지는 것 방지)
create or replace function public.leave_team()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  my_team uuid;
  member_count integer;
  is_owner boolean;
begin
  my_team := public.my_team_id();
  if my_team is null then
    raise exception '소속된 팀이 없습니다';
  end if;

  select count(*) into member_count from public.team_members m where m.team_id = my_team;
  select (t.owner_id = auth.uid()) into is_owner from public.teams t where t.id = my_team;

  if is_owner and member_count > 1 then
    raise exception '팀장은 다른 멤버가 모두 나간 뒤에 팀을 없앨 수 있습니다';
  end if;

  -- 내가 팀에 등록한 상품은 내 개인 상품으로 돌린다
  update public.products p set team_id = null
  where p.team_id = my_team and p.user_id = auth.uid();

  delete from public.team_members m where m.team_id = my_team and m.user_id = auth.uid();

  -- 마지막 멤버였다면 팀 삭제 (남은 팀 상품은 각자 개인으로 — on delete set null)
  if member_count = 1 then
    delete from public.teams t where t.id = my_team;
  end if;
end;
$$;

-- ============================================================
-- 5) 상품 사진 저장용 Storage 버킷 (공개 읽기)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images');

create policy "authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images');

create policy "public read" on storage.objects
  for select using (bucket_id = 'product-images');

-- ============================================================
-- 6) 바코드 카탈로그 (사용자가 등록한 상품명·사진을 재사용)
-- ============================================================
create table public.barcode_catalog (
  barcode text primary key,
  name text not null,
  image_uri text,
  updated_at timestamptz not null default now()
);

alter table public.barcode_catalog enable row level security;

-- ponytail: 등록자 구분 없이 로그인 사용자 누구나 덮어쓸 수 있는 단순 공용 캐시.
-- 악의적 오염 방지가 필요해지면 등록자 신고/롤백 기능으로 확장할 것.
create policy "barcode_catalog select" on public.barcode_catalog
  for select to authenticated using (true);

create policy "barcode_catalog insert" on public.barcode_catalog
  for insert to authenticated with check (true);

create policy "barcode_catalog update" on public.barcode_catalog
  for update to authenticated using (true) with check (true);
