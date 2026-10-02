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

-- 팀 참여 제한은 서버에 두지 않는다: 팀은 가정용(가족 공유)과 매장용을 구분하지 않아 서버에서 막으면
-- 가족 공유까지 막힌다 → 매장 모드 팀 화면에서만 막는다(team.tsx).
revoke execute on function public.is_tester(uuid) from public, anon, authenticated;

-- 유료화 스위치·무료 한도 숫자 (사장님이 Table Editor에서 바꾸면 앱 재빌드 없이 적용)
--  paywall_enabled=false 면 매장용 한도·팀 제한을 모두 끈다(출시 초기 무료 운영)
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
