-- 상품명 좋아요/싫어요 투표 (2026-09-15)
-- 사진(order_catalog_photos/order_photo_votes)·브랜드(product_brand_candidates/votes)와 동일한
-- "후보 + 투표, 득표 1위가 실시간 대표값" 방식을 barcode_catalog.name / order_catalog.name에
-- 적용한다. 두 카탈로그가 후보 풀을 공유한다(바코드 하나의 "진짜 이름"은 앱과 무관하게 동일).
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.product_name_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  name text not null,
  -- submitted_by에 FK 없음: 아래 백필이 대시보드 실행 컨텍스트(auth.uid()가 null)에서 sentinel
  -- uuid를 넣기 때문. FK가 있으면 백필이 실패해 스크립트 전체가 롤백된다(브랜드와 동일한 이유).
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists product_name_candidates_barcode_idx on public.product_name_candidates(barcode);
-- 같은 이름 텍스트를 여러 기기가 각각 제안하면 표가 갈려 대표 선정이 안 된다.
-- 대소문자/앞뒤 공백을 무시한 유니크 인덱스로 한 후보에 표가 모이게 한다(브랜드와 동일).
create unique index if not exists product_name_candidates_barcode_name_idx
  on public.product_name_candidates (barcode, lower(btrim(name)));

alter table public.product_name_candidates enable row level security;
drop policy if exists "product_name_candidates select all" on public.product_name_candidates;
create policy "product_name_candidates select all" on public.product_name_candidates for select using (true);
drop policy if exists "product_name_candidates insert own" on public.product_name_candidates;
create policy "product_name_candidates insert own" on public.product_name_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다.

create table if not exists public.product_name_votes (
  candidate_id uuid not null references public.product_name_candidates(id) on delete cascade,
  voter_id uuid not null default auth.uid() references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (candidate_id, voter_id)
);

alter table public.product_name_votes enable row level security;
drop policy if exists "product_name_votes select all" on public.product_name_votes;
create policy "product_name_votes select all" on public.product_name_votes for select using (true);
drop policy if exists "product_name_votes insert own" on public.product_name_votes;
create policy "product_name_votes insert own" on public.product_name_votes
  for insert with check (auth.uid() = voter_id);
drop policy if exists "product_name_votes update own" on public.product_name_votes;
create policy "product_name_votes update own" on public.product_name_votes
  for update using (auth.uid() = voter_id);
drop policy if exists "product_name_votes delete own" on public.product_name_votes;
create policy "product_name_votes delete own" on public.product_name_votes
  for delete using (auth.uid() = voter_id);

-- 대표 이름 재계산 (득표 최고 → 동점이면 최초 등록 우선). order_catalog/barcode_catalog 양쪽에 반영.
create or replace function public.recalc_product_name_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_name text;
begin
  select c.name into winner_name
  from public.product_name_candidates c
  left join (
    select candidate_id, sum(vote) as score
    from public.product_name_votes
    group by candidate_id
  ) v on v.candidate_id = c.id
  where c.barcode = target_barcode
  order by coalesce(v.score, 0) desc, c.created_at asc
  limit 1;

  if winner_name is null then
    return;
  end if;

  update public.order_catalog set name = winner_name, updated_at = now() where barcode = target_barcode;
  update public.barcode_catalog set name = winner_name, updated_at = now() where barcode = target_barcode;
end;
$$;

create or replace function public.product_name_candidates_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_product_name_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_name_candidates_recalc on public.product_name_candidates;
create trigger product_name_candidates_recalc
  after insert or delete on public.product_name_candidates
  for each row execute function public.product_name_candidates_recalc_trigger();

create or replace function public.product_name_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.product_name_candidates
  where id = coalesce(new.candidate_id, old.candidate_id);
  perform public.recalc_product_name_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_name_votes_recalc on public.product_name_votes;
create trigger product_name_votes_recalc
  after insert or update or delete on public.product_name_votes
  for each row execute function public.product_name_votes_recalc_trigger();

-- 백필: order_catalog를 우선으로 첫 후보 채우기 (빈 문자열/null 제외)
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where name is not null and name <> ''
  and not exists (select 1 from public.product_name_candidates c where c.barcode = order_catalog.barcode);

-- 백필: barcode_catalog 중 아직 후보가 없는 바코드만 추가
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.barcode_catalog
where name is not null and name <> ''
  and not exists (select 1 from public.product_name_candidates c where c.barcode = barcode_catalog.barcode);

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 name을 건드리지 않도록 트리거 교체.
-- (직전 버전은 migration-order-brand-voting.sql이 정의한, brand를 이미 뺀 버전이다. 이번엔 그 위에
-- name까지 빼서 최종적으로 price/category만 갱신하는 버전으로 교체한다.)
create or replace function public.apply_approved_order_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'approved' or new.barcode is null then
    return new;
  end if;

  insert into public.order_catalog (barcode, price, category, updated_at)
  values (new.barcode, new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;
