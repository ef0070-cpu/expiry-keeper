-- 사용자 증가 대비 인덱스 (2026-10-09 확장성 점검 3번)
-- 발주 표들은 보안 규칙(RLS)이 "user_id = 나 또는 team_id = 내 팀"으로 거르는데, 이 칸들에 인덱스가 없어
-- 행이 늘수록 모든 사용자의 동기화가 표 전체를 훑었다. 팀 해체·탈퇴(on delete set null/cascade)도 같다.
-- 지금은 표가 작아 바로 끝난다. SQL 편집기에서 통째로 한 번 실행하면 된다(이미 있으면 건너뜀).

create index if not exists order_products_user_idx on public.order_products (user_id);
create index if not exists order_products_team_idx on public.order_products (team_id) where team_id is not null;
create index if not exists order_products_user_barcode_idx on public.order_products (user_id, barcode);

create index if not exists order_stores_user_idx on public.order_stores (user_id);
create index if not exists order_stores_team_idx on public.order_stores (team_id) where team_id is not null;

create index if not exists order_categories_user_idx on public.order_categories (user_id);
create index if not exists order_categories_team_idx on public.order_categories (team_id) where team_id is not null;

create index if not exists teams_owner_idx on public.teams (owner_id);
