-- 저작권 신고 컬럼 추가 (2026-09-01)
-- "정보 오류 신고" 폼에 저작권 신고 체크박스를 추가하면서, 신고 기록에 저작권
-- 관련 신고인지 표시해두기 위한 컬럼. 이 신고는 접수 즉시(관리자 승인 없이)
-- 해당 바코드의 카탈로그 사진을 초기화하므로(통지-삭제 원칙), 이 컬럼은
-- 순수 기록/필터링용이며 접근 제어에는 관여하지 않는다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.order_product_reports
  add column if not exists is_copyright boolean not null default false;
