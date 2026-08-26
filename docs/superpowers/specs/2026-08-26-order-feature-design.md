# 발주 관리 기능 통합 설계

## 배경

별도로 만들어둔 웹 프로토타입(`발주서.html`, React+Tailwind CDN 단일 파일)을 유통기한 지킴이(expiry-keeper) 앱에 네이티브 기능으로 통합한다. 프로토타입은 아이스크림 도소매점이 매장에 재고를 채우기 위해 "무엇을 몇 박스 주문할지" 정리하고 카카오톡 등으로 발주 내역을 공유하는 용도였다.

헤더 아이콘 삽입 위치는 스크린샷(`KakaoTalk_20260826_165137980.jpg`)에서 사용자가 빨간 원으로 표시한 자리 — 기존 `chef-hat`(레시피) 아이콘 왼쪽, 즉 `headerRight` 아이콘 그룹의 맨 앞.

## 목표

- 발주용 상품 카탈로그(이름/브랜드/가격/제품유형/바코드)를 관리한다.
- 카탈로그 상품별로 발주 수량을 담고, 카카오톡 등으로 공유 가능한 텍스트를 만든다.
- 바코드 스캔으로 카탈로그 상품을 빠르게 찾거나 신규 등록한다.
- 신규 등록 시 사진을 붙이고, 기존 재고관리 기능이 이미 구축해 둔 바코드 공용 캐시(`barcode_catalog`)를 읽고 쓴다.

## 범위 밖 (Out of scope)

- 발주 카탈로그/장바구니의 기기 간 동기화 (Supabase 미사용, 기기 로컬 `AsyncStorage`만)
- 가정용(home) 모드 노출 (retail 모드 전용)
- 발주 매장 목록의 별도 CRUD (기존 재고관리 카테고리를 그대로 조회만 함)

## 데이터 모델

`src/lib/order-types.ts` (신규):

```ts
export interface OrderProduct {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: string; // 제품유형: 바/콘/튜브/샌드기타/홈컵 등, 사용자가 추가·수정·삭제 가능
  barcode: string | null;
}

export type OrderCart = Record<string /* OrderProduct id */, number /* 수량 */>;
```

저장 방식: `AsyncStorage`만 사용 (기존 `repo.ts`의 로컬 저장 패턴과 동일한 구조, Supabase 분기 없음).

| 키 | 내용 |
|---|---|
| `orderProducts:v1` | `OrderProduct[]` |
| `orderCategories:v1` | `string[]` (기본값: `['바','콘','튜브','샌드/기타','홈/컵']`) |
| `orderCart:v1` | `OrderCart` |

"매장" 이름은 별도 저장소 없이, 기존 재고관리 상품(`Product.categories`, 예: 남양동/성주동)에서 매 화면 진입 시 동적으로 뽑아 드롭다운으로 보여준다. 발주 전용 매장 추가/삭제 기능은 만들지 않는다.

## 바코드 공용 캐시 공유

기존 `repo.ts`의 비공개 함수 `upsertBarcodeCatalog(product: Product)`를 `src/lib/barcode-catalog.ts`로 옮기고 시그니처를 일반화한다:

```ts
export async function upsertBarcodeCatalog(
  barcode: string | null,
  name: string,
  imageUri: string | null,
): Promise<void>;
```

- `repo.ts`의 `saveProduct`가 이 함수를 호출하도록 변경 (동작 변화 없음, 위치만 이동).
- 신규 `order-repo.ts`의 상품 저장 함수도 저장 성공 후 이 함수를 best-effort로 호출.
- 읽기는 기존 `lib/barcode-lookup.ts`의 `lookupBarcode(barcode)`를 그대로 재사용 (변경 없음) — `barcode_catalog` 캐시 → 없으면 외부 API(Edge Function) 순.

이로써 재고관리에서 등록한 이름/사진과 발주 카탈로그에서 등록한 이름/사진이 서로 재사용된다.

> 참고(인프라, 이번 작업 범위 아님): 세션 메모상 Supabase에 `barcode_catalog` 테이블이 아직 없을 수 있다는 이슈가 있었다. `supabase/migration-barcode-catalog.sql`과 `migration-barcode-catalog-updated-by.sql`을 대시보드에서 실행해야 라이브로 동작한다. 코드는 테이블 유무와 무관하게 정상 동작(캐시 미스 시 외부 API로 폴백)한다.

## 화면 / 라우팅

### 신규 라우트 (`src/app/_layout.tsx`에 등록)

| 라우트 | 방식 | 설명 |
|---|---|---|
| `order` | 일반 push | 발주 메인 화면 |
| `order-cart` | `presentation: 'modal'` | 담은 품목 확인 + 매장 선택 + 공유 |
| `order-product-form` | 일반 push | 카탈로그 상품 추가/수정 |

### `src/app/order.tsx`

- 검색창(이름/브랜드/바코드)
- 제품유형 카테고리 칩 (`Chip` 공용 컴포넌트 재사용): '전체' + 등록된 카테고리들 + 맨 끝 `+`칩(추가). 칩 롱프레스 시 `Alert.alert`로 "수정 / 삭제 / 취소" 액션시트 — 기존 `index.tsx`의 `showActions()`와 동일한 패턴.
  - 카테고리 삭제 시 해당 카테고리를 쓰던 상품은 삭제되지 않고 그대로 남는다(다만 그 상품의 `category` 값은 이제 카테고리 목록에 없는 문자열이 되어, 칩 필터로는 더 이상 걸러낼 수 없다 — 프로토타입과 동일한 동작). 선택 중이던 카테고리가 삭제되면 '전체'로 복귀.
  - 카테고리 수정(rename) 시 해당 카테고리를 쓰는 모든 `OrderProduct.category`도 함께 갱신.
- 헤더 우측: 바코드 스캔 아이콘(`router.push('/scan?mode=order')`), 상품 추가 아이콘(`router.push('/order-product-form')`)
- 카탈로그 목록: 각 행에 이름/브랜드/가격, 수량 스테퍼(`-` / 개수 / `+`), 길게 누르면 "수정 / 삭제" 액션시트(→ 수정은 `order-product-form`으로 이동, 삭제는 확인 후 카탈로그에서 제거 — 장바구니에도 있었다면 함께 제거)
- 담은 수량 합계 > 0이면 하단 플로팅 버튼("발주 내역 확인 · N박스") → `/order-cart` 모달 오픈

### `src/app/order-cart.tsx` (모달)

- 매장 선택 드롭다운: 재고관리 상품들에서 뽑은 카테고리 목록 (없으면 안내 문구 "재고관리에서 매장을 먼저 등록해 주세요" 표시하고 공유 비활성화)
- 담은 품목 리스트 (이름/브랜드, 수량, 개별 삭제)
- "초기화" (전체 비우기, 확인 필요)
- "공유하기" 버튼 → `Share.share({ message })`
  - 텍스트 포맷은 프로토타입과 동일하게 유지:
    ```
    [아이스크림 발주_ {매장}- {YYYY. M. D.}]
    • {이름}({브랜드}): {수량}박스
    ...

    총 합계: {합계}박스
    ```
  - 날짜는 `toLocaleDateString('ko-KR')` 대신 RN 환경에 맞게 직접 포맷하는 헬퍼를 하나 작성 (`YYYY. M. D.` 형태)

### `src/app/order-product-form.tsx`

`product-form.tsx`와 동일한 레이아웃/패턴으로 구성 (사진 피커, 웹 이미지 검색, 저장/삭제 버튼 스타일 등 재사용):

- 사진: `pickImage()`(카메라/앨범) + "웹에서 이미지 찾기"(`searchProductImage`) — `product-form.tsx`에서 그대로 가져옴
- 바코드: 읽기 전용 표시 (스캔으로 진입 시 채워짐, 직접 입력 진입 시 비어 있음 — 이 경우 상품명 옆에 바코드 없이 저장 가능)
- 상품명 (필수)
- 브랜드
- 가격 (숫자)
- 카테고리: `order.tsx`와 동일한 칩 선택 (기존 카테고리 중 선택 + 새 카테고리 즉시 추가, `product-form.tsx`의 카테고리 입력 UX와 동일한 패턴)
- 저장 시: `order-repo.ts`에 저장 + `upsertBarcodeCatalog` best-effort 호출 + `router.dismissAll()` 또는 뒤로가기
- 삭제(수정 모드일 때만): 확인 후 카탈로그에서 제거

### `src/app/scan.tsx` 수정

`params.mode === 'order'` 분기 추가 (기존 `search`/기본 분기 사이):

1. 유효 바코드 인식 시 `lookupBarcode(data)`와 `listOrderProductsByBarcode(data)`(신규, `order-repo.ts`)를 동시 조회
2. 카탈로그에 이미 있으면 → `router.dismissTo({ pathname: '/order', params: { scannedBarcode: data, nonce: ... } })` (검색어만 채움, `order.tsx`가 해당 바코드로 검색어를 세팅해 자동 필터링)
3. 없으면 → `router.replace({ pathname: '/order-product-form', params: { barcode: data, prefillName: info.name ?? '', prefillImage: info.imageUrl ?? '' } })`

### `src/app/index.tsx` 헤더

`mode === 'retail'`일 때만, `chef-hat` 아이콘 왼쪽에 `cart-outline`(또는 `clipboard-list-outline`) 아이콘 추가, `onPress={() => router.push('/order')}`.

### `src/components/Chip.tsx` (신규, 공용화)

`index.tsx`에 있던 사설 `Chip` 함수를 이 파일로 옮기고 `index.tsx`·`order.tsx` 양쪽에서 import. 스타일/동작 변경 없음, 위치 이동 + export만.

## 에러 처리

기존 앱 전역 관례를 그대로 따른다: 저장/삭제/조회 실패는 `Alert.alert('실패', message)`. 별도의 커스텀 dialog 컴포넌트를 새로 만들지 않는다 (프로토타입엔 있었지만 RN 앱엔 이미 `Alert.alert` 패턴이 확립되어 있으므로 불필요).

## 테스트 방침

RN 프로젝트에 기존 테스트 인프라가 없음(세션 메모 확인됨). 새 순수 로직 함수 — 특히 발주 공유 텍스트 생성 함수(예: `buildOrderShareText(cart, products, branch, date)`) — 는 `src/lib`에 두고, 그 옆에 `__main__` 스타일이 아닌 RN/TS 환경에 맞춰 최소 self-check 스크립트(`ts-node`로 실행 가능한 `*.selfcheck.ts` 또는 간단 `console.assert` 기반)를 하나 남긴다. 프레임워크 도입은 하지 않는다.

## 구현 순서 제안 (다음 단계: writing-plans에서 세분화)

1. `barcode-catalog.ts` 추출 + `repo.ts` 리팩터 (기존 동작 무변경 확인)
2. `order-types.ts`, `order-repo.ts`, `Chip.tsx` 추출
3. `order.tsx` (카탈로그 목록 + 카테고리 관리 + 검색)
4. `order-product-form.tsx`
5. `order-cart.tsx` + 공유 텍스트 헬퍼
6. `scan.tsx` mode=order 분기
7. `index.tsx` 헤더 아이콘 + `_layout.tsx` 라우트 등록
8. 실기기/에뮬레이터 수동 테스트: 스캔→신규 등록→사진 재사용 확인, 카탈로그 카테고리 추가/수정/삭제, 발주 공유 텍스트 포맷 확인
