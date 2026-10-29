import type { OrderCart, OrderProduct } from './order-types';

/** 'YYYY. M. D.' 형태로 날짜를 포맷한다 (프로토타입의 toLocaleDateString('ko-KR')과 동일한 표기). */
export function formatOrderDate(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/** 'YYYY-MM-DD' → '10/30(금)' (UTC 기준 요일 — 시간대와 무관). 형식이 다르면 원문 그대로 */
export function formatDeliveryDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const w = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}/${d}(${w})`;
}

/** 발주 카트를 카카오톡 등으로 공유할 텍스트로 변환한다. extra로 납품 희망일·배송 메모를 글 끝에 덧붙인다(없으면 안 붙음). */
export function buildOrderShareText(
  cart: OrderCart,
  products: OrderProduct[],
  branch: string | null,
  date: Date,
  extra?: { deliveryDate?: string; memo?: string },
): string {
  const header = branch ? `${formatOrderDate(date)} / ${branch}` : formatOrderDate(date);
  const lines = [`[${header}]`];
  let total = 0;
  Object.entries(cart).forEach(([id, qty]) => {
    if (qty <= 0) return;
    const product = products.find((p) => p.id === id);
    if (!product) return;
    lines.push(qty >= 2 ? `• ${product.name} ${qty}박스` : `• ${product.name}`);
    total += qty;
  });
  lines.push('');
  lines.push(`총 합계: ${total}박스`);
  const delivery = extra?.deliveryDate ? formatDeliveryDate(extra.deliveryDate) : '';
  const memo = extra?.memo?.trim() ?? '';
  if (delivery || memo) lines.push('');
  if (delivery) lines.push(`납품 희망일: ${delivery}`);
  if (memo) lines.push(`배송 메모: ${memo}`);
  return lines.join('\n');
}
