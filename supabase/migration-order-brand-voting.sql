-- 발주 브랜드 좋아요/싫어요 투표 (2026-09-14)
-- 사진(order_catalog_photos/order_photo_votes)과 동일한 "후보 + 투표, 득표 1위가 실시간
-- 대표값" 방식을 order_catalog.brand에 적용한다. barcode_catalog에는 brand 컬럼이 없으므로
-- order_catalog 한 곳만 갱신한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.product_brand_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  brand text not null,
  -- submitted_by에 FK 없음: 아래 백필이 대시보드 실행 컨텍스트(auth.uid()가 null)에서
  -- sentinel uuid를 넣기 때문. FK가 있으면 백필이 실패해 스크립트 전체가 롤백된다.
  -- (order_catalog_photos.submitted_by와 동일한 이유/구조)
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.product_brand_candidates alter column submitted_by set default auth.uid();
create index if not exists product_brand_candidates_barcode_idx on public.product_brand_candidates(barcode);
-- 같은 브랜드 텍스트를 여러 기기가 각각 제안하면 표가 갈려 대표 선정이 안 된다.
-- 대소문자/앞뒤 공백을 무시한 유니크 인덱스로 한 후보에 표가 모이게 한다.
create unique index if not exists product_brand_candidates_barcode_brand_idx
  on public.product_brand_candidates (barcode, lower(btrim(brand)));

alter table public.product_brand_candidates enable row level security;
drop policy if exists "product_brand_candidates select all" on public.product_brand_candidates;
create policy "product_brand_candidates select all" on public.product_brand_candidates for select using (true);
drop policy if exists "product_brand_candidates insert own" on public.product_brand_candidates;
create policy "product_brand_candidates insert own" on public.product_brand_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다.

create table if not exists public.product_brand_votes (
  candidate_id uuid not null references public.product_brand_candidates(id) on delete cascade,
  -- 여기엔 sentinel 백필이 없고 항상 실제 로그인 사용자만 insert하므로 FK를 유지해도 안전하다.
  voter_id uuid not null default auth.uid() references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (candidate_id, voter_id)
);
alter table public.product_brand_votes alter column voter_id set default auth.uid();

alter table public.product_brand_votes enable row level security;
drop policy if exists "product_brand_votes select all" on public.product_brand_votes;
create policy "product_brand_votes select all" on public.product_brand_votes for select using (true);
drop policy if exists "product_brand_votes insert own" on public.product_brand_votes;
create policy "product_brand_votes insert own" on public.product_brand_votes
  for insert with check (auth.uid() = voter_id);
drop policy if exists "product_brand_votes update own" on public.product_brand_votes;
create policy "product_brand_votes update own" on public.product_brand_votes
  for update using (auth.uid() = voter_id);
drop policy if exists "product_brand_votes delete own" on public.product_brand_votes;
create policy "product_brand_votes delete own" on public.product_brand_votes
  for delete using (auth.uid() = voter_id);

-- 대표 브랜드 재계산 (득표 최고 → 동점이면 최초 등록 우선). order_catalog.brand에만 반영.
create or replace function public.recalc_order_brand_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_brand text;
begin
  select c.brand into winner_brand
  from public.product_brand_candidates c
  left join (
    select candidate_id, sum(vote) as score
    from public.product_brand_votes
    group by candidate_id
  ) v on v.candidate_id = c.id
  where c.barcode = target_barcode
  order by coalesce(v.score, 0) desc, c.created_at asc
  limit 1;

  if winner_brand is null then
    return;
  end if;

  update public.order_catalog set brand = winner_brand, updated_at = now() where barcode = target_barcode;
end;
$$;

create or replace function public.product_brand_candidates_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_order_brand_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_brand_candidates_recalc on public.product_brand_candidates;
create trigger product_brand_candidates_recalc
  after insert or delete on public.product_brand_candidates
  for each row execute function public.product_brand_candidates_recalc_trigger();

create or replace function public.product_brand_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.product_brand_candidates
  where id = coalesce(new.candidate_id, old.candidate_id);
  perform public.recalc_order_brand_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_brand_votes_recalc on public.product_brand_votes;
create trigger product_brand_votes_recalc
  after insert or update or delete on public.product_brand_votes
  for each row execute function public.product_brand_votes_recalc_trigger();

-- 백필: order_catalog에 이미 있는 브랜드를 0표 후보로 먼저 채운다 (빈 문자열/null 제외).
-- 이게 없으면 새로 제안되는 0표 후보가 그 바코드의 유일한 후보가 되어 기존 브랜드를 즉시 대체해버린다.
insert into public.product_brand_candidates (barcode, brand, submitted_by)
select barcode, brand, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where brand is not null and brand <> ''
  and not exists (
    select 1 from public.product_brand_candidates c where c.barcode = order_catalog.barcode
  );

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 brand를 건드리지 않도록 트리거 교체.
-- (직전 버전은 migration-order-photo-voting.sql이 정의한, image_uri를 이미 뺀 버전이다.)
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

  insert into public.order_catalog (barcode, name, price, category, updated_at)
  values (new.barcode, nullif(new.name, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;
