-- 발주 카탈로그 사진이 앱에서 안 보이던 문제 수정 (2026-09-23)
-- 시드 이미지 URL 상당수가 평문 http:// 라 Android(targetSdk 28+)가 기본 차단해
-- 목록·후보 모달에서 빈 박스/깨진 이미지로 보였다. 앱 쪽 시드 데이터는 https로 고쳤고,
-- 이미 DB에 백필된 값도 같이 맞춰야 한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 1) https 연결이 아예 안 되는 호스트(3곳)는 사진을 비운다 — 깨진 이미지보다 낫다.
--    대표 사진이 비면 DB 트리거가 다음 순위 후보로 자동 교체한다.
delete from public.order_catalog_photos
where photo_uri ~ '^https?://(cfile213\.uf\.daum\.net|www\.munhwanews\.com|www\.viva100\.com)/';

update public.order_catalog set image_uri = null
where image_uri ~ '^https?://(cfile213\.uf\.daum\.net|www\.munhwanews\.com|www\.viva100\.com)/';

update public.barcode_catalog set image_uri = null
where image_uri ~ '^https?://(cfile213\.uf\.daum\.net|www\.munhwanews\.com|www\.viva100\.com)/';

-- 2) 나머지 평문 http는 https로. (해당 16개 호스트 모두 https 200 응답 확인함)
update public.order_catalog_photos
set photo_uri = 'https://' || substring(photo_uri from 8)
where photo_uri like 'http://%';

update public.order_catalog
set image_uri = 'https://' || substring(image_uri from 8)
where image_uri like 'http://%';

update public.barcode_catalog
set image_uri = 'https://' || substring(image_uri from 8)
where image_uri like 'http://%';

-- 3) 확인용 — 세 값 모두 0이 나와야 한다.
select
  (select count(*) from public.order_catalog_photos where photo_uri like 'http://%') as photos_http,
  (select count(*) from public.order_catalog where image_uri like 'http://%') as catalog_http,
  (select count(*) from public.barcode_catalog where image_uri like 'http://%') as barcode_http;
