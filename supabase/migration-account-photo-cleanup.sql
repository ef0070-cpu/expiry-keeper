-- 탈퇴 시 사진 정리 (2026-09-30). 탈퇴한 사용자가 올린 사진 파일이 저장소에 영구히 남던 문제.
-- 개인 사진은 지우고, 다른 사람이 쓰는 사진(공용 바코드 목록·발주 카탈로그·사진 후보·신고 첨부·
-- 팀원의 상품)은 지우면 남의 화면에서 사진이 깨지므로 남기되 올린 사람 정보를 지워 익명으로 둔다.
-- delete-account 함수(service role)만 부른다. 파일 자체 삭제는 Storage API로 해야 해서
-- 여기서는 "지울 목록"만 돌려주고, p_apply=true일 때 남길 사진의 소유자 정보만 지운다.

create or replace function public.account_photo_cleanup(p_uid uuid, p_apply boolean default false)
returns table (bucket_id text, name text, in_use boolean)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  r record;
  url_suffix text;
  used boolean;
begin
  for r in
    select o.bucket_id as b, o.name as n
    from storage.objects o
    where o.owner_id = p_uid::text
      and o.bucket_id in ('product-images', 'order-report-images')
  loop
    url_suffix := '/storage/v1/object/public/' || r.b || '/' || r.n;
    used :=
      exists (select 1 from public.barcode_catalog c where c.image_uri like '%' || url_suffix)
      or exists (select 1 from public.order_catalog c where c.image_uri like '%' || url_suffix)
      or exists (select 1 from public.order_catalog_photos c where c.photo_uri like '%' || url_suffix)
      or exists (
        select 1 from public.order_product_reports c
        where c.photo_uri like '%' || url_suffix and c.submitted_by is distinct from p_uid
      )
      or exists (
        select 1 from public.products c
        where c.image_uri like '%' || url_suffix and c.user_id <> p_uid
      )
      -- 발주 상품은 탈퇴해도 행이 지워지지 않고(user_id에 계정 연결 없음) 팀에 공유된 것은 팀원이
      -- 계속 보므로, 본인 것이라도 팀 공유(team_id 있음)면 사용 중으로 본다
      or exists (
        select 1 from public.order_products c
        where c.image_uri like '%' || url_suffix and (c.user_id <> p_uid or c.team_id is not null)
      );

    if used and p_apply then
      update storage.objects o set owner = null, owner_id = null
      where o.bucket_id = r.b and o.name = r.n;
    end if;

    bucket_id := r.b;
    name := r.n;
    in_use := used;
    return next;
  end loop;
end;
$$;

-- 앱(anon/로그인 사용자)에서 부르지 못하게 — 남의 사진 목록을 캐거나 소유자 정보를 지울 수 있다
revoke all on function public.account_photo_cleanup(uuid, boolean) from public, anon, authenticated;
grant execute on function public.account_photo_cleanup(uuid, boolean) to service_role;
