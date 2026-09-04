# 발주 카탈로그 Supabase 기준 소스 전환 설계

**날짜:** 2026-09-02
**대상 프로젝트:** expiry-keeper

## 배경

지금 발주 카탈로그(바코드별 이름/브랜드/가격/카테고리/사진)의 "정답"은 앱 코드(`order-seed-data.ts`, 388개 하드코딩)이고, 설치 이후엔 각 사용자 로컬(AsyncStorage)에만 존재한다. 사용자가 오류를 신고하면 `order_product_reports`에 쌓이고, 관리자가 Supabase 대시보드에서 승인해도 **다른 사용자가 "Update" 버튼을 직접 눌러야만** 자기 로컬에 반영된다.

이 방식엔 두 가지 문제가 실제로 확인됐다.

1. 관리자가 승인해도 사용자가 버튼을 안 누르면 반영이 안 된다 — "뿌려준다"는 기대와 다르다.
2. `syncApprovedCatalogUpdates()`는 승인된 신고의 바코드가 해당 사용자 로컬 목록에 없으면 **조용히 스킵하면서도 "반영 완료"로 기록**해버려, 그 사용자에게는 영구히 반영되지 않는다 (`order-repo.ts` 기존 코드).

Supabase를 진짜 "기준 소스"로 삼아, 관리자가 승인하면 별도 사용자 행동 없이 전체에 전파되도록 구조를 바꾼다.

## 범위

- **대상 필드:** `name`, `brand`, `price`, `category`, `image_uri` — 바코드로 식별되는 공용 카탈로그 정보. 사용자별 개인화 데이터(카트 수량, 발주 내역 등)는 이 변경과 무관.
- 기존 388개 시드 데이터를 신규 테이블로 1회 이관한다.
- 기존 신고 접수 흐름(`order-product-form.tsx`의 "정보 오류 신고", "사진이 실제 상품과 달라요", 저작권 신고, `order_product_reports`/`order_photo_flags` 테이블)은 **그대로 유지** — 이 설계는 "승인된 신고가 어떻게 전체에 반영되는가"만 바꾼다.
- **"Update" 버튼과 대기건수 배지, 적용 이력 추적(`appliedCatalogUpdateIds`)은 완전히 제거한다.** 동기화는 앱 실행 시 + 발주 화면 진입 시 자동 실행되며, 사용자가 수동으로 당겨올 필요가 없어지기 때문.
- 오프라인/비로그인 상태에서도 마지막으로 받아온 로컬 캐시로 계속 조회 가능해야 한다(온라인이면 자동 새로고침, 실패하면 조용히 기존 캐시 유지).
- 동기화 시 공용 필드는 **Supabase 값이 항상 이긴다** (사용자가 로컬에서 직접 고친 값이라도 다음 동기화 때 덮어써짐) — 공용 정보는 "모두에게 같아야 하는 값"이라는 전제.
- **사용자가 직접 삭제한 상품은 동기화로 재생성되지 않는다** — 로컬에 삭제 기록(바코드 목록)을 남겨 동기화 시 제외한다.

## 아키텍처 / 데이터 흐름

```
[관리자 승인 또는 기존 자동승인 경로]
  order_product_reports.status → 'approved' (INSERT 또는 UPDATE)
    ↓ (DB 트리거, SECURITY DEFINER)
  order_catalog 테이블에 바코드 기준 upsert
    kind='fix'  → 값이 채워진 필드만 갱신 (빈 필드는 기존 유지)
    kind='new'  → 신규 행 삽입(이미 있으면 갱신)
    kind='photo_fill', clear_photo=true → image_uri를 null로

[앱: 실행 시 + 발주 화면 진입 시]
  syncOrderCatalog()
    order_catalog 전체 select
      → 로컬 캐시(AsyncStorage) 갱신
      → 로컬 발주 상품 목록과 바코드 매칭
          있음: name/brand/price/category/imageUri를 Supabase 값으로 덮어씀
          없음 && removedOrderBarcodes에 없음: 신규 상품으로 추가
          없음 && removedOrderBarcodes에 있음: 스킵(사용자가 지운 상품)
      실패(오프라인 등): 조용히 무시, 기존 로컬 상태 유지

[사용자: 상품 삭제]
  deleteOrderProduct(id)
    기존 로컬 삭제 로직 + barcode를 removedOrderBarcodes에 기록
```

## 컴포넌트 상세

### Supabase 스키마 (신규 `supabase/migration-order-catalog-source.sql`)

```sql
create table if not exists public.order_catalog (
  barcode text primary key,
  name text not null,
  brand text,
  price numeric,
  category text,
  image_uri text,
  updated_at timestamptz not null default now()
);

alter table public.order_catalog enable row level security;

-- 읽기는 로그인 여부와 무관하게 전체 공개 (비민감 카탈로그 정보, 비로그인/오프라인 대비 온라인 새로고침도 가능해야 함)
create policy "order_catalog select all" on public.order_catalog
  for select using (true);

-- insert/update/delete 정책을 만들지 않는다 — 일반 클라이언트는 직접 못 쓰고,
-- 아래 SECURITY DEFINER 트리거 함수만 RLS를 우회해 쓸 수 있다.

create or replace function public.apply_approved_order_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'approved' or new.barcode is null then
    return new;
  end if;

  insert into public.order_catalog (barcode, name, brand, price, category, image_uri, updated_at)
  values (
    new.barcode,
    nullif(new.name, ''),
    nullif(new.brand, ''),
    new.price,
    nullif(new.category, ''),
    case when new.clear_photo then null else new.photo_uri end,
    now()
  )
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    brand = coalesce(nullif(excluded.brand, ''), order_catalog.brand),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    image_uri = case when new.clear_photo then null else coalesce(excluded.image_uri, order_catalog.image_uri) end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists order_product_reports_apply_approved on public.order_product_reports;
create trigger order_product_reports_apply_approved
  after insert or update of status on public.order_product_reports
  for each row
  when (new.status = 'approved')
  execute function public.apply_approved_order_report();
```

- `insert.new.name`이 빈 문자열인 경우(`kind='photo_fill'`처럼 사진 외 필드를 비워 보내는 기존 관례)는 `nullif`로 걸러 기존 카탈로그 값을 보존한다 — `photo_fill` 신고가 이름/가격을 지워버리는 일이 없도록.
- 트리거가 실패하면(제약조건 위반 등) 원래의 INSERT/UPDATE 자체가 롤백된다 — Postgres 트리거 기본 동작이라 별도 예외처리 불필요.

### 388개 기존 시드 이관 (1회성)

`order-seed-data.ts`를 읽어 388개 `insert into order_catalog (...) values (...) on conflict (barcode) do nothing;` 구문을 생성해 별도 SQL 파일(`supabase/migration-order-catalog-seed.sql`)로 만든다. 대시보드 SQL Editor에서 위 스키마 마이그레이션 다음에 1회 실행.

### `src/lib/order-repo.ts` (수정)

- 제거: `fetchUnappliedApprovedRows`, `syncApprovedCatalogUpdates`, `countApprovedCatalogUpdates`, `ApprovedReportRow` 타입, `APPLIED_UPDATES_KEY` 관련 코드.
- 추가: `REMOVED_BARCODES_KEY = 'removedOrderBarcodes:v1'`.
- `deleteOrderProduct(id)`: 삭제 대상의 `barcode`가 있으면 `removedOrderBarcodes` 목록에 추가.
- 신규 `syncOrderCatalog(): Promise<void>`:
  - `supabase`가 없으면 즉시 반환(오프라인/비클라우드 빌드).
  - `order_catalog` 전체 select → 실패 시 catch로 조용히 무시.
  - 성공 시: 로컬 `listOrderProducts()`와 바코드로 매칭
    - 매칭됨: 공용 필드(`name`/`brand`/`price`/`category`/`imageUri`)를 카탈로그 값으로 덮어씀
    - 매칭 안 되고 `removedOrderBarcodes`에 없음: 신규 상품으로 추가(`status: 'active'`)
    - 매칭 안 되고 `removedOrderBarcodes`에 있음: 스킵
  - 변경 있으면 `writeOrderProducts()`로 저장.
- `seedDefaultOrderProducts()`: 로직 변경 없음 — 최초 실행 시 네트워크가 없어도 뜨는 오프라인 폴백으로 계속 사용. 이후 `syncOrderCatalog()`가 온라인이 되면 자동으로 최신값을 덮어쓴다.

### 앱 화면 (수정)

- `src/app/order.tsx`: `pendingUpdateCount` state, "Update" 버튼 UI(`onUpdate`, 배지 텍스트), `countApprovedCatalogUpdates`/`syncApprovedCatalogUpdates` import 전부 제거. 화면 진입 `useEffect`에서 `syncOrderCatalog()` 호출 추가(백그라운드, 실패해도 화면 렌더링 막지 않음).
- 앱 루트(`src/app/_layout.tsx`): 앱 실행 시 1회 `syncOrderCatalog()` 호출 추가(다른 화면 진입 전에 미리 최신화).
- `order-product-form.tsx`, `order-report.ts`, `order_photo_flags` 관련 로직: **변경 없음.** 신고 접수 방식은 그대로이고, 승인 이후 전파 경로만 트리거로 바뀐다.

## 마이그레이션 절차 (실행 순서)

1. `supabase/migration-order-catalog-source.sql` (테이블/RLS/트리거) 대시보드 SQL Editor에서 실행
2. `supabase/migration-order-catalog-seed.sql` (388개 초기 데이터) 실행
3. 앱 코드 변경 배포
4. 기존 `pending` 상태로 쌓여 있던 신고 중 이미 육안으로 검토된 것이 있다면, 이번 기회에 대시보드에서 `approved`로 일괄 처리해 트리거가 `order_catalog`에 반영하게 함(선택 사항)

## 에러 처리

- `syncOrderCatalog()` 네트워크 실패: 조용히 무시, 마지막 로컬 캐시 그대로 사용 (앱 실행/화면 진입을 막지 않음).
- 트리거 함수 예외: 해당 승인 UPDATE/INSERT 자체가 롤백되어 관리자가 대시보드에서 바로 실패를 인지할 수 있음(승인이 "된 것처럼 보이지만 반영 안 되는" 상황 방지).
- `order_catalog` select 정책이 공개(`using (true)`)라 비로그인 상태에서도 온라인이면 동기화 가능.

## 테스트

이 앱은 자동화 테스트 스위트가 없는 수동 QA 앱이다(기존 관례 유지). 구현 후 아래 시나리오를 수동으로 확인한다.

1. 관리자가 대시보드에서 `order_product_reports`의 `pending` 신고를 `approved`로 변경 → `order_catalog`에서 해당 바코드 행이 즉시 갱신되는지 확인(대시보드에서 직접 확인)
2. 다른 기기(B)에서 앱을 껐다 켬 → 별도 버튼 없이 해당 상품의 가격/이름이 자동으로 바뀌어 있는지 확인
3. B 기기에서 발주 화면을 나갔다가 다시 들어감(재실행 없이) → 화면 진입 시에도 최신화되는지 확인
4. B 기기가 오프라인 상태에서 발주 화면 진입 → 에러 없이 마지막 캐시값으로 정상 표시되는지 확인
5. B가 특정 상품을 로컬에서 삭제 → 이후 동기화(관리자가 그 상품과 무관한 다른 신고를 승인해도)에도 삭제한 상품이 다시 생기지 않는지 확인
6. 신규 상품 등록(`kind='new'`) 흐름 → 다른 기기에서 앱 재실행만으로 새 상품이 자동으로 목록에 추가되는지 확인
7. "사진이 실제 상품과 달라요" 임계치(2명) 신고 → 트리거를 거쳐 `order_catalog.image_uri`가 null이 되고, 다른 기기 재실행 시 사진이 사라지는지 확인
