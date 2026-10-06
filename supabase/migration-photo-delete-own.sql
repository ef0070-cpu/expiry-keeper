-- 사진 후보 삭제는 자기가 올린 사진만 (2026-10-06)
-- 문제: order_catalog_photos 삭제 정책이 using (true)라 로그인한 누구나 남의 사진 후보를 지울 수 있었다
-- (지우면 대표 사진이 바뀌어 전체 사용자 화면에 반영됨).
-- 다만 저작권 신고는 통지-삭제 원칙상 신고 즉시 내려야 해서, 그 경로만 아래 서버 함수로 연다 —
-- 방금(10분 안) 이 바코드에 저작권 신고(is_copyright)를 남긴 본인만 지울 수 있고, 신고 행에 누가
-- 지웠는지 남는다. 구버전 앱(v25·v29)은 남의 사진 삭제가 조용히 안 될 뿐(0행) 오류는 없다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

drop policy if exists "order_catalog_photos delete" on public.order_catalog_photos;
create policy "order_catalog_photos delete" on public.order_catalog_photos
  for delete to authenticated using (auth.uid() = submitted_by);

create or replace function public.remove_photo_for_copyright(target_barcode text, target_uri text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not exists (
    select 1 from public.order_product_reports
    where barcode = target_barcode and is_copyright and submitted_by = auth.uid()
      and created_at > now() - interval '10 minutes'
  ) then
    raise exception '저작권 신고 기록이 없어 사진을 내릴 수 없습니다.';
  end if;
  delete from public.order_catalog_photos where barcode = target_barcode and photo_uri = target_uri;
  update public.barcode_catalog set image_uri = null where barcode = target_barcode and image_uri = target_uri;
end;
$$;

revoke all on function public.remove_photo_for_copyright(text, text) from public;
grant execute on function public.remove_photo_for_copyright(text, text) to authenticated;
