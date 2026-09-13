-- 발주 상품 신규등록/수정 신고에 제출자 기록 추가 (2026-09-14)
-- order_product_reports(신규 등록 제안 kind='new', 정보 오류/가격·브랜드 수정 신고 kind='fix')에
-- 지금까지 제출자 정보가 전혀 없어, 관리자가 누가 등록/수정했는지 확인할 방법이 없었다.
-- order_catalog_photos/product_name_candidates와 같은 방식으로 submitted_by(auth.users.id)를 추가한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.order_product_reports
  add column if not exists submitted_by uuid references auth.users(id) default auth.uid();

-- 기존 행(이미 쌓여있던 신고)은 제출 당시 이 컬럼이 없어 submitted_by가 비어있다 — 소급 확인은 불가.
-- 이후 새로 들어오는 신고부터는 로그인한 사용자의 uid가 자동으로 채워진다
-- (클라이언트 코드 변경 불필요 — default auth.uid()가 insert 시점 세션에서 채운다).

-- 확인 방법: Supabase 대시보드 > Table Editor > order_product_reports에서 submitted_by(uuid) 값을 복사해
-- Authentication > Users에서 검색하면 이메일/이름/닉네임(raw_user_meta_data)을 확인할 수 있다.
-- 주의: 카카오 로그인은 카카오 비즈니스 채널 인증을 안 받은 앱은 이메일 동의를 받을 수 없어
-- email이 비어있을 수 있다. 이 경우에도 nickname/name은 대부분 raw_user_meta_data에 남는다.
