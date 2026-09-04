# 발주 카탈로그 사진 크라우드 재활용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 카탈로그에서 사진이 없는 상품을, 사용자가 자기 발주상품을 편집하며 이미 찍는 사진으로 관리자 검토 없이 자동으로 채우고, 잘못된 사진은 크라우드 신고 2건으로 자동 초기화한다.

**Architecture:** 기존 신규 상품 자동승인 파이프라인(`order_product_reports`, `status:'approved'` → 각 기기의 "Update" 버튼이 pull)을 그대로 재사용하되, RLS가 `kind:'fix'`의 자동승인을 막아두고 있어(보안 리뷰 결과) 사진 전용 자동승인에는 새 `kind:'photo_fill'`을 쓴다. 새 테이블 `order_photo_flags`로 신고를 집계하고, 임계치 도달 시 같은 `order_product_reports` 파이프라인에 `clear_photo:true` 행을 얹어 사진을 초기화한다. 새 백엔드 함수/트리거 없이 클라이언트 코드만으로 구현한다.

**Tech Stack:** React Native (Expo), TypeScript, Supabase (Postgres + JS 클라이언트), AsyncStorage.

## Global Constraints

- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱이다(design spec §테스트). 각 태스크는 자동 테스트 대신 **구체적인 수동 확인 절차**로 검증한다.
- 사진 재활용은 사용자 동의 없이 완전 자동으로 동작한다(design spec §범위, 사용자 확정 사항).
- "잘못된 사진"은 절대 자동으로 덮어쓰지 않는다 — 신고 임계치 도달 시에만 "사진 없음"으로 초기화하고, 재채움은 §범위에 정의된 자동 채우기 루틴이 다시 담당한다.
- 신규 네트워크 호출(`submitCatalogPhotoFill`)은 best-effort다 — 실패해도 로컬 저장/편집 흐름을 절대 막지 않는다.
- 참조 설계서: `docs/superpowers/specs/2026-08-31-order-catalog-photo-reuse-design.md`

---

### Task 1: Supabase 스키마 준비

**중요 (설계 수정):** 기존 `supabase/migration-order-report-restrict-photo-url.sql`이
`order_product_reports`의 insert 정책을 `status='pending' or (kind='new' and status='approved')`로
이미 제한해뒀다 — `kind='fix'`는 보안 리뷰로 관리자 승인 없는 자동 `status='approved'` insert가
막혀 있다. 이 정책을 우회하지 않고, 사진 전용 자동승인 경로를 위한 **새 kind `'photo_fill'`**을
쓴다. Task 2·3·5는 전부 `kind:'fix'`가 아니라 `kind:'photo_fill'`을 사용한다.

**Files:**
- Create: `supabase/migration-order-catalog-photo-reuse.sql` (기존 `supabase/migration-*.sql` 파일들과 동일한 관례 — 대시보드에서 수동 실행하는 트래킹된 SQL 파일)

**Interfaces:**
- Produces: 이후 태스크가 사용할 테이블/컬럼/kind 값
  - `order_photo_flags(barcode text, reporter_id uuid default auth.uid(), created_at timestamptz default now(), primary key(barcode, reporter_id))`
  - `order_product_reports.clear_photo boolean default false`
  - 새 kind 값 `'photo_fill'` — `status='approved'` insert가 `name=''`, `brand`/`category` 빈 값, `price is null`, `message is null`일 때만 허용됨(다른 필드 몰래 덮어쓰기 방지)

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migration-order-catalog-photo-reuse.sql` 신규 생성:

```sql
-- 발주 카탈로그 사진 크라우드 재활용 (2026-08-31)
-- 사용자가 자기 발주상품을 편집하며 추가한 사진을, 카탈로그에 사진이 없던 항목에 한해
-- 관리자 승인 없이 즉시 반영한다. 기존 kind='fix'(정보 오류 신고)는 여전히 관리자 승인이
-- 필요하므로(migration-order-report-restrict-photo-url.sql 참고), 사진 전용 자동승인
-- 경로를 별도 kind='photo_fill'로 분리한다. 악의적인 클라이언트가 kind='photo_fill'을
-- 사칭해 이름/가격 등 다른 필드까지 검토 없이 밀어넣지 못하도록, 이 kind는 photo_uri/
-- clear_photo 외 필드가 전부 비어 있을 때만 status='approved' insert를 허용한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- (order_product_reports, order-report-images 버킷은 이미 존재해야 함)

alter table public.order_product_reports
  add column if not exists clear_photo boolean not null default false;

drop policy if exists "order_product_reports insert" on public.order_product_reports;
create policy "order_product_reports insert" on public.order_product_reports
  for insert to authenticated
  with check (
    (
      status = 'pending'
      or (kind = 'new' and status = 'approved')
      or (
        kind = 'photo_fill' and status = 'approved'
        and name = '' and (brand is null or brand = '') and price is null
        and (category is null or category = '') and message is null
        and not (photo_uri is not null and clear_photo = true)
      )
    )
    and (
      photo_uri is null
      or photo_uri like 'https://ocbwjiziwzkgkwzzkvvf.supabase.co/storage/v1/object/public/order-report-images/%'
    )
  );

create table if not exists public.order_photo_flags (
  barcode text not null,
  reporter_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (barcode, reporter_id)
);

alter table public.order_photo_flags enable row level security;

drop policy if exists "order_photo_flags insert" on public.order_photo_flags;
create policy "order_photo_flags insert" on public.order_photo_flags
  for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "order_photo_flags select" on public.order_photo_flags;
create policy "order_photo_flags select" on public.order_photo_flags
  for select to authenticated using (true);
```

- [ ] **Step 2: Supabase 대시보드에서 실행**

Supabase 대시보드 → SQL Editor에 Step 1의 SQL 전체를 붙여넣고 실행.

- [ ] **Step 3: 수동 확인**

SQL Editor에서 아래를 실행해 에러 없이 성공하는지 확인:

```sql
select * from order_photo_flags limit 1;
select clear_photo from order_product_reports limit 1;
insert into order_product_reports (kind, status, name, photo_uri, clear_photo)
values ('photo_fill', 'approved', '', null, true);
select id from order_product_reports where kind = 'photo_fill' order by created_at desc limit 1;
delete from order_product_reports where kind = 'photo_fill';
```

빈 결과/성공만 나오면 통과 (마지막 insert가 성공한다는 건 새 정책이 photo_fill 자동승인을 실제로 허용한다는 뜻).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migration-order-catalog-photo-reuse.sql
git commit -m "feat: 카탈로그 사진 재활용용 Supabase 스키마 마이그레이션 추가"
```

---

### Task 2: `submitCatalogPhotoFill` — 사진 자동 채우기 제출 함수

**Files:**
- Modify: `expiry-keeper/src/lib/order-report.ts`

**Interfaces:**
- Consumes: `supabase` (`./supabase`), `uploadPhotoToBucket` (`./storage`) — 파일 상단에 이미 import돼 있음
- Produces: `submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void>` — Task 4(`order-repo.ts`)가 이 시그니처로 호출

- [ ] **Step 1: 함수 추가**

`expiry-keeper/src/lib/order-report.ts`의 `submitNewOrderProduct` 함수 바로 뒤(파일 끝, 58번째 줄 `}` 다음)에 추가:

```ts

/**
 * 바코드 카탈로그에 아직 사진이 없는 상품에, 사용자가 자기 발주상품을 편집하며 추가한 사진을
 * 관리자 검토 없이 즉시 반영되는 카탈로그 수정 제안(kind:'photo_fill')으로 접수한다.
 * kind:'fix'(정보 오류 신고)는 RLS가 자동승인 insert를 막아둔 관리자 승인 전용 경로라 재사용할 수 없다.
 * name/brand/price/category는 비워 보내 기존 병합 로직(syncApprovedCatalogUpdates)이
 * 사진 외 다른 필드를 건드리지 않도록 한다. best-effort — 실패해도 로컬 저장 흐름을 막지 않는다.
 */
export async function submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void> {
  if (!supabase) return;
  try {
    const photoUrl = await uploadReportPhoto(photoUri);
    if (!photoUrl) return;
    await supabase.from('order_product_reports').insert({
      kind: 'photo_fill',
      status: 'approved',
      barcode,
      name: '',
      brand: '',
      price: null,
      category: '',
      photo_uri: photoUrl,
    });
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd expiry-keeper && npx tsc --noEmit`
Expected: 기존 에러 외에 `order-report.ts` 관련 새 에러 없음.

- [ ] **Step 3: 수동 확인**

`node -e` 등으로 실행할 필요 없음 — Task 4에서 실제 호출 경로가 연결된 뒤 통합 확인(design spec §테스트 1번)으로 검증한다. 지금은 타입 체크 통과로 충분.

- [ ] **Step 4: 커밋**

```bash
git add expiry-keeper/src/lib/order-report.ts
git commit -m "feat: 카탈로그 사진 자동 채우기 제출 함수 추가"
```

---

### Task 3: `flagCatalogPhoto` — 잘못된 사진 신고/자동 초기화 함수

**Files:**
- Modify: `expiry-keeper/src/lib/order-report.ts`

**Interfaces:**
- Consumes: `supabase` (`./supabase`) — 이미 import돼 있음
- Produces: `flagCatalogPhoto(barcode: string): Promise<{ cleared: boolean }>` — Task 6(`order-product-form.tsx`)가 이 시그니처로 호출

- [ ] **Step 1: 함수 추가**

`expiry-keeper/src/lib/order-report.ts` 맨 끝(Task 2에서 추가한 `submitCatalogPhotoFill` 뒤)에 추가:

```ts

const PHOTO_FLAG_THRESHOLD = 2;

/**
 * 카탈로그 사진이 실제 상품과 다르다는 신고를 접수한다.
 * 같은 바코드를 서로 다른 사용자 PHOTO_FLAG_THRESHOLD명 이상이 신고하면
 * 관리자 검토 없이 즉시 사진을 초기화(clear_photo:true)한다.
 * order_photo_flags의 PK가 (barcode, reporter_id)라 동일 유저의 중복 신고는 upsert로 자동 무시된다.
 */
export async function flagCatalogPhoto(barcode: string): Promise<{ cleared: boolean }> {
  if (!supabase) throw new Error('로그인이 필요합니다.');

  const { error: insertError } = await supabase
    .from('order_photo_flags')
    .upsert({ barcode }, { onConflict: 'barcode,reporter_id' });
  if (insertError) throw insertError;

  const { count, error: countError } = await supabase
    .from('order_photo_flags')
    .select('reporter_id', { count: 'exact', head: true })
    .eq('barcode', barcode);
  if (countError) throw countError;
  if ((count ?? 0) < PHOTO_FLAG_THRESHOLD) return { cleared: false };

  const { error: clearError } = await supabase.from('order_product_reports').insert({
    kind: 'photo_fill',
    status: 'approved',
    barcode,
    name: '',
    brand: '',
    price: null,
    category: '',
    photo_uri: null,
    clear_photo: true,
  });
  if (clearError) throw clearError;
  return { cleared: true };
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd expiry-keeper && npx tsc --noEmit`
Expected: 새 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add expiry-keeper/src/lib/order-report.ts
git commit -m "feat: 카탈로그 사진 신고 및 임계치 자동 초기화 함수 추가"
```

---

### Task 4: `saveOrderProduct`에 자동 채우기 훅 연결

**Files:**
- Modify: `expiry-keeper/src/lib/order-repo.ts:1-4` (import), `expiry-keeper/src/lib/order-repo.ts:44-54` (`saveOrderProduct`)

**Interfaces:**
- Consumes: `submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void>` (Task 2에서 정의)
- Produces: 변경 없음 — `saveOrderProduct`의 외부 시그니처(`(p: OrderProduct) => Promise<OrderProduct>`)는 그대로 유지

- [ ] **Step 1: import 추가**

`expiry-keeper/src/lib/order-repo.ts` 3번째 줄:

```ts
import { submitNewOrderProduct } from './order-report';
```

를 아래로 교체:

```ts
import { submitCatalogPhotoFill, submitNewOrderProduct } from './order-report';
```

- [ ] **Step 2: `saveOrderProduct` 수정**

현재 코드(44-54번째 줄):

```ts
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) submitNewOrderProduct(p).catch(() => {});
  return p;
}
```

아래로 교체:

```ts
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const hadNoPhoto = !isNew && !items[idx].imageUri;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (hadNoPhoto && p.imageUri && p.barcode) {
    submitCatalogPhotoFill(p.barcode, p.imageUri).catch(() => {});
  }
  return p;
}
```

`hadNoPhoto`는 덮어쓰기 전(`items[idx] = p` 이전)의 기존 값을 봐야 하므로, 반드시 `items.push`/`items[idx] = p` **이전**에 계산해야 한다.

- [ ] **Step 3: 타입 체크**

Run: `cd expiry-keeper && npx tsc --noEmit`
Expected: 새 에러 없음.

- [ ] **Step 4: 수동 확인 (design spec §테스트 1번)**

1. 앱 실행 → 발주 화면에서 바코드는 있지만 사진이 없는 기존 상품을 하나 연다
2. 사진 추가 후 "수정 저장"
3. Supabase 대시보드 → Table Editor → `order_product_reports`에서 방금 생성된 행 확인: `kind='photo_fill'`, `status='approved'`, 해당 `barcode`, `photo_uri`에 값 있음, `name`/`brand`/`category`는 빈 문자열, `price`는 null

- [ ] **Step 5: 커밋**

```bash
git add expiry-keeper/src/lib/order-repo.ts
git commit -m "feat: 발주상품 저장 시 사진 없던 카탈로그 항목에 사진 자동 제출"
```

---

### Task 5: `syncApprovedCatalogUpdates`에 `clear_photo` 처리 추가

**Files:**
- Modify: `expiry-keeper/src/lib/order-repo.ts:139-148` (`ApprovedReportRow` 타입), `:159-162` (select 목록), `:209-222` (`fix` 분기)

**Interfaces:**
- Consumes: Task 1에서 만든 `order_product_reports.clear_photo` 컬럼
- Produces: 변경 없음 — `syncApprovedCatalogUpdates(): Promise<{ added: number; fixed: number }>` 시그니처 그대로 유지

- [ ] **Step 1: `ApprovedReportRow` 타입에 필드 추가 및 `kind`에 `'photo_fill'` 추가**

현재(139-148번째 줄):

```ts
type ApprovedReportRow = {
  id: string;
  kind: 'new' | 'fix';
  barcode: string | null;
  name: string;
  brand: string | null;
  price: number | null;
  category: string | null;
  photo_uri: string | null;
};
```

아래로 교체:

```ts
type ApprovedReportRow = {
  id: string;
  kind: 'new' | 'fix' | 'photo_fill';
  barcode: string | null;
  name: string;
  brand: string | null;
  price: number | null;
  category: string | null;
  photo_uri: string | null;
  clear_photo: boolean | null;
};
```

`'photo_fill'`은 `kind === 'new'`가 아니므로 아래 `syncApprovedCatalogUpdates()`의 기존
`if (row.kind === 'new') {...} else {...}` 두 갈래 분기에서 자동으로 `else`(병합) 경로를 탄다 —
분기 자체는 수정할 필요 없다.

- [ ] **Step 2: select 목록에 컬럼 추가**

현재(159-162번째 줄):

```ts
  const { data, error } = await supabase
    .from('order_product_reports')
    .select('id, kind, barcode, name, brand, price, category, photo_uri')
    .eq('status', 'approved');
```

아래로 교체:

```ts
  const { data, error } = await supabase
    .from('order_product_reports')
    .select('id, kind, barcode, name, brand, price, category, photo_uri, clear_photo')
    .eq('status', 'approved');
```

- [ ] **Step 3: `fix` 분기에서 `clear_photo` 처리**

현재(209-222번째 줄, `else` 분기):

```ts
    } else {
      const idx = row.barcode ? items.findIndex((p) => p.barcode === row.barcode) : -1;
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          name: row.name || items[idx].name,
          brand: row.brand || items[idx].brand,
          price: row.price ?? items[idx].price,
          category: row.category || items[idx].category,
          imageUri: row.photo_uri || items[idx].imageUri,
        };
        fixed++;
      }
    }
```

아래로 교체:

```ts
    } else {
      const idx = row.barcode ? items.findIndex((p) => p.barcode === row.barcode) : -1;
      if (idx >= 0) {
        items[idx] = {
          ...items[idx],
          name: row.name || items[idx].name,
          brand: row.brand || items[idx].brand,
          price: row.price ?? items[idx].price,
          category: row.category || items[idx].category,
          imageUri: row.clear_photo ? null : row.photo_uri || items[idx].imageUri,
        };
        fixed++;
      }
    }
```

- [ ] **Step 4: 타입 체크**

Run: `cd expiry-keeper && npx tsc --noEmit`
Expected: 새 에러 없음.

- [ ] **Step 5: 수동 확인 (design spec §테스트 2번)**

1. Task 4 Step 4에서 만든 `order_product_reports` 행이 있는 상태에서, 다른 계정(또는 같은 계정도 무방)으로 로그인된 기기에서 발주 화면의 "Update" 버튼을 누른다
2. 해당 바코드 상품에 사진이 반영됐는지, 가격/이름 등 다른 필드는 그대로인지 확인

- [ ] **Step 6: 커밋**

```bash
git add expiry-keeper/src/lib/order-repo.ts
git commit -m "feat: 카탈로그 동기화에 사진 초기화(clear_photo) 처리 추가"
```

---

### Task 6: "사진이 실제 상품과 달라요" 신고 버튼 UI

**Files:**
- Modify: `expiry-keeper/src/app/order-product-form.tsx:18` (import), `:39-54` (state), `:305-323` (사진 액션 행)

**Interfaces:**
- Consumes: `flagCatalogPhoto(barcode: string): Promise<{ cleared: boolean }>` (Task 3에서 정의)

- [ ] **Step 1: import 추가**

현재 27번째 줄:

```ts
import { reportOrderProductIssue } from '@/lib/order-report';
```

를 아래로 교체:

```ts
import { flagCatalogPhoto, reportOrderProductIssue } from '@/lib/order-report';
```

- [ ] **Step 2: state 추가**

현재 54번째 줄(`const [reporting, setReporting] = useState(false);`) 바로 다음에 추가:

```ts
  const [flaggingPhoto, setFlaggingPhoto] = useState(false);
```

- [ ] **Step 3: 핸들러 추가**

`pickReportPhoto` 정의(현재 85-86번째 줄) 바로 뒤에 추가:

```ts

  const flagPhoto = () => {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return;
    Alert.alert('사진 신고', '이 사진이 실제 상품과 다른가요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '신고',
        onPress: async () => {
          setFlaggingPhoto(true);
          try {
            const { cleared } = await flagCatalogPhoto(trimmedBarcode);
            Alert.alert(
              '접수 완료',
              cleared ? '여러 신고가 접수되어 사진이 초기화됐습니다.' : '신고가 접수됐습니다.',
            );
          } catch (e) {
            Alert.alert('신고 실패', e instanceof Error ? e.message : '알 수 없는 오류');
          } finally {
            setFlaggingPhoto(false);
          }
        },
      },
    ]);
  };
```

- [ ] **Step 4: 버튼 UI 추가**

현재(305-323번째 줄):

```tsx
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
```

아래로 교체:

```tsx
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
            {isEdit && barcode.trim() && imageUri ? (
              <Pressable onPress={flagPhoto} disabled={flaggingPhoto} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진이 실제 상품과 달라요</Text>
              </Pressable>
            ) : null}
```

- [ ] **Step 5: 타입 체크**

Run: `cd expiry-keeper && npx tsc --noEmit`
Expected: 새 에러 없음.

- [ ] **Step 6: 수동 확인 (design spec §테스트 3~6번)**

1. 바코드 있고 사진 있는 기존 상품 편집 화면을 연다 → "사진이 실제 상품과 달라요" 버튼이 보이는지 확인 (바코드 없으면 안 보여야 함)
2. 한 계정으로 버튼 탭 → "신고" → "신고가 접수됐습니다" 알럿 확인 (아직 초기화 안 됨)
3. Supabase 대시보드에서 `order_photo_flags`에 해당 barcode 행 1개 생성 확인
4. 다른 계정으로 로그인해 같은 상품에서 버튼 탭 → "신고" → "여러 신고가 접수되어 사진이 초기화됐습니다" 알럿 확인
5. `order_product_reports`에 `clear_photo:true`인 새 행 생성 확인
6. 아무 기기에서 "Update" 버튼 → 해당 상품 사진이 "사진 없음" 상태로 리셋되는지 확인
7. 리셋된 상품을 아무 사용자가 편집해 사진 재추가 → Task 4의 자동 채우기가 다시 동작하는지 확인 (design spec §테스트 6번, 전체 루프 회귀 확인)

- [ ] **Step 7: 커밋**

```bash
git add expiry-keeper/src/app/order-product-form.tsx
git commit -m "feat: 카탈로그 사진 오류 신고 버튼 추가"
```
