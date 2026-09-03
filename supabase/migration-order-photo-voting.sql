-- 발주 카탈로그 사진 좋아요/싫어요 투표 (2026-09-03)
-- 여러 사용자가 올린 사진 후보 중 득표(좋아요-싫어요) 최고 사진을 트리거가 자동으로
-- order_catalog.image_uri에 반영한다. 기존 "사진이 실제 상품과 달라요" 2명 합의 신고
-- (order_photo_flags)는 이 마이그레이션으로 완전히 대체되어 삭제된다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.order_catalog_photos (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  photo_uri text not null,
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists order_catalog_photos_barcode_idx on public.order_catalog_photos(barcode);

-- 이미 order_catalog에 채워져 있던 388개 기존 사진을 첫 후보로 백필한다.
-- 이게 없으면 새로 등록되는 0표짜리 후보가 그 바코드의 유일한 후보가 되어
-- 기존 좋은 사진을 즉시 대체해버린다 (이 기능이 막으려던 바로 그 문제).
-- submitted_by는 대시보드에서 SQL을 직접 실행하는 컨텍스트라 auth.uid()가 null이라
-- sentinel uuid로 채운다 (이 컬럼엔 FK가 없어 가능).
insert into public.order_catalog_photos (barcode, photo_uri, submitted_by)
select barcode, image_uri, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where image_uri is not null
  and not exists (
    select 1 from public.order_catalog_photos p where p.barcode = order_catalog.barcode
  );

alter table public.order_catalog_photos enable row level security;

drop policy if exists "order_catalog_photos select" on public.order_catalog_photos;
create policy "order_catalog_photos select" on public.order_catalog_photos
  for select to authenticated using (true);

drop policy if exists "order_catalog_photos insert" on public.order_catalog_photos;
create policy "order_catalog_photos insert" on public.order_catalog_photos
  for insert to authenticated with check (auth.uid() = submitted_by);

-- 일반 update 정책은 없음: 후보 내용을 고칠 수 없다.
-- 삭제(저작권 신고 등)는 제출자 본인 여부와 무관하게 인증된 사용자 누구나 즉시 처리할 수 있다 —
-- 신고자가 원 제출자가 아닌 게 일반적이므로 submitted_by로 제한하면 삭제가 조용히 실패한다.
-- 별도 백엔드 검증 함수가 없는 이 기능의 기존 트레이드오프와 동일한 성격이다.
drop policy if exists "order_catalog_photos delete" on public.order_catalog_photos;
create policy "order_catalog_photos delete" on public.order_catalog_photos
  for delete to authenticated using (true);

create table if not exists public.order_photo_votes (
  photo_id uuid not null references public.order_catalog_photos(id) on delete cascade,
  voter_id uuid not null default auth.uid(),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (photo_id, voter_id)
);

alter table public.order_photo_votes enable row level security;

drop policy if exists "order_photo_votes select" on public.order_photo_votes;
create policy "order_photo_votes select" on public.order_photo_votes
  for select to authenticated using (true);

drop policy if exists "order_photo_votes insert" on public.order_photo_votes;
create policy "order_photo_votes insert" on public.order_photo_votes
  for insert to authenticated with check (auth.uid() = voter_id);

drop policy if exists "order_photo_votes update" on public.order_photo_votes;
create policy "order_photo_votes update" on public.order_photo_votes
  for update to authenticated using (auth.uid() = voter_id);

drop policy if exists "order_photo_votes delete" on public.order_photo_votes;
create policy "order_photo_votes delete" on public.order_photo_votes
  for delete to authenticated using (auth.uid() = voter_id);

-- 대표 사진 재계산: 득표 최고 → 동점이면 최초 등록 우선
create or replace function public.recalc_order_catalog_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_uri text;
begin
  select p.photo_uri into winner_uri
  from public.order_catalog_photos p
  left join (
    select photo_id, sum(vote) as score
    from public.order_photo_votes
    group by photo_id
  ) v on v.photo_id = p.id
  where p.barcode = target_barcode
  order by coalesce(v.score, 0) desc, p.created_at asc
  limit 1;

  update public.order_catalog
  set image_uri = winner_uri, updated_at = now()
  where barcode = target_barcode;
end;
$$;

create or replace function public.order_catalog_photos_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_order_catalog_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_catalog_photos_recalc on public.order_catalog_photos;
create trigger order_catalog_photos_recalc
  after insert or delete on public.order_catalog_photos
  for each row execute function public.order_catalog_photos_recalc_trigger();

create or replace function public.order_photo_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.order_catalog_photos
  where id = coalesce(new.photo_id, old.photo_id);
  perform public.recalc_order_catalog_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_photo_votes_recalc on public.order_photo_votes;
create trigger order_photo_votes_recalc
  after insert or update or delete on public.order_photo_votes
  for each row execute function public.order_photo_votes_recalc_trigger();

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 사진을 건드리지 않도록 교체
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

  insert into public.order_catalog (barcode, name, brand, price, category, updated_at)
  values (new.barcode, nullif(new.name, ''), nullif(new.brand, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    brand = coalesce(nullif(excluded.brand, ''), order_catalog.brand),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;

-- 기존 "사진이 실제 상품과 달라요" 2명 합의 신고 기능 제거 (새 투표로 대체)
drop table if exists public.order_photo_flags;
