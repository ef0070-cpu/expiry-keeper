-- 빠른발주 배치 설정 동기화 (2026-10-22)
-- 매장별 구역 열 수(2/3/4열)와 냉동고 배경(평대/쇼케이스/없음)을 팀원 기기와 맞추기 위한 칸.
-- 형태: {"columns": {"600바-1": 3, "콘": 2}, "background": "chest"}
-- 칸 크기(1칸/2칸/줄)와 빈칸은 기존 assignments(JSON) 안에 들어가므로 따로 칸이 필요 없다.
-- 앱은 이 칸이 없어도 동작한다(열 수·배경이 그 기기에만 저장될 뿐). 기존 RLS 정책을 그대로 따른다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

alter table public.order_store_layout
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- 확인: 결과에 settings 한 줄이 나오면 성공
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'order_store_layout' and column_name = 'settings';
