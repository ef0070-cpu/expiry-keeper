# 바코드 스캔 시 중복 등록 확인 화면 — 설계

## 배경

현재 바코드를 스캔해 상품을 등록하려면 유통기한까지 다 입력해야 화면(대시보드)에서 기존 등록 상품과 겹치는지 확인할 수 있다. 사용자는 유통기한을 정확히 기억하지 못하는 경우가 많아, 이미 등록된 상품을 또 새로 등록해버리는 일이 자주 생긴다. 특히 세일 상품을 살 때 기존 재고보다 유통기한이 더 짧은 걸 사는 경우도 있어, 등록 전에 기존 내역을 먼저 보고 싶어한다.

## 범위

- 바코드를 스캔했을 때(일반 등록 흐름), 같은 바코드로 이미 등록된 **보관중(active)** 상품이 있으면 유통기한 입력 전에 그 목록을 먼저 보여준다.
- 목록에서 항목을 탭하면 해당 상품의 수정 화면으로 이동한다.
- [취소]/[등록] 버튼으로 그대로 나가거나 새 상품 등록을 계속할 수 있다.
- 매칭되는 기존 상품이 없으면 지금과 동일하게 곧바로 등록 폼으로 진행한다 (동작 변화 없음).
- 홈 검색창의 바코드 스캔 검색 기능(별도 계획, `2026-08-25-barcode-search.md`)과는 독립적인 변경이며 서로 겹치지 않는다.

## 아키텍처 & 데이터 흐름

```
[scan.tsx, 일반 등록 모드] 바코드 스캔
    → Promise.all([lookupBarcode(data), listProductsByBarcode(data)])
    → matches.length > 0 이면
        router.replace('/product-duplicates', { barcode, prefillName, prefillImage })
      아니면 (기존과 동일)
        router.replace('/product-form', { barcode, prefillName, prefillImage })

[product-duplicates.tsx] (신규 화면)
    → mount 시 listProductsByBarcode(barcode) 재조회
      (재조회 결과 0건이면 경합 방지로 즉시 '/product-form'으로 replace)
    → 매칭 상품을 기존 ProductCard 컴포넌트로 나열
        - 탭 → router.push('/product-form', { id }) (해당 상품 수정)
        - onLongPress → no-op
    → 하단 버튼
        - [취소] → router.replace('/')
        - [등록] → router.replace('/product-form', { barcode, prefillName, prefillImage })
```

## 컴포넌트 변경 범위

### `src/lib/repo.ts`
- `listProductsByBarcode(barcode: string): Promise<Product[]>` 추가
  - 클라우드 모드: `supabase.from('products').select('*').eq('barcode', barcode).eq('status', 'active')`
  - 로컬 모드: `localList()`를 barcode + `status === 'active'`로 필터링
  - 양쪽 다 `expiryDate` 오름차순 정렬 (임박한 것부터)

### `src/app/scan.tsx`
- 일반(등록) 모드 분기에서 `lookupBarcode(data)`와 `listProductsByBarcode(data)`를 `Promise.all`로 병렬 조회
- 매칭 있으면 `/product-duplicates`로, 없으면 기존과 동일하게 `/product-form`으로 `router.replace`
- 검색 모드(`mode=search`, 이미 별도 계획으로 구현됨) 분기는 변경하지 않음

### `src/app/product-duplicates.tsx` (신규)
- 파라미터: `barcode`, `prefillName`, `prefillImage`
- mount 시 `listProductsByBarcode(barcode)` 재조회 → 0건이면 즉시 `/product-form`으로 `router.replace`
- 매칭 상품 리스트를 기존 `ProductCard`로 렌더링 (D-day 뱃지·카테고리 칩·이미지 등 신규 UI 없이 그대로 재사용)
- 하단 [취소] / [등록] 버튼

## 에러 처리

`listProductsByBarcode` 실패 시 빈 배열을 반환한다 (기존 `lookupBarcode`의 조용한 실패 패턴과 동일). 매칭 0건과 동일하게 처리되어 바로 `product-form`으로 넘어가며, 별도 에러 알럿은 띄우지 않는다.

## 상태 필터링

소진/폐기 처리된 과거 이력은 목록에 포함하지 않는다 (`status === 'active'`만). 이미 다 쓰거나 버린 상품은 "재고 중복"이 아니므로 제외한다.

## 테스트

이 저장소엔 테스트 프레임워크가 없다(jest/vitest 미설정). 기존 관례대로 `npx tsc --noEmit` 타입체크 + 실기기/에뮬레이터 수동 QA로 검증한다:

1. 이미 등록된(보관중) 상품의 바코드를 스캔 → 중복 확인 화면이 뜨고 해당 상품이 목록에 나타난다 → 카드 탭 → 그 상품의 수정 화면으로 이동한다
2. 중복 확인 화면에서 [등록] → 기존과 동일하게 이름/사진이 prefill된 등록 폼으로 이동한다
3. 중복 확인 화면에서 [취소] → 홈 화면으로 이동하고 아무것도 등록되지 않는다
4. 처음 스캔하는(미등록) 바코드 → 중복 확인 화면 없이 곧바로 등록 폼으로 진행한다 (기존 동작 유지)
5. 소진/폐기 처리된 상품만 있는 바코드를 스캔 → 중복 확인 화면이 뜨지 않고 곧바로 등록 폼으로 진행한다
