# 발주 카탈로그 사진 좋아요/싫어요 투표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 카탈로그 사진(`order_catalog.image_uri`)을 "마지막으로 승인된 사진이 무조건 이기는" 구조에서, 여러 사용자가 올린 후보 사진 중 좋아요를 가장 많이 받은 사진이 자동으로 대표가 되는 구조로 바꾼다.

**Architecture:** 신규 테이블 `order_catalog_photos`(후보 사진)와 `order_photo_votes`(사용자당 사진당 1표)를 추가하고, DB 트리거가 득표(좋아요-싫어요) 최고 사진을 자동으로 `order_catalog.image_uri`에 반영한다. 기존 "사진이 실제 상품과 달라요" 신고(`order_photo_flags`, 2명 합의 초기화)는 완전히 제거하고 새 투표로 대체한다. 정보 오류 신고(`kind='fix'`) 승인 트리거는 더 이상 사진을 건드리지 않는다.

**Tech Stack:** Expo/React Native, Supabase(Postgres + RLS + 트리거), AsyncStorage, TypeScript.

## Global Constraints

- 대상 필드는 `order_catalog.image_uri` 하나뿐이다 — `name`/`brand`/`price`/`category`는 이 작업과 무관 (스펙 "범위").
- `order_photo_flags` 테이블과 `flagCatalogPhoto()`는 완전히 삭제하고 새 투표로 대체한다 (스펙 "범위").
- `apply_approved_order_report` 트리거는 더 이상 `image_uri`/`clear_photo`를 건드리지 않는다 (스펙 "범위").
- 저작권 삭제 요청은 여전히 즉시 처리하되, 대상이 `order_catalog_photos`의 해당 사진 행이다 (스펙 "범위").
- `barcode_catalog`(범용 자동채움 캐시)는 이 작업 범위 밖이다 — 손대지 않는다 (스펙 "범위").
- 대표 사진 선정 규칙: 그 바코드의 후보 사진 중 (좋아요 − 싫어요)가 가장 높은 것, 동점이면 먼저 등록된 사진 (스펙 "아키텍처").
- 새로 올라온 사진은 0표로 시작하므로 이미 득표한 기존 사진을 자동으로 밀어내지 못한다 (스펙 "배경").
- 신규 상품 등록 시 사진 후보 insert는 `order_catalog` 행이 생성된 **뒤에** 일어나야 한다 — 순서가 바뀌면 대표 사진 재계산이 대상 행을 못 찾아 조용히 유실된다 (스펙 "에러 처리").
- 자기 사진에 자기가 투표하는 것은 막지 않는다 — 범위 밖 (스펙 "에러 처리").
- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱이다 — 순수 로직만 `*.selfcheck.ts`로 검증하고, 나머지는 `npx tsc --noEmit` + 수동 시나리오로 검증한다 (기존 관례).
- RLS 정책은 `order_photo_flags`/`order_product_reports`가 이미 쓰는 기존 관례(`to authenticated`, `default auth.uid()`로 신원 컬럼 채우기)를 그대로 따른다 — 스펙 문서의 SQL 초안보다 이 관례를 우선한다.

---

### Task 1: Supabase 마이그레이션 SQL 작성 (후보/투표 테이블 + 트리거 + 기존 함수 교체)

**Files:**
- Create: `supabase/migration-order-photo-voting.sql`

**Interfaces:**
- Consumes: 없음 (신규 SQL, 기존 `order_catalog`/`order_product_reports` 테이블 전제)
- Produces: 테이블 `order_catalog_photos(id uuid pk, barcode text, photo_uri text, submitted_by uuid default auth.uid(), created_at timestamptz)`, `order_photo_votes(photo_id uuid, voter_id uuid default auth.uid(), vote smallint, created_at timestamptz, pk(photo_id, voter_id))`. 이후 Task 3(`order-report.ts`)이 이 스키마를 그대로 가정하고 쿼리를 작성한다.

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 발주 카탈로그 사진 좋아요/싫어요 투표 (2026-09-03)
-- 여러 사용자가 올린 사진 후보 중 득표(좋아요-싫어요) 최고 사진을 트리거가 자동으로
-- order_catalog.image_uri에 반영한다. 기존 "사진이 실제 상품과 달라요" 2명 합의 신고
-- (order_photo_flags)는 이 마이그레이션으로 완전히 대체되어 삭제된다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.order_catalog_photos (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  photo_uri text not null,
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists order_catalog_photos_barcode_idx on public.order_catalog_photos(barcode);

alter table public.order_catalog_photos enable row level security;

drop policy if exists "order_catalog_photos select" on public.order_catalog_photos;
create policy "order_catalog_photos select" on public.order_catalog_photos
  for select to authenticated using (true);

drop policy if exists "order_catalog_photos insert" on public.order_catalog_photos;
create policy "order_catalog_photos insert" on public.order_catalog_photos
  for insert to authenticated with check (auth.uid() = submitted_by);

-- 일반 update 정책은 없음: 후보 내용을 고칠 수 없다.
-- 저작권 삭제는 신고자 본인이 앱에서 즉시 지울 수 있어야 하므로 delete 정책만 추가한다.
drop policy if exists "order_catalog_photos delete own submission" on public.order_catalog_photos;
create policy "order_catalog_photos delete own submission" on public.order_catalog_photos
  for delete to authenticated using (auth.uid() = submitted_by);

create table if not exists public.order_photo_votes (
  photo_id uuid not null references public.order_catalog_photos(id) on delete cascade,
  voter_id uuid not null default auth.uid(),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (photo_id, voter_id)
);

alter table public.order_photo_votes enable row level security;

drop policy if exists "order_photo_votes select" on public.order_photo_votes;
create policy "order_photo_votes select" on public.order_photo_votes
  for select to authenticated using (true);

drop policy if exists "order_photo_votes insert" on public.order_photo_votes;
create policy "order_photo_votes insert" on public.order_photo_votes
  for insert to authenticated with check (auth.uid() = voter_id);

drop policy if exists "order_photo_votes update" on public.order_photo_votes;
create policy "order_photo_votes update" on public.order_photo_votes
  for update to authenticated using (auth.uid() = voter_id);

drop policy if exists "order_photo_votes delete" on public.order_photo_votes;
create policy "order_photo_votes delete" on public.order_photo_votes
  for delete to authenticated using (auth.uid() = voter_id);

-- 대표 사진 재계산: 득표 최고 → 동점이면 최초 등록 우선
create or replace function public.recalc_order_catalog_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_uri text;
begin
  select p.photo_uri into winner_uri
  from public.order_catalog_photos p
  left join (
    select photo_id, sum(vote) as score
    from public.order_photo_votes
    group by photo_id
  ) v on v.photo_id = p.id
  where p.barcode = target_barcode
  order by coalesce(v.score, 0) desc, p.created_at asc
  limit 1;

  update public.order_catalog
  set image_uri = winner_uri, updated_at = now()
  where barcode = target_barcode;
end;
$$;

create or replace function public.order_catalog_photos_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_order_catalog_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_catalog_photos_recalc on public.order_catalog_photos;
create trigger order_catalog_photos_recalc
  after insert or delete on public.order_catalog_photos
  for each row execute function public.order_catalog_photos_recalc_trigger();

create or replace function public.order_photo_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.order_catalog_photos
  where id = coalesce(new.photo_id, old.photo_id);
  perform public.recalc_order_catalog_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_photo_votes_recalc on public.order_photo_votes;
create trigger order_photo_votes_recalc
  after insert or update or delete on public.order_photo_votes
  for each row execute function public.order_photo_votes_recalc_trigger();

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 사진을 건드리지 않도록 교체
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

  insert into public.order_catalog (barcode, name, brand, price, category, updated_at)
  values (new.barcode, nullif(new.name, ''), nullif(new.brand, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    brand = coalesce(nullif(excluded.brand, ''), order_catalog.brand),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;

-- 기존 "사진이 실제 상품과 달라요" 2명 합의 신고 기능 제거 (새 투표로 대체)
drop table if exists public.order_photo_flags;
```

- [ ] **Step 2: 파일 저장 확인**

Run: `test -f supabase/migration-order-photo-voting.sql && echo OK`
Expected: `OK`

- [ ] **Step 3: 사용자에게 실행 요청 (사람이 하는 단계 — 코드 아님)**

이 SQL을 Supabase 대시보드 SQL Editor에서 실행해달라고 안내한다. 실행 후 Table Editor에서 `order_catalog_photos`/`order_photo_votes` 테이블이 생성되고 `order_photo_flags`가 사라졌는지, Database > Triggers에서 `order_catalog_photos_recalc`/`order_photo_votes_recalc`가 붙었는지 확인해달라고 요청한다.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-order-photo-voting.sql
git commit -m "feat: 사진 후보/투표 테이블 + 대표사진 자동선정 트리거 마이그레이션 추가"
```

---

### Task 2: `order-catalog-merge.ts` — `flaggedPhotos`/`resolvedFlags` 기능 제거

**Files:**
- Modify: `src/lib/order-catalog-merge.ts`
- Modify: `src/lib/order-catalog-merge.selfcheck.ts`

**Interfaces:**
- Consumes: 없음 (기존 파일 정리)
- Produces: `export function mergeCatalogIntoProducts(items: OrderProduct[], catalogRows: OrderCatalogRow[], removedBarcodes: Set<string>, makeId?: () => string): { items: OrderProduct[]; changed: boolean }` — Task 4의 `syncOrderCatalog`가 이 시그니처를 그대로 호출한다 (`flaggedPhotos` 인자와 `resolvedFlags` 반환값 제거됨).

- [ ] **Step 1: `order-catalog-merge.ts` 전체를 아래로 교체**

```ts
import type { OrderProduct } from './order-types';

/** repo.ts의 newId()와 동일한 로직. 이 파일을 tsx로 단독 실행 가능한 순수 로직으로 유지하기 위해
 * (repo.ts는 AsyncStorage 등 RN 전용 모듈을 함께 import해 tsx 번들링이 깨짐) 별도로 둔다. */
function defaultId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export type OrderCatalogRow = {
  barcode: string;
  name: string;
  brand: string | null;
  price: number | null;
  category: string | null;
  image_uri: string | null;
};

/**
 * 로컬 발주 상품 목록에 공용 카탈로그(Supabase order_catalog) 값을 병합한다. IO 없는 순수 함수.
 * 바코드로 매칭되면 공용 필드(name/brand/price/category/imageUri)를 카탈로그 값으로 덮어쓴다
 * (공용 값이 항상 이김). 매칭 안 되고 removedBarcodes에도 없으면 신규 상품으로 추가한다
 * (사용자가 직접 삭제한 바코드는 재생성하지 않음).
 */
export function mergeCatalogIntoProducts(
  items: OrderProduct[],
  catalogRows: OrderCatalogRow[],
  removedBarcodes: Set<string>,
  makeId: () => string = defaultId,
): { items: OrderProduct[]; changed: boolean } {
  const next = items.map((p) => ({ ...p }));
  const byBarcode = new Map(
    next.filter((p): p is OrderProduct & { barcode: string } => !!p.barcode).map((p) => [p.barcode, p]),
  );
  let changed = false;

  for (const row of catalogRows) {
    const local = byBarcode.get(row.barcode);
    if (local) {
      const nextBrand = row.brand ?? '';
      const nextPrice = row.price ?? local.price;
      const nextCategory = row.category ?? local.category;
      if (
        local.name !== row.name ||
        local.brand !== nextBrand ||
        local.price !== nextPrice ||
        local.category !== nextCategory ||
        local.imageUri !== row.image_uri
      ) {
        local.name = row.name;
        local.brand = nextBrand;
        local.price = nextPrice;
        local.category = nextCategory;
        local.imageUri = row.image_uri;
        changed = true;
      }
    } else if (!removedBarcodes.has(row.barcode)) {
      next.push({
        id: makeId(),
        name: row.name,
        brand: row.brand ?? '',
        price: row.price ?? 0,
        category: row.category ?? '',
        barcode: row.barcode,
        imageUri: row.image_uri,
        status: 'active',
      });
      changed = true;
    }
  }

  return { items: next, changed };
}
```

- [ ] **Step 2: `order-catalog-merge.selfcheck.ts`에서 6번/7번 테스트 블록 삭제**

`// 6) 신고한 사진이...`부터 `// 7) 신고 후 카탈로그 값이...` 블록 끝(`console.assert(resolvedFlags.includes('111')...` 다음 줄, `}`까지)을 통째로 삭제한다. 1~5번 테스트와 마지막 `console.log('order-catalog-merge selfcheck OK');`는 그대로 둔다.

- [ ] **Step 3: selfcheck 실행**

Run: `npx tsx src/lib/order-catalog-merge.selfcheck.ts`
Expected: 마지막 줄에 `order-catalog-merge selfcheck OK` 출력, assertion 실패 없음

- [ ] **Step 4: Commit**

```bash
git add src/lib/order-catalog-merge.ts src/lib/order-catalog-merge.selfcheck.ts
git commit -m "refactor: order-catalog-merge에서 사진 신고 임계치 로직 제거 (투표 시스템으로 대체)"
```

---

### Task 3: `order-report.ts` — 신고/투표 함수 교체

**Files:**
- Modify: `src/lib/order-report.ts`

**Interfaces:**
- Consumes: `uploadPhotoToBucket` (`src/lib/storage.ts`), `supabase` (`src/lib/supabase.ts`)
- Produces:
  - `export async function submitPhotoCandidate(barcode: string, photoUri: string): Promise<void>` — Task 4의 `order-repo.ts`가 호출
  - `export type PhotoCandidate = { id: string; photoUri: string; likes: number; dislikes: number; myVote: 1 | -1 | null }`
  - `export async function listPhotoCandidates(barcode: string): Promise<PhotoCandidate[]>` — Task 5의 `PhotoCandidatesModal`이 호출
  - `export async function voteOnPhoto(photoId: string, vote: 1 | -1): Promise<void>` — Task 5의 `PhotoCandidatesModal`이 호출
  - 제거되는 것: `flagCatalogPhoto`, `submitCatalogPhotoFill`, `PHOTO_FLAG_THRESHOLD` (다른 파일에서 참조 없음, Task 4/6에서 import도 함께 제거)

- [ ] **Step 1: `submitCatalogPhotoFill` 함수를 `submitPhotoCandidate`로 교체**

기존(`submitCatalogPhotoFill` 함수 전체, 주석 포함):
```ts
/**
 * 바코드 카탈로그에 아직 사진이 없는 상품에, 사용자가 자기 발주상품을 편집하며 추가한 사진을
 * 관리자 검토 없이 즉시 반영되는 카탈로그 수정 제안(kind:'photo_fill')으로 접수한다.
 * kind:'fix'(정보 오류 신고)는 RLS가 자동승인 insert를 막아둔 관리자 승인 전용 경로라 재사용할 수 없다.
 * name/brand/price/category는 비워 보내 기존 병합 로직(order-catalog-merge.ts의 mergeCatalogIntoProducts)이
 * 사진 외 다른 필드를 건드리지 않도록 한다. best-effort — 실패해도 로컬 저장 흐름을 막지 않는다.
 * 호출자(saveOrderProduct)는 로컬 기기의 이전 상태(사진 없음)만 보고 호출하므로, 그 사이 다른
 * 사용자가 이미 채운 사진을 덮어쓰지 않도록 여기서 공용 barcode_catalog 상태를 다시 한번 확인한다.
 */
export async function submitCatalogPhotoFill(barcode: string, photoUri: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: cached } = await supabase
      .from('barcode_catalog')
      .select('image_uri')
      .eq('barcode', barcode)
      .maybeSingle();
    if (cached?.image_uri) return;

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

교체:
```ts
/**
 * 사진 후보를 order_catalog_photos에 추가한다. 검토 없이 즉시 접수되지만, 대표 사진이 되려면
 * 다른 사용자의 좋아요를 받아야 한다(대표 선정은 DB 트리거가 득표수로 자동 결정, 여기선 후보만 추가).
 * best-effort — 실패해도 로컬 저장 흐름을 막지 않는다.
 */
export async function submitPhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  if (!supabase) return;
  try {
    const photoUrl = await uploadReportPhoto(photoUri);
    if (!photoUrl) return;
    await supabase.from('order_catalog_photos').insert({ barcode, photo_uri: photoUrl });
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 2: `submitNewOrderProduct`에서 사진을 순서대로 후보로 접수**

기존:
```ts
export async function submitNewOrderProduct(product: OrderProduct): Promise<void> {
  if (!supabase) return;
  try {
    const photoUrl = product.imageUri ? await uploadReportPhoto(product.imageUri) : null;
    await supabase.from('order_product_reports').insert({
      kind: 'new',
      status: 'approved',
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      price: product.price,
      category: product.category,
      photo_uri: photoUrl,
    });
  } catch {
    // best-effort
  }
}
```

교체:
```ts
export async function submitNewOrderProduct(product: OrderProduct): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('order_product_reports').insert({
      kind: 'new',
      status: 'approved',
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      price: product.price,
      category: product.category,
      photo_uri: null,
    });
    // order_catalog 행이 생성된 뒤에 사진 후보를 넣어야 한다 — 먼저 넣으면 대표 사진
    // 재계산 UPDATE가 대상 행을 못 찾아 조용히 유실된다.
    if (product.imageUri && product.barcode) {
      await submitPhotoCandidate(product.barcode, product.imageUri);
    }
  } catch {
    // best-effort
  }
}
```

- [ ] **Step 3: 저작권 삭제 경로를 `order_catalog_photos` delete로 교체**

기존(`reportOrderProductIssue` 함수 안 `if (isCopyright && product.barcode) { ... }` 블록):
```ts
  if (isCopyright && product.barcode) {
    await supabase.from('order_product_reports').insert({
      kind: 'photo_fill',
      status: 'approved',
      barcode: product.barcode,
      name: '',
      brand: '',
      price: null,
      category: '',
      photo_uri: null,
      clear_photo: true,
    });
    await supabase
      .from('barcode_catalog')
      .update({ image_uri: null })
      .eq('barcode', product.barcode);
  }
```

교체:
```ts
  if (isCopyright && product.barcode && product.imageUri) {
    await supabase
      .from('order_catalog_photos')
      .delete()
      .eq('barcode', product.barcode)
      .eq('photo_uri', product.imageUri);
    await supabase
      .from('barcode_catalog')
      .update({ image_uri: null })
      .eq('barcode', product.barcode);
  }
```

- [ ] **Step 4: `flagCatalogPhoto`와 `PHOTO_FLAG_THRESHOLD` 삭제**

`const PHOTO_FLAG_THRESHOLD = 2;`부터 파일 끝(`flagCatalogPhoto` 함수 전체)까지 통째로 삭제한다.

- [ ] **Step 5: 투표 조회/제출 함수 추가 (파일 끝에)**

```ts
export type PhotoCandidate = {
  id: string;
  photoUri: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 사진 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listPhotoCandidates(barcode: string): Promise<PhotoCandidate[]> {
  if (!supabase) return [];
  const { data: photos, error } = await supabase
    .from('order_catalog_photos')
    .select('id, photo_uri')
    .eq('barcode', barcode)
    .order('created_at', { ascending: true });
  if (error || !photos || photos.length === 0) return [];

  const ids = photos.map((p) => p.id);
  const { data: votes } = await supabase
    .from('order_photo_votes')
    .select('photo_id, voter_id, vote')
    .in('photo_id', ids);
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

  return photos.map((p) => {
    const photoVotes = (votes ?? []).filter((v) => v.photo_id === p.id);
    const likes = photoVotes.filter((v) => v.vote === 1).length;
    const dislikes = photoVotes.filter((v) => v.vote === -1).length;
    const mine = photoVotes.find((v) => v.voter_id === myId);
    return {
      id: p.id,
      photoUri: p.photo_uri,
      likes,
      dislikes,
      myVote: (mine?.vote as 1 | -1 | undefined) ?? null,
    };
  });
}

/** 사진에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnPhoto(photoId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: userData } = await supabase.auth.getUser();
  const voterId = userData.user?.id;
  if (!voterId) throw new Error('로그인이 필요합니다.');

  const { data: existing } = await supabase
    .from('order_photo_votes')
    .select('vote')
    .eq('photo_id', photoId)
    .eq('voter_id', voterId)
    .maybeSingle();

  if (existing?.vote === vote) {
    const { error } = await supabase
      .from('order_photo_votes')
      .delete()
      .eq('photo_id', photoId)
      .eq('voter_id', voterId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('order_photo_votes')
    .upsert({ photo_id: photoId, vote }, { onConflict: 'photo_id,voter_id' });
  if (error) throw error;
}
```

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx` 기존 무관 오류 1건만 남고, `order-report.ts` 자체엔 새 오류 없음. (`order-repo.ts`/`order-product-form.tsx`는 옛 함수를 아직 import하고 있어 이 시점엔 오류가 날 수 있음 — Task 4/6에서 해결된다.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/order-report.ts
git commit -m "feat: 사진 신고 임계치 로직을 좋아요/싫어요 투표 함수로 교체"
```

---

### Task 4: `order-repo.ts` — 신고 임계치 로컬 추적 제거, 후보 제출 연결

**Files:**
- Modify: `src/lib/order-repo.ts`

**Interfaces:**
- Consumes: Task 2의 `mergeCatalogIntoProducts` (새 시그니처), Task 3의 `submitPhotoCandidate`
- Produces: `saveOrderProduct`/`syncOrderCatalog` 시그니처는 그대로 (외부에서 보는 동작 변경 없음, 내부 구현만 교체)
- 제거되는 것(다른 파일에서 참조 없음, Task 6에서 import도 함께 제거): `getFlaggedPhotoBarcodes`, `recordFlaggedPhoto`, `clearResolvedFlaggedPhotos`, `FLAGGED_PHOTO_KEY`

- [ ] **Step 1: import 및 상수 교체**

기존:
```ts
import { submitCatalogPhotoFill, submitNewOrderProduct } from './order-report';
```
```ts
const FLAGGED_PHOTO_KEY = 'flaggedPhotoBarcodes:v1';
```

교체:
```ts
import { submitNewOrderProduct, submitPhotoCandidate } from './order-report';
```
```ts
const SUBMITTED_PHOTO_KEY = 'submittedPhotoCandidates:v1';
```

- [ ] **Step 2: `saveOrderProduct`를 새 후보 제출 방식으로 교체**

기존(`saveOrderProduct` 함수 전체와 그 위 docblock):
```ts
/**
 * 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort).
 * 신규 등록(기존 id와 매칭 안 됨)이면 크라우드소싱 카탈로그 제안으로도 접수한다 (best-effort).
 * 기존 상품 수정이고 이 기기에 사진이 없었는데 사진이 새로 추가된 경우, 카탈로그 사진
 * 자동채우기(submitCatalogPhotoFill)로도 접수한다 (best-effort).
 */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const hadNoPhoto = !isNew && !items[idx].imageUri;
  const categoryChanged = !isNew && items[idx].category !== p.category;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (hadNoPhoto && p.imageUri && p.barcode) {
    submitCatalogPhotoFill(p.barcode, p.imageUri).catch(() => {});
  }
  // 카테고리 수정은 공용 카탈로그 승인 절차를 안 거치므로, 다음 syncOrderCatalog가
  // 공용 값으로 도로 덮어쓰지 않도록 이 바코드의 로컬 지정값을 기억해둔다.
  if (categoryChanged && p.barcode) {
    recordCategoryOverride(p.barcode, p.category).catch(() => {});
  }
  return p;
}
```

교체:
```ts
async function getSubmittedPhotoCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_PHOTO_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedPhotoCandidate(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  map.set(barcode, photoUri);
  await AsyncStorage.setItem(SUBMITTED_PHOTO_KEY, JSON.stringify(Object.fromEntries(map)));
}

/** 이 바코드에 마지막으로 제출한 사진과 다를 때만 새 후보로 제출한다 (같은 사진 반복 저장 시 후보 중복 방지). */
async function submitPhotoCandidateIfChanged(barcode: string, photoUri: string): Promise<void> {
  const map = await getSubmittedPhotoCandidates();
  if (map.get(barcode) === photoUri) return;
  await submitPhotoCandidate(barcode, photoUri);
  await recordSubmittedPhotoCandidate(barcode, photoUri);
}

/**
 * 추가/수정 겸용 저장. 바코드가 있으면 공용 바코드 캐시에도 반영한다 (best-effort).
 * 신규 등록(기존 id와 매칭 안 됨)이면 크라우드소싱 카탈로그 제안으로도 접수한다 (best-effort).
 * 사진이 이전 제출과 달라졌으면 새 사진 후보로 접수한다(submitPhotoCandidateIfChanged, best-effort) —
 * 대표 사진이 되려면 다른 사용자의 좋아요를 받아야 한다.
 */
export async function saveOrderProduct(p: OrderProduct): Promise<OrderProduct> {
  const items = await listOrderProducts();
  const idx = items.findIndex((x) => x.id === p.id);
  const isNew = idx < 0;
  const categoryChanged = !isNew && items[idx].category !== p.category;
  if (isNew) items.push(p);
  else items[idx] = p;
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
    submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
  }
  // 카테고리 수정은 공용 카탈로그 승인 절차를 안 거치므로, 다음 syncOrderCatalog가
  // 공용 값으로 도로 덮어쓰지 않도록 이 바코드의 로컬 지정값을 기억해둔다.
  if (categoryChanged && p.barcode) {
    recordCategoryOverride(p.barcode, p.category).catch(() => {});
  }
  return p;
}
```

- [ ] **Step 3: 신고 임계치 로컬 추적 함수 삭제**

아래 블록(`getFlaggedPhotoBarcodes`, `recordFlaggedPhoto`, `clearResolvedFlaggedPhotos` 3개 함수와 그 docblock)을 통째로 삭제한다.

```ts
/** 바코드→신고 당시 사진 URL. syncOrderCatalog가 이 목록을 보고 아직 해결 안 된 신고 사진을 되살리지 않는다. */
export async function getFlaggedPhotoBarcodes(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(FLAGGED_PHOTO_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

/** 사진 신고 직후 호출: 이 바코드의 사진이 해결(카탈로그 값 변경)될 때까지 되살아나지 않게 기록한다. */
export async function recordFlaggedPhoto(barcode: string, imageUri: string): Promise<void> {
  const flagged = await getFlaggedPhotoBarcodes();
  flagged.set(barcode, imageUri);
  await AsyncStorage.setItem(FLAGGED_PHOTO_KEY, JSON.stringify(Object.fromEntries(flagged)));
}

async function clearResolvedFlaggedPhotos(barcodes: string[]): Promise<void> {
  if (barcodes.length === 0) return;
  const flagged = await getFlaggedPhotoBarcodes();
  for (const b of barcodes) flagged.delete(b);
  await AsyncStorage.setItem(FLAGGED_PHOTO_KEY, JSON.stringify(Object.fromEntries(flagged)));
}
```

- [ ] **Step 4: `syncOrderCatalog`에서 `flaggedPhotos` 처리 제거**

기존:
```ts
export async function syncOrderCatalog(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('order_catalog')
      .select('barcode, name, brand, price, category, image_uri');
    if (error || !data) return;

    const [items, removedBarcodes, flaggedPhotos, categoryOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getFlaggedPhotoBarcodes(),
      getCategoryOverrides(),
    ]);
    const rows = (data as OrderCatalogRow[]).map((row) =>
      categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row,
    );
    const { items: merged, changed, resolvedFlags } = mergeCatalogIntoProducts(
      items,
      rows,
      removedBarcodes,
      undefined,
      flaggedPhotos,
    );
    if (changed) await writeOrderProducts(merged);
    await clearResolvedFlaggedPhotos(resolvedFlags);
  } catch {
    // best-effort: 오프라인 등 실패 시 기존 로컬 상태 유지
  }
}
```

교체:
```ts
export async function syncOrderCatalog(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('order_catalog')
      .select('barcode, name, brand, price, category, image_uri');
    if (error || !data) return;

    const [items, removedBarcodes, categoryOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getCategoryOverrides(),
    ]);
    const rows = (data as OrderCatalogRow[]).map((row) =>
      categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row,
    );
    const { items: merged, changed } = mergeCatalogIntoProducts(items, rows, removedBarcodes);
    if (changed) await writeOrderProducts(merged);
  } catch {
    // best-effort: 오프라인 등 실패 시 기존 로컬 상태 유지
  }
}
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx` 기존 무관 오류 1건만 남고, `order-repo.ts` 자체엔 새 오류 없음. (`order-product-form.tsx`가 아직 `recordFlaggedPhoto`를 import 중이라 그 파일에서는 오류가 날 수 있음 — Task 6에서 해결된다.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "refactor: order-repo에서 사진 신고 임계치 추적을 후보 제출 추적으로 교체"
```

---

### Task 5: `PhotoCandidatesModal` 컴포넌트 신규 작성

**Files:**
- Create: `src/components/PhotoCandidatesModal.tsx`

**Interfaces:**
- Consumes: Task 3의 `listPhotoCandidates`, `voteOnPhoto`, `PhotoCandidate` (`@/lib/order-report`)
- Produces: `export default function PhotoCandidatesModal(props: { visible: boolean; barcode: string; onClose: () => void }): JSX.Element` — Task 6의 `order-product-form.tsx`가 그대로 렌더링

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { listPhotoCandidates, voteOnPhoto, type PhotoCandidate } from '@/lib/order-report';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

/**
 * 이 바코드에 등록된 사진 후보들을 보여주고 좋아요/싫어요 투표를 받는다.
 * 대표 사진은 DB 트리거가 득표수로 자동 결정하므로, 여기서 직접 "이걸로 확정" 선택은 없다.
 */
export default function PhotoCandidatesModal({
  visible,
  barcode,
  onClose,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    listPhotoCandidates(barcode)
      .then(setCandidates)
      .finally(() => setLoading(false));
  }, [visible, barcode]);

  const vote = async (photoId: string, value: 1 | -1) => {
    setVotingId(photoId);
    try {
      await voteOnPhoto(photoId, value);
      setCandidates(await listPhotoCandidates(barcode));
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">사진 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 후보 사진이 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className="mb-3 flex-row items-center rounded-xl border border-line p-2"
                >
                  <Image
                    source={{ uri: c.photoUri }}
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                    contentFit="cover"
                  />
                  <View className="ml-3 flex-1 flex-row items-center justify-around">
                    <Pressable
                      onPress={() => vote(c.id, 1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      accessibilityRole="button"
                      accessibilityLabel="좋아요"
                    >
                      <MaterialCommunityIcons
                        name={c.myVote === 1 ? 'thumb-up' : 'thumb-up-outline'}
                        size={22}
                        color={c.myVote === 1 ? '#2E7D32' : '#888888'}
                      />
                      <Text className="text-ink mt-0.5 text-xs">{c.likes}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => vote(c.id, -1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      accessibilityRole="button"
                      accessibilityLabel="싫어요"
                    >
                      <MaterialCommunityIcons
                        name={c.myVote === -1 ? 'thumb-down' : 'thumb-down-outline'}
                        size={22}
                        color={c.myVote === -1 ? '#C62828' : '#888888'}
                      />
                      <Text className="text-ink mt-0.5 text-xs">{c.dislikes}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx` 기존 무관 오류 1건만 남고, 이 신규 파일에서 새 오류 없음.

- [ ] **Step 3: Commit**

```bash
git add src/components/PhotoCandidatesModal.tsx
git commit -m "feat: 사진 후보 목록/투표 모달 컴포넌트 추가"
```

---

### Task 6: `order-product-form.tsx` — "사진이 실제 상품과 달라요" 링크를 투표 화면으로 교체

**Files:**
- Modify: `src/app/order-product-form.tsx`

**Interfaces:**
- Consumes: Task 5의 `PhotoCandidatesModal`
- Produces: 없음 (최종 화면 코드)

- [ ] **Step 1: import 교체**

기존(19번째, 21~30번째 줄):
```ts
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderProduct,
  getOrderProduct,
  listOrderCategories,
  newId,
  recordFlaggedPhoto,
  saveOrderProduct,
} from '@/lib/order-repo';
import { flagCatalogPhoto, reportOrderProductIssue } from '@/lib/order-report';
```

교체:
```ts
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import PhotoCandidatesModal from '@/components/PhotoCandidatesModal';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderProduct,
  getOrderProduct,
  listOrderCategories,
  newId,
  saveOrderProduct,
} from '@/lib/order-repo';
import { reportOrderProductIssue } from '@/lib/order-report';
```

- [ ] **Step 2: `flaggingPhoto` state를 `showPhotoCandidates`로 교체**

기존(66번째 줄):
```ts
  const [flaggingPhoto, setFlaggingPhoto] = useState(false);
```

교체:
```ts
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
```

- [ ] **Step 3: `clearLocalPhoto`와 `flagPhoto` 함수 삭제**

`flagPhoto`의 유일한 호출자였던 `clearLocalPhoto`도 함께 죽은 코드가 되므로 같이 삭제한다. 아래 블록(106번째 줄 `const clearLocalPhoto = ...`부터 155번째 줄 `flagPhoto` 끝의 `};`까지) 전체를 삭제한다.

```ts
  const clearLocalPhoto = async () => {
    setImageUri(null);
    if (!params.id) return;
    try {
      await saveOrderProduct({
        id: params.id,
        name: name.trim(),
        brand: brand.trim(),
        price: Number(price) || 0,
        category,
        barcode: barcode.trim() || null,
        imageUri: null,
        status,
      });
    } catch {
      // 신고 자체는 이미 접수됐으므로 로컬 저장 실패는 조용히 무시
    }
  };

  const flagPhoto = () => {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return;
    Alert.alert('사진 신고', '이 사진이 실제 상품과 다른가요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '신고',
        onPress: async () => {
          setFlaggingPhoto(true);
          const flaggedUri = imageUri;
          try {
            const { cleared } = await flagCatalogPhoto(trimmedBarcode);
            // 신고 임계치 미달이면 공용 카탈로그 사진은 그대로다 — 여기 기록해두지 않으면
            // 다음 syncOrderCatalog 때 방금 지운 로컬 사진이 도로 채워진다.
            if (flaggedUri) await recordFlaggedPhoto(trimmedBarcode, flaggedUri);
            await clearLocalPhoto();
            Alert.alert(
              '접수 완료',
              cleared
                ? '여러 신고가 접수되어 사진이 초기화됐습니다.'
                : '신고가 접수됐습니다. 이 상품의 사진도 제거해 저장했습니다.',
            );
          } catch (e) {
            Alert.alert('신고 실패', errorMessage(e));
          } finally {
            setFlaggingPhoto(false);
          }
        },
      },
    ]);
  };
```

- [ ] **Step 4: 모달 렌더링 추가**

기존(344~352번째 줄, `ImageCandidatesModal` 바로 다음):
```tsx
      <ImageCandidatesModal
        visible={imageCandidates !== null}
        candidates={imageCandidates ?? []}
        onSelect={(url) => {
          setImageUri(url);
          setImageCandidates(null);
        }}
        onClose={() => setImageCandidates(null)}
      />
```

교체(뒤에 `PhotoCandidatesModal` 추가):
```tsx
      <ImageCandidatesModal
        visible={imageCandidates !== null}
        candidates={imageCandidates ?? []}
        onSelect={(url) => {
          setImageUri(url);
          setImageCandidates(null);
        }}
        onClose={() => setImageCandidates(null)}
      />
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode.trim()}
        onClose={() => setShowPhotoCandidates(false)}
      />
```

- [ ] **Step 5: 링크 텍스트/동작 교체**

기존(403~407번째 줄):
```tsx
            {isEdit && barcode.trim() && imageUri ? (
              <Pressable onPress={flagPhoto} disabled={flaggingPhoto} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진이 실제 상품과 달라요</Text>
              </Pressable>
            ) : null}
```

교체:
```tsx
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setShowPhotoCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
```

(조건에서 `&& imageUri`를 뺐다 — 지금 내 기기엔 사진이 없어도 다른 사람이 올린 후보가 있을 수 있으므로.)

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx` 기존 무관 오류 1건만 남고 새 오류 없음.

- [ ] **Step 7: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주상품 편집화면에 사진 후보 보기/투표 연결, 사진신고 기능 제거"
```

---

### Task 7: 최종 검증 및 수동 QA 안내

**Files:**
- 없음 (검증 전용 태스크)

**Interfaces:**
- Consumes: Task 1~6의 모든 산출물
- Produces: 없음

- [ ] **Step 1: 전체 타입체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx` 기존 무관 오류 1건만 출력됨. 그 외 오류 없음.

- [ ] **Step 2: 순수 로직 selfcheck 재실행**

Run: `npx tsx src/lib/order-catalog-merge.selfcheck.ts`
Expected: 마지막 줄에 `order-catalog-merge selfcheck OK`, assertion 실패 없음.

- [ ] **Step 3: 사용자에게 수동 QA 요청 (스펙의 "테스트" 섹션 그대로)**

앱을 실기기(dev client)에서 두 대(또는 두 계정)로 띄운 뒤 아래를 확인해달라고 안내한다.

1. A가 신규 상품 등록(사진 포함) → 대표 사진이 즉시 A의 사진으로 뜨는지
2. B가 같은 상품을 편집하며 다른(이상한) 사진으로 교체 → 대표 사진이 **바뀌지 않고** A의 사진 그대로인지(투표 없이는 안 바뀌어야 함)
3. 다른 사용자 여러 명이 B의 사진에 좋아요를 A의 사진 좋아요 수보다 많이 누름 → 대표 사진이 B의 사진으로 자동 전환되는지
4. 같은 사용자가 같은 사진에 같은 값(좋아요/좋아요)으로 재투표 → 투표 취소(중립)로 바뀌는지
5. 저작권 삭제(내 사진 신고 체크박스)로 대표 사진이 지워짐 → 다음 순위 후보(또는 없으면 빈 사진)로 자동 대체되는지
6. 정보 오류 신고(가격 등, 사진 미첨부)가 관리자 승인됨 → 대표 사진은 전혀 안 바뀌는지
7. 같은 사진을 반복 저장(변경 없음) → "사진 후보 보기/투표" 목록에 중복 후보가 안 쌓이는지

- [ ] **Step 4: 최종 확인**

각 태스크에서 이미 커밋했으므로, 여기서는 6개 커밋(마이그레이션, merge 정리, order-report, order-repo, 모달 컴포넌트, order-product-form)이 있는지만 확인한다.

Run: `git log --oneline -7`
