# 발주 카탈로그 사진 크라우드 재활용 설계

**날짜:** 2026-08-31
**대상 프로젝트:** expiry-keeper

## 배경

발주 카탈로그 상품 중 사진이 없는 것도 많고, 잘못된 사진이 등록된 것도 많다.

기존 "정보 오류 신고" 경로(`reportOrderProductIssue`)는 관리자가 Supabase 대시보드에서 직접 확인한 뒤 `order-seed-data.ts`를 고쳐 **앱스토어 업데이트**로 반영해야 하는 무거운 절차라, 신고가 쌓여도 대응하기 현실적으로 부담이 크다.

반면 신규 상품 등록 제안(`submitNewOrderProduct`, `kind: 'new'`)은 이미 `status: 'approved'`로 즉시 저장되어, 각 사용자가 "Update" 버튼을 누르는 시점에 로컬 카탈로그로 반영된다 — **앱 업데이트가 필요 없는** 가벼운 배포 경로가 이미 존재한다.

사용자는 자기 발주상품을 편집하며 어차피 찍는 사진(현재는 로컬에만 저장되고 서버로 안 감)을 재활용해, 관리자의 사전 검토 없이 카탈로그의 빈 사진을 채우길 원한다.

## 범위

- **대상:** 바코드가 있는 발주 상품 중 카탈로그에 "사진이 없는" 상태를 채우는 것.
- **잘못된 사진은 자동으로 덮어쓰지 않는다.** 대신 크라우드 신고로 먼저 "사진 없음" 상태로 되돌리고, 같은 자동 채우기 루틴이 다시 채우게 한다 — "빈 칸 채우기" 하나의 메커니즘으로 "없음"과 "잘못됨" 두 문제를 함께 처리한다.
- 기존 "정보 오류 신고"(가격/바코드 등 자유 텍스트 신고)는 그대로 유지한다. 사람 판단이 필요한 항목이라 관리자 수동 검토 경로를 바꾸지 않는다.
- 사진 재활용은 사용자에게 별도 동의를 구하지 않는 완전 자동/무언 방식이다 (사용자 확정 사항).

## 아키텍처 / 데이터 흐름

```
[B: 자기 발주상품 편집, 사진 추가]
  saveOrderProduct() (기존 로컬 상품 수정 케이스)
    barcode 있음 && 이전에 사진 없었음 && 새 사진 생김
      → submitCatalogPhotoFill(barcode, photoUri)  [best-effort, 실패 무시]
        order_product_reports에 kind:'photo_fill', status:'approved' 즉시 삽입
        (기존 kind:'fix'는 RLS가 approved 자동 insert를 막아둔 관리자 승인 전용 경로라 재사용 불가.
         사진 전용 자동승인을 위해 별도 kind 도입)
        (name/brand/price/category는 비워서 전송 → 기존 병합 로직이 사진만 채움)

  ※ 신규 로컬 상품(isNew===true)에 처음부터 사진이 있는 경우는
    기존 submitNewOrderProduct(kind:'new')가 이미 처리 — 중복 로직 불필요

[C: Update 버튼]
  syncApprovedCatalogUpdates() (기존 그대로)
    미반영 approved 행을 당겨와 로컬 카탈로그에 반영, 앱 업데이트 불필요

[C: "사진이 실제 상품과 달라요" 신고]
  flagCatalogPhoto(barcode)
    order_photo_flags에 (barcode, reporter_id) upsert (동일 유저 중복 신고 무시)
    같은 요청 안에서 해당 barcode의 distinct reporter 수 조회
    임계치(기본 2명) 이상이면 order_product_reports에
      kind:'photo_fill', status:'approved', barcode, clear_photo:true 행 추가 삽입

[아무 기기: 다음 Update]
  syncApprovedCatalogUpdates()가 clear_photo:true 행을 만나면 imageUri를 null로 리셋
  → 이후 누군가 편집 시 위 첫 흐름이 다시 자연스럽게 채움
```

## 컴포넌트 상세

### Supabase (`supabase/migration-*.sql` — 기존 프로젝트 관례대로 트래킹된 SQL 파일)

기존 `migration-order-report-restrict-photo-url.sql`이 이미 `order_product_reports`의 insert 정책을
`status='pending' or (kind='new' and status='approved')`로 제한해뒀다 — `kind:'fix'`는 보안 리뷰로
관리자 승인 없는 자동 approved insert가 막혀 있다. 이 제한을 우회하지 않고, 사진 전용
자동승인 경로를 위한 **새 kind `'photo_fill'`**을 도입한다.

- `order_product_reports` 테이블에 컬럼 추가: `clear_photo boolean not null default false`
- insert 정책 갱신: `kind='photo_fill' and status='approved'`는 `name=''`, `brand`/`category`
  빈 값, `price is null`일 때만 허용 — photo_uri/clear_photo 외 필드를 절대 못 건드리게 해
  악의적 클라이언트가 이 자동승인 경로로 이름/가격을 몰래 덮어쓰는 걸 원천 차단
  (`kind='new'`에 이미 걸려있는 photo_uri 버킷 URL 제한과 같은 방어 패턴)
- 신규 테이블 `order_photo_flags`
  - `barcode text not null`
  - `reporter_id uuid not null default auth.uid()`
  - `created_at timestamptz not null default now()`
  - PK `(barcode, reporter_id)` — 동일 유저의 중복 신고를 자연히 무시
  - RLS: 로그인 유저 insert 허용, 조회 허용(카운트 조회용)

### `src/lib/order-report.ts` (수정)

- `submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void>`
  - 사진을 `order-report-images` 버킷에 업로드 후 `order_product_reports`에 `kind:'photo_fill', status:'approved', barcode, photo_uri, name:'', brand:'', price:null, category:''`로 삽입
  - `submitNewOrderProduct`와 동일하게 실패는 조용히 무시(best-effort)
- `flagCatalogPhoto(barcode: string): Promise<{ cleared: boolean }>`
  - 로그인 안 됐으면 에러 throw(기존 `reportOrderProductIssue`와 동일 UX로 "로그인 필요" 알럿 유도)
  - `order_photo_flags`에 upsert → distinct reporter 수 조회 → 임계치 이상이면 `clear_photo:true` 행 삽입 후 `{ cleared: true }` 반환, 아니면 `{ cleared: false }`

### `src/lib/order-repo.ts` (수정)

- `saveOrderProduct()`: 덮어쓰기 전 `items[idx]`의 기존 `imageUri` 유무를 기억해두고, 수정 케이스(`!isNew`)면서 `barcode` 있고 이전엔 사진 없었는데 새로 생겼으면 `submitCatalogPhotoFill(p.barcode, p.imageUri)` 호출(best-effort, `submitNewOrderProduct`와 같은 `.catch(() => {})` 패턴)
- `ApprovedReportRow` 타입에 `clear_photo: boolean | null` 필드 추가
- `ApprovedReportRow`의 `kind` 타입에 `'photo_fill'` 추가. `syncApprovedCatalogUpdates()`는 이미
  `kind === 'new'` 아니면 전부 같은 병합(else) 분기를 타므로 `'photo_fill'`도 별도 분기 없이
  자동으로 처리된다
- `syncApprovedCatalogUpdates()`의 `kind !== 'new'` 분기에서 `imageUri: row.clear_photo ? null : (row.photo_uri || items[idx].imageUri)`로 한 줄만 수정 — 나머지 필드 병합 로직은 그대로 재사용

### `src/app/order-product-form.tsx` (수정)

- 사진 영역 근처에 "사진이 실제 상품과 달라요" 텍스트 버튼 추가. `barcode`가 없으면 숨김(플래그는 바코드 매칭 기준이라 바코드 없인 무의미)
- 기존 "정보 오류 신고"(자유 텍스트, `showReport` 섹션)와는 별개 — 이 버튼은 사람 판단이 필요 없는 단순 신고라 즉시 자동 처리
- 클릭 시 확인 알럿 → `flagCatalogPhoto(barcode)` 호출 → 결과에 따라 "신고 접수" 또는 "반영되어 사진이 초기화됐습니다" 알럿

## 에러 처리

- `submitCatalogPhotoFill`, `flagCatalogPhoto`의 네트워크 실패는 로컬 저장/편집 흐름을 막지 않는다(best-effort, 기존 `submitNewOrderProduct` 패턴과 동일).
- `flagCatalogPhoto`를 비로그인 상태에서 호출하면 "로그인 필요" 알럿 (기존 정보 오류 신고와 동일한 UX 유지).

## 테스트

이 앱은 별도 자동화 테스트 스위트가 없는 수동 QA 앱이다(기존 관례 유지). 구현 후 아래 시나리오를 수동으로 확인한다.

1. 사진 없는 카탈로그 상품 A를 B가 편집해 사진 추가 → 저장 → Supabase `order_product_reports`에 `kind:'photo_fill', status:'approved'`이고 `photo_uri`가 있는 행이 생기는지 확인
2. C 기기에서 Update 버튼 → A 상품에 사진이 반영되고, 가격/이름 등 다른 필드는 그대로인지 확인
3. C가 "사진이 달라요" 1회 신고 → 아직 반영 안 됨(임계치 미달) 확인
4. D가 같은 상품을 신고(2번째 distinct reporter) → `clear_photo:true` 행이 생성되는지 확인
5. B/C 기기에서 Update → 해당 상품 사진이 다시 "없음" 상태로 리셋되는지 확인
6. 리셋 후 아무 사용자가 다시 사진을 추가 편집 → 1번부터 반복되어 재채움되는지 확인
