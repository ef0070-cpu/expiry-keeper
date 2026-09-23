-- 이용 허락 없는 출처의 상품 사진 정리 (2026-09-23)
-- 시드 이미지 355건 중 158건이 언론사 보도사진·개인 블로그·카페 첨부에서 온 것이라
-- 이용 허락 근거가 없었다. 앱의 시드 데이터에서는 제거했고, DB에 백필된 값도 같이 지운다.
-- 남기는 것: 커머스 상품 이미지(카카오 쇼핑하우·네이버 쇼핑·ESM 등)와
--            Open Food Facts(CC BY-SA 3.0, 앱 설정 화면에 출처 표시 추가함).
-- 사진이 비면 DB 트리거가 다음 순위 후보(사용자가 직접 올린 사진)로 자동 교체한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 대상 호스트: 다음 뉴스/카페, 네이버 블로그·뉴스 프록시, 카카오 블로그, 각 언론사·커뮤니티
create temporary table _drop_hosts (host text) on commit drop;
insert into _drop_hosts (host) values
  ('t1.daumcdn.net'), ('postfiles.pstatic.net'), ('dthumb-phinf.pstatic.net'),
  ('blog.kakaocdn.net'), ('img.insight.co.kr'), ('www.foodnews.co.kr'),
  ('upload3.inven.co.kr'), ('www.newsdream.kr'), ('www.biztribune.co.kr'),
  ('img.etnews.com'), ('www.whitepaper.co.kr'), ('www.thinkfood.co.kr'),
  ('www.theliving.co.kr'), ('www.shinmoongo.net'), ('www.newsworker.co.kr'),
  ('www.foodtoday.or.kr'), ('www.fetimes.co.kr'), ('www.consumuch.com'),
  ('www.bokuennews.com'), ('img2.quasarzone.com'), ('img.siksinhot.com'),
  ('img.newspim.com'), ('cdnweb01.wikitree.co.kr');

delete from public.order_catalog_photos p
using _drop_hosts d
where p.photo_uri like 'https://' || d.host || '/%'
   or p.photo_uri like 'http://' || d.host || '/%';

update public.order_catalog c set image_uri = null
where exists (
  select 1 from _drop_hosts d
  where c.image_uri like 'https://' || d.host || '/%'
     or c.image_uri like 'http://' || d.host || '/%'
);

update public.barcode_catalog b set image_uri = null
where exists (
  select 1 from _drop_hosts d
  where b.image_uri like 'https://' || d.host || '/%'
     or b.image_uri like 'http://' || d.host || '/%'
);

-- 확인용 — 남아 있는 출처와 건수. 커머스 CDN과 openfoodfacts만 보여야 한다.
select split_part(split_part(photo_uri, '//', 2), '/', 1) as host, count(*)
from public.order_catalog_photos
group by 1 order by 2 desc;
