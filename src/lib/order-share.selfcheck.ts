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
console.assert(text.startsWith('[아이스크림 발주_ 1호점- 2026. 8. 26.]'), '헤더 포맷 불일치');
console.assert(text.includes('• 메로나: 2박스'), '품목 라인 누락');
console.assert(!text.includes('빙그레'), '공유 텍스트에 브랜드명이 들어가면 안 됨');
console.assert(!text.includes('월드콘'), '수량 0인 품목이 포함됨');
console.assert(text.includes('총 합계: 2박스'), '합계 라인 불일치');

console.log('order-share selfcheck OK');
