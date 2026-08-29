-- 보안 리뷰 결과 반영 (2026-08-29): kind='new' 자동승인 경로에서 photo_uri가 검증 없이
-- 임의 외부 URL을 받아들여, 이 앱의 업로드 흐름을 거치지 않은 사진(추적 픽셀·부적절한
-- 이미지 등)이 관리자 검토 없이 모든 사용자 기기에 자동 반영될 수 있는 문제가 있었다.
-- "신규 상품은 자동 승인" 설계 자체는 유지하되, photo_uri는 비어있거나 이 프로젝트의
-- order-report-images 버킷 공개 URL로 시작해야만 insert가 허용되도록 막는다.
-- (pending으로 들어가는 오류 신고 쪽도 동일하게 막아 관리자 승인 이전 단계부터 방어한다.)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (
    (status = 'pending' or (kind = 'new' and status = 'approved'))
    and (
      photo_uri is null
      or photo_uri like 'https://ocbwjiziwzkgkwzzkvvf.supabase.co/storage/v1/object/public/order-report-images/%'
    )
  );
