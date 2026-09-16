-- 시드 데이터(order-seed-data.ts)에 있던 브랜드 오타가 order_catalog 시딩 당시 그대로
-- Supabase에도 들어갔던 것을 바로잡는다 (2026-09-14). 로컬 시드 파일은 이미 고쳤고,
-- 이 스크립트는 이미 배포되어 order_catalog/product_brand_candidates에 남아있는
-- 같은 오타를 맞춘다. Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
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
update public.product_brand_candidates
set brand = '롯데'
where barcode = '8801062417155' and brand <> '롯데';

update public.order_catalog
set brand = '롯데', updated_at = now()
where barcode = '8801062417155' and brand <> '롯데';
