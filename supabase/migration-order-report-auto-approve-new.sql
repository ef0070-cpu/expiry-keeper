-- 신규 상품 등록(kind='new')은 자동 승인, 정보 오류 신고(kind='fix')는 여전히 관리자 승인 필요 (2026-08-28)
-- 앱 코드(submitNewOrderProduct)는 신규 상품 제출 시 status='approved'로 직접 insert한다.
-- 이 정책이 없으면 신고(fix) 제출도 클라이언트가 임의로 status='approved'를 넣어 관리자 검토를
-- 건너뛸 수 있으므로, kind='new' 건만 승인 상태로 insert 가능하도록 서버에서 강제한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요. (order_product_reports 테이블은 이미 존재해야 함)

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (status = 'pending' or (kind = 'new' and status = 'approved'));
