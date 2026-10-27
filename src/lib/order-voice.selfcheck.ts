import { matchVoiceItems, parseVoiceOrder } from './order-voice';
import type { OrderProduct } from './order-types';

const mk = (id: string, name: string, extra: Partial<OrderProduct> = {}): OrderProduct => ({
  id, name, brand: '', price: 0, category: '', barcode: null, imageUri: null, ...extra,
});
const products = [mk('1', '메로나'), mk('2', '붕어싸만코'), mk('3', '월드콘'), mk('4', '비비빅'), mk('5', '투게더'), mk('6', '메로나 바나나맛'), mk('7', '옛날바', { status: 'discontinued' })];

const a = parseVoiceOrder('메로나 두 박스 하겐다즈 세 개 붕어싸만코');
console.assert(JSON.stringify(a) === JSON.stringify([{ name: '메로나', qty: 2 }, { name: '하겐다즈', qty: 3 }, { name: '붕어싸만코', qty: 1 }]), '문장1 파싱 불일치');
const ma = matchVoiceItems(a, products);
console.assert(ma.matched.length === 2 && ma.matched[0].product.id === '1' && ma.matched[0].qty === 2, '메로나 2 매칭 불일치');
console.assert(ma.matched[1].product.id === '2' && ma.matched[1].qty === 1, '붕어싸만코 1 매칭 불일치');
console.assert(ma.failed.length === 1 && ma.failed[0].name === '하겐다즈' && ma.failed[0].qty === 3, '하겐다즈는 실패여야 함');

const b = parseVoiceOrder('월드콘 5박스, 비비빅 열 개 그리고 투게더');
console.assert(JSON.stringify(b) === JSON.stringify([{ name: '월드콘', qty: 5 }, { name: '비비빅', qty: 10 }, { name: '투게더', qty: 1 }]), '문장2 파싱 불일치');

console.assert(parseVoiceOrder('메로나 십이 박스')[0].qty === 12, '십이 = 12 불일치');
console.assert(parseVoiceOrder('').length === 0, '빈 문자열은 빈 배열');

const mm = matchVoiceItems([{ name: '메로', qty: 60 }, { name: '메로나', qty: 60 }, { name: '옛날바', qty: 1 }, { name: '메', qty: 1 }], products);
console.assert(mm.matched.length === 1 && mm.matched[0].qty === 99, '합산 최대 99 불일치');
console.assert(mm.failed.length === 2, '단종·1글자는 실패여야 함');

console.log('order-voice selfcheck OK');
