import { buildOrderShareText, formatOrderDate } from './order-share';
import type { OrderCart, OrderProduct } from './order-types';

const products: OrderProduct[] = [
  { id: '1', name: '메로나', brand: '빙그레', price: 400, category: '바', barcode: null, imageUri: null },
  { id: '2', name: '월드콘', brand: '롯데', price: 800, category: '콘', barcode: null, imageUri: null },
];
const cart: OrderCart = { '1': 2, '2': 0 };
const date = new Date(2026, 7, 26); // 2026-08-26 (month는 0-based)

console.assert(formatOrderDate(date) === '2026. 8. 26.', 'formatOrderDate 포맷 불일치');

const text = buildOrderShareText(cart, products, '1호점', date);
console.assert(text.startsWith('[2026. 8. 26. / 1호점]'), '헤더 포맷 불일치');
console.assert(text.includes('• 메로나 2박스'), '품목 라인 누락');
console.assert(!text.includes(':  ') && !text.includes('메로나:'), '콜론 형식이 남아 있음');
console.assert(!text.includes('빙그레'), '공유 텍스트에 브랜드명이 들어가면 안 됨');
console.assert(!text.includes('월드콘'), '수량 0인 품목이 포함됨');
console.assert(text.includes('총 합계: 2박스'), '합계 라인 불일치');

const textNoBranch = buildOrderShareText(cart, products, null, date);
console.assert(textNoBranch.startsWith('[2026. 8. 26.]'), '매장 미선택 시 헤더 포맷 불일치');

// 수량 1은 박스 표기 생략, 2 이상만 표기
const ex: OrderProduct[] = [
  { id: 'a', name: '메로나', brand: '', price: 0, category: '', barcode: null, imageUri: null },
  { id: 'b', name: '체리마루바', brand: '', price: 0, category: '', barcode: null, imageUri: null },
  { id: 'c', name: '녹차마루컵 미니', brand: '', price: 0, category: '', barcode: null, imageUri: null },
];
const exText = buildOrderShareText({ a: 1, b: 1, c: 2 }, ex, '1호점', new Date(2026, 9, 21));
console.assert(
  exText === '[2026. 10. 21. / 1호점]\n• 메로나\n• 체리마루바\n• 녹차마루컵 미니 2박스\n\n총 합계: 4박스',
  `수량 1 생략 형식 불일치: ${exText}`,
);

console.log('order-share selfcheck OK');

// 납품 희망일·배송 메모는 글 끝에 덧붙고, 없으면 기존 글과 똑같다
import { formatDeliveryDate } from './order-share';
const base = buildOrderShareText(cart, products, '1호점', date);
console.assert(buildOrderShareText(cart, products, '1호점', date, {}) === base, 'extra가 비면 기존과 같다');
console.assert(buildOrderShareText(cart, products, '1호점', date, { deliveryDate: '', memo: '  ' }) === base, '빈 값은 안 붙는다');
const withBoth = buildOrderShareText(cart, products, '1호점', date, { deliveryDate: '2026-10-30', memo: ' 창고 앞 ' });
console.assert(withBoth === base + '\n\n납품 희망일: 10/30(금)\n배송 메모: 창고 앞', '희망일·메모가 글 끝에 붙는다');
console.assert(buildOrderShareText(cart, products, '1호점', date, { memo: '냉동고' }) === base + '\n\n배송 메모: 냉동고', '메모만');
console.assert(formatDeliveryDate('2026-11-01') === '11/1(일)' && formatDeliveryDate('abc') === 'abc', '날짜 표기');
console.log('order-share 자가검사(희망일·메모) 통과');
