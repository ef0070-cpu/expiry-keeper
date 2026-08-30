import type { OrderCart, OrderHistoryEntry, OrderProduct } from './order-types';

/** 'YYYY. M. D.' 형태로 날짜를 포맷한다 (프로토타입의 toLocaleDateString('ko-KR')과 동일한 표기). */
export function formatOrderDate(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 발주 카트를 카카오톡 등으로 공유할 텍스트로 변환한다. */
export function buildOrderShareText(
  cart: OrderCart,
  products: OrderProduct[],
  branch: string,
  date: Date,
): string {
  const lines = [`[아이스크림 발주_ ${branch}- ${formatOrderDate(date)}]`];
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

/** 캘린더의 발주 완료 내역 1건을 클립보드 복사용 텍스트로 변환한다. */
export function buildOrderHistoryCopyText(entry: OrderHistoryEntry): string {
  const lines = [
    `[아이스크림 발주_ ${entry.branch}- ${formatOrderDate(new Date(entry.sentAt))}]`,
  ];
  entry.items.forEach((it) => {
    lines.push(`• ${it.name}: ${it.qty}박스`);
  });
  lines.push('');
  lines.push(`총 합계: ${entry.totalBoxes}박스`);
  return lines.join('\n');
}
