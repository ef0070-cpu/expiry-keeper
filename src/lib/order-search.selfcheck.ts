import { searchOrderProducts } from './order-search';
import type { OrderProduct } from './order-types';

function p(overrides: Partial<OrderProduct>): OrderProduct {
  return {
    id: overrides.name ?? 'id',
    name: '이름없음',
    brand: '',
    price: 0,
    category: '바',
    barcode: null,
    imageUri: null,
    status: 'active',
    ...overrides,
  };
}

const melona = p({ name: '메로나', brand: '빙그레', aliases: ['메론바'] });
const worldcone = p({ name: '월드콘', brand: '롯데' });
const jaws = p({ name: '죠스바', brand: '롯데' });
const products = [worldcone, melona, jaws];

// 1) 완전일치가 최상단
{
  const r = searchOrderProducts(products, '메로나');
  console.assert(r[0] === melona, '완전일치 상품이 1순위여야 함');
}

// 2) 시작일치 > 부분일치 순위
{
  const items = [p({ name: '딸기메로나' }), p({ name: '메로나' })];
  const r = searchOrderProducts(items, '메로');
  console.assert(r[0].name === '메로나', '시작일치가 부분일치보다 앞에 와야 함');
}

// 3) 공백/구두점 무시 정규화
{
  const withPunct = p({ name: '메로나-아이스크림' });
  console.assert(
    searchOrderProducts([withPunct], '메로나아이스크림').includes(withPunct),
    '공백/구두점 차이를 무시하고 매칭돼야 함',
  );
}

// 4) 초성+완성형 혼합 검색 (기존 matchesSearch 재사용 확인)
{
  const r = searchOrderProducts(products, 'ㅁㄹ나');
  console.assert(r.includes(melona), '초성+완성형 혼합 검색어가 매칭돼야 함');
}

// 5) 별칭(동의어) 검색
{
  const r = searchOrderProducts(products, '메론바');
  console.assert(r[0] === melona, '별칭으로 검색해도 상품이 매칭돼야 함');
}

// 6) 오타 허용(fuzzy) — 결정적 등급에 하나도 안 걸릴 때만 적용
{
  const r = searchOrderProducts(products, '매로나');
  console.assert(r.includes(melona), '한 글자 틀린 검색어(매로나)도 메로나를 찾아야 함');
}

// 7) 무관한 검색어는 결과 없음
{
  const r = searchOrderProducts(products, '완전히무관한단어');
  console.assert(r.length === 0, '무관한 검색어는 결과가 없어야 함');
}

// 8) 빈 검색어는 원래 순서 그대로
{
  const r = searchOrderProducts(products, '');
  console.assert(r.length === 3 && r[0] === worldcone, '빈 검색어는 원래 목록을 그대로 반환해야 함');
}

console.log('order-search selfcheck OK');
