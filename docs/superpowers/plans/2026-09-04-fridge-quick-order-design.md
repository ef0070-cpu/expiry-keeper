# 냉장고 빠른발주 화면 — 설계

**프로젝트**: expiry-keeper (`C:\Users\USER\expiry-keeper`)
**날짜**: 2026-09-04

## 배경 / 목표

기존 발주 화면(`order.tsx`)은 388종 전체 카탈로그를 검색/카테고리 칩으로 훑는 방식이라, 실제 냉장고 앞에서 재고를 빠르게 채워 넣는 상황엔 느리다. 매장 냉장고에는 실제로 10~30종 정도만 진열되어 있고, 가격대별로 **600바 / 100바·콘류 / 1000바 / 샌드류** 4개 구역으로 나뉜다.

목표: 이 4개 구역을 탭으로 오가며 상품 타일을 탭 한 번으로 장바구니에 담는 "빠른발주" 모드를 만든다. 기존 검색 기반 발주 화면은 그대로 두고, 하나의 화면에서 두 모드를 전환한다. 매장마다 진열 구성이 다르므로 매장 선택 기능도 포함한다.

## 화면 구조

`order.tsx` 하나에 통합. 상단 세그먼트탭으로 모드 전환:

```
┌─────────────────────────────┐
│  [매장: 강남점 ▾]              │  ← 매장 선택 (탭하면 매장 목록/추가 모달)
│  빠른발주  |  검색발주          │  ← 세그먼트탭 (mode state)
├─────────────────────────────┤
│ 🔍 냉장고 진열 상품 중에서 찾기  │  ← 빠른발주 전용 검색창
│ [600바][100바·콘류][1000바][샌드류] │  ← 구역탭
│  □상품  □상품  □상품            │  ← 그리드, 탭=1개 담기
└─────────────────────────────┘
```

- `mode: 'quick' | 'search'` — `quick`이면 구역탭+그리드, `search`면 기존 검색창+카테고리칩+리스트(변경 없음)
- 장바구니는 두 모드가 완전히 공유 (같은 `OrderCart`). 하단 "발주 내역 확인" 바는 모드 무관하게 항상 표시

## 데이터 모델

상품 카탈로그(388종: name/brand/price/barcode/imageUri)는 매장과 무관하게 공용이다. "이 매장 냉장고 어디에 뭘 두는지"만 매장마다 다르므로, 이를 상품 레코드가 아닌 별도 매장별 매핑으로 분리한다.

```ts
// order-types.ts
export interface Store {
  id: string;
  name: string; // 사용자가 직접 입력 (예: "강남점")
}

export type FridgeSection = '600바' | '100바콘류' | '1000바' | '샌드류';
export type FridgeAssignment = { productId: string; section: FridgeSection };
```

`OrderProduct`에는 필드를 추가하지 않는다 (기존 설계에서 `fridgeSection`을 상품에 직접 붙이려던 안은 매장 다중화 요구로 폐기).

### 저장 키 (order-repo.ts)

- `stores:v1` — `Store[]`
- `activeStoreId:v1` — 현재 선택된 매장 id
- `fridgeAssignments:{storeId}` — 그 매장의 `FridgeAssignment[]`
- `orderCart:{storeId}` — **기존 `orderCart:v1` 전역 키를 매장별로 분리**. 매장 전환 시 다른 장바구니를 불러온다.

카탈로그(`orderProducts:v1`)와 공용 카테고리(`orderCategories:v1`)는 매장과 무관하게 지금처럼 전역 유지.

### 공용 카탈로그 동기화와의 관계

`order-catalog-merge.ts`의 `mergeCatalogIntoProducts`는 `name/brand/price/category/imageUri` 5개 필드만 클라우드 값으로 덮어쓴다. `FridgeAssignment`는 상품 레코드가 아니라 별도 로컬 저장소라 동기화 로직과 아예 접점이 없다 — 오버라이드 보호 장치가 필요 없다.

## 상호작용

### 매장 선택

상단 "매장: OOO" 배지 탭 → 매장 목록 모달(추가/이름수정/삭제, 기존 카테고리 관리 Alert 패턴 재사용) → 선택 시 `activeStoreId` 갱신 + 해당 매장의 `fridgeAssignments`/`orderCart` 다시 로드.

### 타일 제스처 (하나로 통합)

같은 타일에서 세 동작을 구분한다:

| 동작 | 결과 |
|---|---|
| 짧게 탭 | 장바구니 +1 (수량 배지 표시) |
| 눌렀다가 움직임 없이 떼기 (롱프레스) | 시트 메뉴: 상태 변경 / 이 구역에서 빼기 |
| 누른 채로 다른 구역탭까지 끌어 놓기 | 그 구역으로 위치 이동 (드래그) |

- **이 구역에서 빼기**: 해당 `productId`의 `FridgeAssignment`를 현재 매장의 목록에서 제거. 상품 자체(카탈로그)는 삭제되지 않음
- **구역 간 드래그 이동**: `FridgeAssignment.section`을 드롭한 탭의 구역으로 변경
- 검색발주 쪽 리스트 행의 기존 롱프레스 메뉴(수정/상태변경/삭제)에는 **"냉장고 구역에 추가/변경"** 항목을 추가 — 4개 구역 중 선택하면 현재 매장의 `FridgeAssignment`에 추가/갱신

### 상태(단종/일시중지) 처리

기존 `OrderStatus`(`active`/`discontinued`/`paused`) 필드를 그대로 재사용 — 새 필드 없음.

- 그리드 표시 조건: `assignment.section === currentSection && product.status === 'active'`
- **일시 납품중지(paused)**: 그리드에서 자동 숨김. `FridgeAssignment`는 그대로 남아있어서, 나중에 상태를 다시 `active`로 바꾸면 별도 조작 없이 자동으로 재노출
- **단종(discontinued)**: 마찬가지로 자동 숨김. 완전히 자리를 비우고 싶으면 "이 구역에서 빼기"를 추가로 실행

### 빠른발주 검색 (위치 찾기)

- 검색창은 **현재 매장의 `FridgeAssignment`에 있고 상태가 active인 상품만** 대상으로 검색 (388종 전체가 아님). 기존 `searchOrderProducts`(초성/오타허용 포함 랭킹) 로직을 그대로 재사용하되 후보 목록만 좁힌다
- 검색 결과 드롭다운의 각 행에 위치 태그(예: "🧊 600바") 표시
- 결과를 탭하면: 그 상품이 속한 구역탭으로 자동 전환 + 검색창 비움 + 그리드에서 해당 타일이 잠깐 파랗게 깜빡여 위치를 알려줌 (담기는 별도로, 탭해야 함 — "찾기"와 "담기"를 분리)

## 재사용 vs 신규

**재사용**: `saveOrderProduct`/`OrderCart` 저장 함수들의 패턴(`order-repo.ts`), `searchOrderProducts`(`order-search.ts`), `Chip`/`Thumbnail` 컴포넌트, 기존 Alert 기반 롱프레스 메뉴 패턴, `OrderStatus` 필드, 낙관적 업데이트(`changeQty`) 패턴

**신규**: `Store`/`FridgeAssignment` 타입, 매장별 저장 키 구조(`order-repo.ts`에 함수 추가), `order.tsx`에 `mode` 세그먼트탭 + 구역탭 + 그리드 뷰 + 매장 선택 UI, 타일 통합 제스처(탭/롱프레스/드래그) 핸들러

## 보류/제외한 것

- **드래그 판정 UX 세부 튜닝**(홀드 시간, 이동 임계값, 실기기 손가락 기준 조정)은 구현 단계에서 실측 후 조정 필요 — 이 문서에서 확정하지 않음
- 매장별로 카탈로그 자체(가격 등)가 달라지는 경우는 다루지 않음 (현재 요구사항엔 없음, 필요해지면 별도 설계)
