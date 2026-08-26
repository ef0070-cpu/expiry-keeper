# 발주 관리 기능 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이스크림 도소매점용 발주(주문) 관리 화면을 유통기한 지킴이(expiry-keeper) 앱에 네이티브 기능으로 추가한다 — 발주 카탈로그 관리, 바코드 스캔 등록(공용 캐시 재사용), 매장별 발주 수량 담기, 카카오톡 등으로 공유.

**Architecture:** 기존 재고관리(`Product`/`repo.ts`)와 완전히 분리된 로컬 전용 카탈로그(`OrderProduct`/`order-repo.ts`, AsyncStorage)를 신설한다. 화면 3개(`order.tsx`, `order-product-form.tsx`, `order-cart.tsx`)를 기존 `product-form.tsx`/`index.tsx`의 UI 패턴을 그대로 재사용해 만들고, `scan.tsx`에 `mode=order` 분기를 추가해 바코드 스캔 진입점을 통합한다. 바코드 이름/사진은 기존 `barcode_catalog` 공용 캐시를 통해 재고관리 쪽과 서로 재사용된다.

**Tech Stack:** Expo v57 (React Native), expo-router (file-based, `Stack.Protected`), NativeWind(Tailwind), `@react-native-async-storage/async-storage`, `expo-camera`, `expo-image-picker`, `expo-image`, `@expo/vector-icons`(MaterialCommunityIcons), RN 내장 `Share`. 새 의존성 추가 없음.

## Global Constraints

- 이 저장소는 `AGENTS.md`에 따라 Expo 문서가 최근 바뀌었다고 명시함 — expo-router/expo-camera/expo-image-picker API를 새로 쓰는 코드를 작성하기 전 `https://docs.expo.dev/versions/v57.0.0/` 확인 (스펙 문서 인용).
- 발주 카탈로그/카테고리/장바구니는 **기기 로컬 `AsyncStorage`만** 사용한다. Supabase 테이블/동기화를 추가하지 않는다.
- 발주 기능은 **`mode === 'retail'`일 때만** 노출한다 (`useAppMode()` 사용).
- "매장" 목록은 별도로 관리하지 않고 기존 재고관리 상품(`Product.categories`)에서 매번 조회만 한다.
- 바코드 이름·사진은 기존 공용 캐시 `barcode_catalog`(Supabase, `src/lib/barcode-lookup.ts`의 `lookupBarcode`가 읽음)와 **양방향**으로 공유한다 — 발주 카탈로그 저장 시에도 캐시에 기록한다.
- 이 프로젝트에는 자동 테스트 러너가 없다(세션에서 확인됨, `package.json`에 test 스크립트 없음). 각 태스크의 검증은 `npx tsc --noEmit` 통과 여부로 하고, 순수 로직 함수(`order-share.ts`)만 예외적으로 Node(v22.6+, 이 머신은 v24)가 `.ts` 파일을 직접 실행할 수 있는 기능을 이용해 assert 기반 self-check를 돌린다 — 새 의존성(ts-node 등) 추가하지 않는다.
- 새 상품/카테고리 추가·수정·삭제 UI에서 `Alert.prompt`는 **쓰지 않는다** (iOS 전용, 이 앱은 Android도 지원). 텍스트 입력이 필요한 조작은 항상 인라인 `TextInput` + 버튼으로 구현한다 (기존 `product-form.tsx`의 카테고리 추가 UI와 동일한 패턴).
- 커스텀 dialog 컴포넌트를 새로 만들지 않는다 — 확인/선택은 전부 `Alert.alert`.

---

### Task 1: 바코드 공용 캐시 헬퍼 분리

**Files:**
- Create: `src/lib/barcode-catalog.ts`
- Modify: `src/lib/repo.ts:102-111` (비공개 함수 제거), `src/lib/repo.ts:1-4`(import 추가), `src/lib/repo.ts:192`(호출부 수정)
- Test: 없음 (타입체크만)

**Interfaces:**
- Produces: `upsertBarcodeCatalog(barcode: string | null, name: string, imageUri: string | null): Promise<void>` — 이후 모든 태스크(특히 Task 4)가 이 시그니처로 import해서 쓴다.

- [ ] **Step 1: `src/lib/barcode-catalog.ts` 생성**

```ts
import { supabase } from './supabase';

/** 바코드로 등록된 상품이면 이름·사진을 공용 카탈로그에 저장해, 다음 스캔 때 재사용한다. */
export async function upsertBarcodeCatalog(
  barcode: string | null,
  name: string,
  imageUri: string | null,
): Promise<void> {
  if (!supabase || !barcode || !name.trim()) return;
  await supabase.from('barcode_catalog').upsert({
    barcode,
    name: name.trim(),
    image_uri: imageUri,
    updated_at: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: `src/lib/repo.ts`에서 비공개 함수 제거하고 새 헬퍼로 교체**

`src/lib/repo.ts` 최상단 import 블록을 다음처럼 바꾼다 (기존 4줄 뒤에 1줄 추가):

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { getCachedAppMode } from './settings';
import { supabase } from './supabase';
import { Product, ProductStatus } from './types';
```

다음 블록(현재 102~111번째 줄)을 통째로 삭제한다:

```ts
/** 바코드로 등록된 상품이면 이름·사진을 공용 카탈로그에 저장해, 다음 스캔 때 재사용한다. */
async function upsertBarcodeCatalog(p: Product): Promise<void> {
  if (!supabase || !p.barcode || !p.name.trim()) return;
  await supabase.from('barcode_catalog').upsert({
    barcode: p.barcode,
    name: p.name.trim(),
    image_uri: p.imageUri,
    updated_at: new Date().toISOString(),
  });
}
```

`saveProduct` 안의 호출부(기존 192번째 줄)를 새 시그니처에 맞게 수정한다:

```ts
    // 기존: upsertBarcodeCatalog(uploaded).catch(() => {});
    upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (기존에 있던 에러가 있었다면 동일하게 유지, 새로 추가된 에러 없어야 함)

- [ ] **Step 4: Commit**

```bash
git add src/lib/barcode-catalog.ts src/lib/repo.ts
git commit -m "refactor: 바코드 공용 캐시 upsert 로직을 barcode-catalog.ts로 분리"
```

---

### Task 2: 공용 Chip 컴포넌트 추출

**Files:**
- Create: `src/components/Chip.tsx`
- Modify: `src/app/index.tsx:1-23`(import 추가), `src/app/index.tsx:332-353`(로컬 함수 삭제)
- Test: 타입체크만

**Interfaces:**
- Produces: `Chip` 컴포넌트, props `{ label: string; active: boolean; onPress: () => void; onLongPress?: () => void }` — Task 5, 6, 7이 `@/components/Chip`으로 import해서 쓴다.

- [ ] **Step 1: `src/components/Chip.tsx` 생성**

```tsx
import { Pressable, Text } from 'react-native';

export default function Chip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`justify-center rounded-full border px-3.5 py-1.5 ${
        active ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-paper' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 2: `src/app/index.tsx`에서 로컬 `Chip` 제거하고 import로 교체**

파일 맨 아래(현재 332~353번째 줄)에 있는 다음 블록을 통째로 삭제한다:

```tsx
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`justify-center rounded-full border px-3.5 py-1.5 ${
        active ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-paper' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
```

파일 상단 import 블록에 한 줄 추가 (다른 `@/components/*` import 옆, 예: `Fab` import 다음 줄):

```ts
import Chip from '@/components/Chip';
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음. (`index.tsx`가 여전히 `Chip`을 `<Chip label=... active=... onPress=.../>` 형태로만 쓰고 있으므로 새 `onLongPress?` 선택 프로퍼티는 영향 없음)

- [ ] **Step 4: Commit**

```bash
git add src/components/Chip.tsx src/app/index.tsx
git commit -m "refactor: index.tsx의 Chip 컴포넌트를 공용 컴포넌트로 추출"
```

---

### Task 3: 발주 타입 정의 + 공유 텍스트 순수 로직

**Files:**
- Create: `src/lib/order-types.ts`
- Create: `src/lib/order-share.ts`
- Create: `src/lib/order-share.selfcheck.ts`
- Test: `node src/lib/order-share.selfcheck.ts`, `npx tsc --noEmit`

**Interfaces:**
- Produces: `OrderProduct { id, name, brand, price, category, barcode, imageUri }`, `OrderCart = Record<string, number>`, `formatOrderDate(date: Date): string`, `buildOrderShareText(cart: OrderCart, products: OrderProduct[], branch: string, date: Date): string` — Task 4, 5, 6, 7이 이 타입/함수를 그대로 가져다 쓴다.

- [ ] **Step 1: `src/lib/order-types.ts` 생성**

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

- [ ] **Step 2: self-check 파일을 먼저 작성 (아직 대상 함수가 없으므로 실패해야 정상)**

`src/lib/order-share.selfcheck.ts`:

```ts
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
console.assert(text.includes('• 메로나(빙그레): 2박스'), '품목 라인 누락');
console.assert(!text.includes('월드콘'), '수량 0인 품목이 포함됨');
console.assert(text.includes('총 합계: 2박스'), '합계 라인 불일치');

console.log('order-share selfcheck OK');
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `node src/lib/order-share.selfcheck.ts`
Expected: FAIL — `Cannot find module './order-share'` (아직 파일이 없으므로)

- [ ] **Step 4: `src/lib/order-share.ts` 구현**

```ts
import type { OrderCart, OrderProduct } from './order-types';

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
    lines.push(`• ${product.name}(${product.brand}): ${qty}박스`);
    total += qty;
  });
  lines.push('');
  lines.push(`총 합계: ${total}박스`);
  return lines.join('\n');
}
```

- [ ] **Step 5: 다시 실행해서 통과 확인**

Run: `node src/lib/order-share.selfcheck.ts`
Expected: 출력에 `order-share selfcheck OK`, 어떤 `Assertion failed` 라인도 없음 (Node의 `console.assert`는 실패해도 프로세스를 종료시키지 않으므로 출력을 직접 눈으로 확인할 것)

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: Commit**

```bash
git add src/lib/order-types.ts src/lib/order-share.ts src/lib/order-share.selfcheck.ts
git commit -m "feat: 발주 타입 정의 및 공유 텍스트 생성 로직 추가"
```

---

### Task 4: 발주 카탈로그 로컬 저장소 (`order-repo.ts`)

**Files:**
- Create: `src/lib/order-repo.ts`
- Test: `npx tsc --noEmit` (AsyncStorage는 RN 런타임이 필요해 Node에서 직접 실행 불가 — 실동작 검증은 Task 5~7에서 화면에 연결된 뒤 앱 실행으로 확인)

**Interfaces:**
- Consumes: `upsertBarcodeCatalog` (Task 1, `@/lib/barcode-catalog`), `newId` (기존 `@/lib/repo`), `OrderProduct`/`OrderCart` (Task 3, `@/lib/order-types`)
- Produces: `listOrderProducts()`, `getOrderProduct(id)`, `listOrderProductsByBarcode(barcode)`, `saveOrderProduct(p)`, `deleteOrderProduct(id)`, `listOrderCategories()`, `addOrderCategory(name)`, `renameOrderCategory(from, to)`, `deleteOrderCategory(name)`, `getOrderCart()`, `setOrderCartQuantity(productId, qty): Promise<OrderCart>`, `clearOrderCart()` — Task 5, 6, 7이 이 함수들을 그대로 가져다 쓴다.

- [ ] **Step 1: `src/lib/order-repo.ts` 작성**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { upsertBarcodeCatalog } from './barcode-catalog';
import { newId } from './repo';
import { OrderCart, OrderProduct } from './order-types';

export { newId };

const PRODUCTS_KEY = 'orderProducts:v1';
const CATEGORIES_KEY = 'orderCategories:v1';
const CART_KEY = 'orderCart:v1';

const DEFAULT_CATEGORIES = ['바', '콘', '튜브', '샌드/기타', '홈/컵'];

// ---------- 카탈로그 ----------

export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  return raw ? (JSON.parse(raw) as OrderProduct[]) : [];
}

async function writeOrderProducts(items: OrderProduct[]): Promise<void> {
  await AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(items));
}

export async function getOrderProduct(id: string): Promise<OrderProduct | null> {
  const items = await listOrderProducts();
  return items.find((p) => p.id === id) ?? null;
}

export async function listOrderProductsByBarcode(barcode: string): Promise<OrderProduct[]> {
  const items = await listOrderProducts();
  return items.filter((p) => p.barcode === barcode);
}

/** 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort). */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  if (idx >= 0) items[idx] = p;
  else items.push(p);
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  return p;
}

export async function deleteOrderProduct(id: string): Promise<void> {
  const items = await listOrderProducts();
  await writeOrderProducts(items.filter((p) => p.id !== id));
  const cart = await getOrderCart();
  if (id in cart) {
    const next = { ...cart };
    delete next[id];
    await writeOrderCart(next);
  }
}

// ---------- 제품유형 카테고리 ----------

export async function listOrderCategories(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : DEFAULT_CATEGORIES;
}

async function writeOrderCategories(items: string[]): Promise<void> {
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(items));
}

export async function addOrderCategory(name: string): Promise<string[]> {
  const items = await listOrderCategories();
  if (items.includes(name)) return items;
  const next = [...items, name];
  await writeOrderCategories(next);
  return next;
}

export async function renameOrderCategory(from: string, to: string): Promise<void> {
  const categories = await listOrderCategories();
  await writeOrderCategories(categories.map((c) => (c === from ? to : c)));
  const products = await listOrderProducts();
  await writeOrderProducts(
    products.map((p) => (p.category === from ? { ...p, category: to } : p)),
  );
}

export async function deleteOrderCategory(name: string): Promise<void> {
  const items = await listOrderCategories();
  await writeOrderCategories(items.filter((c) => c !== name));
}

// ---------- 장바구니 ----------

export async function getOrderCart(): Promise<OrderCart> {
  const raw = await AsyncStorage.getItem(CART_KEY);
  return raw ? (JSON.parse(raw) as OrderCart) : {};
}

async function writeOrderCart(cart: OrderCart): Promise<void> {
  await AsyncStorage.setItem(CART_KEY, JSON.stringify(cart));
}

/** 수량을 절대값으로 설정한다 (0 이하면 항목 제거). 갱신된 전체 카트를 반환한다. */
export async function setOrderCartQuantity(productId: string, qty: number): Promise<OrderCart> {
  const cart = await getOrderCart();
  const next = { ...cart };
  if (qty <= 0) delete next[productId];
  else next[productId] = qty;
  await writeOrderCart(next);
  return next;
}

export async function clearOrderCart(): Promise<void> {
  await writeOrderCart({});
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 발주 카탈로그/카테고리/장바구니 로컬 저장소 추가"
```

---

### Task 5: 발주 메인 화면 (`order.tsx`)

**Files:**
- Create: `src/app/order.tsx`
- Test: `npx tsc --noEmit` (라우트가 아직 `_layout.tsx`에 등록되지 않아 앱에서 진입은 안 됨 — Task 9에서 등록 후 실기기 확인)

**Interfaces:**
- Consumes: 모든 `@/lib/order-repo` 함수(Task 4), `OrderProduct`/`OrderCart`(Task 3), `Chip`(Task 2)
- Produces: 라우트 `/order` (파일 기반, `_layout.tsx` 등록은 Task 9)

- [ ] **Step 1: `src/app/order.tsx` 작성**

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
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct } from '@/lib/order-types';

export default function Order() {
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cart, setCart] = useState<OrderCart>({});
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();

  const load = useCallback(async () => {
    const [productList, categoryList, cartData] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setCart(cartData);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (scanParams.scannedBarcode) setQuery(scanParams.scannedBarcode);
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== '전체' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q)
      );
    });
  }, [products, query, selectedCategory]);

  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  const changeQty = async (productId: string, delta: number) => {
    const current = cart[productId] ?? 0;
    const next = await setOrderCartQuantity(productId, Math.max(0, current + delta));
    setCart(next);
  };

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

  const cancelCategoryEdit = () => {
    setEditingCategory(null);
    setCategoryInput('');
  };

  const onLongPressCategory = (cat: string) => {
    Alert.alert(cat, '카테고리를 어떻게 할까요?', [
      {
        text: '이름 수정',
        onPress: () => {
          setEditingCategory(cat);
          setCategoryInput(cat);
        },
      },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            '카테고리 삭제',
            `'${cat}' 카테고리를 삭제할까요?\n이 카테고리를 쓰던 상품은 삭제되지 않습니다.`,
            [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: async () => {
                  await deleteOrderCategory(cat);
                  if (selectedCategory === cat) setSelectedCategory('전체');
                  load();
                },
              },
            ],
          );
        },
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const onLongPressProduct = (p: OrderProduct) => {
    Alert.alert(p.name, '어떻게 처리할까요?', [
      {
        text: '수정',
        onPress: () => router.push({ pathname: '/order-product-form', params: { id: p.id } }),
      },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          Alert.alert('상품 삭제', `'${p.name}' 을(를) 카탈로그에서 삭제할까요?`, [
            { text: '취소', style: 'cancel' },
            {
              text: '삭제',
              style: 'destructive',
              onPress: async () => {
                await deleteOrderProduct(p.id);
                load();
              },
            },
          ]);
        },
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 16 }}>
              <Pressable onPress={() => router.push('/scan?mode=order')} hitSlop={8}>
                <MaterialCommunityIcons name="barcode-scan" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable onPress={() => router.push('/order-product-form')} hitSlop={8}>
                <MaterialCommunityIcons name="plus" size={22} color="#1A1A1A" />
              </Pressable>
            </View>
          ),
        }}
      />

      <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3">
        <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
        <TextInput
          className="text-ink ml-2 flex-1 py-2.5 text-base"
          placeholder="상품명, 브랜드, 바코드 검색"
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={setQuery}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      <View className="mt-2.5 px-4" style={{ gap: 8 }}>
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
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
        renderItem={({ item }) => (
          <CatalogRow
            product={item}
            qty={cart[item.id] ?? 0}
            onChangeQty={(delta) => changeQty(item.id, delta)}
            onLongPress={() => onLongPressProduct(item)}
          />
        )}
        ListEmptyComponent={
          <View className="mt-24 items-center">
            <MaterialCommunityIcons name="cart-outline" size={48} color="#CCCCCC" />
            <Text className="text-muted mt-4 text-base">등록된 발주 상품이 없습니다</Text>
            <Text className="text-muted mt-1 text-sm">
              오른쪽 위 + 버튼을 눌러 상품을 등록해 보세요
            </Text>
          </View>
        }
      />

      {totalCount > 0 ? (
        <View className="absolute bottom-0 left-0 right-0 p-4">
          <Pressable
            onPress={() => router.push('/order-cart')}
            className="flex-row items-center justify-between rounded-2xl bg-ink px-5 py-4 active:opacity-80"
            style={{ elevation: 6 }}
          >
            <Text className="text-paper text-base font-bold">발주 내역 확인</Text>
            <Text className="text-paper text-base font-bold">{totalCount}박스</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

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

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 메인 화면(카탈로그 목록/카테고리 관리/검색) 추가"
```

---

### Task 6: 발주 상품 등록/수정 화면 (`order-product-form.tsx`)

**Files:**
- Create: `src/app/order-product-form.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `addOrderCategory`, `deleteOrderProduct`, `getOrderProduct`, `listOrderCategories`, `newId`, `saveOrderProduct`(Task 4), `OrderProduct`(Task 3), `Chip`(Task 2), `hasImageSearchKeys`/`searchProductImage`(기존 `@/lib/barcode-lookup`)
- Produces: 라우트 `/order-product-form` (파라미터: `id?`, `barcode?`, `prefillName?`, `prefillImage?`)

- [ ] **Step 1: `src/app/order-product-form.tsx` 작성**

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Chip from '@/components/Chip';
import { hasImageSearchKeys, searchProductImage } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderProduct,
  getOrderProduct,
  listOrderCategories,
  newId,
  saveOrderProduct,
} from '@/lib/order-repo';
import { OrderProduct } from '@/lib/order-types';

export default function OrderProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const isEdit = !!params.id;

  const [name, setName] = useState(params.prefillName ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.prefillImage || null);
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [barcode, setBarcode] = useState<string | null>(params.barcode ?? null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    listOrderCategories().then((list) => {
      setCategories(list);
      if (!params.id && list.length > 0) setCategory((prev) => prev || list[0]);
    });

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
  }, [params.id]);

  const pickImage = () => {
    Alert.alert('상품 사진', '사진을 어떻게 추가할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '앨범에서 선택', onPress: () => launchPicker('library') },
      { text: '카메라 촬영', onPress: () => launchPicker('camera') },
    ]);
  };

  const launchPicker = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '카메라 접근 권한을 허용해 주세요.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const findImageOnWeb = async () => {
    if (!name.trim()) {
      Alert.alert('입력 확인', '먼저 상품명을 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '이미지 검색을 사용하려면 로그인이 필요합니다.');
      return;
    }
    setSearching(true);
    const url = await searchProductImage(name.trim());
    setSearching(false);
    if (url) setImageUri(url);
    else Alert.alert('검색 결과 없음', '이미지를 찾지 못했습니다. 직접 촬영해 주세요.');
  };

  const addCategory = async () => {
    const v = newCategory.trim();
    if (!v) return;
    const next = await addOrderCategory(v);
    setCategories(next);
    setCategory(v);
    setNewCategory('');
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('입력 확인', '상품명을 입력해 주세요.');
      return;
    }
    if (!category) {
      Alert.alert('입력 확인', '카테고리를 선택해 주세요.');
      return;
    }
    const parsedPrice = Number(price);
    if (price.trim() && Number.isNaN(parsedPrice)) {
      Alert.alert('입력 확인', '가격은 숫자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode,
        imageUri,
      };
      await saveOrderProduct(product);
      router.back();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!params.id) return;
    Alert.alert('상품 삭제', '이 상품을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteOrderProduct(params.id!);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
      <Stack.Screen options={{ title: isEdit ? '발주 상품 수정' : '발주 상품 등록' }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row">
          <Pressable
            onPress={pickImage}
            className="items-center justify-center rounded-xl border border-line bg-paper active:opacity-70"
            style={{ width: 96, height: 96 }}
          >
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={{ width: 96, height: 96, borderRadius: 12 }}
                contentFit="cover"
              />
            ) : (
              <View className="items-center">
                <MaterialCommunityIcons name="camera-plus-outline" size={26} color="#888888" />
                <Text className="text-muted mt-1 text-xs">사진 추가</Text>
              </View>
            )}
          </Pressable>

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
              className="text-ink mt-1.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 메로나"
              placeholderTextColor="#BBBBBB"
              value={name}
              onChangeText={setName}
            />
            <View className="mt-2 flex-row items-center gap-4">
              <Pressable
                onPress={findImageOnWeb}
                disabled={searching}
                className="flex-row items-center"
              >
                {searching ? (
                  <ActivityIndicator size="small" color="#CC2222" />
                ) : (
                  <MaterialCommunityIcons name="image-search-outline" size={15} color="#CC2222" />
                )}
                <Text className="text-primary ml-1 text-xs font-medium">웹에서 이미지 찾기</Text>
              </Pressable>
              {imageUri ? (
                <Pressable onPress={() => setImageUri(null)}>
                  <Text className="text-muted text-xs underline">사진 제거</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="브랜드" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 빙그레"
              placeholderTextColor="#BBBBBB"
              value={brand}
              onChangeText={setBrand}
            />
          </View>
          <View className="flex-1">
            <Label text="가격 (원)" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 400"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              value={price}
              onChangeText={setPrice}
            />
          </View>
        </View>

        <View className="mt-4">
          <Label text="카테고리 *" />
          {categories.length > 0 ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              placeholder="새 카테고리 입력 (예: 컵)"
              placeholderTextColor="#BBBBBB"
              value={newCategory}
              onChangeText={setNewCategory}
            />
            <Pressable
              onPress={addCategory}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">추가</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-5 flex-row gap-3">
          {isEdit ? (
            <Pressable
              onPress={remove}
              className="flex-1 items-center rounded-xl border border-line bg-paper py-3.5 active:opacity-70"
            >
              <Text className="text-primary text-base font-medium">삭제</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={save}
            disabled={busy}
            className={`items-center rounded-xl bg-primary py-3.5 active:opacity-80 ${
              isEdit ? 'flex-[2]' : 'flex-1'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-paper text-base font-bold">{isEdit ? '수정 저장' : '등록'}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Label({ text }: { text: string }) {
  return <Text className="text-ink mb-1.5 text-sm font-bold">{text}</Text>;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주 상품 등록/수정 화면 추가 (사진/브랜드/가격/카테고리)"
```

---

### Task 7: 발주 내역 확인 모달 (`order-cart.tsx`) + 매장 목록 헬퍼

**Files:**
- Create: `src/app/order-cart.tsx`
- Modify: `src/lib/repo.ts` (파일 끝에 함수 추가)
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `clearOrderCart`, `getOrderCart`, `listOrderProducts`, `setOrderCartQuantity`(Task 4), `buildOrderShareText`(Task 3), `Chip`(Task 2), `listProductCategories`(이 태스크에서 `repo.ts`에 신설)
- Produces: `listProductCategories(): Promise<string[]>` (기존 `repo.ts`에 추가, 재고관리 상품들의 카테고리 중복 제거 목록), 라우트 `/order-cart`

- [ ] **Step 1: `src/lib/repo.ts` 파일 끝에 함수 추가**

`src/lib/repo.ts` 맨 마지막 줄(기존 `listProductsByBarcode` 함수 뒤)에 이어서 추가:

```ts

/** 재고관리 상품들에 쓰인 카테고리(매장 등)를 중복 없이 정렬해 반환한다. */
export async function listProductCategories(): Promise<string[]> {
  const items = await listProducts();
  const set = new Set<string>();
  items.forEach((p) => p.categories.forEach((c) => set.add(c)));
  return [...set].sort();
}
```

- [ ] **Step 2: `src/app/order-cart.tsx` 작성**

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import Chip from '@/components/Chip';
import {
  clearOrderCart,
  getOrderCart,
  listOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { buildOrderShareText } from '@/lib/order-share';
import { OrderCart, OrderProduct } from '@/lib/order-types';
import { listProductCategories } from '@/lib/repo';

export default function OrderCartScreen() {
  const [cart, setCart] = useState<OrderCart>({});
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cartData, productList, branchList] = await Promise.all([
      getOrderCart(),
      listOrderProducts(),
      listProductCategories(),
    ]);
    setCart(cartData);
    setProducts(productList);
    setBranches(branchList);
    setSelectedBranch((prev) => prev ?? branchList[0] ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const items = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
        .filter((x): x is { product: OrderProduct; qty: number } => !!x.product && x.qty > 0),
    [cart, products],
  );

  const total = items.reduce((sum, item) => sum + item.qty, 0);

  const removeItem = async (id: string) => {
    const next = await setOrderCartQuantity(id, 0);
    setCart(next);
  };

  const clearAll = () => {
    Alert.alert('발주 내역 초기화', '담은 품목을 모두 비울까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: async () => {
          await clearOrderCart();
          setCart({});
        },
      },
    ]);
  };

  const share = async () => {
    if (!selectedBranch) {
      Alert.alert('매장 없음', '재고관리 화면에서 매장(카테고리)을 먼저 등록해 주세요.');
      return;
    }
    const text = buildOrderShareText(cart, products, selectedBranch, new Date());
    try {
      await Share.share({ message: text });
    } catch (e) {
      Alert.alert('공유 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="border-b border-line bg-paper px-4 pb-3 pt-4">
        <Text className="text-ink mb-2 text-sm font-bold">매장</Text>
        {branches.length > 0 ? (
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {branches.map((b) => (
              <Chip
                key={b}
                label={b}
                active={selectedBranch === b}
                onPress={() => setSelectedBranch(b)}
              />
            ))}
          </View>
        ) : (
          <Text className="text-muted text-sm">
            재고관리 화면에서 매장(카테고리)을 먼저 등록해 주세요.
          </Text>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.product.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View className="mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3">
            <View className="flex-1">
              <Text className="text-ink text-base font-bold">{item.product.name}</Text>
              <Text className="text-muted mt-0.5 text-sm">{item.product.brand}</Text>
            </View>
            <Text className="text-primary mr-3 text-lg font-black">{item.qty}박스</Text>
            <Pressable onPress={() => removeItem(item.product.id)} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color="#BBBBBB" />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View className="mt-16 items-center">
            <Text className="text-muted text-base">담은 상품이 없습니다</Text>
          </View>
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <Pressable onPress={clearAll} className="mb-3 self-end">
              <Text className="text-muted text-xs underline">전체 초기화</Text>
            </Pressable>
          ) : null
        }
      />

      <View className="border-t border-line bg-paper p-4">
        <Text className="text-muted mb-3 text-sm">총 합계: {total}박스</Text>
        <Pressable
          onPress={share}
          disabled={items.length === 0}
          className={`items-center rounded-xl py-3.5 ${
            items.length === 0 ? 'bg-line' : 'bg-primary active:opacity-80'
          }`}
        >
          <Text className="text-paper text-base font-bold">공유하기</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/order-cart.tsx src/lib/repo.ts
git commit -m "feat: 발주 내역 확인 모달(매장 선택/공유) 및 매장 목록 헬퍼 추가"
```

---

### Task 8: `scan.tsx`에 `mode=order` 분기 추가

**Files:**
- Modify: `src/app/scan.tsx`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Consumes: `listOrderProductsByBarcode`(Task 4, `@/lib/order-repo`)

- [ ] **Step 1: import 추가**

`src/app/scan.tsx` 상단 import 블록(현재 7번째 줄, `listProductsByBarcode` import 다음)에 추가:

```ts
import { listOrderProductsByBarcode } from '@/lib/order-repo';
```

- [ ] **Step 2: `onScanned` 함수에 `order` 분기 추가**

기존 코드:

```ts
    if (params.mode === 'search') {
      // 검색 모드: 외부 조회 없이 스캔한 바코드만 들고 홈 화면으로 돌아간다.
      // replace 대신 dismissTo를 써서 스택에 이미 있는 홈 화면으로 되돌아가며
      // params만 갱신한다(리마운트 없음 — replace는 홈 화면을 스택에 중복시킴).
      router.dismissTo({
        pathname: '/',
        params: { scannedBarcode: data, nonce: String(Date.now()) },
      });
      return;
    }

    setLooking(true);
```

다음처럼 `order` 분기를 그 사이에 추가한다:

```ts
    if (params.mode === 'search') {
      // 검색 모드: 외부 조회 없이 스캔한 바코드만 들고 홈 화면으로 돌아간다.
      // replace 대신 dismissTo를 써서 스택에 이미 있는 홈 화면으로 되돌아가며
      // params만 갱신한다(리마운트 없음 — replace는 홈 화면을 스택에 중복시킴).
      router.dismissTo({
        pathname: '/',
        params: { scannedBarcode: data, nonce: String(Date.now()) },
      });
      return;
    }

    if (params.mode === 'order') {
      // 발주 모드: 카탈로그에 이미 있으면 검색어만 채우고, 없으면 신규 등록 화면으로 보낸다.
      setLooking(true);
      const [info, duplicates] = await Promise.all([
        lookupBarcode(data),
        listOrderProductsByBarcode(data),
      ]);
      setLooking(false);

      if (duplicates.length > 0) {
        router.dismissTo({
          pathname: '/order',
          params: { scannedBarcode: data, nonce: String(Date.now()) },
        });
        return;
      }

      router.replace({
        pathname: '/order-product-form',
        params: { barcode: data, prefillName: info.name ?? '', prefillImage: info.imageUrl ?? '' },
      });
      return;
    }

    setLooking(true);
```

- [ ] **Step 3: "바코드 없이 직접 입력" 버튼이 발주 모드에서 올바른 화면으로 가도록 수정**

기존 코드(파일 하단, `params.mode !== 'search'` 조건 블록 안):

```tsx
          <Pressable
            onPress={() => router.replace('/product-form')}
            className="rounded-full border border-paper/60 bg-ink/50 px-6 py-3 active:opacity-70"
          >
            <Text className="text-paper text-base font-medium">바코드 없이 직접 입력</Text>
          </Pressable>
```

다음으로 교체:

```tsx
          <Pressable
            onPress={() =>
              router.replace(params.mode === 'order' ? '/order-product-form' : '/product-form')
            }
            className="rounded-full border border-paper/60 bg-ink/50 px-6 py-3 active:opacity-70"
          >
            <Text className="text-paper text-base font-medium">바코드 없이 직접 입력</Text>
          </Pressable>
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/app/scan.tsx
git commit -m "feat: 바코드 스캔 화면에 발주(order) 모드 분기 추가"
```

---

### Task 9: 라우트 등록 + 헤더 아이콘 연결 (최종 배선)

**Files:**
- Modify: `src/app/_layout.tsx`
- Modify: `src/app/index.tsx`
- Test: `npx tsc --noEmit` + 실기기/에뮬레이터 수동 확인 (Task 10에서 상세 체크리스트)

**Interfaces:**
- Consumes: 없음 (배선만)
- Produces: 라우트 `/order`, `/order-product-form`, `/order-cart`가 앱 내에서 정상 내비게이션 가능해짐

- [ ] **Step 1: `src/app/_layout.tsx`에 라우트 3개 등록**

`<Stack.Protected guard={authed && mode !== null}>` 블록 안, 기존 `<Stack.Screen name="product-duplicates" .../>` 다음 줄에 추가:

```tsx
          <Stack.Screen name="order" options={{ title: '발주 관리' }} />
          <Stack.Screen name="order-product-form" options={{ title: '발주 상품' }} />
          <Stack.Screen
            name="order-cart"
            options={{ title: '발주 내역', presentation: 'modal' }}
          />
```

- [ ] **Step 2: `src/app/index.tsx` 헤더에 발주 아이콘 추가**

기존 코드:

```tsx
              {mode === 'home' ? (
                <Pressable onPress={() => router.push('/recipes')} hitSlop={8}>
                  <MaterialCommunityIcons name="chef-hat" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
```

다음으로 교체 (발주 아이콘을 `chef-hat` 왼쪽에 추가):

```tsx
              {mode === 'retail' ? (
                <Pressable onPress={() => router.push('/order')} hitSlop={8}>
                  <MaterialCommunityIcons name="cart-outline" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
              {mode === 'home' ? (
                <Pressable onPress={() => router.push('/recipes')} hitSlop={8}>
                  <MaterialCommunityIcons name="chef-hat" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add src/app/_layout.tsx src/app/index.tsx
git commit -m "feat: 발주 관리 라우트 등록 및 홈 화면 헤더에 발주 아이콘 연결"
```

---

### Task 10: 실기기 수동 검증 (자동화 불가 항목)

이 프로젝트는 카메라·이미지피커·AsyncStorage·Share 시트를 다루므로 아래 항목은 Expo Go 또는 개발 빌드에서 사람이 직접 확인해야 한다.

**Files:** 없음 (검증만)

- [ ] **Step 1: 앱 실행**

Run: `npm run android` (또는 `npx expo start`로 Expo Go에서 실행)

- [ ] **Step 2: 노출 조건 확인**
  - 설정에서 앱 모드를 `retail`로 두고 홈 화면 진입 → 헤더에 `cart-outline` 아이콘이 `chef-hat` 왼쪽에 보이는지 확인
  - 모드를 `home`으로 바꾸면 `cart-outline` 아이콘이 사라지는지 확인

- [ ] **Step 3: 카탈로그 CRUD 확인**
  - `cart-outline` 클릭 → `/order` 진입
  - 우측 상단 `+`로 상품 하나 수동 등록(바코드 없이, 사진은 앨범에서 선택) → 목록에 표시되는지 확인
  - 카테고리 칩 옆 입력창에 새 카테고리 입력 후 "추가" → 칩이 생기는지 확인
  - 새로 만든 카테고리 칩 롱프레스 → "이름 수정" 선택 → 이름 변경 → 상품의 카테고리도 같이 바뀌는지 확인
  - 카테고리 칩 롱프레스 → "삭제" → 확인 후 칩이 사라지고 상품은 남아있는지 확인
  - 등록한 상품 롱프레스 → "삭제" → 카탈로그에서 사라지는지 확인

- [ ] **Step 4: 바코드 스캔 + 공용 캐시 재사용 확인**
  - 재고관리 홈 화면(`/`)에서 실제 상품 하나를 바코드 스캔으로 등록하면서 사진을 찍어 저장
  - `/order` 화면에서 스캔 아이콘 클릭 → 같은 바코드를 스캔 → `order-product-form`에 방금 재고관리에서 등록한 이름/사진이 자동으로 채워지는지 확인 (Supabase `barcode_catalog` 테이블이 라이브에 없다면 이 항목은 실패할 수 있음 — 그 경우 `supabase/migration-barcode-catalog.sql`을 대시보드에서 먼저 실행)
  - 그 상태에서 저장 → 다시 `/order`에서 같은 바코드로 스캔 → 카탈로그에 이미 있으므로 검색어만 채워지고 등록 화면으로 넘어가지 않는지 확인

- [ ] **Step 5: 장바구니/공유 확인**
  - `/order`에서 상품 2~3개 수량을 담고 하단 "발주 내역 확인" 클릭 → `/order-cart` 모달 진입
  - 매장 칩이 재고관리 카테고리(예: 남양동/성주동)와 동일하게 보이는지 확인
  - 매장 선택 후 "공유하기" → 공유 시트가 뜨고, 텍스트가 다음 형식과 일치하는지 확인:
    ```
    [아이스크림 발주_ {매장}- {YYYY. M. D.}]
    • {이름}({브랜드}): {수량}박스

    총 합계: {합계}박스
    ```
  - "전체 초기화" → 확인 후 카트가 비고 `/order` 화면의 하단 버튼도 사라지는지 확인

- [ ] **Step 6: 기존 기능 회귀 확인 (Task 1, 2 리팩터 영향 범위)**
  - 재고관리 홈 화면(`/`)에서 카테고리 필터 칩이 정상 동작하는지 확인 (Task 2 `Chip` 추출 영향)
  - 재고관리에서 상품을 사진과 함께 새로 등록 → 저장 성공하는지 확인 (Task 1 `upsertBarcodeCatalog` 리팩터 영향)

## Self-Review 결과

- **스펙 커버리지**: 스펙의 데이터 모델(Task 3, 4) / 화면·라우팅(Task 5~9) / 바코드 공용 캐시(Task 1, 4, 8) / 에러 처리(전 태스크에서 `Alert.alert` 사용) / 테스트 방침(Task 3의 self-check, Global Constraints의 tsc 방침) 섹션 모두 대응하는 태스크가 있음을 확인.
- **플레이스홀더 스캔**: "TBD"/"추후"/"적절히 처리" 류 문구 없음. 모든 코드 블록은 실제 완성된 코드.
- **타입 일관성**: `OrderProduct`/`OrderCart`(Task 3) 필드명이 `order-repo.ts`(Task 4), `order.tsx`/`order-product-form.tsx`/`order-cart.tsx`(Task 5~7) 전체에서 동일하게 사용됨을 재확인 (`imageUri` 필드 포함 여부 특히 재확인 — 스펙 수정 반영됨). `setOrderCartQuantity`가 갱신된 `OrderCart`를 반환하는 시그니처로 Task 4/5/7에서 일관되게 쓰임.
