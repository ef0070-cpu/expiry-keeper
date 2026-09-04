import type { OrderCart, OrderProduct } from './order-types';

/** 'YYYY. M. D.' 형태로 날짜를 포맷한다 (프로토타입의 toLocaleDateString('ko-KR')과 동일한 표기). */
export function formatOrderDate(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 발주 카트를 카카오톡 등으로 공유할 텍스트로 변환한다. */
export function buildOrderShareText(
  cart: OrderCart,
  products: OrderProduct[],
  branch: string | null,
  date: Date,
): string {
  const header = branch ? `${formatOrderDate(date)} / ${branch}` : formatOrderDate(date);
  const lines = [`[${header}]`];
  let total = 0;
  Object.entries(cart).forEach(([id, qty]) => {
    if (qty <= 0) return;
    const product = products.find((p) => p.id === id);
    if (!product) return;
    lines.push(`• ${product.name}: ${qty}박스`);
    total += qty;
  });
  lines.push('');
  lines.push(`총 합계: ${total}박스`);
  return lines.join('\n');
}
