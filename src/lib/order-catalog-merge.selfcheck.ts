import { applyBarcodeMoves, mergeCatalogIntoProducts } from './order-catalog-merge';
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
  const { items, changed, newBarcodes, updatedBarcodes } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '111', name: '새이름', brand: '새브랜드', price: 2000, category: '콘', image_uri: 'http://x/1.jpg' }],
    new Set(),
  );
  console.assert(changed, '값이 바뀌면 changed=true여야 함');
  console.assert(items[0].name === '새이름', '이름이 Supabase 값으로 덮어써져야 함');
  console.assert(items[0].price === 2000, '가격이 Supabase 값으로 덮어써져야 함');
  console.assert(items[0].imageUri === 'http://x/1.jpg', '사진이 Supabase 값으로 덮어써져야 함');
  console.assert(
    updatedBarcodes.length === 1 && updatedBarcodes[0] === '111',
    '필드가 바뀐 기존 상품은 updatedBarcodes에 담겨야 함',
  );
  console.assert(newBarcodes.length === 0, '기존 상품 수정은 newBarcodes에 담기면 안 됨');
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
  const { items, changed, newBarcodes, updatedBarcodes } = mergeCatalogIntoProducts(
    [base],
    [{ barcode: '222', name: '신상품', brand: '브랜드', price: 500, category: '바', image_uri: null }],
    new Set(),
    () => 'new-1',
  );
  console.assert(changed, '신규 추가는 changed=true여야 함');
  console.assert(items.length === 2, '상품이 하나 추가돼야 함');
  console.assert(items[1].id === 'new-1' && items[1].barcode === '222', '신규 상품 필드가 카탈로그 값과 일치해야 함');
  console.assert(
    newBarcodes.length === 1 && newBarcodes[0] === '222',
    '새로 추가된 상품은 newBarcodes에 담겨야 함',
  );
  console.assert(updatedBarcodes.length === 0, '신규 추가는 updatedBarcodes에 담기면 안 됨');
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


// 6) 승인된 바코드 변경: 예전 바코드 상품을 새 바코드로 옮기고, 새 바코드가 이미 있으면 건드리지 않음
{
  const old = { ...base, id: 'a', barcode: 'OLD' };
  const other = { ...base, id: 'b', barcode: 'X' };
  const r = applyBarcodeMoves([old, other], [{ old_barcode: 'OLD', new_barcode: 'NEW' }]);
  console.assert(r.items[0].barcode === 'NEW' && r.moved.length === 1, '예전 바코드 상품이 새 바코드로 옮겨져야 함');
  console.assert(r.items[1].barcode === 'X', '관계없는 상품은 그대로');
  const merged = mergeCatalogIntoProducts(
    r.items,
    [{ barcode: 'NEW', name: '기존이름', brand: null, price: null, category: null, image_uri: null }],
    new Set(),
  );
  console.assert(merged.items.length === 2 && merged.newBarcodes.length === 0, '옮긴 뒤엔 새 바코드가 신규로 중복 추가되면 안 됨');
  const already = applyBarcodeMoves([old, { ...base, id: 'c', barcode: 'NEW' }], [{ old_barcode: 'OLD', new_barcode: 'NEW' }]);
  console.assert(already.moved.length === 0 && already.items[0].barcode === 'OLD', '새 바코드 상품이 이미 있으면 옮기지 않음');
}

console.log('order-catalog-merge selfcheck OK');
