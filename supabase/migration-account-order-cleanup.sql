-- 탈퇴 시 혼자 쓰던 발주 데이터 삭제 (2026-09-30). 발주 테이블은 user_id에 계정 연결(FK)이 없어
-- 탈퇴해도 매장·발주 상품·분류가 서버에 영구히 남았다(개인정보).
-- 다른 팀원이 있는 팀에 공유된 것은 팀이 계속 쓰므로 남긴다. 팀원이 없는 팀(혼자 남은 팀)은 개인 데이터로 본다.
-- 매장을 지우면 진열(order_store_layout)·장바구니(order_carts)는 FK cascade로 함께 지워진다.
-- delete-account 함수(service role)만 부른다 — 사진 정리(account_photo_cleanup)보다 먼저 불러야
-- 지워진 발주 상품이 가리키던 사진이 '사용 중'으로 잘못 남지 않는다.

create or replace function public.account_order_cleanup(p_uid uuid)
returns table (stores int, products int, categories int)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 탈퇴자 말고 다른 팀원이 있는 팀 = 계속 쓰이는 팀
  shared_teams uuid[] := array(
    select distinct m.team_id from public.team_members m where m.user_id <> p_uid
  );
begin
  delete from public.order_stores s
  where s.user_id = p_uid and (s.team_id is null or not (s.team_id = any (shared_teams)));
  get diagnostics stores = row_count;

  delete from public.order_products p
  where p.user_id = p_uid and (p.team_id is null or not (p.team_id = any (shared_teams)));
  get diagnostics products = row_count;

  delete from public.order_categories c
  where c.user_id = p_uid and (c.team_id is null or not (c.team_id = any (shared_teams)));
  get diagnostics categories = row_count;

  return next;
end;
$$;

revoke all on function public.account_order_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.account_order_cleanup(uuid) to service_role;
