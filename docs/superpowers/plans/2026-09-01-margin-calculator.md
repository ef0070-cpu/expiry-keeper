# 원가·마진 계산기 (소매점 전용) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소매점 모드에서 원가/마진율/판매가 3개 입력칸 중 아무 2개나 채우면 나머지 1개가 실시간 자동 계산되는 화면을 추가하고, 홈 화면 헤더의 발주 아이콘 왼쪽에 진입 아이콘을 붙인다.

**Architecture:** 계산 공식은 `src/lib/margin.ts`의 순수 함수 `computeMissing`으로 분리한다. 화면(`src/app/margin-calculator.tsx`)은 "최근 수정한 두 필드 = 입력값"을 추적하는 로컬 state만 갖고, 실제 계산은 전부 `computeMissing`에 위임한다. 라우트는 `src/app/_layout.tsx`의 기존 소매점 전용 `Stack.Protected` 블록에 등록하고, 진입점은 `src/app/index.tsx` 헤더에 아이콘으로 추가한다.

**Tech Stack:** React Native + Expo Router, TypeScript, NativeWind. 새 의존성 없음.

## Global Constraints

- 이 저장소엔 테스트 프레임워크가 없다(jest/vitest 미설정) — 완료 확인은 `npx tsc --noEmit` 타입체크 + 실기기 수동 QA로 한다.
- 계산 공식: `판매가 = 원가 / (1 - 마진율/100)`. 마진율이 100 이상이면 계산 불가(`null` 반환), 화면에 마진율 필드 아래 경고 문구를 띄운다.
- 원가/판매가는 정수 원 단위(천단위 콤마 표시), 마진율은 소수 첫째 자리까지.
- 계산 결과는 저장하지 않는다 — 화면을 나가면 입력값은 사라진다.
- 이 화면은 `mode === 'retail'`일 때만 접근 가능해야 한다(다른 소매점 전용 화면과 동일한 `Stack.Protected` 가드 재사용).

---

### Task 1: `src/lib/margin.ts` — 계산 로직

**Files:**
- Create: `src/lib/margin.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `MarginField = 'cost' | 'margin' | 'price'`, `MarginInputs { cost?: number; margin?: number; price?: number }`, `computeMissing(known: { a: MarginField; b: MarginField }, inputs: MarginInputs): number | null` — Task 2가 그대로 가져다 쓴다.

- [ ] **Step 1: 파일 작성**

```ts
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
```

- [ ] **Step 2: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: `src/app/login.tsx(110,45)`의 기존 무관 에러 1건 외에 새 에러 없음.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/lib/margin.ts
git commit -m "feat: 원가/마진율/판매가 상호 계산 로직 추가"
```

---

### Task 2: `src/app/margin-calculator.tsx` — 화면 + 라우트 등록

**Files:**
- Create: `src/app/margin-calculator.tsx`
- Modify: `src/app/_layout.tsx:59-61` (소매점 전용 `Stack.Protected` 블록에 라우트 추가)

**Interfaces:**
- Consumes: Task 1의 `MarginField`, `MarginInputs`, `computeMissing` (`@/lib/margin`)
- Produces: 라우트 `/margin-calculator` — Task 3이 여기로 `router.push`한다.

- [ ] **Step 1: 화면 파일 작성**

```tsx
import { Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { computeMissing, MarginField, MarginInputs } from '@/lib/margin';

const FIELDS: {
  key: MarginField;
  label: string;
  suffix: string;
  keyboardType: 'number-pad' | 'decimal-pad';
}[] = [
  { key: 'cost', label: '원가', suffix: '원', keyboardType: 'number-pad' },
  { key: 'margin', label: '마진율', suffix: '%', keyboardType: 'decimal-pad' },
  { key: 'price', label: '판매가', suffix: '원', keyboardType: 'number-pad' },
];

function parseNum(text: string): number {
  return Number(text.replace(/,/g, ''));
}

function formatValue(key: MarginField, n: number): string {
  if (key === 'margin') return n.toFixed(1);
  return Math.round(n).toLocaleString('ko-KR');
}

export default function MarginCalculator() {
  const [values, setValues] = useState<Record<MarginField, string>>({
    cost: '',
    margin: '',
    price: '',
  });
  const [editedOrder, setEditedOrder] = useState<MarginField[]>([]);
  const [marginError, setMarginError] = useState(false);

  const onChangeField = (key: MarginField, text: string) => {
    const nextOrder = [key, ...editedOrder.filter((k) => k !== key)].slice(0, 2);
    const nextValues = { ...values, [key]: text };
    let nextMarginError = false;

    if (nextOrder.length === 2) {
      const [a, b] = nextOrder;
      const outputKey = FIELDS.map((f) => f.key).find((k) => k !== a && k !== b)!;
      const numA = parseNum(nextValues[a]);
      const numB = parseNum(nextValues[b]);
      const bothValid =
        nextValues[a].trim() !== '' &&
        nextValues[b].trim() !== '' &&
        !Number.isNaN(numA) &&
        !Number.isNaN(numB);

      if (bothValid) {
        const inputs: MarginInputs = {};
        inputs[a] = numA;
        inputs[b] = numB;
        const result = computeMissing({ a, b }, inputs);
        if (result === null) {
          nextValues[outputKey] = '';
          if (a === 'margin' || b === 'margin') nextMarginError = true;
        } else {
          nextValues[outputKey] = formatValue(outputKey, result);
        }
      } else {
        nextValues[outputKey] = '';
      }
    }

    setEditedOrder(nextOrder);
    setValues(nextValues);
    setMarginError(nextMarginError);
  };

  return (
    <>
      <Stack.Screen options={{ title: '원가 계산기' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="flex-1 bg-bg"
          contentContainerStyle={{ padding: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {FIELDS.map((f) => (
            <View key={f.key} className="mb-4">
              <Text className="text-ink mb-1.5 text-sm font-bold">
                {f.label} ({f.suffix})
              </Text>
              <TextInput
                className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
                placeholder="0"
                placeholderTextColor="#BBBBBB"
                keyboardType={f.keyboardType}
                value={values[f.key]}
                onChangeText={(t) => onChangeField(f.key, t)}
              />
              {f.key === 'margin' && marginError ? (
                <Text className="text-primary mt-1 text-xs">마진율은 100% 미만이어야 합니다</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
```

- [ ] **Step 2: `_layout.tsx`에 라우트 등록**

기존 (59~61번째 줄):

```tsx
        <Stack.Protected guard={authed && mode === 'retail'}>
          <Stack.Screen name="order" options={{ title: '발주 관리' }} />
          <Stack.Screen name="order-product-form" options={{ title: '발주 상품' }} />
```

다음으로 교체:

```tsx
        <Stack.Protected guard={authed && mode === 'retail'}>
          <Stack.Screen name="order" options={{ title: '발주 관리' }} />
          <Stack.Screen name="order-product-form" options={{ title: '발주 상품' }} />
          <Stack.Screen name="margin-calculator" options={{ title: '원가 계산기' }} />
```

- [ ] **Step 3: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 기존 무관 에러 1건 외에 새 에러 없음.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/margin-calculator.tsx src/app/_layout.tsx
git commit -m "feat: 원가 계산기 화면 추가 및 소매점 전용 라우트 등록"
```

---

### Task 3: `src/app/index.tsx` — 헤더 진입 아이콘

**Files:**
- Modify: `src/app/index.tsx:192-202` (헤더 `mode === 'retail'` 블록, cart-outline 앞에 삽입)

**Interfaces:**
- Consumes: Task 2가 등록한 라우트 `/margin-calculator`
- Produces: 없음 (최종 사용자 대면 UI)

- [ ] **Step 1: 계산기 아이콘 삽입**

기존 (192~202번째 줄):

```tsx
              {mode === 'retail' ? (
                <Pressable
                  onPress={() => router.push('/order')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="발주 관리"
                >
                  <MaterialCommunityIcons name="cart-outline" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
```

다음으로 교체(계산기 아이콘을 발주 아이콘보다 앞에 삽입):

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
              {mode === 'retail' ? (
                <Pressable
                  onPress={() => router.push('/order')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="발주 관리"
                >
                  <MaterialCommunityIcons name="cart-outline" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
```

- [ ] **Step 2: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 기존 무관 에러 1건 외에 새 에러 없음.

- [ ] **Step 3: 수동 QA (스펙 6가지 시나리오)**

dev client가 준비되면 `npx expo start`로 앱 실행 후, 소매점 모드 계정으로 로그인해:

1. 원가 10000, 마진율 20 입력 → 판매가 12,500원이 자동으로 뜨는지 확인
2. 위 상태에서 판매가를 15,000으로 직접 수정 → 마진율이 33.3%로 재계산되는지 확인(원가는 그대로 10,000)
3. 마진율에 100 이상 입력 → 판매가 계산 안 되고 "마진율은 100% 미만이어야 합니다" 문구가 뜨는지 확인
4. 홈 모드(`mode === 'home'`)에서는 계산기 아이콘이 헤더에 아예 안 보이는지 확인
5. 소매점 모드 헤더에서 계산기 아이콘이 발주(cart) 아이콘보다 왼쪽에 있는지 확인
6. 계산기 화면 진입 → 뒤로가기 → 다시 진입 시 입력값이 초기화(빈 화면)되는지 확인

- [ ] **Step 4: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/index.tsx
git commit -m "feat: 홈 헤더에 원가 계산기 진입 아이콘 추가"
```

---

## Self-Review Notes

- **스펙 커버리지**: `computeMissing` 공식(Task 1), 3필드 자동계산 화면 + 포맷팅 + 마진율 100% 이상 경고(Task 2), `_layout.tsx` 라우트 가드(Task 2), 헤더 진입 아이콘 위치(Task 3) — 스펙의 모든 절이 커버됨. "영향 없음" 절(발주/신호등 작업)은 겹치는 파일이 없어 별도 처리 불필요.
- **타입 일관성**: `MarginField`/`MarginInputs`/`computeMissing`을 Task 1에서 정의한 그대로 Task 2가 import해 사용. 필드 3개(`cost`/`margin`/`price`) 이름이 `margin.ts`와 화면 컴포넌트 전체에서 동일.
- **플레이스홀더 없음**: 모든 스텝이 실제 전체 코드로 작성됨.
- **콤마 파싱 주의사항**: 원가/판매가는 `toLocaleString`으로 콤마가 붙은 채 화면에 남는다 — 이후 그 필드를 다시 수정할 때 `Number()`가 콤마 때문에 실패하지 않도록 `parseNum`에서 `replace(/,/g, '')` 처리함(Task 2 Step 1에 반영됨).
