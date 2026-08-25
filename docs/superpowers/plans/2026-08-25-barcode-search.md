# 홈 검색창 바코드 스캔 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면 검색창 우측에 바코드 스캔 아이콘을 추가해, 스캔한 바코드로 등록된 상품을 찾고 미등록 상품이면 외부 조회로 이름을 찾아 등록을 유도한다.

**Architecture:** `scan.tsx`에 검색 전용 모드(`mode=search`)를 추가해 기존 카메라 스캔 로직을 재사용하고, 스캔 결과 바코드를 `router` 파라미터로 홈(`index.tsx`)에 전달한다. `index.tsx`는 그 바코드를 검색창에 채우고, 로컬 필터 결과가 없으면 `lookupBarcode()`로 외부 조회해 배너로 안내한다.

**Tech Stack:** React Native + Expo Router, TypeScript. 새 의존성 없음 — 기존 `lookupBarcode`(`@/lib/barcode-lookup`), `BarcodeInfo` 타입(`@/lib/types`)을 그대로 재사용.

## Global Constraints

- 검색창에 바코드 숫자를 직접 타이핑하는 것은 외부 조회 트리거 대상이 아니다 — **스캔 아이콘 경유 시에만** 외부 조회한다 (스펙 결정 사항).
- 이 저장소엔 테스트 프레임워크가 없다(jest/vitest 미설정) — 이 기능만을 위해 새로 도입하지 않는다. 각 작업 완료 확인은 `npx tsc --noEmit` 타입체크 + 실기기/에뮬레이터 수동 QA로 한다.
- `lookupBarcode` 실패 시(`{ name: null, imageUrl: null }`) 별도 에러 UI 없이 조용히 무시한다 (기존 앱 패턴).
- 배너는 목록 상단에 1줄로 표시하고, 사용자가 검색어를 직접 수정하면 사라진다.

---

### Task 1: `scan.tsx` — 검색 모드 분기 추가

**Files:**
- Modify: `src/app/scan.tsx:1-140` (import문, `onScanned` 함수, 하단 "직접 입력" 버튼 블록)

**Interfaces:**
- Consumes: 없음 (기존 `lookupBarcode` import 그대로 사용)
- Produces: 홈 화면과의 네비게이션 계약 — `mode=search` 쿼리 파라미터로 진입해 유효한 바코드를 스캔하면, `router.replace({ pathname: '/', params: { scannedBarcode: string } })`를 호출한다. Task 2는 `useLocalSearchParams<{ scannedBarcode?: string }>()`로 이 값을 받는다.

- [ ] **Step 1: import문에 `useLocalSearchParams` 추가**

`src/app/scan.tsx` 3번째 줄을 다음으로 교체:

```tsx
import { router, useLocalSearchParams } from 'expo-router';
```

- [ ] **Step 2: `mode` 파라미터 읽기**

`export default function Scan() {` 바로 다음 줄(`const [permission, requestPermission] = useCameraPermissions();` 앞)에 추가:

```tsx
  const params = useLocalSearchParams<{ mode?: string }>();
```

- [ ] **Step 3: `onScanned`에 검색 모드 분기 추가**

기존:

```tsx
  const onScanned = async ({ type, data, bounds }: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    if (!isValidBarcode(type, data)) return;
    if (!isInsideGuide(bounds)) return;
    scannedRef.current = true;
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
  const onScanned = async ({ type, data, bounds }: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    if (!isValidBarcode(type, data)) return;
    if (!isInsideGuide(bounds)) return;
    scannedRef.current = true;

    if (params.mode === 'search') {
      // 검색 모드: 외부 조회 없이 스캔한 바코드만 들고 홈 화면으로 돌아간다
      router.replace({ pathname: '/', params: { scannedBarcode: data } });
      return;
    }

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

- [ ] **Step 4: 검색 모드에서 "바코드 없이 직접 입력" 버튼 숨기기**

기존:

```tsx
      {/* 직접 입력 */}
      <View
        className="absolute w-full items-center"
        style={{ bottom: Math.max(insets.bottom, 48) + 24 }}
      >
        <Pressable
          onPress={() => router.replace('/product-form')}
          className="rounded-full border border-paper/60 bg-ink/50 px-6 py-3 active:opacity-70"
        >
          <Text className="text-paper text-base font-medium">바코드 없이 직접 입력</Text>
        </Pressable>
      </View>
```

다음으로 교체 (검색 모드가 아닐 때만 렌더):

```tsx
      {/* 직접 입력 (검색 모드에서는 의미가 없으므로 숨김) */}
      {params.mode !== 'search' ? (
        <View
          className="absolute w-full items-center"
          style={{ bottom: Math.max(insets.bottom, 48) + 24 }}
        >
          <Pressable
            onPress={() => router.replace('/product-form')}
            className="rounded-full border border-paper/60 bg-ink/50 px-6 py-3 active:opacity-70"
          >
            <Text className="text-paper text-base font-medium">바코드 없이 직접 입력</Text>
          </Pressable>
        </View>
      ) : null}
```

- [ ] **Step 5: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 에러 없음 (기존에 있던 무관한 에러가 있었다면 그 개수가 늘지 않았는지만 확인)

- [ ] **Step 6: 수동 확인 (기존 등록 플로우가 안 깨졌는지)**

`npx expo start`로 앱 실행 → 하단 스캔 버튼(FAB)으로 `/scan` 진입(mode 파라미터 없음) → 바코드 스캔 → 기존처럼 `product-form`으로 이동하며 이름/사진이 prefill되는지 확인. 이 단계에서는 아직 검색 진입 경로(아이콘)가 없으므로 `mode=search` 분기는 Task 2 완료 후 확인한다.

- [ ] **Step 7: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/scan.tsx
git commit -m "feat: add search mode to barcode scan screen"
```

---

### Task 2: `index.tsx` — 검색창 바코드 아이콘 + 조회 배너

**Files:**
- Modify: `src/app/index.tsx:1-171` (import문, state, effect, 검색창 JSX), `src/app/index.tsx:173-195` 인근 (배너 JSX 삽입 위치)

**Interfaces:**
- Consumes: Task 1이 만든 네비게이션 계약 — `/`로 돌아올 때 `scannedBarcode` 쿼리 파라미터가 붙는다. `lookupBarcode(barcode: string): Promise<BarcodeInfo>` (`@/lib/barcode-lookup`), `BarcodeInfo { name: string | null; imageUrl: string | null }` (`@/lib/types`).
- Produces: 없음 (최종 사용자 대면 UI)

- [ ] **Step 1: import문 갱신**

`src/app/index.tsx` 1~21번째 줄 전체를 다음으로 교체:

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import Fab from '@/components/Fab';
import ProductCard from '@/components/ProductCard';
import SummaryHeader from '@/components/SummaryHeader';
import { lookupBarcode } from '@/lib/barcode-lookup';
import { SECTION_ORDER, SECTION_TITLES, SectionKey, daysUntil, sectionOf } from '@/lib/dates';
import { cancelExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, listProducts, resolveProduct } from '@/lib/repo';
import { useAppMode } from '@/lib/settings';
import { BarcodeInfo, Product } from '@/lib/types';
```

- [ ] **Step 2: 바코드 조회 state 추가**

기존:

```tsx
export default function Dashboard() {
  const mode = useAppMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
```

다음으로 교체:

```tsx
export default function Dashboard() {
  const mode = useAppMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string }>();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<BarcodeInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
```

- [ ] **Step 3: 들어온 스캔 파라미터를 검색어로 반영하는 effect 추가**

`const categories = useMemo(...)` 블록 바로 앞(즉 `const load = ...` / `useFocusEffect(...)` 다음, `const categories = useMemo` 앞)에 추가:

```tsx
  useEffect(() => {
    if (scanParams.scannedBarcode) {
      setQuery(scanParams.scannedBarcode);
      setScannedBarcode(scanParams.scannedBarcode);
      setLookupResult(null);
    }
  }, [scanParams.scannedBarcode]);
```

- [ ] **Step 4: 필터링된 총 개수 계산 + 외부 조회 effect 추가**

`sections` useMemo 블록(기존 58~82번째 줄) 바로 다음에 추가:

```tsx
  const totalFilteredCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.data.length, 0),
    [sections],
  );

  useEffect(() => {
    if (!scannedBarcode) return;
    if (query !== scannedBarcode) {
      // 사용자가 검색어를 직접 수정함 — 스캔 배너를 더 이상 보여주지 않는다
      setScannedBarcode(null);
      setLookupResult(null);
      return;
    }
    if (totalFilteredCount > 0) return; // 로컬에 이미 있으면 외부 조회 불필요

    let cancelled = false;
    setLookingUp(true);
    lookupBarcode(scannedBarcode)
      .then((result) => {
        if (!cancelled) setLookupResult(result);
      })
      .finally(() => {
        if (!cancelled) setLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scannedBarcode, query, totalFilteredCount]);
```

- [ ] **Step 5: 검색창에 바코드 스캔 아이콘 추가**

기존:

```tsx
      {/* 검색 */}
      <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3">
        <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
        <TextInput
          className="text-ink ml-2 flex-1 py-2.5 text-base"
          placeholder="상품명, 바코드, 메모 검색"
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
```

다음으로 교체:

```tsx
      {/* 검색 */}
      <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3">
        <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
        <TextInput
          className="text-ink ml-2 flex-1 py-2.5 text-base"
          placeholder="상품명, 바코드, 메모 검색"
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={setQuery}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push('/scan?mode=search')}
          hitSlop={8}
          className="ml-2"
        >
          <MaterialCommunityIcons name="barcode-scan" size={20} color="#888888" />
        </Pressable>
      </View>
```

- [ ] **Step 6: 조회 배너 JSX 추가**

기존 (카테고리 필터 블록과 `<SectionList` 사이):

```tsx
      {/* 카테고리 필터 */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2.5 max-h-10"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          <Chip
            label="전체"
            active={selectedCategories.size === 0}
            onPress={() => setSelectedCategories(new Set())}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategories.has(c)}
              onPress={() => toggleCategory(c)}
            />
          ))}
        </ScrollView>
      ) : null}

      <SectionList
```

다음으로 교체 (카테고리 필터 블록은 그대로 두고 그 사이에 배너 삽입):

```tsx
      {/* 카테고리 필터 */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2.5 max-h-10"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          <Chip
            label="전체"
            active={selectedCategories.size === 0}
            onPress={() => setSelectedCategories(new Set())}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategories.has(c)}
              onPress={() => toggleCategory(c)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* 바코드 조회 배너 (로컬 미등록 + 스캔으로 들어온 바코드) */}
      {lookingUp || lookupResult?.name ? (
        <Pressable
          disabled={lookingUp}
          onPress={() => {
            if (!lookupResult?.name || !scannedBarcode) return;
            router.push({
              pathname: '/product-form',
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

      <SectionList
```

- [ ] **Step 7: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 8: 수동 QA (스펙 4가지 시나리오)**

`npx expo start`로 앱 실행 후:

1. **등록된 상품 검색**: 이미 등록된 상품의 바코드를 검색창 아이콘으로 스캔 → 해당 상품이 목록에 나타나고 배너는 뜨지 않는지 확인
2. **미등록 바코드 검색**: 등록되지 않은 실물 바코드를 스캔 → 목록은 비어 있고 상단에 "바코드 조회: OOO — 등록하기" 배너가 뜨는지 확인 → 배너 탭 → `product-form`에 이름/사진이 prefill되어 이동하는지 확인
3. **조회 실패 케이스**: 기기 비행기 모드로 전환 후 미등록 바코드 스캔 → 배너 없이 빈 목록만 보이고 에러 알럿이 뜨지 않는지 확인 (다시 네트워크 켜기)
4. **배너 사라짐**: 미등록 바코드 스캔으로 배너가 뜬 상태에서 검색창 글자를 하나 지우거나 추가 → 배너가 즉시 사라지는지 확인

- [ ] **Step 9: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/index.tsx
git commit -m "feat: add barcode scan search with unregistered-product lookup banner"
```

---

## Self-Review Notes

- **스펙 커버리지**: 검색창 우측 아이콘(Task 2 Step 5), 로컬 등록 상품 검색(기존 `sections` 필터 재사용, 변경 없음), 외부 조회 배너(Task 2 Step 4, 6), 스캔 경유 시에만 조회(Task 2 Step 4의 `scannedBarcode` 게이트 + Task 1의 `mode=search` 분기), 배너 탭 시 등록 이동(Task 2 Step 6), 검색어 수정 시 배너 소멸(Task 2 Step 4) — 모두 태스크에 매핑됨.
- **타입 일관성**: `BarcodeInfo`(`{ name, imageUrl }`)를 `lookupResult`에 그대로 사용, `lookupBarcode` 시그니처(`(barcode: string) => Promise<BarcodeInfo>`)와 일치. `scannedBarcode` 파라미터 이름은 Task 1(`router.replace` 대상)과 Task 2(`useLocalSearchParams`)에서 동일하게 사용.
- **플레이스홀더 없음**: 모든 코드 블록이 실제 diff 형태로 작성됨.
