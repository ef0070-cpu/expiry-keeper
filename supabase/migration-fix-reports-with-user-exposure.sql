-- order_product_reports_with_user 뷰 외부 노출 차단 (2026-10-21)
-- Supabase Advisor CRITICAL 2건: Exposed Auth Users, Security Definer View.
-- 대시보드에서 직접 만든 관리자용 뷰(신고 + auth.users 제출자 정보)가 anon/authenticated에 열려 있어
-- 로그인 없이 공개 키만으로 조회됐다(10/21 확인, 88행). 앱 코드는 이 뷰를 쓰지 않는다.
-- 대시보드 Table Editor·SQL Editor는 관리자 권한(postgres)이라 조치 후에도 그대로 조회된다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

revoke all on public.order_product_reports_with_user from anon, authenticated;
alter view public.order_product_reports_with_user set (security_invoker = true);

-- 확인: 아래 결과가 비어 있어야 한다(anon/authenticated 권한 없음).
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'order_product_reports_with_user'
  and grantee in ('anon', 'authenticated');
