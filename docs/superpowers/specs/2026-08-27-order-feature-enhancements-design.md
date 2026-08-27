# 발주 기능 개선 (사진 자동 채우기 / UX 개선 / 납품상태 태그 / 바코드 수동 입력) Design

**Status:** Approved
**Date:** 2026-08-27
**Base:** main (발주 관리 기능이 이미 병합된 상태, `docs/superpowers/plans/2026-08-26-order-feature.md` 참고)

## 배경

발주 관리 기능을 실기기에서 확인해본 뒤 나온 개선 요청들을 모은 스펙이다. 여섯 가지 항목이며, 서로 다른 화면/파일을 건드리지만 모두 "발주" 기능 범위 안에 있어 하나의 스펙 + 하나의 구현 계획으로 묶는다.

1. 사진 없는 발주 상품에 대해 바코드로 자동 사진 채우기
2. 발주 화면 하단 "발주 내역 확인" 바가 기기 내비게이션 바에 가려지는 문제 수정
3. 발주 목록에서 상품 수정 진입을 길게 누르기 대신 탭으로 즉시 가능하게
4. 상품별 납품상태 태그(시판중/단종/생산일시중단) 추가
5. 발주 목록에 바코드 번호 표시
6. 발주 등록/수정 화면에 바코드 수동 입력 + 조회 버튼 (다른 사용자가 이미 등록한 이름/사진 재사용)

## Global Constraints (기존 발주 기능과 동일하게 유지)

- 발주 카탈로그/카테고리/장바구니는 여전히 **기기 로컬 `AsyncStorage`만** 사용한다. 이번 변경으로 Supabase 테이블을 새로 추가하지 않는다.
- 가격·카테고리는 매장마다 다를 수 있어 **로컬에만 유지**하고 공유하지 않는다. 공유되는 것은 바코드·상품명·사진뿐이며, 기존에 이미 구현된 공용 캐시 `barcode_catalog` 테이블(및 `upsertBarcodeCatalog`/`lookupBarcode`)을 그대로 재사용한다 — 새 테이블/새 동기화 로직을 만들지 않는다.
- 이 프로젝트에는 자동 테스트 러너가 없다. 각 변경의 검증은 `npx tsc --noEmit` 통과 여부로 한다.
- `Alert.prompt` 사용 금지(iOS 전용), 커스텀 dialog 컴포넌트 신설 금지 — 기존 발주 기능과 동일한 제약.

---

## 1. 사진 자동 채우기

### 목적
현재 발주 상품(특히 시드 388건)은 대부분 사진이 없다. 상품마다 "웹에서 이미지 찾기"를 수동으로 누르는 대신, 한 번에 일괄 처리한다.

### 아키텍처

**`src/lib/order-repo.ts`에 함수 추가:**

```ts
import { lookupBarcode } from './barcode-lookup';

/**
 * 바코드가 있지만 사진이 없는 발주 상품을 순서대로 훑어 lookupBarcode()로 채운다.
 * 항목 하나 처리할 때마다 즉시 저장(중단돼도 그동안 채운 건 유지)하고 onProgress를 호출한다.
 * 반환값: 실제로 사진을 채운 개수.
 */
export async function fillMissingOrderPhotos(
  onProgress?: (done: number, total: number) => void,
): Promise<number>
```

**동작:**
1. `listOrderProducts()`로 전체 목록을 읽고 `barcode`가 있고 `imageUri`가 없는 항목만 대상으로 추린다.
2. 대상이 0개면 바로 0 반환.
3. 대상을 하나씩 순서대로(동시 실행 아님) `lookupBarcode(barcode)` 호출.
   - 반환된 `imageUrl`이 있으면 그 상품의 `imageUri`를 갱신하고 **즉시 `writeOrderProducts`로 전체 배열을 저장**(private 함수라 같은 파일 안에서 직접 호출).
   - 이 과정에서 `upsertBarcodeCatalog`는 호출하지 않는다 — 이미 `lookupBarcode`가 캐시에서 읽어온 값이거나, 외부 API에서 새로 찾은 값을 그대로 로컬에 반영하는 것뿐이므로 공용 캐시에 다시 쓸 필요가 없다(`seedDefaultOrderProducts`와 동일한 논리로 대량 개별 네트워크 쓰기를 피한다).
   - 매 항목 처리 후(성공/실패 무관) `onProgress(현재까지 처리한 개수, 전체 대상 개수)` 호출.
4. 전체 처리 후 채운 개수를 반환.

개별 항목에서 `lookupBarcode`가 실패해도(네트워크 오류 등) 이미 그 함수 내부에서 `{name: null, imageUrl: null}`로 안전하게 처리되므로, 이 함수는 추가 try/catch 없이 다음 항목으로 넘어간다.

### UI — `src/app/order.tsx`

- 상태 추가: `filling: boolean`, `fillProgress: {done: number; total: number}`.
- 사진 없는 상품 개수(`products.filter(p => p.barcode && !p.imageUri).length`)가 0보다 클 때만, 검색창 아래에 버튼 노출: `사진 없는 상품 N개 — 자동으로 채우기`.
- 누르면:
  - `hasImageSearchKeys()`(기존 함수, `@/lib/barcode-lookup`)가 `false`면 "로그인이 필요합니다" 알림 후 중단.
  - `true`면 `filling = true`로 바꾸고 `fillMissingOrderPhotos(onProgress)` 실행, 버튼 텍스트를 `134 / 388 처리 중...`으로 갱신.
  - 완료 후 `filling = false`, `load()`로 목록 새로고침, `Alert.alert`로 "N개 사진을 채웠습니다." 안내(0개면 "채울 수 있는 사진을 찾지 못했습니다").
- 화면을 벗어나도 실행 중인 루프 자체는 끝까지 진행된다(JS 프로미스 체인은 컴포넌트 언마운트와 무관하게 계속 실행됨). 다만 언마운트 후에는 진행률 UI가 갱신되지 않을 수 있다 — 이번 스펙에서는 취소 버튼이나 언마운트 후 진행률 복구는 만들지 않는다(범위 제외).

---

## 2. 발주 내역 확인 바 — 하단 안전영역 보정

### 문제
`src/app/order.tsx`의 하단 고정 바(`발주 내역 확인`)가 `bottom-0` + `p-4`로만 배치돼 있어, 제스처 내비게이션 바가 있는 기기에서 버튼 아래쪽이 시스템 바에 가려 터치가 어렵다.

### 수정
기존에 이미 `src/components/Fab.tsx`가 쓰고 있는 `useSafeAreaInsets()`(라이브러리: `react-native-safe-area-context`, 이미 의존성에 있음) 패턴을 그대로 재사용한다.

```ts
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// ...
const insets = useSafeAreaInsets();
```

하단 바 컨테이너의 `style`에 `paddingBottom: Math.max(insets.bottom, 16) + 16` 정도로 적용(기존 `p-4`가 주던 16px 여백은 유지하면서 시스템 인셋만큼 추가). 좌우/상단 패딩은 기존 className 그대로 둔다.

---

## 3. 발주 목록 — 탭으로 즉시 수정

### 문제
`order.tsx`의 `CatalogRow`는 `onLongPress`(길게 누르기)로만 수정/삭제 메뉴(`onLongPressProduct`)를 띄운다. 재고관리 목록(`src/components/ProductCard.tsx` + `src/app/index.tsx`)은 이미 "탭 = 바로 수정 화면 이동, 길게 누르기 = 메뉴"로 되어 있다 — 같은 패턴으로 맞춘다.

### 수정
`CatalogRow`(order.tsx 내부)에 `onPress` prop을 추가로 전달:

```tsx
<CatalogRow
  product={item}
  qty={cart[item.id] ?? 0}
  onChangeQty={(delta) => changeQty(item.id, delta)}
  onPress={() => router.push({ pathname: '/order-product-form', params: { id: item.id } })}
  onLongPress={() => onLongPressProduct(item)}
/>
```

`CatalogRow` 컴포넌트의 최상위 `Pressable`에 `onPress`를 추가(`onLongPress`는 기존 그대로 유지 — 삭제 등 메뉴는 계속 길게 누르기로 접근 가능). 수량 +/- 버튼은 이미 별도의 중첩 `Pressable`이라 터치 시 그쪽이 우선 반응하므로 행 전체의 `onPress`와 충돌하지 않는다(재고관리 쪽과 동일한 구조로 검증된 패턴).

---

## 4. 납품상태 태그 (시판중 / 단종 / 생산일시중단)

### 데이터 모델 — `src/lib/order-types.ts`

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
  status?: OrderStatus; // 없으면(과거 데이터/시드 데이터) 'active'로 취급
}
```

`status`를 optional로 둬서 `src/lib/order-seed-data.ts`(388건, 이 필드 없음)를 수정할 필요가 없게 한다.

### 기본값 처리 — `src/lib/order-repo.ts`

`listOrderProducts()`가 반환하기 전에 각 항목에 기본값을 채운다:

```ts
export async function listOrderProducts(): Promise<OrderProduct[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  const items = raw ? (JSON.parse(raw) as OrderProduct[]) : [];
  return items.map((p) => ({ status: 'active' as const, ...p }));
}
```

(스프레드 순서상 `p.status`가 있으면 그 값이, 없으면 `'active'`가 사용된다.) 이후 저장 시(`saveOrderProduct`)에는 항상 명시적인 `status` 값이 들어가므로 이 기본값 처리는 읽기 시점에만 필요하다.

### UI — 등록/수정 화면 (`src/app/order-product-form.tsx`)

- 상태 추가: `const [status, setStatus] = useState<OrderStatus>('active')`. 수정 모드 로드 시 `p.status ?? 'active'`로 초기화.
- 카테고리 섹션 아래(또는 위, 레이아웃상 자연스러운 위치)에 3개 선택 버튼을 인라인으로 새로 만든다(기존 `Chip`은 단일 강조색이라 재사용하지 않고, 이 화면 안에 작은 3버튼 컴포넌트를 직접 작성):
  - 시판중 (선택 시 초록 배경/테두리)
  - 단종 (선택 시 빨강)
  - 생산일시중단 (선택 시 노랑)
- 저장 시 `product.status = status`로 포함해서 `saveOrderProduct` 호출.

### UI — 목록 표시 (`src/app/order.tsx`의 `CatalogRow`)

상품명 옆(또는 아래)에 항상 작은 색깔 태그를 표시한다(신호등처럼 상시 노출, 시판중일 때도 초록 태그로 보임):

- `active` → 초록 배경 + "시판중"
- `discontinued` → 빨강 배경 + "단종"
- `paused` → 노랑 배경 + "생산중단"

### 범위 제외 (이번엔 안 함)
- 상태별 필터링 UI 없음.
- 단종/생산중단 상품이라도 장바구니 담기 제한 없음 — 사용자가 알아서 판단.
- 공유 텍스트(`buildOrderShareText`)에 상태 정보 추가 안 함 — 텍스트는 현행 유지.

---

## 5. 발주 목록에 바코드 표시

`order.tsx`의 `CatalogRow`에서, `product.barcode`가 있을 때 브랜드/가격 줄 아래(또는 옆)에 작은 텍스트로 바코드 번호를 추가로 보여준다. 없으면 표시 안 함. 순수 표시용 변경이라 데이터/로직 변경 없음.

---

## 6. 바코드 수동 입력 + 조회 (사용자 간 이름/사진 재사용)

### 배경
현재 발주/재고관리 어느 화면에도 바코드를 직접 타이핑하는 입력칸이 없다(스캔으로만 채워짐). 이번에 발주 등록 화면에 처음 추가한다.

### 재사용되는 기존 메커니즘
`src/lib/barcode-lookup.ts`의 `lookupBarcode(barcode)`는 이미:
1. 공용 캐시 `barcode_catalog`에서 먼저 조회(다른 사용자가 이미 등록해뒀으면 여기서 무료로 찾음)
2. 없으면 Edge Function(`barcode-lookup`)을 통해 식품안전나라/네이버쇼핑/OpenFoodFacts 순으로 조회

그리고 `saveOrderProduct`(order-repo.ts)는 이미 저장할 때마다 `upsertBarcodeCatalog(barcode, name, imageUri)`를 호출해 공용 캐시에 반영한다(2026-08-27 최종 리뷰에서 로컬 파일 경로/null로 캐시를 오염시키지 않도록 이미 수정됨). 즉, **공유 메커니즘 자체는 이미 완성되어 있고, 이번 작업은 그걸 트리거할 수동 입력 UI만 추가**하면 된다.

### UI — `src/app/order-product-form.tsx`

- 기존 상단 바코드 배지(아이콘+텍스트만 표시, 읽기 전용)를 제거하고, 브랜드/가격 섹션 위(또는 아래) 새 줄에 `바코드` `Label` + `TextInput`(스캔으로 이미 barcode가 채워져 있으면 그 값을 초기값으로 사용, 계속 수정 가능) + 그 옆에 `조회` 버튼을 배치한다.
- `조회` 버튼 동작:
  1. 입력값이 비어있으면 "바코드를 입력해 주세요" 알림.
  2. `hasImageSearchKeys()`가 `false`면 "로그인이 필요합니다" 알림(기존 `findImageOnWeb`와 동일 패턴).
  3. `lookupBarcode(barcode.trim())` 호출(로딩 스피너 표시).
  4. 결과의 `name`이 있고 현재 `name` 입력칸이 비어있으면 채움. `imageUrl`이 있고 현재 `imageUri`가 없으면 채움. 이미 사용자가 입력/설정한 값은 덮어쓰지 않는다.
  5. 아무 것도 못 찾았으면 "일치하는 정보를 찾지 못했습니다. 직접 입력해 주세요." 알림.
- 저장(`save()`) 시 `barcode: barcode.trim() || null`로 `OrderProduct.barcode`에 반영(기존 로직 유지, 입력 소스만 스캔 params 외에 수동 입력도 추가된 것).

### 범위 제외
- 수동 입력한 바코드가 이미 로컬 카탈로그에 있는지 중복 검사하지 않는다(스캔 플로우의 중복 검사는 화면 진입 전 단계에서 이뤄지는 것이고, 폼 내부 검증으로 확장하지 않음 — 범위 밖).
- 가격/카테고리는 여전히 공유 대상이 아니다(Global Constraints 참고).

---

## 컴포넌트/파일 변경 요약

| 파일 | 변경 |
|---|---|
| `src/lib/order-types.ts` | `OrderStatus` 타입 추가, `OrderProduct.status?` 필드 추가 |
| `src/lib/order-repo.ts` | `fillMissingOrderPhotos()` 추가, `listOrderProducts()`에 status 기본값 처리 추가 |
| `src/app/order.tsx` | 사진 자동 채우기 버튼, 하단 바 안전영역 보정, `CatalogRow`에 onPress/바코드 표시/상태 태그 추가 |
| `src/app/order-product-form.tsx` | 바코드 입력칸+조회 버튼 추가(기존 배지 대체), 납품상태 3버튼 선택 UI 추가 |

새로 만드는 파일 없음. 새 의존성 없음. Supabase 스키마 변경 없음(기존 `barcode_catalog` 테이블 그대로 사용).

## 테스트 방침

자동 테스트 러너가 없으므로 각 변경 후 `npx tsc --noEmit`로 신규 타입 에러가 없는지 확인한다. UI 동작(자동 채우기 진행률, 태그 색상, 조회 버튼 prefill)은 실기기/에뮬레이터에서 수동 확인한다.
