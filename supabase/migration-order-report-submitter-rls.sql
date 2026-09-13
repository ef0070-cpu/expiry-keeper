-- order_product_reports 제출자 위변조 방지 (2026-09-14, 기존 검증조건 보존)
-- 이전 마이그레이션(migration-order-report-submitter.sql)이 추가한 submitted_by는
-- 클라이언트가 값을 안 보낼 때만 default auth.uid()로 채워진다. 정책에 auth.uid() =
-- submitted_by 조건만 없으면, 조작된 클라이언트가 submitted_by에 남의 uuid를 직접 넣어
-- 보내는 것까지는 막지 못한다.
--
-- 주의: 이 테이블의 insert 정책은 그동안 여러 마이그레이션을 거쳐 누적된 검증 조건을
-- 담고 있다 (상태값 제한 → migration-order-report-auto-approve-new.sql, photo_uri 버킷
-- 제한 → migration-order-report-restrict-photo-url.sql, photo_fill 필드 제한 →
-- migration-order-catalog-photo-reuse.sql). 정책을 통째로 교체하면 이 검증이 전부
-- 사라지므로, 기존 조건은 그대로 두고 auth.uid() = submitted_by만 AND로 덧붙인다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (
    auth.uid() = submitted_by
    and (
      (status = 'pending')
      or (kind = 'new' and status = 'approved')
      or (
        kind = 'photo_fill' and status = 'approved'
        and name = '' and (brand is null or brand = '')
        and price is null and (category is null or category = '')
        and message is null
        and not (photo_uri is not null and clear_photo = true)
      )
    )
    and (
      photo_uri is null
      or photo_uri like 'https://ocbwjiziwzkgkwzzkvvf.supabase.co/storage/v1/object/public/order-report-images/%'
    )
  );

-- 우리 앱 코드(submitNewOrderProduct/reportOrderProductIssue)는 submitted_by를 직접 안 보내고
-- 컬럼 default(auth.uid())에 맡기므로 정상 동작에는 영향이 없다. 나머지 조건은 지금 정상
-- insert가 이미 충족하고 있는 것들이라 앱 동작에 영향 없다.
