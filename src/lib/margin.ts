export type MarginField = 'cost' | 'margin' | 'price';

export interface MarginInputs {
  cost?: number; // 원가(원)
  margin?: number; // 마진율(%)
  price?: number; // 판매가(원)
}

/**
 * cost/margin/price 중 정확히 2개(a, b)가 주어지면 나머지 1개를 계산해 반환한다.
 * margin이 100 이상이면(분모가 0 이하가 됨) null을 반환한다(계산 불가).
 * a/b 중 하나가 숫자로 유효하지 않으면(undefined/NaN) null을 반환한다.
 */
export function computeMissing(
  known: { a: MarginField; b: MarginField },
  inputs: MarginInputs,
): number | null {
  const { a, b } = known;
  const va = inputs[a];
  const vb = inputs[b];
  if (va === undefined || vb === undefined || Number.isNaN(va) || Number.isNaN(vb)) return null;

  const pair = [a, b].sort().join('-'); // 'cost-margin' | 'cost-price' | 'margin-price'
  if (pair === 'cost-margin') {
    if (inputs.margin! >= 100) return null;
    return inputs.cost! / (1 - inputs.margin! / 100); // → price
  }
  if (pair === 'cost-price') {
    if (inputs.price === 0) return null;
    return ((inputs.price! - inputs.cost!) / inputs.price!) * 100; // → margin
  }
  // 'margin-price'
  if (inputs.margin! >= 100) return null;
  return inputs.price! * (1 - inputs.margin! / 100); // → cost
}
