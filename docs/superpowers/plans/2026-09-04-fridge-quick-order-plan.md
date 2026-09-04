# 냉장고 빠른발주 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/app/order.tsx`에 "빠른발주" 모드를 추가해, 매장 냉장고에 진열된 10~30종만 4개 구역(600바/100바콘류/1000바/샌드류) 탭 그리드로 탭 한 번에 담을 수 있게 한다.

**Architecture:** 상품-구역 매핑(`FridgeAssignment`)을 상품 레코드와 분리한 매장별 로컬 저장소로 관리한다(`order-repo.ts`에 CRUD 추가). `order.tsx`는 기존 검색발주 UI를 그대로 두고 `mode: 'quick' | 'search'` state로 조건부 렌더링하는 얇은 스위치만 추가한다. 장바구니(`OrderCart`)는 두 모드가 완전히 공유(이미 매장별로 분리되어 있음, 2026-09-04 커밋에서 완료).

**Tech Stack:** React Native, Expo Router, NativeWind, TypeScript. 프로젝트: `C:\Users\USER\expiry-keeper`.

## Global Constraints

- 새 라우트를 만들지 않는다 — `order.tsx` 하나에 통합 (스펙 "화면 구조").
- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱. `order-repo.ts`의 함수는 전부 AsyncStorage I/O라 `*.selfcheck.ts` 대상이 아니다(기존 `order-repo.ts` 관례와 동일) — `npx tsc --noEmit` + 수동 시나리오로 검증한다.
- Android `Alert.alert`는 버튼 3개까지만 표시된다 — 4개 이상 선택지가 필요한 UI(구역 선택 등)는 Alert 대신 기존 `StoreSwitcherModal`과 같은 커스텀 `Modal`을 쓴다.
- **드래그 앤 드롭으로 구역 이동은 이번 계획에서 제외한다** (설계 문서에서도 "보류" 항목으로 명시됨). 대신 롱프레스 메뉴의 "구역에서 빼기" 액션으로 대체한다 — 훨씬 적은 코드로 실용적인 결과를 낸다. 필요하면 나중에 별도로 추가.
- 검색발주 리스트 행의 기존 롱프레스 메뉴(수정/상태변경/삭제, 이미 Android 3버튼 한도에 걸쳐 있음)에는 손대지 않는다 — 대신 빠른발주 그리드 자체에 "+ 상품 추가" 진입점을 둔다 (설계 문서의 아이디어를 Android 제약에 맞게 조정).

---

### Task 1: 데이터 모델 + 매장별 냉장고 매핑 저장소

**Files:**
- Modify: `src/lib/order-types.ts`
- Modify: `src/lib/order-repo.ts`

**Interfaces:**
- Produces (Task 2~4가 그대로 가져다 씀):
  - `type FridgeSection = '600바' | '100바콘류' | '1000바' | '샌드류'`
  - `const FRIDGE_SECTIONS: FridgeSection[]` (표시 순서 그대로: 600바, 100바콘류, 1000바, 샌드류)
  - `interface FridgeAssignment { productId: string; section: FridgeSection }`
  - `function listFridgeAssignments(storeId: string): Promise<FridgeAssignment[]>`
  - `function assignToFridgeSection(storeId: string, productId: string, section: FridgeSection): Promise<FridgeAssignment[]>`
  - `function removeFromFridgeSection(storeId: string, productId: string): Promise<FridgeAssignment[]>`

- [ ] **Step 1: `order-types.ts`에 타입 추가**

`src/lib/order-types.ts`의 `Store` 인터페이스 바로 아래에 추가:

```ts
export type FridgeSection = '600바' | '100바콘류' | '1000바' | '샌드류';

export interface FridgeAssignment {
  productId: string;
  section: FridgeSection;
}
```

- [ ] **Step 2: `order-repo.ts`에 냉장고 매핑 CRUD 추가**

`src/lib/order-repo.ts` 상단 import에 `FridgeAssignment`, `FridgeSection` 추가:

```ts
import { OrderCart, OrderProduct, Store, FridgeAssignment, FridgeSection } from './order-types';
```

`// ---------- 매장 ----------` 섹션(store 함수들) 바로 다음, `// ---------- 장바구니 ----------` 섹션 앞에 새 섹션 추가:

```ts
// ---------- 냉장고 구역 배정 (매장별) ----------

export const FRIDGE_SECTIONS: FridgeSection[] = ['600바', '100바콘류', '1000바', '샌드류'];

function fridgeAssignmentsKey(storeId: string): string {
  return `fridgeAssignments:${storeId}`;
}

export async function listFridgeAssignments(storeId: string): Promise<FridgeAssignment[]> {
  const raw = await AsyncStorage.getItem(fridgeAssignmentsKey(storeId));
  return raw ? (JSON.parse(raw) as FridgeAssignment[]) : [];
}

async function writeFridgeAssignments(storeId: string, list: FridgeAssignment[]): Promise<void> {
  await AsyncStorage.setItem(fridgeAssignmentsKey(storeId), JSON.stringify(list));
}

/** 상품을 이 매장의 특정 구역에 배정한다. 이미 다른 구역에 있었으면 그 구역에서 빼고 새 구역으로
 * 옮긴다(한 상품은 매장당 한 구역에만 있을 수 있음). */
export async function assignToFridgeSection(
  storeId: string,
  productId: string,
  section: FridgeSection,
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const next = [...list.filter((a) => a.productId !== productId), { productId, section }];
  await writeFridgeAssignments(storeId, next);
  return next;
}

export async function removeFromFridgeSection(
  storeId: string,
  productId: string,
): Promise<FridgeAssignment[]> {
  const list = await listFridgeAssignments(storeId);
  const next = list.filter((a) => a.productId !== productId);
  await writeFridgeAssignments(storeId, next);
  return next;
}
```

- [ ] **Step 3: 매장 삭제 시 냉장고 매핑도 함께 정리**

`deleteStore` 함수(이미 존재, 매장 삭제 + 그 매장 장바구니 삭제)에 한 줄 추가:

```ts
export async function deleteStore(id: string): Promise<Store[]> {
  const stores = await listStores();
  const next = stores.filter((s) => s.id !== id);
  await writeStores(next);
  await AsyncStorage.removeItem(`orderCart:${id}`);
  await AsyncStorage.removeItem(fridgeAssignmentsKey(id)); // 추가
  if ((await getActiveStoreId()) === id) await setActiveStoreId(null);
  return next;
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx`의 기존 무관 오류 1건만 출력됨. 그 외 오류 없음.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-types.ts src/lib/order-repo.ts
git commit -m "feat: 냉장고 구역 배정(FridgeAssignment) 매장별 저장소 추가"
```

---

### Task 2: 빠른발주 모드 탭 + 구역 그리드 + 상품 추가

**Files:**
- Modify: `src/app/order.tsx`

**Interfaces:**
- Consumes: Task 1의 `FRIDGE_SECTIONS`, `FridgeAssignment`, `FridgeSection`, `listFridgeAssignments`, `assignToFridgeSection` (모두 `@/lib/order-repo`, 타입은 `@/lib/order-types`에서 import)
- 기존 `products`, `cart`, `changeQty`, `activeStoreId`, `stores`, `searchOrderProducts`는 그대로 재사용

- [ ] **Step 1: import 및 상단 상수 추가**

`src/app/order.tsx`의 `@/lib/order-repo` import 목록에 추가:

```ts
  assignToFridgeSection,
  FRIDGE_SECTIONS,
  listFridgeAssignments,
```

`@/lib/order-types` import에 `FridgeAssignment`, `FridgeSection` 추가:

```ts
import { FridgeAssignment, FridgeSection, OrderCart, OrderProduct, OrderStatus, Store } from '@/lib/order-types';
```

- [ ] **Step 2: mode/그리드 관련 state 추가**

`Order` 컴포넌트 안, `showStoreModal` state 바로 아래에 추가:

```ts
  const [mode, setMode] = useState<'search' | 'quick'>('search');
  const [fridgeAssignments, setFridgeAssignments] = useState<FridgeAssignment[]>([]);
  const [activeSection, setActiveSection] = useState<FridgeSection>(FRIDGE_SECTIONS[0]);
  const [showAddToFridge, setShowAddToFridge] = useState(false);
  const [fridgeSearchQuery, setFridgeSearchQuery] = useState('');
```

- [ ] **Step 3: `loadCatalog`가 활성 매장의 냉장고 매핑도 불러오게 수정**

기존 `loadCatalog` 함수를 아래로 교체(활성 매장이 없으면 빈 배열):

```ts
  const loadCatalog = useCallback(async () => {
    const [productList, categoryList, cartData, badges, storeList, activeId] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
      getCatalogUpdateBadges(),
      listStores(),
      getActiveStoreId(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setCart(cartData);
    setUpdateBadges(badges);
    setStores(storeList);
    setActiveStoreIdState(activeId);
    setFridgeAssignments(activeId ? await listFridgeAssignments(activeId) : []);
  }, []);
```

- [ ] **Step 4: 그리드에 표시할 상품 목록 계산**

`filtered`/`suggestions` useMemo들 사이 아무 곳에 추가:

```ts
  const fridgeProducts = useMemo(() => {
    const idsInSection = new Set(
      fridgeAssignments.filter((a) => a.section === activeSection).map((a) => a.productId),
    );
    return products.filter(
      (p) => idsInSection.has(p.id) && (p.status ?? 'active') === 'active',
    );
  }, [products, fridgeAssignments, activeSection]);
```

- [ ] **Step 5: 상품 추가 처리 함수**

```ts
  const onAddToFridge = useCallback(
    async (productId: string) => {
      if (!activeStoreId) return;
      setFridgeAssignments(await assignToFridgeSection(activeStoreId, productId, activeSection));
      setShowAddToFridge(false);
      setFridgeSearchQuery('');
    },
    [activeStoreId, activeSection],
  );
```

- [ ] **Step 6: 모드 세그먼트탭 + 구역탭 + 그리드 JSX 추가**

기존 반환문에서 매장선택 버튼 **바로 다음**에 모드탭을 추가하고, 기존 검색창(`relative mx-4 mt-3`)부터 안내문구 `Text`, `FlatList`까지 전체를 `{mode === 'search' ? (...) : (...)}`로 감싼다. 검색발주 쪽 기존 `FlatList`에 `key="search-list"`를 추가해 둔다(아래 이유 참고).

```tsx
      <View className="mx-4 mt-3 flex-row gap-2">
        <Pressable
          onPress={() => setMode('search')}
          className={`flex-1 items-center rounded-xl border py-2.5 ${
            mode === 'search' ? 'border-primary' : 'border-line'
          }`}
        >
          <Text className={`text-sm font-bold ${mode === 'search' ? 'text-primary' : 'text-ink'}`}>
            검색발주
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('quick')}
          className={`flex-1 items-center rounded-xl border py-2.5 ${
            mode === 'quick' ? 'border-primary' : 'border-line'
          }`}
        >
          <Text className={`text-sm font-bold ${mode === 'quick' ? 'text-primary' : 'text-ink'}`}>
            빠른발주
          </Text>
        </Pressable>
      </View>

      {mode === 'search' ? (
        <>
          {/* 기존 검색창 View + 카테고리 칩 View + 안내문구 Text + FlatList(key="search-list" 추가) 전부 이 안으로 이동 */}
        </>
      ) : !activeStoreId ? (
        <View className="mt-16 items-center px-6">
          <MaterialCommunityIcons name="storefront-outline" size={40} color="#CCCCCC" />
          <Text className="text-muted mt-3 text-center text-sm">
            빠른발주는 매장별 진열 정보가 필요해요.{'\n'}위에서 매장을 먼저 선택하거나 추가해 주세요.
          </Text>
        </View>
      ) : (
        <>
          <View className="mt-3 flex-row flex-wrap gap-2 px-4">
            {FRIDGE_SECTIONS.map((s) => (
              <Chip key={s} label={s} active={activeSection === s} onPress={() => setActiveSection(s)} />
            ))}
          </View>
          <FlatList
            key="quick-grid"
            data={fridgeProducts}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }}
            columnWrapperStyle={{ gap: 10 }}
            ListHeaderComponent={
              <Pressable
                onPress={() => setShowAddToFridge(true)}
                className="mb-3 flex-row items-center justify-center rounded-xl border border-dashed border-line py-3"
              >
                <MaterialCommunityIcons name="plus" size={18} color="#888888" />
                <Text className="text-muted ml-1.5 text-sm font-medium">
                  '{activeSection}' 구역에 상품 추가
                </Text>
              </Pressable>
            }
            renderItem={({ item }) => (
              <FridgeTile
                product={item}
                qty={cart[item.id] ?? 0}
                onTap={() => changeQty(item.id, 1)}
                onLongPress={() => onLongPressFridgeTile(item)}
              />
            )}
            ListEmptyComponent={
              <Text className="text-muted mt-8 text-center text-sm">
                이 구역에 등록된 상품이 없습니다. 위 버튼으로 추가해 보세요.
              </Text>
            }
          />
        </>
      )}
```

`numColumns`가 다른 두 `FlatList`(검색발주=1열, 빠른발주=3열)를 조건부로 오갈 때 RN이 "numColumns를 렌더링 중 바꿀 수 없다"는 경고/오류를 낼 수 있어 `key`를 다르게 줘서 완전히 다른 컴포넌트로 언마운트/마운트되게 한다.

- [ ] **Step 7: 타입체크 + 수동 확인**

Run: `npx tsc --noEmit`
Expected: `login.tsx` 기존 오류 1건만.

수동 확인: Expo 개발 빌드로 앱 열어서 발주 화면 → "빠른발주" 탭 → 매장 미선택 시 안내 문구 뜨는지, 매장 선택 후 구역탭 전환되는지, "+ 상품 추가" 눌러서(다음 Task에서 완성) 아직 모달이 없어 아무 반응 없는 게 정상인지만 확인.

- [ ] **Step 8: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 발주 화면에 빠른발주 모드(구역탭+그리드) 뼈대 추가"
```

---

### Task 3: 그리드 타일 컴포넌트 + 롱프레스 메뉴 + 상품 추가 모달

**Files:**
- Modify: `src/app/order.tsx`

**Interfaces:**
- Consumes: Task 1의 `removeFromFridgeSection`, `assignToFridgeSection`, Task 2의 `onAddToFridge`, `activeSection`, `activeStoreId`, 기존 `onChangeStatus`, `searchOrderProducts`
- Produces: `FridgeTile` 컴포넌트, `onLongPressFridgeTile` 핸들러, `AddToFridgeModal` 컴포넌트 (Task 2의 `showAddToFridge`/`fridgeSearchQuery`가 사용)

- [ ] **Step 1: `onLongPressFridgeTile` 핸들러 추가**

Task 2의 `onAddToFridge` 함수 바로 아래에 추가. 롱프레스하면 "상태 변경"(기존 `onChangeStatus` 재사용) 또는 "이 구역에서 빼기" 중 선택(2개+취소=3개, Android 한도 안):

```ts
  const onLongPressFridgeTile = useCallback(
    (p: OrderProduct) => {
      Alert.alert(p.name, '어떻게 처리할까요?', [
        { text: '상태 변경', onPress: () => onChangeStatus(p) },
        {
          text: '이 구역에서 빼기',
          style: 'destructive',
          onPress: async () => {
            if (!activeStoreId) return;
            setFridgeAssignments(await removeFromFridgeSection(activeStoreId, p.id));
          },
        },
        { text: '취소', style: 'cancel' },
      ]);
    },
    [activeStoreId, onChangeStatus],
  );
```

`@/lib/order-repo` import에 `removeFromFridgeSection` 추가.

- [ ] **Step 2: `FridgeTile` 컴포넌트 추가**

파일 하단, `CatalogRow` 컴포넌트 정의 바로 위에 추가:

```tsx
const FridgeTile = memo(function FridgeTile({
  product,
  qty,
  onTap,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  onTap: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onTap}
      onLongPress={onLongPress}
      className="mb-3 flex-1 items-center rounded-xl border border-line bg-paper p-2 active:opacity-70"
      style={{ maxWidth: '31%' }}
    >
      <Thumbnail uri={product.imageUri} size={64} radius={8} iconSize={22} />
      <Text className="text-ink mt-1.5 text-center text-xs font-bold" numberOfLines={2}>
        {product.name}
      </Text>
      {qty > 0 ? (
        <View className="mt-1 rounded-full bg-primary px-2 py-0.5">
          <Text className="text-paper text-xs font-bold">{qty}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});
```

- [ ] **Step 3: 상품 추가 모달 추가**

같은 위치(파일 하단, `StoreSwitcherModal` 다음)에 추가:

```tsx
const AddToFridgeModal = memo(function AddToFridgeModal({
  visible,
  section,
  allProducts,
  assignedIds,
  query,
  onChangeQuery,
  onPick,
  onClose,
}: {
  visible: boolean;
  section: FridgeSection;
  allProducts: OrderProduct[];
  assignedIds: Set<string>;
  query: string;
  onChangeQuery: (q: string) => void;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const results = useMemo(() => {
    const base = query.trim() ? searchOrderProducts(allProducts, query) : allProducts;
    return base.filter((p) => !assignedIds.has(p.id)).slice(0, 30);
  }, [allProducts, assignedIds, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '75%' }}
        >
          <Text className="text-ink mb-2 text-base font-bold">'{section}' 구역에 상품 추가</Text>
          <TextInput
            className="text-ink mb-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            placeholder="상품명 검색"
            placeholderTextColor="#BBBBBB"
            value={query}
            onChangeText={onChangeQuery}
          />
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item.id)}
                className="flex-row items-center border-b border-line py-2.5"
              >
                <Thumbnail uri={item.imageUri} size={36} radius={6} iconSize={16} />
                <Text className="text-ink ml-2.5 flex-1 text-sm font-medium" numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text className="text-muted py-6 text-center text-sm">검색 결과가 없습니다</Text>
            }
          />
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});
```

- [ ] **Step 4: Task 2의 그리드 JSX에 모달 연결**

Task 2 Step 6에서 넣은 `FlatList` (quick 모드) 바로 다음에 추가:

```tsx
          <AddToFridgeModal
            visible={showAddToFridge}
            section={activeSection}
            allProducts={products}
            assignedIds={new Set(fridgeAssignments.map((a) => a.productId))}
            query={fridgeSearchQuery}
            onChangeQuery={setFridgeSearchQuery}
            onPick={onAddToFridge}
            onClose={() => {
              setShowAddToFridge(false);
              setFridgeSearchQuery('');
            }}
          />
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: `login.tsx` 기존 오류 1건만.

- [ ] **Step 6: 수동 확인**

1. 빠른발주 탭 → 구역 선택 → "+ 상품 추가" → 검색해서 상품 하나 탭 → 그리드에 나타나는지
2. 그리드 타일 탭 → 장바구니 수량 배지가 뜨는지 (검색발주 탭으로 전환해도 같은 장바구니인지 — 검색발주 목록에서 같은 상품 수량이 동일하게 보이는지)
3. 타일 롱프레스 → "이 구역에서 빼기" → 그리드에서 사라지는지
4. 매장을 바꾸면 그리드 내용도 그 매장 것으로 바뀌는지

- [ ] **Step 7: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 빠른발주 그리드에 상품 추가/제거/장바구니 담기 연결"
```

---

### Task 4: 빠른발주 전용 검색 (진열 상품 한정 + 위치 태그)

**Files:**
- Modify: `src/app/order.tsx`

**Interfaces:**
- Consumes: Task 2/3의 `fridgeAssignments`, `activeSection`, `setActiveSection`, 기존 `searchOrderProducts`

- [ ] **Step 1: 빠른발주 검색 state + 결과 계산 추가**

`showAddToFridge` state 근처에 추가:

```ts
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
```

`fridgeProducts` useMemo 다음에 추가(전체 진열 상품 대상, 구역 무관):

```ts
  const fridgeSectionByProductId = useMemo(
    () => new Map(fridgeAssignments.map((a) => [a.productId, a.section])),
    [fridgeAssignments],
  );

  const quickSearchResults = useMemo(() => {
    const q = quickSearchQuery.trim();
    if (!q) return [];
    const assignedProducts = products.filter(
      (p) => fridgeSectionByProductId.has(p.id) && (p.status ?? 'active') === 'active',
    );
    return searchOrderProducts(assignedProducts, q).slice(0, 8);
  }, [products, fridgeSectionByProductId, quickSearchQuery]);
```

- [ ] **Step 2: 검색창 + 결과 드롭다운 JSX 추가**

Task 2 Step 6에서 넣은 구역탭 `View` 바로 앞에 추가:

```tsx
          <View className="mx-4 mt-1">
            <View className="flex-row items-center rounded-xl border border-line bg-paper px-3">
              <MaterialCommunityIcons name="magnify" size={18} color="#888888" />
              <TextInput
                className="text-ink ml-2 flex-1 py-2 text-sm"
                placeholder="냉장고 진열 상품 중에서 찾기"
                placeholderTextColor="#BBBBBB"
                value={quickSearchQuery}
                onChangeText={setQuickSearchQuery}
              />
            </View>
            {quickSearchResults.length > 0 ? (
              <View className="mt-1 overflow-hidden rounded-xl border border-line bg-paper">
                {quickSearchResults.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      const section = fridgeSectionByProductId.get(p.id);
                      if (section) setActiveSection(section);
                      setQuickSearchQuery('');
                    }}
                    className="flex-row items-center justify-between border-b border-line px-3 py-2.5"
                  >
                    <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-muted ml-2 text-xs">
                      🧊 {fridgeSectionByProductId.get(p.id)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: `login.tsx` 기존 오류 1건만.

- [ ] **Step 4: 수동 확인**

1. 빠른발주 검색창에 진열된 상품 이름 입력 → 드롭다운에 위치 태그(🧊 구역명)와 함께 뜨는지
2. 결과 탭 → 그 구역탭으로 자동 전환 + 검색창 비워지는지
3. 진열 안 된(냉장고 배정 안 된) 상품명을 검색하면 결과가 안 뜨는지 (388종 전체가 아니라 이 매장 진열 상품만 대상인지 확인)

- [ ] **Step 5: Commit**

```bash
git add src/app/order.tsx
git commit -m "feat: 빠른발주에 진열 상품 한정 검색(위치 태그) 추가"
```
