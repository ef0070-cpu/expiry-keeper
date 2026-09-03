-- 사진 후보/투표 결과를 barcode_catalog에도 반영 (2026-09-03)
-- 발주 카탈로그(order_catalog)에만 적용되던 사진 좋아요/싫어요 투표(order_catalog_photos,
-- order_photo_votes, migration-order-photo-voting.sql)를 유통기한 앱이 쓰는 barcode_catalog
-- 에도 그대로 적용한다. 바코드 하나의 "진짜 사진"은 앱과 무관하게 동일하므로, 두 앱의 사용자가
-- 같은 후보/투표 풀에 참여하고 대표 사진도 두 테이블에 함께 반영된다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (migration-order-photo-voting.sql을
-- 먼저 실행했어야 함 — order_catalog_photos/order_photo_votes 테이블이 이미 있어야 한다.)

-- barcode_catalog에는 order_catalog보다 훨씬 많은 바코드(유통기한 앱에서 스캔된 것 포함)가
-- 이미 사진과 함께 쌓여 있다. 이 바코드들도 후보가 0개인 채로 시작하면, 최초 마이그레이션 때
-- order_catalog 388건에서 겪었던 것과 똑같은 문제가 재발한다 — 누군가 한 번만 사진을 바꿔도
-- 0표짜리 후보가 유일한 후보가 되어 기존 좋은 사진을 즉시 대체해버린다. 그래서 여기서도 동일하게
-- 기존 사진을 첫 후보로 백필한다 (order_catalog_photos에 이미 그 바코드 후보가 있으면 건너뜀 —
-- order_catalog 백필과 대상이 겹칠 수 있어 재실행/중복 방지 겸 필요).
insert into public.order_catalog_photos (barcode, photo_uri, submitted_by)
select barcode, image_uri, '00000000-0000-0000-0000-000000000000'::uuid
from public.barcode_catalog
where image_uri is not null
  and not exists (
    select 1 from public.order_catalog_photos p where p.barcode = barcode_catalog.barcode
  );

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

  update public.barcode_catalog
  set image_uri = winner_uri, updated_at = now()
  where barcode = target_barcode;
end;
$$;
