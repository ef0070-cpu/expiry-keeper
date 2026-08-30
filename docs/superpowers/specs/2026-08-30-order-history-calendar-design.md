# 발주 완료 내역 캘린더 저장 Design

**Status:** Approved
**Date:** 2026-08-30
**Base:** main (`docs/superpowers/specs/2026-08-27-order-feature-enhancements-design.md`까지 반영된 상태)

## 배경

발주(order) 화면에서 "공유하기"를 눌러 카카오톡/문자 등으로 발주 내역을 전송했을 때, 그 사실이 앱 어디에도 기록되지 않는다. 언제 어떤 매장에 무엇을 얼마나 발주했는지 나중에 돌아볼 방법이 없다. 이번 스펙은 발주 전송이 끝난 시점에 그 내역을 기기에 저장하고, 기존 `calendar.tsx` 화면에서 날짜별로 확인할 수 있게 한다.

## Global Constraints

- 발주 내역은 **기기 로컬 `AsyncStorage`에만** 저장한다. 발주 카탈로그/카테고리/장바구니와 동일한 저장 범위이며, 이번 변경으로 Supabase 테이블을 새로 추가하지 않는다.
- 이 프로젝트에는 자동 테스트 러너가 없다. 타입 검증은 `npx tsc --noEmit`으로 하고, 날짜별 그룹핑처럼 분기가 있는 순수 로직은 `korean-search.selfcheck.ts`와 같은 패턴의 자가검증 스크립트를 둔다.
- 새 UI 컴포넌트 라이브러리나 캘린더 라이브러리를 추가하지 않는다 — 기존 `calendar.tsx`의 달력 그리드/점 표시 구조를 그대로 확장한다.

---

## 1. 데이터 모델 — `src/lib/order-types.ts`

```ts
export interface OrderHistoryEntry {
  id: string;          // uuid
  dateKey: string;      // YYYY-MM-DD (전송한 날짜, 캘린더 그룹핑 키)
  sentAt: string;        // ISO timestamp (정렬/표시용)
  branch: string;        // 발주 매장명 (order-cart.tsx의 selectedBranch)
  items: { productId: string; name: string; qty: number }[];
  totalBoxes: number;    // items의 qty 합 (표시용으로 미리 계산해 저장)
}
```

`dateKey`는 `sentAt`에서 파생 가능하지만, 캘린더 그룹핑에서 매번 문자열을 슬라이스하지 않도록 저장 시점에 한 번 계산해서 같이 넣는다.

## 2. 저장소 — `src/lib/order-repo.ts`

```ts
const HISTORY_KEY = 'order_history_v1';

export async function listOrderHistory(): Promise<OrderHistoryEntry[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  return raw ? (JSON.parse(raw) as OrderHistoryEntry[]) : [];
}

export async function saveOrderHistory(entry: OrderHistoryEntry): Promise<void> {
  const items = await listOrderHistory();
  items.push(entry);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

export async function deleteOrderHistory(id: string): Promise<void> {
  const items = (await listOrderHistory()).filter((e) => e.id !== id);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}
```

기존 `getOrderCart`/`writeOrderCart` 등과 같은 파일, 같은 스타일(단순 read-modify-write, 동시성 걱정 없음 — 발주 완료는 사용자가 화면에서 순차적으로만 트리거함).

## 3. 저장 트리거 — `src/app/order-cart.tsx`의 `share()`

```ts
const share = async () => {
  if (!selectedBranch) {
    Alert.alert('매장 없음', '재고관리 화면에서 매장(카테고리)을 먼저 등록해 주세요.');
    return;
  }
  const text = buildOrderShareText(cart, products, selectedBranch, new Date());
  try {
    const result = await Share.share({ message: text });
    if (result.action === Share.sharedAction) {
      await saveOrderHistory({
        id: String(Date.now()),
        dateKey: todayStr(), // src/lib/dates.ts, calendar.tsx도 이미 사용 중
        sentAt: new Date().toISOString(),
        branch: selectedBranch,
        items: items.map((it) => ({ productId: it.product.id, name: it.product.name, qty: it.qty })),
        totalBoxes: total,
      });
      await clearOrderCart();
      setCart({});
    }
  } catch (e) {
    Alert.alert('공유 실패', e instanceof Error ? e.message : '알 수 없는 오류');
  }
};
```

**동작 정리:**
- `Share.share()`가 `sharedAction`으로 resolve됐을 때만 저장 + 장바구니 비움.
- `dismissedAction`(취소)이면 아무 것도 안 하고 장바구니도 그대로 유지 — 사용자가 다시 시도할 수 있음.
- **플랫폼 차이 참고**: iOS는 사용자가 실제로 공유 대상을 선택/완료해야 `sharedAction`을 반환하지만, Android는 공유 시트를 띄우는 시점에 `sharedAction`을 즉시 반환하는 경우가 많아 "실제 전송 여부"보다는 "공유 버튼을 눌러 진행했다"에 가깝게 동작한다. 이번 스펙에서는 이 차이를 그대로 받아들인다(별도 확인 다이얼로그를 추가하지 않기로 이미 결정됨).
- 저장(`saveOrderHistory`) 자체가 실패해도(AsyncStorage 오류 등) 이미 공유는 끝난 뒤이므로 별도 알림 없이 무시한다 — 기존 `writeOrderCart(next).catch(() => {})`와 동일한 정책.

## 4. 캘린더 화면 — `src/app/calendar.tsx`

### 4.1 데이터 로드
`load()`에서 `listProducts()`와 함께 `listOrderHistory()`도 병렬로 불러와 `orderHistory` state에 저장.

### 4.2 날짜별 점 표시 (일 모드)
기존 `byDate`(유통기한 상품 맵)와 별도로 `orderDatesSet`(발주 내역이 있는 `dateKey`의 `Set<string>`)을 만든다. 일 모드 달력 셀에서, 기존 유통기한 점 줄 아래에 그 날짜가 `orderDatesSet`에 있으면 작은 점 하나를 추가로 찍는다(보라색 계열, 기존 4색 — 검정/빨강/주황/초록 — 과 겹치지 않는 색).

### 4.3 하단 목록 — 선택된 날짜의 발주 내역
`mode === 'day'`이고 `selectedDay`에 해당하는 `orderHistory` 항목이 있으면, 기존 "유통기한 상품" 리스트 **위에** 별도 섹션을 추가로 렌더링:

- 헤더: "발주 내역" + 매장명 + 시각(`sentAt`을 HH:mm으로 포맷)
- 품목 리스트: `{name} × {qty}` 형태로 나열
- 롱프레스 시 `Alert.alert`로 삭제 확인 (기존 `confirmDelete` 패턴과 동일하게, 오기록 삭제용)

월/년 모드에서는 발주 내역을 별도로 집계하지 않는다(범위 제외 — 아래 참고).

## 범위 제외 (이번엔 안 함)

- 월/년 모드 달력 그리드에 발주 건수 표시 안 함 — 일 모드에서만 확인 가능.
- 발주 내역 수정(품목/수량 변경) 기능 없음 — 삭제만 가능.
- 발주 내역을 다시 장바구니로 복원("재발주") 기능 없음.
- Supabase 동기화 없음 — 기기를 바꾸면 발주 내역은 승계되지 않는다(이미 승인된 제약).

## 컴포넌트/파일 변경 요약

| 파일 | 변경 |
|---|---|
| `src/lib/order-types.ts` | `OrderHistoryEntry` 타입 추가 |
| `src/lib/order-repo.ts` | `listOrderHistory`/`saveOrderHistory`/`deleteOrderHistory` 추가 |
| `src/app/order-cart.tsx` | `share()`에서 전송 성공 시 내역 저장 + 장바구니 자동 비움 |
| `src/app/calendar.tsx` | 발주 내역 로드, 일 모드 점 추가, 선택 날짜 발주 내역 섹션 추가 |

새로 만드는 파일: `src/lib/order-history.selfcheck.ts`(저장/조회/삭제, 날짜별 그룹핑 자가검증). 새 의존성 없음. Supabase 스키마 변경 없음.

## 테스트 방침

`npx tsc --noEmit`로 타입 에러 확인. `order-history.selfcheck.ts`로 저장/조회/삭제 및 `dateKey` 그룹핑 로직을 자가검증(패턴은 `korean-search.selfcheck.ts` 참고). 캘린더 점 표시·하단 섹션·공유 플로우는 실기기/에뮬레이터에서 수동 확인한다.
