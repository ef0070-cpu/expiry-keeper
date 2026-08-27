# 발주 기능 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 병합된 발주 관리 기능에 사진 자동 채우기, 하단 바 가림 수정, 탭으로 즉시 수정, 납품상태 태그, 목록 바코드 표시, 바코드 수동 입력+조회 기능을 추가한다.

**Architecture:** 기존 4개 파일(`order-types.ts`, `order-repo.ts`, `order.tsx`, `order-product-form.tsx`)만 수정한다. 새 파일/새 의존성/새 Supabase 스키마 없음. 기존에 이미 구현된 `lookupBarcode`(공용 바코드 캐시 조회)와 `useSafeAreaInsets`(안전영역 패턴)를 재사용한다.

**Tech Stack:** React Native / Expo Router, TypeScript, AsyncStorage, Supabase Edge Functions(기존 것만 재사용).

## Global Constraints

- 발주 카탈로그/카테고리/장바구니는 기기 로컬 `AsyncStorage`만 사용한다 — Supabase 테이블/동기화를 새로 추가하지 않는다.
- 가격·카테고리는 로컬에만 유지하고 공유하지 않는다. 공유되는 것은 바코드·상품명·사진뿐이며, 기존 공용 캐시 `barcode_catalog`(`upsertBarcodeCatalog`/`lookupBarcode`)를 그대로 재사용한다.
- 이 프로젝트에는 자동 테스트 러너가 없다. 각 태스크의 검증은 `npx tsc --noEmit` 통과 여부로 한다.
- `Alert.prompt` 사용 금지(iOS 전용), 커스텀 dialog 컴포넌트 신설 금지 — 확인/선택은 전부 `Alert.alert`.
- 참고 스펙: `docs/superpowers/specs/2026-08-27-order-feature-enhancements-design.md`

---

### Task 1: OrderStatus 타입 추가 + listOrderProducts 기본값 처리

**Files:**
- Modify: `src/lib/order-types.ts`
- Modify: `src/lib/order-repo.ts:17-20` (`listOrderProducts`)
- Test: `npx tsc --noEmit`

**Interfaces:**
- Produces: `OrderStatus`(`'active' | 'discontinued' | 'paused'`, `@/lib/order-types`), `OrderProduct.status?: OrderStatus` 필드. `listOrderProducts()`가 반환하는 모든 항목은 이제 `status`가 항상 채워져 있음(과거 데이터는 `'active'`). Task 4, 5가 이 타입과 기본값 보장을 소비한다.

- [ ] **Step 1: `src/lib/order-types.ts` 수정**

기존 코드:
```ts
export interface OrderProduct {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  imageUri: string | null;
}

export type OrderCart = Record<string, number>;
```

다음으로 교체:
```ts
export type OrderStatus = 'active' | 'discontinued' | 'paused';

export interface OrderProduct {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  imageUri: string | null;
  status?: OrderStatus;
}

export type OrderCart = Record<string, number>;
```

- [ ] **Step 2: `src/lib/order-repo.ts`의 `listOrderProducts` 수정**

기존 코드:
```ts
export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  return raw ? (JSON.parse(raw) as OrderProduct[]) : [];
}
```

다음으로 교체:
```ts
export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  const items = raw ? (JSON.parse(raw) as OrderProduct[]) : [];
  return items.map((p) => ({ status: 'active' as const, ...p }));
}
```

(스프레드 순서상 `p.status`가 이미 있으면 그 값이, 없으면 `'active'`가 쓰인다. 시드 데이터 388건은 이 필드가 없으므로 전부 `'active'`로 읽힌다.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (기존 `login.tsx` 무관 에러 1건만 있으면 정상)

- [ ] **Step 4: Commit**

```bash
git add src/lib/order-types.ts src/lib/order-repo.ts
git commit -m "feat: OrderProduct에 납품상태(status) 필드 추가"
```

---

### Task 2: 사진 없는 발주 상품 자동 채우기 함수

**Files:**
- Modify: `src/lib/order-repo.ts` (상단 import, 파일 끝에 함수 추가)
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `lookupBarcode(barcode: string): Promise<{ name: string | null; imageUrl: string | null }>`(기존, `@/lib/barcode-lookup`)
- Produces: `fillMissingOrderPhotos(onProgress?: (done: number, total: number) => void): Promise<number>` — Task 6(`order.tsx`)가 `@/lib/order-repo`에서 가져다 쓴다.

- [ ] **Step 1: import 추가**

기존 코드(파일 최상단):
```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { newId } from './repo';
import { OrderCart, OrderProduct } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';
```

다음으로 교체:
```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lookupBarcode } from './barcode-lookup';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { newId } from './repo';
import { OrderCart, OrderProduct } from './order-types';
import { DEFAULT_ORDER_PRODUCTS } from './order-seed-data';
```

- [ ] **Step 2: 파일 맨 끝(`seedDefaultOrderProducts` 함수 뒤)에 함수 추가**

```ts

/**
 * 바코드가 있지만 사진이 없는 발주 상품을 순서대로 훑어 lookupBarcode()로 채운다.
 * 항목 하나 채울 때마다 즉시 저장한다(중단돼도 그동안 채운 건 유지됨).
 * 공용 바코드 캐시(upsertBarcodeCatalog)에는 다시 쓰지 않는다 — 이미 캐시에서 읽어왔거나
 * 외부 API에서 새로 찾은 값을 로컬에 반영하는 것뿐이라 재기록이 불필요하다
 * (seedDefaultOrderProducts와 동일한 논리로 대량 개별 네트워크 쓰기를 피한다).
 */
export async function fillMissingOrderPhotos(
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const items = await listOrderProducts();
  const targets = items.filter((p) => p.barcode && !p.imageUri);
  let filled = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const info = await lookupBarcode(target.barcode!);
    if (info.imageUrl) {
      const idx = items.findIndex((p) => p.id === target.id);
      if (idx >= 0) {
        items[idx] = { ...items[idx], imageUri: info.imageUrl };
        await writeOrderProducts(items);
        filled++;
      }
    }
    onProgress?.(i + 1, targets.length);
  }
  return filled;
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 사진 없는 발주 상품 바코드로 자동 채우기 함수 추가"
```

---

### Task 3: 발주 등록/수정 화면 — 바코드 수동 입력 + 조회 버튼

**Files:**
- Modify: `src/app/order-product-form.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `lookupBarcode(barcode: string): Promise<{ name: string | null; imageUrl: string | null }>`, `hasImageSearchKeys(): boolean`(둘 다 기존, `@/lib/barcode-lookup`)
- Produces: 없음(UI 전용, `barcode` 상태의 타입만 `string | null` → `string`으로 바뀜 — Task 4가 이 변경 이후의 `save()` 코드를 이어받는다)

- [ ] **Step 1: import에 `lookupBarcode` 추가**

기존 코드:
```ts
import { hasImageSearchKeys, searchProductImage } from '@/lib/barcode-lookup';
```

다음으로 교체:
```ts
import { hasImageSearchKeys, lookupBarcode, searchProductImage } from '@/lib/barcode-lookup';
```

- [ ] **Step 2: `barcode` 상태를 문자열로, `checkingBarcode` 상태 추가**

기존 코드:
```ts
  const [barcode, setBarcode] = useState<string | null>(params.barcode ?? null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
```

다음으로 교체:
```ts
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [checkingBarcode, setCheckingBarcode] = useState(false);
```

- [ ] **Step 3: 수정 모드 로드 시 barcode를 문자열로 세팅**

기존 코드:
```ts
    if (params.id) {
      getOrderProduct(params.id).then((p) => {
        if (!p) return;
        setName(p.name);
        setImageUri(p.imageUri);
        setBrand(p.brand);
        setPrice(String(p.price));
        setBarcode(p.barcode);
        setCategory(p.category);
      });
    }
```

다음으로 교체:
```ts
    if (params.id) {
      getOrderProduct(params.id).then((p) => {
        if (!p) return;
        setName(p.name);
        setImageUri(p.imageUri);
        setBrand(p.brand);
        setPrice(String(p.price));
        setBarcode(p.barcode ?? '');
        setCategory(p.category);
      });
    }
```

- [ ] **Step 4: 바코드 조회 핸들러 추가**

`findImageOnWeb` 함수 바로 뒤에 이어서 추가:

```ts
  const checkBarcode = async () => {
    const v = barcode.trim();
    if (!v) {
      Alert.alert('입력 확인', '바코드를 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '바코드 조회를 사용하려면 로그인이 필요합니다.');
      return;
    }
    setCheckingBarcode(true);
    const info = await lookupBarcode(v);
    setCheckingBarcode(false);
    if (!info.name && !info.imageUrl) {
      Alert.alert('조회 결과 없음', '일치하는 정보를 찾지 못했습니다. 직접 입력해 주세요.');
      return;
    }
    if (info.name && !name.trim()) setName(info.name);
    if (info.imageUrl && !imageUri) setImageUri(info.imageUrl);
  };
```

- [ ] **Step 5: `save()`에서 barcode를 trim 처리**

기존 코드:
```ts
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode,
        imageUri,
      };
```

다음으로 교체:
```ts
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode: barcode.trim() || null,
        imageUri,
      };
```

- [ ] **Step 6: 상단 바코드 배지 제거 + 새 바코드 입력 섹션 추가**

기존 코드(상품명 라벨 줄):
```tsx
          <View className="ml-3 flex-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-ink text-sm font-bold">상품명 *</Text>
              {barcode ? (
                <View className="flex-row items-center">
                  <MaterialCommunityIcons name="barcode" size={14} color="#888888" />
                  <Text className="text-muted ml-1 text-xs">{barcode}</Text>
                </View>
              ) : null}
            </View>
            <TextInput
```

다음으로 교체:
```tsx
          <View className="ml-3 flex-1">
            <Text className="text-ink text-sm font-bold">상품명 *</Text>
            <TextInput
```

이어서, 기존 코드(상품명 섹션이 끝나고 브랜드/가격 섹션이 시작되는 경계):
```tsx
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="브랜드" />
```

다음으로 교체(바코드 입력 섹션을 그 사이에 추가):
```tsx
          </View>
        </View>

        <View className="mt-4">
          <Label text="바코드" />
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="바코드 번호 입력 또는 스캔"
              placeholderTextColor="#BBBBBB"
              value={barcode}
              onChangeText={setBarcode}
            />
            <Pressable
              onPress={checkBarcode}
              disabled={checkingBarcode}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              {checkingBarcode ? (
                <ActivityIndicator size="small" color="#CC2222" />
              ) : (
                <Text className="text-ink text-sm font-medium">조회</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="브랜드" />
```

- [ ] **Step 7: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 8: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주 상품 등록 화면에 바코드 수동 입력 + 조회 버튼 추가"
```

---

### Task 4: 발주 등록/수정 화면 — 납품상태 선택 UI

**Files:**
- Modify: `src/app/order-product-form.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `OrderStatus`(Task 1, `@/lib/order-types`)
- Produces: 없음(UI 전용)

이 태스크는 Task 3 완료 후의 `order-product-form.tsx`를 기준으로 한다.

- [ ] **Step 1: import에 `OrderStatus` 추가**

기존 코드:
```ts
import { OrderProduct } from '@/lib/order-types';
```

다음으로 교체:
```ts
import { OrderProduct, OrderStatus } from '@/lib/order-types';
```

- [ ] **Step 2: `status` 상태 추가**

기존 코드:
```ts
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
```

다음으로 교체:
```ts
  const [newCategory, setNewCategory] = useState('');
  const [status, setStatus] = useState<OrderStatus>('active');
  const [busy, setBusy] = useState(false);
```

- [ ] **Step 3: 수정 모드 로드 시 status 세팅**

기존 코드(Task 3에서 이미 수정된 상태):
```ts
        setBarcode(p.barcode ?? '');
        setCategory(p.category);
      });
```

다음으로 교체:
```ts
        setBarcode(p.barcode ?? '');
        setCategory(p.category);
        setStatus(p.status ?? 'active');
      });
```

- [ ] **Step 4: `save()`에 status 포함**

기존 코드(Task 3에서 이미 수정된 상태):
```ts
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode: barcode.trim() || null,
        imageUri,
      };
```

다음으로 교체:
```ts
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode: barcode.trim() || null,
        imageUri,
        status,
      };
```

- [ ] **Step 5: 납품상태 3버튼 UI 추가**

기존 코드(카테고리 섹션이 끝나고 저장/삭제 버튼 행이 시작되는 경계):
```tsx
        </View>

        <View className="mt-5 flex-row gap-3">
          {isEdit ? (
```

다음으로 교체(상태 선택 섹션을 그 사이에 추가):
```tsx
        </View>

        <View className="mt-4">
          <Label text="납품상태" />
          <View className="flex-row gap-2">
            <StatusOption
              label="시판중"
              color="#2E7D32"
              active={status === 'active'}
              onPress={() => setStatus('active')}
            />
            <StatusOption
              label="단종"
              color="#C62828"
              active={status === 'discontinued'}
              onPress={() => setStatus('discontinued')}
            />
            <StatusOption
              label="생산중단"
              color="#F9A825"
              active={status === 'paused'}
              onPress={() => setStatus('paused')}
            />
          </View>
        </View>

        <View className="mt-5 flex-row gap-3">
          {isEdit ? (
```

- [ ] **Step 6: `StatusOption` 컴포넌트 추가**

파일 맨 끝, 기존 `Label` 함수 뒤에 이어서 추가:

```tsx
function StatusOption({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center justify-center rounded-xl border py-2.5 active:opacity-70"
      style={{
        borderColor: active ? color : '#E5E5E5',
        backgroundColor: active ? color : '#FFFFFF',
      }}
    >
      <Text className="text-sm font-bold" style={{ color: active ? '#FFFFFF' : '#888888' }}>
        {label}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 7: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 8: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주 상품 등록 화면에 납품상태(시판중/단종/생산중단) 선택 UI 추가"
```

---

### Task 5: 발주 목록 — 탭으로 즉시 수정 + 바코드 표시 + 납품상태 태그 + 하단 바 안전영역

**Files:**
- Modify: `src/app/order.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `OrderStatus`(Task 1, `@/lib/order-types`)
- Produces: 없음(UI 전용). `CatalogRow`가 `onPress` prop을 새로 요구하게 됨 — Task 6은 이 태스크 이후의 `order.tsx`를 기준으로 이어받는다.

- [ ] **Step 1: import 수정 (안전영역 훅 추가, OrderStatus 추가)**

기존 코드:
```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Chip from '@/components/Chip';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct } from '@/lib/order-types';
```

다음으로 교체:
```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  active: { label: '시판중', color: '#2E7D32' },
  discontinued: { label: '단종', color: '#C62828' },
  paused: { label: '생산중단', color: '#F9A825' },
};
```

- [ ] **Step 2: 컴포넌트에서 안전영역 값 가져오기**

기존 코드:
```tsx
export default function Order() {
  const [products, setProducts] = useState<OrderProduct[]>([]);
```

다음으로 교체:
```tsx
export default function Order() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<OrderProduct[]>([]);
```

- [ ] **Step 3: 하단 바 패딩에 안전영역 반영**

기존 코드:
```tsx
      {totalCount > 0 ? (
        <View className="absolute bottom-0 left-0 right-0 p-4">
          <Pressable
```

다음으로 교체:
```tsx
      {totalCount > 0 ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        >
          <Pressable
```

- [ ] **Step 4: `FlatList`의 `renderItem`에 `onPress` 전달**

기존 코드:
```tsx
        renderItem={({ item }) => (
          <CatalogRow
            product={item}
            qty={cart[item.id] ?? 0}
            onChangeQty={(delta) => changeQty(item.id, delta)}
            onLongPress={() => onLongPressProduct(item)}
          />
        )}
```

다음으로 교체:
```tsx
        renderItem={({ item }) => (
          <CatalogRow
            product={item}
            qty={cart[item.id] ?? 0}
            onChangeQty={(delta) => changeQty(item.id, delta)}
            onPress={() =>
              router.push({ pathname: '/order-product-form', params: { id: item.id } })
            }
            onLongPress={() => onLongPressProduct(item)}
          />
        )}
```

- [ ] **Step 5: `CatalogRow` 컴포넌트 전체 교체**

기존 코드:
```tsx
function CatalogRow({
  product,
  qty,
  onChangeQty,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  onChangeQty: (delta: number) => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      {product.imageUri ? (
        <Image
          source={{ uri: product.imageUri }}
          style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#F0F0F0' }}
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 items-center justify-center rounded-lg bg-bg">
          <MaterialCommunityIcons name="image-off-outline" size={22} color="#BBBBBB" />
        </View>
      )}
      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-sm">
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(-1)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="minus" size={16} color="#1A1A1A" />
        </Pressable>
        <Text className="text-ink mx-3 w-6 text-center text-base font-bold">{qty}</Text>
        <Pressable
          onPress={() => onChangeQty(1)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="plus" size={16} color="#1A1A1A" />
        </Pressable>
      </View>
    </Pressable>
  );
}
```

다음으로 교체:
```tsx
function CatalogRow({
  product,
  qty,
  onChangeQty,
  onPress,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  onChangeQty: (delta: number) => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const statusMeta = STATUS_META[product.status ?? 'active'];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      {product.imageUri ? (
        <Image
          source={{ uri: product.imageUri }}
          style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#F0F0F0' }}
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 items-center justify-center rounded-lg bg-bg">
          <MaterialCommunityIcons name="image-off-outline" size={22} color="#BBBBBB" />
        </View>
      )}
      <View className="ml-3 flex-1">
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-ink text-base font-bold" numberOfLines={1}>
            {product.name}
          </Text>
          <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: statusMeta.color }}>
            <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
              {statusMeta.label}
            </Text>
          </View>
        </View>
        <Text className="text-muted mt-0.5 text-sm">
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
        {product.barcode ? (
          <Text className="text-muted mt-0.5 text-xs">{product.barcode}</Text>
        ) : null}
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(-1)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="minus" size={16} color="#1A1A1A" />
        </Pressable>
        <Text className="text-ink mx-3 w-6 text-center text-base font-bold">{qty}</Text>
        <Pressable
          onPress={() => onChangeQty(1)}
          className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="plus" size={16} color="#1A1A1A" />
        </Pressable>
      </View>
    </Pressable>
  );
}
```

(수량 +/- 버튼은 이미 별도의 중첩 `Pressable`이므로, 그 부분을 터치하면 안쪽 버튼이 우선 반응하고 바깥 행의 `onPress`/`onLongPress`와 충돌하지 않는다 — 재고관리 목록의 `ProductCard` + `index.tsx`가 이미 쓰고 있는 "탭=수정, 길게 누르기=메뉴" 구조와 동일하다.)

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 목록 탭 수정, 바코드/납품상태 표시, 하단 바 안전영역 보정"
```

---

### Task 6: 발주 목록 — 사진 자동 채우기 버튼

**Files:**
- Modify: `src/app/order.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `fillMissingOrderPhotos(onProgress?: (done: number, total: number) => void): Promise<number>`(Task 2, `@/lib/order-repo`), `hasImageSearchKeys(): boolean`(기존, `@/lib/barcode-lookup`)
- Produces: 없음(UI 전용)

이 태스크는 Task 5 완료 후의 `order.tsx`를 기준으로 한다.

- [ ] **Step 1: import 추가**

기존 코드:
```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';
```

다음으로 교체:
```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import { hasImageSearchKeys } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  fillMissingOrderPhotos,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';
```

- [ ] **Step 2: 진행 상태 추가**

기존 코드:
```tsx
  const [seeding, setSeeding] = useState(false);
```

다음으로 교체:
```tsx
  const [seeding, setSeeding] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillProgress, setFillProgress] = useState({ done: 0, total: 0 });
```

- [ ] **Step 3: 사진 없는 상품 개수 계산**

기존 코드:
```tsx
  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
```

다음으로 교체:
```tsx
  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const missingPhotoCount = useMemo(
    () => products.filter((p) => p.barcode && !p.imageUri).length,
    [products],
  );
```

- [ ] **Step 4: 핸들러 추가**

`onSeedDefaults` 함수 바로 뒤에 이어서 추가:

```tsx
  const onFillPhotos = async () => {
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '사진 자동 채우기를 사용하려면 로그인이 필요합니다.');
      return;
    }
    setFilling(true);
    setFillProgress({ done: 0, total: 0 });
    try {
      const count = await fillMissingOrderPhotos((done, total) =>
        setFillProgress({ done, total }),
      );
      await load();
      Alert.alert(
        count > 0 ? '완료' : '알림',
        count > 0 ? `${count}개 사진을 채웠습니다.` : '채울 수 있는 사진을 찾지 못했습니다.',
      );
    } finally {
      setFilling(false);
    }
  };
```

- [ ] **Step 5: 버튼 UI 추가**

기존 코드(검색창 `View`가 끝나고 카테고리 섹션이 시작되는 경계):
```tsx
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      <View className="mt-2.5 px-4" style={{ gap: 8 }}>
```

다음으로 교체(자동 채우기 버튼을 그 사이에 추가):
```tsx
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      {missingPhotoCount > 0 ? (
        <Pressable
          onPress={onFillPhotos}
          disabled={filling}
          className="mx-4 mt-2.5 items-center rounded-xl border border-line bg-paper py-2.5 active:opacity-70"
        >
          <Text className="text-ink text-sm font-medium">
            {filling
              ? `${fillProgress.done} / ${fillProgress.total} 처리 중...`
              : `사진 없는 상품 ${missingPhotoCount}개 — 자동으로 채우기`}
          </Text>
        </Pressable>
      ) : null}

      <View className="mt-2.5 px-4" style={{ gap: 8 }}>
```

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 화면에 사진 없는 상품 자동 채우기 버튼 추가"
```

---

### Task 7: 발주 검색창 — 바코드 스캔 시 자동 조회 배너

**Files:**
- Modify: `src/app/order.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `lookupBarcode(barcode: string): Promise<BarcodeInfo>`(기존, `@/lib/barcode-lookup`), `BarcodeInfo`(기존 타입, `@/lib/types`)
- Produces: 없음(UI 전용)

재고관리 화면(`src/app/index.tsx`)에 이미 있는 "스캔한 바코드가 로컬에 없으면 자동으로 원격 조회해서 배너로 등록 유도" 패턴을 그대로 재사용한다. 이 태스크는 Task 6 완료 후의 `order.tsx`를 기준으로 한다.

- [ ] **Step 1: import 수정**

기존 코드:
```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import { hasImageSearchKeys } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  fillMissingOrderPhotos,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';
```

다음으로 교체:
```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import { hasImageSearchKeys, lookupBarcode } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  fillMissingOrderPhotos,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';
import { BarcodeInfo } from '@/lib/types';
```

- [ ] **Step 2: 조회 상태 추가**

기존 코드:
```tsx
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();
```

다음으로 교체:
```tsx
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<BarcodeInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
```

- [ ] **Step 3: 스캔 파라미터 effect 수정 + 조회 effect 추가**

기존 코드:
```tsx
  useEffect(() => {
    if (scanParams.scannedBarcode) setQuery(scanParams.scannedBarcode);
  }, [scanParams.scannedBarcode, scanParams.nonce]);
```

다음으로 교체:
```tsx
  useEffect(() => {
    if (scanParams.scannedBarcode) {
      setQuery(scanParams.scannedBarcode);
      setScannedBarcode(scanParams.scannedBarcode);
      setLookupResult(null);
    }
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  useEffect(() => {
    if (!scannedBarcode) return;
    if (query !== scannedBarcode) {
      // 사용자가 검색어를 직접 수정함 — 스캔 배너를 더 이상 보여주지 않는다
      setScannedBarcode(null);
      setLookupResult(null);
      setLookingUp(false);
      return;
    }
    const registeredLocally = products.some((p) => p.barcode === scannedBarcode);
    if (registeredLocally) {
      setLookingUp(false);
      return;
    }

    let cancelled = false;
    setLookingUp(true);
    lookupBarcode(scannedBarcode)
      .then((result) => {
        if (!cancelled) setLookupResult(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scannedBarcode, query, products]);
```

- [ ] **Step 4: 배너 UI 추가**

기존 코드(검색창 `View`가 끝나고 사진 자동채우기 버튼이 시작되는 경계 — Task 6에서 만든 부분):
```tsx
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      {missingPhotoCount > 0 ? (
```

다음으로 교체(배너를 그 사이에 추가):
```tsx
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      {lookingUp || lookupResult?.name ? (
        <Pressable
          disabled={lookingUp}
          onPress={() => {
            if (!lookupResult?.name || !scannedBarcode) return;
            router.push({
              pathname: '/order-product-form',
              params: {
                barcode: scannedBarcode,
                prefillName: lookupResult.name,
                prefillImage: lookupResult.imageUrl ?? '',
              },
            });
          }}
          className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3 py-2.5 active:opacity-70"
        >
          {lookingUp ? (
            <>
              <ActivityIndicator size="small" color="#CC2222" />
              <Text className="text-muted ml-2 text-sm">바코드 조회 중...</Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="barcode-scan" size={18} color="#CC2222" />
              <Text className="text-ink ml-2 flex-1 text-sm" numberOfLines={1}>
                바코드 조회: {lookupResult!.name}
              </Text>
              <Text className="text-primary text-sm font-bold">등록하기</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {missingPhotoCount > 0 ? (
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 검색창에 바코드 자동 조회 배너 추가"
```

---

### Task 8: 카테고리 추가를 "+" 칩 토글 방식으로 변경

**Files:**
- Modify: `src/app/order.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: 없음(기존 `Chip`, `submitCategory`, `cancelCategoryEdit`만 재사용)
- Produces: 없음(UI 전용)

지금은 새 카테고리 입력칸이 항상 화면에 보인다. 카테고리 칩 목록 끝에 "+" 칩을 추가하고, 눌렀을 때만 입력칸(기존과 동일한 인라인 `TextInput` + 버튼, 새 다이얼로그 아님)이 나타나도록 바꾼다. 이 태스크는 Task 7 완료 후의 `order.tsx`를 기준으로 한다.

- [ ] **Step 1: 입력칸 표시 상태 추가**

기존 코드:
```tsx
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
```

다음으로 교체:
```tsx
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
```

- [ ] **Step 2: `submitCategory`에서 새 카테고리 추가 후 입력칸 닫기**

기존 코드:
```ts
  const submitCategory = async () => {
    const v = categoryInput.trim();
    if (!v) return;
    if (editingCategory) {
      if (v !== editingCategory) {
        await renameOrderCategory(editingCategory, v);
        if (selectedCategory === editingCategory) setSelectedCategory(v);
      }
      setEditingCategory(null);
    } else {
      await addOrderCategory(v);
    }
    setCategoryInput('');
    load();
  };
```

다음으로 교체:
```ts
  const submitCategory = async () => {
    const v = categoryInput.trim();
    if (!v) return;
    if (editingCategory) {
      if (v !== editingCategory) {
        await renameOrderCategory(editingCategory, v);
        if (selectedCategory === editingCategory) setSelectedCategory(v);
      }
      setEditingCategory(null);
    } else {
      await addOrderCategory(v);
      setShowCategoryInput(false);
    }
    setCategoryInput('');
    load();
  };
```

- [ ] **Step 3: 입력칸 닫기 핸들러 추가**

기존 코드:
```ts
  const cancelCategoryEdit = () => {
    setEditingCategory(null);
    setCategoryInput('');
  };
```

다음으로 교체:
```ts
  const cancelCategoryEdit = () => {
    setEditingCategory(null);
    setCategoryInput('');
  };

  const closeCategoryInput = () => {
    setShowCategoryInput(false);
    setCategoryInput('');
  };
```

- [ ] **Step 4: 카테고리 칩 목록 + 입력칸 JSX 교체**

기존 코드:
```tsx
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Chip
            label="전체"
            active={selectedCategory === '전체'}
            onPress={() => setSelectedCategory('전체')}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategory === c}
              onPress={() => setSelectedCategory(c)}
              onLongPress={() => onLongPressCategory(c)}
            />
          ))}
        </View>
        <View className="flex-row gap-2">
          <TextInput
            className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            placeholder="새 카테고리 입력 (예: 컵)"
            placeholderTextColor="#BBBBBB"
            value={categoryInput}
            onChangeText={setCategoryInput}
          />
          <Pressable
            onPress={submitCategory}
            className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
          >
            <Text className="text-ink text-sm font-medium">{editingCategory ? '수정' : '추가'}</Text>
          </Pressable>
          {editingCategory ? (
            <Pressable onPress={cancelCategoryEdit} className="items-center justify-center px-2">
              <Text className="text-muted text-sm">취소</Text>
            </Pressable>
          ) : null}
        </View>
```

다음으로 교체:
```tsx
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Chip
            label="전체"
            active={selectedCategory === '전체'}
            onPress={() => setSelectedCategory('전체')}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategory === c}
              onPress={() => setSelectedCategory(c)}
              onLongPress={() => onLongPressCategory(c)}
            />
          ))}
          <Chip label="+" active={false} onPress={() => setShowCategoryInput(true)} />
        </View>
        {showCategoryInput || editingCategory ? (
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              placeholder="새 카테고리 입력 (예: 컵)"
              placeholderTextColor="#BBBBBB"
              value={categoryInput}
              onChangeText={setCategoryInput}
              autoFocus
            />
            <Pressable
              onPress={submitCategory}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">
                {editingCategory ? '수정' : '추가'}
              </Text>
            </Pressable>
            <Pressable
              onPress={editingCategory ? cancelCategoryEdit : closeCategoryInput}
              className="items-center justify-center px-2"
            >
              <Text className="text-muted text-sm">취소</Text>
            </Pressable>
          </View>
        ) : null}
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 카테고리 추가를 '+' 칩 토글 방식으로 변경"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 6개 항목(사진 자동채우기 → Task 2/6, 하단 바 안전영역 → Task 5, 탭으로 즉시 수정 → Task 5, 납품상태 태그 → Task 1/4/5, 목록 바코드 표시 → Task 5, 바코드 수동입력+조회 → Task 3) + 세션 중 추가된 2개 항목(검색창 바코드 자동조회 → Task 7, 카테고리 "+" 토글 → Task 8) 모두 대응하는 태스크가 있음을 확인.
- **플레이스홀더 스캔**: "TBD"/"추후"/"적절히 처리" 류 문구 없음. 모든 코드 블록은 실제 완성된 코드.
- **타입/이름 일관성**: `OrderStatus`(`'active'|'discontinued'|'paused'`)가 Task 1(정의)·4(선택 UI)·5(태그 표시)에서 동일하게 쓰임. `fillMissingOrderPhotos`가 Task 2(정의)·6(사용)에서 동일 시그니처로 쓰임. `scannedBarcode`/`lookupResult`/`lookingUp`은 Task 7 안에서만 정의·사용됨(재고관리 `index.tsx`의 동명 상태와는 별개 파일이라 충돌 없음). `showCategoryInput`/`closeCategoryInput`은 Task 8 안에서만 정의·사용됨. `checkBarcode`, `onFillPhotos`, `StatusOption`, `STATUS_META` 등 새 식별자는 정의된 태스크 내에서만 참조되고 이름 불일치 없음. Task 3→4, Task 5→6→7→8은 같은 파일을 순차로 수정하므로 각 태스크의 "기존 코드"가 이전 태스크의 결과를 정확히 반영하도록 작성함(특히 Task 7/8의 "기존 코드"는 각각 Task 6, Task 7 적용 이후 상태를 기준으로 함).
- **Global Constraints 재확인**: Task 8의 "+" 칩 토글은 `Alert.prompt`/커스텀 dialog를 쓰지 않고 기존 인라인 `TextInput`을 조건부로 보여주는 방식이라 제약을 어기지 않는다(사용자에게도 이 방식으로 진행하기로 확인받음).
