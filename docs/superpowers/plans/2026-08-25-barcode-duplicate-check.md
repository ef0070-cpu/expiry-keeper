# 바코드 스캔 시 중복 등록 확인 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 바코드를 스캔해 상품을 등록하려 할 때, 같은 바코드로 이미 등록된(보관중) 상품이 있으면 유통기한 입력 전에 그 목록부터 보여주고, 그래도 새로 등록할지 사용자가 선택하게 한다.

**Architecture:** `scan.tsx`의 일반(등록) 모드 분기에서 `lookupBarcode`와 신규 `listProductsByBarcode`를 병렬 조회해, 매칭이 있으면 신규 화면 `/product-duplicates`로 보낸다. 이 화면은 mount 시 목록을 재조회(경합 방지)하고, 기존 `ProductCard`로 나열하며, [취소]/[등록] 버튼으로 나가거나 등록 폼으로 계속 진행한다.

**Tech Stack:** React Native + Expo Router, TypeScript. 새 의존성 없음 — 기존 `ProductCard`(`@/components/ProductCard`), `lookupBarcode`(`@/lib/barcode-lookup`)를 그대로 재사용.

**Spec:** `docs/superpowers/specs/2026-08-25-barcode-duplicate-check-design.md`

## Global Constraints

- 이 저장소엔 테스트 프레임워크가 없다(jest/vitest 미설정) — 이 기능만을 위해 새로 도입하지 않는다. 각 작업 완료 확인은 `npx tsc --noEmit` 타입체크 + 실기기/에뮬레이터 수동 QA로 한다.
- `listProductsByBarcode` 실패 시 빈 배열을 반환한다 (기존 `lookupBarcode`의 조용한 실패 패턴과 동일) — 별도 에러 알럿 없음.
- 소진/폐기 처리된(`status !== 'active'`) 상품은 목록에 포함하지 않는다.
- 홈 검색창의 바코드 스캔 검색 기능(`mode=search` 분기, 이미 구현됨)과는 독립적인 변경이며 서로 겹치지 않는다 — `scan.tsx`의 `params.mode === 'search'` 분기는 건드리지 않는다.
- 매칭되는 기존 상품이 없으면 지금과 동일하게 곧바로 등록 폼으로 진행한다 (동작 변화 없음).

---

### Task 1: `repo.ts` — `listProductsByBarcode` 추가

**Files:**
- Modify: `src/lib/repo.ts` (파일 끝, `deleteProduct` 함수 다음)

**Interfaces:**
- Consumes: 없음 (기존 `supabase`, `localList`, `fromRow`, `ProductRow` 그대로 사용)
- Produces: `listProductsByBarcode(barcode: string): Promise<Product[]>` — `status === 'active'`인 상품만, `expiryDate` 오름차순 정렬, 실패 시 `[]`. Task 2(`scan.tsx`)와 Task 3(`product-duplicates.tsx`)가 이 시그니처로 import한다.

- [ ] **Step 1: `listProductsByBarcode` 추가**

`src/lib/repo.ts` 맨 끝(`deleteProduct` 함수 다음)에 추가:

```ts

/** 같은 바코드로 이미 등록된(보관중) 상품 목록을 조회한다. 실패 시 조용히 빈 배열을 반환한다. */
export async function listProductsByBarcode(barcode: string): Promise<Product[]> {
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('barcode', barcode)
        .eq('status', 'active')
        .order('expiry_date', { ascending: true });
      if (error) return [];
      return (data as ProductRow[]).map(fromRow);
    }
    const items = await localList();
    return items
      .filter((p) => p.barcode === barcode && p.status === 'active')
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 에러 없음 (기존에 있던 무관한 에러가 있었다면 그 개수가 늘지 않았는지만 확인)

- [ ] **Step 3: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/lib/repo.ts
git commit -m "feat: add listProductsByBarcode for duplicate detection"
```

---

### Task 2: `scan.tsx` — 일반 등록 모드에서 중복 확인 분기

**Files:**
- Modify: `src/app/scan.tsx:1-83` (import문, `onScanned` 함수의 `mode !== 'search'` 분기)

**Interfaces:**
- Consumes: `listProductsByBarcode(barcode: string): Promise<Product[]>` (`@/lib/repo`, Task 1)
- Produces: 신규 화면과의 네비게이션 계약 — 매칭 있으면 `router.replace({ pathname: '/product-duplicates', params: { barcode, prefillName, prefillImage } })`. Task 3이 이 파라미터(`barcode`, `prefillName?`, `prefillImage?`)를 `useLocalSearchParams`로 받는다.

- [ ] **Step 1: import문에 `listProductsByBarcode` 추가**

`src/app/scan.tsx` 7번째 줄(`import { lookupBarcode } from '@/lib/barcode-lookup';`) 다음에 추가:

```tsx
import { listProductsByBarcode } from '@/lib/repo';
```

- [ ] **Step 2: 일반 등록 모드 분기를 병렬 조회 + 중복 확인으로 교체**

기존 (`onScanned` 함수 내부, `search` 모드 분기 다음):

```tsx
    setLooking(true);
    // 바코드로 상품 정보 자동 조회 후 등록 화면으로 이동
    const info = await lookupBarcode(data);
    router.replace({
      pathname: '/product-form',
      params: {
        barcode: data,
        prefillName: info.name ?? '',
        prefillImage: info.imageUrl ?? '',
      },
    });
  };
```

다음으로 교체:

```tsx
    setLooking(true);
    // 상품 정보 조회와 동시에 같은 바코드로 이미 등록된(보관중) 상품이 있는지 확인한다
    const [info, duplicates] = await Promise.all([
      lookupBarcode(data),
      listProductsByBarcode(data),
    ]);

    if (duplicates.length > 0) {
      router.replace({
        pathname: '/product-duplicates',
        params: {
          barcode: data,
          prefillName: info.name ?? '',
          prefillImage: info.imageUrl ?? '',
        },
      });
      return;
    }

    router.replace({
      pathname: '/product-form',
      params: {
        barcode: data,
        prefillName: info.name ?? '',
        prefillImage: info.imageUrl ?? '',
      },
    });
  };
```

- [ ] **Step 3: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 에러 없음 (`/product-duplicates` 라우트는 Task 3에서 생성되므로, Task 3 완료 전까지는 expo-router 타입에서 해당 경로를 모를 수 있다 — 이 경우 에러 메시지가 "정의되지 않은 경로"류라면 정상, Task 3 완료 후 재확인)

- [ ] **Step 4: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/scan.tsx
git commit -m "feat: check for duplicate barcode registrations before registering"
```

---

### Task 3: `product-duplicates.tsx` 신규 화면 + 라우트 등록

**Files:**
- Create: `src/app/product-duplicates.tsx`
- Modify: `src/app/_layout.tsx:46-56` (`Stack.Protected` 블록 내 `Stack.Screen` 목록)

**Interfaces:**
- Consumes: `listProductsByBarcode(barcode: string): Promise<Product[]>` (`@/lib/repo`, Task 1), Task 2가 만든 네비게이션 계약(`barcode`, `prefillName?`, `prefillImage?` 파라미터), 기존 `ProductCard` (`@/components/ProductCard`, props: `product: Product`, `onPress: () => void`, `onLongPress: () => void`)
- Produces: 없음 (최종 사용자 대면 화면)

- [ ] **Step 1: `product-duplicates.tsx` 생성**

`src/app/product-duplicates.tsx` 새로 생성:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProductCard from '@/components/ProductCard';
import { listProductsByBarcode } from '@/lib/repo';
import { Product } from '@/lib/types';

export default function ProductDuplicates() {
  const params = useLocalSearchParams<{
    barcode: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProductsByBarcode(params.barcode).then((matches) => {
      if (cancelled) return;
      if (matches.length === 0) {
        // mount 사이 상태가 바뀐 경합 상황 — 중복 화면 없이 바로 등록 폼으로
        router.replace({
          pathname: '/product-form',
          params: {
            barcode: params.barcode,
            prefillName: params.prefillName ?? '',
            prefillImage: params.prefillImage ?? '',
          },
        });
        return;
      }
      setProducts(matches);
    });
    return () => {
      cancelled = true;
    };
  }, [params.barcode]);

  const goToForm = () => {
    router.replace({
      pathname: '/product-form',
      params: {
        barcode: params.barcode,
        prefillName: params.prefillName ?? '',
        prefillImage: params.prefillImage ?? '',
      },
    });
  };

  if (products === null) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color="#CC2222" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <Text className="text-muted mx-4 mt-4 text-sm leading-5">
        같은 바코드로 이미 등록된 상품이 있어요. 목록을 눌러 확인하거나, 그래도 새로 등록할 수 있어요.
      </Text>

      <ScrollView className="mt-3 flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onPress={() => router.push({ pathname: '/product-form', params: { id: p.id } })}
            onLongPress={() => {}}
          />
        ))}
      </ScrollView>

      <View
        className="flex-row border-t border-line bg-paper px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable
          onPress={() => router.replace('/')}
          className="mr-2 flex-1 items-center rounded-xl border border-line bg-paper py-3 active:opacity-70"
        >
          <Text className="text-ink text-base font-bold">취소</Text>
        </Pressable>
        <Pressable
          onPress={goToForm}
          className="ml-2 flex-1 items-center rounded-xl bg-primary py-3 active:opacity-80"
        >
          <Text className="text-paper text-base font-bold">등록</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: `_layout.tsx`에 라우트 등록**

`src/app/_layout.tsx`에서 기존:

```tsx
          <Stack.Screen name="product-form" options={{ title: '상품 등록' }} />
```

다음으로 교체 (바로 다음 줄에 추가):

```tsx
          <Stack.Screen name="product-form" options={{ title: '상품 등록' }} />
          <Stack.Screen name="product-duplicates" options={{ title: '이미 등록된 상품' }} />
```

- [ ] **Step 3: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 수동 QA (스펙 5가지 시나리오)**

`npx expo start`로 앱 실행 후:

1. **중복 있는 바코드 스캔**: 이미 등록된(보관중) 상품의 바코드를 홈 FAB(`/scan`, 일반 모드)로 스캔 → 중복 확인 화면이 뜨고 해당 상품이 목록에 나타난다 → 카드 탭 → 그 상품의 수정 화면(`product-form`)으로 이동한다
2. **[등록] 버튼**: 중복 확인 화면에서 [등록] 탭 → 기존과 동일하게 이름/사진이 prefill된 등록 폼으로 이동한다
3. **[취소] 버튼**: 중복 확인 화면에서 [취소] 탭 → 홈 화면으로 이동하고 아무것도 등록되지 않는다
4. **미등록 바코드**: 처음 스캔하는 바코드 → 중복 확인 화면 없이 곧바로 등록 폼으로 진행한다 (기존 동작 유지)
5. **소진/폐기만 있는 바코드**: 소진 또는 폐기 처리된 상품만 있는 바코드를 스캔 → 중복 확인 화면이 뜨지 않고 곧바로 등록 폼으로 진행한다

- [ ] **Step 5: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/product-duplicates.tsx src/app/_layout.tsx
git commit -m "feat: add duplicate-check screen when scanning a barcode already registered"
```

---

## Self-Review Notes

- **스펙 커버리지**: 등록 전 기존 목록 노출(Task 2 Step 2 + Task 3 Step 1 mount effect), 카드 탭 시 수정 이동(Task 3 Step 1 `onPress`), [취소]/[등록] 버튼(Task 3 Step 1), 매칭 없으면 기존과 동일(Task 2 Step 2의 `else` 경로, 동작 변화 없음), 검색 모드와 독립(Task 2는 `mode === 'search'` 분기 이후 코드만 수정), 재조회 시 0건이면 경합 방지 즉시 이동(Task 3 Step 1 mount effect), 소진/폐기 제외(Task 1의 `status === 'active'` 필터), 조용한 실패(Task 1의 `catch { return [] }`) — 모두 태스크에 매핑됨.
- **타입 일관성**: `listProductsByBarcode(barcode: string): Promise<Product[]>`를 Task 1에서 정의한 그대로 Task 2(`scan.tsx`)·Task 3(`product-duplicates.tsx`)에서 동일하게 import·사용. 네비게이션 파라미터 이름(`barcode`, `prefillName`, `prefillImage`)이 Task 2의 `router.replace` 대상과 Task 3의 `useLocalSearchParams`에서 동일.
- **플레이스홀더 없음**: 모든 코드 블록이 실제 diff/전체 파일 형태로 작성됨.
