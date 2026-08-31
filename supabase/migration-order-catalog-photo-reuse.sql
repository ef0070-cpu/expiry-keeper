-- 발주 카탈로그 사진 크라우드 재활용 (2026-08-31)
-- 사용자가 자기 발주상품을 편집하며 추가한 사진을, 카탈로그에 사진이 없던 항목에 한해
-- 관리자 승인 없이 즉시 반영한다. 기존 kind='fix'(정보 오류 신고)는 여전히 관리자 승인이
-- 필요하므로(migration-order-report-restrict-photo-url.sql 참고), 사진 전용 자동승인
-- 경로를 별도 kind='photo_fill'로 분리한다. 악의적인 클라이언트가 kind='photo_fill'을
-- 사칭해 이름/가격 등 다른 필드까지 검토 없이 밀어넣지 못하도록, 이 kind는 photo_uri/
-- clear_photo 외 필드가 전부 비어 있을 때만 status='approved' insert를 허용한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- (order_product_reports, order-report-images 버킷은 이미 존재해야 함)
-- 주의: 이 기능이 포함된 앱 버전을 배포하기 "전에" 반드시 이 마이그레이션을 먼저 실행할 것.
-- clear_photo 컬럼을 모르는 구버전 앱은 clear_photo:true 행을 그냥 "반영됨" 처리만 하고
-- 실제로는 아무 동작도 하지 않으므로(appliedCatalogUpdateIds에 기록됨), 구버전 기기에서는
-- 그 초기화가 영구히 유실된다.

alter table public.order_product_reports
  add column if not exists clear_photo boolean not null default false;

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (
    (
      status = 'pending'
      or (kind = 'new' and status = 'approved')
      or (
        -- 이 조건은 photo_fill 행이 name/brand/price/category 같은 다른 필드를 건드리지
        -- "못하게" 필드 단위로만 막는다. "빈 사진 슬롯만 채워야 한다"거나 "2명 합의가 필요하다"는
        -- 불변조건은 RLS가 알 수 있는 정보가 아니라(직전 상태를 모름) 여기서 강제할 수 없고,
        -- 전적으로 애플리케이션 코드(submitCatalogPhotoFill의 barcode_catalog 확인, flagCatalogPhoto의
        -- 임계치 로직)가 책임진다. 즉 이 앱 UI를 거치지 않고 인증된 세션만으로 직접 insert하는
        -- 클라이언트는 임의 바코드에 대해 photo_fill이나 clear_photo:true 행을 마음대로 넣을 수 있다 —
        -- "백엔드 함수 없음" 아키텍처의 알려진, 감수하기로 한 트레이드오프이며 지금 고칠 대상이 아니다.
        kind = 'photo_fill' and status = 'approved'
        and name = '' and (brand is null or brand = '') and price is null
        and (category is null or category = '') and message is null
        and not (photo_uri is not null and clear_photo = true)
      )
    )
    and (
      photo_uri is null
      or photo_uri like 'https://ocbwjiziwzkgkwzzkvvf.supabase.co/storage/v1/object/public/order-report-images/%'
    )
  );

create table if not exists public.order_photo_flags (
  barcode text not null,
  reporter_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (barcode, reporter_id)
);

alter table public.order_photo_flags enable row level security;

drop policy if exists "order_photo_flags insert" on public.order_photo_flags;
create policy "order_photo_flags insert" on public.order_photo_flags
  for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "order_photo_flags select" on public.order_photo_flags;
create policy "order_photo_flags select" on public.order_photo_flags
  for select to authenticated using (true);
