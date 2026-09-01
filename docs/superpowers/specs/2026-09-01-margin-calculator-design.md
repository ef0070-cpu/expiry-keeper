# 원가·마진 계산기 (소매점 전용) — 설계

## 배경

소매점 모드(`mode === 'retail'`) 사용자가 상품의 원가/판매가/마진율 중 두 값을 알 때 나머지 값을 빠르게 계산할 수 있는 화면을 원함. 참고로 제공된 스크린샷은 다른 앱("마진율계산기")의 화면으로, 화면 전체를 채우는 커스텀 숫자 키패드 + 판매가계산/마진율계산 모드 토글 + 별도 결과 화면(표+공유 버튼) 구조였다.

이 앱은 모든 숫자 입력에 이미 네이티브 키보드(`keyboardType="number-pad"`) + 일반 `TextInput`을 쓰고 있어(`order-product-form.tsx`의 가격 입력 등), 커스텀 키패드는 만들지 않기로 함(사용자 확인). 모드 토글도 없애고, 입력칸 3개 중 아무 2개나 채우면 나머지 1개가 실시간 자동 계산되는 방식으로 단순화(사용자 확인). 결과도 별도 화면 없이 같은 화면에 바로 표시(사용자 확인).

## 범위

- 신규 화면 `src/app/margin-calculator.tsx`
- 신규 계산 로직 `src/lib/margin.ts` (순수 함수, UI 없음 — 화면 파일이 비대해지지 않도록 분리)
- `src/app/index.tsx`: 헤더의 발주(cart) 아이콘 왼쪽에 계산기 아이콘 추가(`mode === 'retail'`일 때만)

## 계산 공식 (`src/lib/margin.ts`)

세 값의 관계는 하나의 항등식에서 파생된다: `판매가 = 원가 / (1 - 마진율/100)`

```ts
export type MarginField = 'cost' | 'margin' | 'price';

export interface MarginInputs {
  cost?: number;   // 원가(원)
  margin?: number; // 마진율(%)
  price?: number;  // 판매가(원)
}

/**
 * cost/margin/price 중 정확히 2개가 주어지면 나머지 1개를 계산해 반환한다.
 * margin이 100 이상이면(분모가 0 이하가 됨) null을 반환한다(계산 불가).
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
```

`computeMissing`은 어떤 필드가 "빠진 값"인지 스스로 판단하지 않는다 — 호출부(화면)가 "이 두 필드가 입력값"이라고 알려주면 나머지 하나를 계산해 돌려주는 순수 함수. 어떤 두 필드가 입력값인지 결정하는 로직(최근 수정한 두 칸 추적)은 화면 쪽 상태로 둔다(아래 참고).

## `src/app/margin-calculator.tsx`

### 상태

```ts
const [values, setValues] = useState<{ cost: string; margin: string; price: string }>({
  cost: '',
  margin: '',
  price: '',
});
const [editedOrder, setEditedOrder] = useState<MarginField[]>([]); // 최근 수정한 필드, 앞이 최신, 최대 2개
```

### 입력 처리

사용자가 필드 `key`를 수정하면:
1. `values[key]`를 새 텍스트로 갱신
2. `editedOrder`에서 `key`를 제거하고 맨 앞에 추가, 앞 2개만 유지 → `nextOrder`
3. `nextOrder.length === 2`면, 그 2개 필드가 "입력값" — `computeMissing`으로 세 번째(출력) 필드 계산
   - 두 입력값이 숫자로 파싱 가능하고 계산 결과가 `null`이 아니면 → 출력 필드에 반영(포맷팅 적용, 아래 참고)
   - 파싱 실패(공백/숫자 아님) 또는 `computeMissing`이 `null`(마진율 100% 이상)이면 → 출력 필드는 빈 문자열로 비움 + `margin` 필드가 문제면 아래 경고 문구 표시
4. `nextOrder.length < 2`(아직 한 필드만 수정)면 나머지 두 필드는 그대로 둔다(계산 안 함)

이 로직은 온갖 순서로 입력해도 "최근 두 번 손댄 칸 = 입력, 나머지 = 결과"라는 하나의 규칙으로 일관되게 동작한다. 예: 원가→마진율 순서로 입력하면 판매가가 계산됨. 그 상태에서 판매가를 직접 고치면, `editedOrder`가 `[price, margin]`이 되어 원가가 다시 계산된다(가장 오래 전에 손댔던 칸이 계산값으로 대체됨).

### 포맷팅

- `cost`/`price`: 정수 원 단위, 천단위 콤마 (`toLocaleString('ko-KR')`)
- `margin`: 소수 첫째 자리까지 (`toFixed(1)`), 불필요한 `.0`은 유지(단순함 우선 — 굳이 안 없앰)
- 입력 중인 필드(방금 사용자가 타이핑한 필드)는 사용자가 입력한 원문 그대로 보여주고, 계산되어 채워지는 출력 필드만 위 포맷을 적용한다.

### 검증 UI

`margin` 필드가 100 이상인 값으로 인해 계산이 무산되면(`computeMissing`이 `null`), 마진율 입력칸 아래 작은 빨간 텍스트로 "마진율은 100% 미만이어야 합니다" 표시. 그 외 실패 케이스(입력 불완전)는 별도 메시지 없이 조용히 출력 필드만 빈 채로 둔다.

### 레이아웃

기존 화면들과 통일된 스타일(`rounded-xl border border-line bg-paper`, 라벨 위/입력창 아래) 3개를 세로로 배치. 상단 `Stack.Screen options={{ title: '원가 계산기' }}`, 뒤로가기는 기본 헤더 동작 사용(다른 하위 화면과 동일).

## `src/app/index.tsx` 변경

`Stack.Screen`의 `headerRight` 안, `mode === 'retail'`일 때 렌더되는 cart-outline `Pressable` **바로 앞**에 계산기 아이콘 추가:

```tsx
{mode === 'retail' ? (
  <Pressable
    onPress={() => router.push('/margin-calculator')}
    hitSlop={8}
    accessibilityRole="button"
    accessibilityLabel="원가 계산기"
  >
    <MaterialCommunityIcons name="calculator-variant" size={22} color="#1A1A1A" />
  </Pressable>
) : null}
```

기존 `mode === 'retail' ? <Pressable onPress={() => router.push('/order')} ...>` 블록은 그대로 두고 그 앞에 위 블록을 삽입한다(순서상 계산기 아이콘이 발주 아이콘보다 왼쪽에 오도록).

## 영향 없음

- 발주(order) 관련 파일, 유통기한 신호등 작업(`dates.ts`/`DdayBadge`/`SummaryHeader`)과 독립적 — 겹치는 파일 없음.
- 계산 결과는 저장하지 않는다(상태 없는 1회성 계산기). 상품 등록 화면과 연동하지 않는다(요청 범위 밖).

## 테스트

테스트 프레임워크 없음 — `npx tsc --noEmit` + 수동 QA:

1. 원가 10000, 마진율 20 입력 → 판매가 12,500원이 자동으로 뜨는지 확인
2. 위 상태에서 판매가를 15,000으로 직접 수정 → 마진율이 33.3%로 재계산되는지 확인(원가는 그대로 10,000)
3. 마진율에 100 이상 입력 → 판매가 계산 안 되고 "마진율은 100% 미만이어야 합니다" 문구가 뜨는지 확인
4. 홈 모드(`mode === 'home'`)에서는 계산기 아이콘이 헤더에 아예 안 보이는지 확인
5. 소매점 모드 헤더에서 계산기 아이콘이 발주(cart) 아이콘보다 왼쪽에 있는지 확인
6. 계산기 화면 진입 → 뒤로가기 → 다시 진입 시 입력값이 초기화(빈 화면)되는지 확인(상태 저장 안 하므로)
