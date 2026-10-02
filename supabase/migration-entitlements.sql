-- 유료 권한 마이그레이션 (2026-10-02)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
create extension if not exists pgcrypto;

-- 사용자별 유료 권한. 앱은 읽기만(get_my_entitlement), 쓰기는 서버 함수·Edge Function만.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ad_free boolean not null default false,
  retail_until timestamptz,              -- 구독·이벤트 종료 시각
  retail_lifetime boolean not null default false,
  retail_source text,                    -- 'subscription' | 'promo'
  updated_at timestamptz not null default now()
);
alter table public.entitlements enable row level security;  -- 정책 없음 = 직접 접근 불가

create table if not exists public.tester_emails (email text primary key);
alter table public.tester_emails enable row level security;

create table if not exists public.promo_codes (
  code_hash text primary key,            -- sha256(하이픈 뺀 대문자 코드) hex
  batch text not null,
  months int not null,
  redeem_deadline timestamptz not null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
alter table public.promo_codes enable row level security;

create table if not exists public.promo_attempts (
  user_id uuid not null, at timestamptz not null default now()
);
alter table public.promo_attempts enable row level security;

-- 구글 구매 토큰은 처음 검증한 계정에만 묶는다(한 결제로 여러 계정 해제 방지)
create table if not exists public.purchase_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now()
);
alter table public.purchase_tokens enable row level security;

create or replace function public.is_tester(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.tester_emails t
                 where t.email = lower((select u.email from auth.users u where u.id = uid)));
$$;

create or replace function public.has_retail_premium(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_tester(uid)
      or exists (select 1 from public.entitlements e
                 where e.user_id = uid and (e.retail_lifetime or e.retail_until > now()));
$$;

-- 내 권한 = 내 행 + 테스터 + (팀장의 매장 권한 승계)
create or replace function public.get_my_entitlement()
returns table (ad_free boolean, retail_until timestamptz, retail_lifetime boolean, retail_source text)
language plpgsql security definer stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tester boolean;
  e public.entitlements;
  owner_id uuid;
  owner_e public.entitlements;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  tester := public.is_tester(me);
  select * into e from public.entitlements x where x.user_id = me;
  select t.owner_id into owner_id from public.teams t where t.id = public.my_team_id() and t.owner_id <> me;
  if owner_id is not null then
    select * into owner_e from public.entitlements x where x.user_id = owner_id;
  end if;
  return query select
    coalesce(e.ad_free, false) or tester,
    greatest(e.retail_until, owner_e.retail_until),
    coalesce(e.retail_lifetime, false) or tester
      or coalesce(owner_e.retail_lifetime, false) or (owner_id is not null and public.is_tester(owner_id)),
    coalesce(e.retail_source, owner_e.retail_source);
end;
$$;

-- 이벤트 코드 사용: 5회 틀리면 10분 차단, 계정당 1회, 코드당 1회(동시 입력 시 1명만)
create or replace function public.redeem_promo_code(code text)
returns timestamptz
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  h text := encode(extensions.digest(upper(regexp_replace(code, '[^0-9A-Za-z]', '', 'g')), 'sha256'), 'hex');
  p public.promo_codes;
  new_until timestamptz;
begin
  if me is null then raise exception '로그인이 필요합니다'; end if;
  if (select count(*) from public.promo_attempts a
      where a.user_id = me and a.at > now() - interval '10 minutes') >= 5 then
    raise exception '여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요';
  end if;
  if exists (select 1 from public.promo_codes x where x.used_by = me) then
    raise exception '이벤트 코드는 계정당 한 번만 쓸 수 있어요';
  end if;
  update public.promo_codes x set used_by = me, used_at = now()
    where x.code_hash = h and x.used_by is null and x.redeem_deadline > now()
    returning * into p;
  if not found then
    -- raise 하면 이 insert도 함께 취소돼 횟수 제한이 안 걸린다 → null을 돌려주고 앱이 문구를 띄운다
    insert into public.promo_attempts (user_id) values (me);
    return null;
  end if;
  insert into public.entitlements as e (user_id, retail_until, retail_source)
    values (me, now() + make_interval(months => p.months), 'promo')
  on conflict (user_id) do update
    set retail_until = greatest(coalesce(e.retail_until, now()), now()) + make_interval(months => p.months),
        retail_source = coalesce(e.retail_source, 'promo'),
        updated_at = now()
  returning e.retail_until into new_until;
  return new_until;
end;
$$;

-- 팀 참여: 팀장이 매장 유료가 아니면 새 팀원을 받지 않는다(기존 팀원은 유지)
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
  if (select c.paywall_enabled from public.app_config c where c.id = 1)
     and not public.has_retail_premium(found_team.owner_id) then
    raise exception '팀장이 매장용 구독 중일 때만 팀에 참여할 수 있어요';
  end if;

  insert into public.team_members (team_id, user_id, email)
  values (found_team.id, auth.uid(), (select u.email from auth.users u where u.id = auth.uid()));

  return query select found_team.id, found_team.name, found_team.invite_code;
end;
$$;

revoke execute on function public.is_tester(uuid), public.has_retail_premium(uuid) from anon, authenticated;

-- 유료화 스위치·무료 한도 숫자 (사장님이 Table Editor에서 바꾸면 앱 재빌드 없이 적용)
--  paywall_enabled=false 면 매장용 한도·팀 참여 제한을 모두 끈다(출시 초기 무료 운영)
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  paywall_enabled boolean not null default false,
  product_limit int not null default 30,
  monthly_limit int not null default 5,
  alert_limit int not null default 2
);
insert into public.app_config (id) values (1) on conflict do nothing;
alter table public.app_config enable row level security;
drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config for select using (true);
