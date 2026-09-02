import { mergeCatalogIntoProducts } from './order-catalog-merge';
import type { OrderProduct } from './order-types';

const base: OrderProduct = {
  id: 'local-1',
  name: '기존이름',
  brand: '기존브랜드',
  price: 1000,
  category: '바',
  barcode: '111',
  imageUri: null,
  status: 'active',
};

// 1) 바코드 매칭되면 공용 필드가 Supabase 값으로 덮어써진다
{
  const { items, changed } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '111', name: '새이름', brand: '새브랜드', price: 2000, category: '콘', image_uri: 'http://x/1.jpg' }],
    new Set(),
  );
  console.assert(changed, '값이 바뀌면 changed=true여야 함');
  console.assert(items[0].name === '새이름', '이름이 Supabase 값으로 덮어써져야 함');
  console.assert(items[0].price === 2000, '가격이 Supabase 값으로 덮어써져야 함');
  console.assert(items[0].imageUri === 'http://x/1.jpg', '사진이 Supabase 값으로 덮어써져야 함');
}

// 2) 완전히 동일하면 changed=false
{
  const { changed } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '111', name: '기존이름', brand: '기존브랜드', price: 1000, category: '바', image_uri: null }],
    new Set(),
  );
  console.assert(!changed, '변경 없으면 changed=false여야 함');
}

// 3) 로컬에 없는 바코드는 신규 상품으로 추가된다
{
  const { items, changed } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '222', name: '신상품', brand: '브랜드', price: 500, category: '바', image_uri: null }],
    new Set(),
    () => 'new-1',
  );
  console.assert(changed, '신규 추가는 changed=true여야 함');
  console.assert(items.length === 2, '상품이 하나 추가돼야 함');
  console.assert(items[1].id === 'new-1' && items[1].barcode === '222', '신규 상품 필드가 카탈로그 값과 일치해야 함');
}

// 4) removedBarcodes에 있으면 재생성하지 않는다
{
  const { items, changed } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '333', name: '삭제했던상품', brand: '', price: 0, category: '', image_uri: null }],
    new Set(['333']),
  );
  console.assert(!changed, '삭제 기록된 바코드는 재생성하면 안 됨');
  console.assert(items.length === 1, '상품 개수가 그대로여야 함');
}

// 5) 카탈로그 필드가 null이면 로컬 값을 보존한다 (price/category)
{
  const { items } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '111', name: '기존이름', brand: null, price: null, category: null, image_uri: null }],
    new Set(),
  );
  console.assert(items[0].price === 1000, 'price가 null이면 기존 로컬 값을 유지해야 함');
  console.assert(items[0].category === '바', 'category가 null이면 기존 로컬 값을 유지해야 함');
  console.assert(items[0].brand === '', 'brand는 null이면 빈 문자열로 정규화됨(name과 동일 규칙)');
}

// 6) 신고한 사진이 카탈로그에서 아직 그대로면(미해결) 되살리지 않고 null로 취급한다
{
  const flagged = new Map([['111', 'http://old-wrong.jpg']]);
  const { items, resolvedFlags } = mergeCatalogIntoProducts(
    [{ ...base, imageUri: null }],
    [{ barcode: '111', name: '기존이름', brand: '기존브랜드', price: 1000, category: '바', image_uri: 'http://old-wrong.jpg' }],
    new Set(),
    undefined,
    flagged,
  );
  console.assert(items[0].imageUri === null, '신고 미해결 상태면 사진을 되살리면 안 됨');
  console.assert(resolvedFlags.length === 0, '카탈로그 값이 그대로면 resolvedFlags가 비어 있어야 함');
}

// 7) 신고 후 카탈로그 값이 바뀌면(해결됨) 새 값을 받아들이고 resolvedFlags로 알린다
{
  const flagged = new Map([['111', 'http://old-wrong.jpg']]);
  const { items, resolvedFlags } = mergeCatalogIntoProducts(
    [{ ...base, imageUri: null }],
    [{ barcode: '111', name: '기존이름', brand: '기존브랜드', price: 1000, category: '바', image_uri: null }],
    new Set(),
    undefined,
    flagged,
  );
  console.assert(items[0].imageUri === null, '해결된 뒤(사진 초기화)면 카탈로그의 null을 그대로 받아들여야 함');
  console.assert(resolvedFlags.includes('111'), '카탈로그 값이 신고 당시와 다르면 resolvedFlags에 포함돼야 함');
}

console.log('order-catalog-merge selfcheck OK');
