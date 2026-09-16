-- 시드 데이터(order-seed-data.ts)에 있던 브랜드 오타가 order_catalog 시딩 당시 그대로
-- Supabase에도 들어갔던 것을 바로잡는다 (2026-09-14). 로컬 시드 파일은 이미 고쳤고,
-- 이 스크립트는 이미 배포되어 order_catalog/product_brand_candidates에 남아있는
-- 같은 오타를 맞춘다. Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
--
-- 실행 순서 주의: migration-order-brand-voting.sql(product_brand_candidates 테이블 생성)이
-- 먼저 적용돼 있어야 한다 — 파일명 알파벳순(fix- < migration-)으로 적용하면 릴레이션이
-- 없어 에러가 나고, Supabase SQL Editor는 붙여넣은 스크립트를 하나의 트랜잭션으로 실행하므로
-- 같은 파일의 다른 UPDATE까지 함께 롤백된다.
--
-- 대상: '빙그' -> '빙그레' (9건), 'RE' -> '롯데' (3건). 정확히 이 오타 문자열인 행만
-- 건드리도록 where절에 brand 조건을 같이 걸어 멱등성을 확보했다(이미 고쳐졌으면 0행 갱신).

update public.product_brand_candidates
set brand = '빙그레'
where brand = '빙그'
  and barcode in (
    '8801104952880', '8801104952453', '8801104954419', '8801104953597',
    '8801104951135', '8801104951159', '8801104953191', '8801104952040',
    '8801104953719'
  );

update public.order_catalog
set brand = '빙그레', updated_at = now()
where brand = '빙그'
  and barcode in (
    '8801104952880', '8801104952453', '8801104954419', '8801104953597',
    '8801104951135', '8801104951159', '8801104953191', '8801104952040',
    '8801104953719'
  );

update public.product_brand_candidates
set brand = '롯데'
where brand = 'RE'
  and barcode in ('8801118257339', '8801062416974', '8801062893799');

update public.order_catalog
set brand = '롯데', updated_at = now()
where brand = 'RE'
  and barcode in ('8801118257339', '8801062416974', '8801062893799');

-- 스크린샷에서 발견된 개별 오류: 누크바(8801062417155) 브랜드가 '롯데'가 아닌 값으로
-- 잘못 표시되던 문제. 시드 파일에는 원래 '롯데'로 정확히 들어있었으므로 그 값으로 되돌린다.
-- brand <> '롯데' 만으로는 이후 브랜드 투표로 정당하게 다른 값으로 바뀐 것까지 되돌려버릴
-- 수 있어(이 스크립트를 재실행하면), 이 스크립트 작성 시점(2026-09-14) 이전에 생성/수정된
-- 행만 건드리도록 시점 조건을 추가했다 — 그 이후 값은 투표 결과이므로 건드리지 않는다.
update public.product_brand_candidates
set brand = '롯데'
where barcode = '8801062417155' and brand <> '롯데' and created_at < '2026-09-15T00:00:00Z';

update public.order_catalog
set brand = '롯데', updated_at = now()
where barcode = '8801062417155' and brand <> '롯데' and updated_at < '2026-09-15T00:00:00Z';
