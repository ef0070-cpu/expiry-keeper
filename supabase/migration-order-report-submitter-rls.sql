-- order_product_reports 제출자 위변조 방지 (2026-09-14)
-- 이전 마이그레이션(migration-order-report-submitter.sql)이 추가한 submitted_by는
-- 클라이언트가 값을 안 보낼 때만 default auth.uid()로 채워진다. 기존 insert 정책이
-- with check (true)라서, 조작된 클라이언트가 submitted_by에 남의 uuid를 직접 넣어 보내는 것까지는
-- 막지 못한다. order_catalog_photos와 같은 방식으로 본인 uid만 넣을 수 있게 제한한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated with check (auth.uid() = submitted_by);

-- 우리 앱 코드(submitNewOrderProduct/reportOrderProductIssue)는 submitted_by를 직접 안 보내고
-- 컬럼 default(auth.uid())에 맡기므로 정상 동작에는 영향이 없다.
