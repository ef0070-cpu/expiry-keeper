-- 카테고리 다중 선택 마이그레이션 (2026-08-15)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- 상품당 카테고리를 하나만 저장하던 category(text) 컬럼을
-- 여러 개 저장 가능한 categories(text[])로 바꾼다.

alter table public.products
  add column if not exists categories text[] not null default '{}';

-- 기존 단일 category 값을 배열로 옮긴다
update public.products
  set categories = array[category]
  where category is not null and categories = '{}';

-- 확인 후 필요하면 옛 컬럼은 아래 줄의 주석을 풀어 직접 삭제하세요.
-- alter table public.products drop column category;
