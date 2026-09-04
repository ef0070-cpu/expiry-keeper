# 발주 카탈로그 사진 좋아요/싫어요 투표 설계

**날짜:** 2026-09-03
**대상 프로젝트:** expiry-keeper

## 배경

발주 카탈로그(`order_catalog`)는 바코드당 사진을 1장만 저장한다. 지금까지 이 사진이 갱신되는 경로는 두 가지였다.

1. 신규 상품 등록(`kind='new'`) — 자동승인, 사진이 있으면 무조건 반영
2. 정보 오류 신고(`kind='fix'`) — 관리자 승인 후 반영, 신고에 사진이 첨부돼 있으면 **품질과 무관하게 기존 사진을 덮어씀**

즉 "마지막으로 승인된 사진"이 이기는 구조라, A가 깔끔한 사진을 등록해도 B가 나중에 이상한 사진으로 오류를 신고하고 관리자가 그걸 승인하면 C는 B의 나쁜 사진을 보게 된다. 품질을 비교하는 로직이 전혀 없는 게 근본 원인이다.

이를 해결하기 위해, 사진을 "여러 명이 올린 후보 중 좋아요를 가장 많이 받은 것"으로 자동 선정하는 구조로 바꾼다.

## 범위

- **대상 필드는 `order_catalog.image_uri` 하나뿐.** `name`/`brand`/`price`/`category`는 이 설계와 무관 — 기존 `kind='fix'` 승인 흐름 그대로 유지.
- 새 테이블 2개(`order_catalog_photos`, `order_photo_votes`)를 추가하고, 대표 사진은 트리거가 득표 기준으로 자동 계산해 `order_catalog.image_uri`에 반영한다.
- **`order_photo_flags` 테이블과 `flagCatalogPhoto()`("사진이 실제 상품과 달라요", 2명 합의 시 초기화)는 완전히 삭제하고 새 투표로 대체한다.**
- `apply_approved_order_report` 트리거(`kind='fix'` 처리)는 **더 이상 `image_uri`/`clear_photo`를 건드리지 않는다** — 오류신고 승인이 사진을 덮어쓰던 경로 자체를 없앤다.
- 저작권 삭제 요청은 여전히 즉시 처리하되, 대상이 `barcode_catalog.image_uri`가 아니라 `order_catalog_photos`의 해당 사진 행이 된다.
- **`barcode_catalog`(바코드 스캔 시 이름/사진 자동채움용 범용 캐시)는 범위 밖.** 이 테이블은 `.upsert()`로 매번 무조건 덮어쓰는 구조라 같은 문제가 있지만, 소비 경로가 "신규 스캔 시 제안"일 뿐이라 위험도가 낮고 별도 트랙으로 미룬다.

## 아키텍처 / 데이터 흐름

```
[신규 상품 등록] submitNewOrderProduct(product)
  1. order_product_reports insert (kind='new', status='approved')
     → 기존 트리거가 order_catalog에 name/brand/price/category upsert (사진 필드 없음)
  2. (1이 성공한 뒤) product.imageUri 있으면 order_catalog_photos에 첫 후보로 insert
     → 트리거가 대표 사진 재계산 (후보가 1장뿐이므로 그대로 대표가 됨)

[기존 상품 사진 변경] saveOrderProduct → submitPhotoCandidateIfChanged(barcode, imageUri)
  로컬 기록(submittedPhotoCandidates:v1)의 마지막 제출 URI와 다르면
    → order_catalog_photos에 새 후보 insert (0표로 시작)
    → 트리거가 대표 사진 재계산 (기존에 득표 있는 사진을 밀어내지 못함)
  같으면 아무것도 안 함 (같은 사진 반복 저장 시 후보 중복 방지)

[투표] 사용자가 "사진 후보 보기/투표" 화면에서 좋아요/싫어요
  order_photo_votes upsert (사용자당 사진당 1행)
    → 트리거가 그 바코드의 대표 사진 재계산

[저작권 삭제] (관리자, 즉시 처리는 기존과 동일)
  해당 order_catalog_photos 행 delete
    → 트리거가 대표 사진 재계산 (다음 순위로 자동 대체, 없으면 null)

[정보 오류 신고 승인] (kind='fix', 기존과 동일하되 사진 제외)
  order_product_reports.status → 'approved'
    → 트리거가 order_catalog의 name/brand/price/category만 갱신, image_uri는 그대로
```

**대표 사진 선정 규칙:** 그 바코드의 후보 사진 중 (좋아요 수 − 싫어요 수)가 가장 높은 것. 동점이면 먼저 등록된 사진.

## 컴포넌트 상세

### Supabase 스키마 (신규 `supabase/migration-order-photo-voting.sql`)

```sql
create table if not exists public.order_catalog_photos (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  photo_uri text not null,
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists order_catalog_photos_barcode_idx on public.order_catalog_photos(barcode);

alter table public.order_catalog_photos enable row level security;
create policy "order_catalog_photos select all" on public.order_catalog_photos for select using (true);
create policy "order_catalog_photos insert own" on public.order_catalog_photos
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 일반 사용자는 후보를 못 지움. 저작권 삭제는 관리자가 대시보드(서비스 롤)에서 직접 delete.

create table if not exists public.order_photo_votes (
  photo_id uuid not null references public.order_catalog_photos(id) on delete cascade,
  voter_id uuid not null references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (photo_id, voter_id)
);

alter table public.order_photo_votes enable row level security;
create policy "order_photo_votes select all" on public.order_photo_votes for select using (true);
create policy "order_photo_votes insert own" on public.order_photo_votes
  for insert with check (auth.uid() = voter_id);
create policy "order_photo_votes update own" on public.order_photo_votes
  for update using (auth.uid() = voter_id);
create policy "order_photo_votes delete own" on public.order_photo_votes
  for delete using (auth.uid() = voter_id);

-- 대표 사진 재계산 (득표 최고 → 동점이면 최초 등록 우선)
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

-- 기존 사진 신고 기능 제거
drop table if exists public.order_photo_flags;
```

`apply_approved_order_report` 함수도 아래처럼 사진 관련 부분을 제거한 버전으로 교체한다(마이그레이션에 포함):

```sql
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
```

### `src/lib/order-report.ts` (수정)

- `flagCatalogPhoto()` 삭제.
- `submitCatalogPhotoFill()` → `submitPhotoCandidateIfChanged(barcode, photoUri)`로 교체:
  - 로컬 `submittedPhotoCandidates:v1`(barcode → 마지막 제출 URI)을 확인, 같으면 아무것도 안 하고 반환.
  - 다르면 `order_catalog_photos`에 insert, 성공하면 로컬 기록 갱신. best-effort(실패해도 무시).
- `submitNewOrderProduct(product)`: 기존 report insert가 **성공한 뒤에** `product.imageUri`가 있으면 같은 방식으로 `order_catalog_photos`에 insert. (순서 중요 — `order_catalog` 행이 아직 없는 상태에서 사진부터 넣으면 대표 사진 재계산 UPDATE가 대상 행을 못 찾아 조용히 유실된다.)
- 저작권 신고(`isCopyright`) 경로: `barcode_catalog` 업데이트는 유지하되, 추가로 `order_catalog_photos`에서 `barcode`+`photo_uri` 일치하는 행을 delete.
- 신규: `voteOnPhoto(photoId, vote: 1 | -1)` — `order_photo_votes`에 upsert. 같은 값으로 다시 누르면 delete(투표 취소).
- 신규: `listPhotoCandidates(barcode)` — `order_catalog_photos` + `order_photo_votes`를 조회해 사진별 좋아요/싫어요 수와 내 투표 상태를 계산해 반환.

### `src/lib/order-repo.ts` (수정)

```ts
if (isNew) {
  submitNewOrderProduct(p).catch(() => {});
} else if (p.barcode && p.imageUri) {
  submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
}
```
기존 `hadNoPhoto` 조건 제거 — 이제 "빈 슬롯일 때만"이 아니라 "사진이 바뀔 때마다" 후보로 들어간다.

### `src/app/order-product-form.tsx` (수정)

- "사진이 실제 상품과 달라요" `Pressable`(`flagPhoto`)을 제거하고 "사진 후보 보기/투표" 링크로 교체 → 신규 컴포넌트 `PhotoCandidatesModal` 오픈.
- `PhotoCandidatesModal`: 기존 `ImageCandidatesModal`의 리스트 렌더링 뼈대를 기반으로, 각 항목에 사진 미리보기 + 좋아요/싫어요 버튼 + 현재 득표수를 추가한 새 컴포넌트로 만든다(순수 재사용은 아니고 확장).

## 마이그레이션 절차 (실행 순서)

1. `supabase/migration-order-photo-voting.sql` (신규 테이블/트리거/RLS + `apply_approved_order_report` 교체 + `order_photo_flags` DROP) 대시보드 SQL Editor에서 실행
2. 앱 코드 변경 배포
3. 기존에 이미 `order_catalog.image_uri`가 채워진 바코드들은 후보 테이블에 아무 행도 없는 상태로 시작한다 — 문제 없음(대표 사진 컬럼은 그대로 유지되고, 누군가 새 후보를 올려서 더 많은 표를 받기 전까지는 기존 사진이 계속 대표로 남는다).

## 에러 처리

- `order_catalog_photos`/`order_photo_votes` insert 실패(네트워크 등): 전부 best-effort, catch로 무시 — 로컬 저장 흐름을 막지 않는다.
- 대표 사진 재계산 트리거 실패 시 원본 insert/delete 자체가 롤백된다(Postgres 기본 동작).
- 자기 사진에 자기가 투표하는 것은 막지 않는다 — 악용 사례가 실제로 나오면 `submitted_by <> voter_id` 체크를 추가한다(지금은 범위 밖).
- 신규 상품의 사진 후보 insert가 `order_catalog` 행 생성보다 먼저 일어나지 않도록 `submitNewOrderProduct` 내부에서 순서를 강제한다(위 컴포넌트 상세 참고) — 그래도 실패하면 최악의 경우 대표 사진이 비어있는 상태로 남을 뿐, 다음에 누가 후보를 하나 더 올리면(또는 기존 사진 편집 시 재제출하면) 정상화된다.

## 테스트

자동화 테스트 스위트가 없는 수동 QA 앱(기존 관례 유지). 구현 후 아래 시나리오를 수동으로 확인한다.

1. A가 신규 상품 등록(사진 포함) → 대표 사진이 즉시 A의 사진으로 뜨는지 확인
2. B가 같은 상품을 편집하며 다른(이상한) 사진으로 교체 → 대표 사진이 **바뀌지 않고** A의 사진 그대로인지 확인(투표 없이는 안 바뀌어야 함)
3. 다른 사용자 여러 명이 B의 사진에 좋아요를 A의 사진 좋아요 수보다 많이 누름 → 대표 사진이 B의 사진으로 자동 전환되는지 확인
4. 같은 사용자가 같은 사진을 반복 좋아요 시도(같은 값 재클릭) → 투표 취소(중립)로 바뀌는지 확인
5. 저작권 삭제로 대표 사진이 지워짐 → 다음 순위 후보(또는 없으면 빈 사진)로 자동 대체되는지 확인
6. 정보 오류 신고(가격 등, 사진 미첨부)가 관리자 승인됨 → 대표 사진은 전혀 안 바뀌는지 확인
7. 같은 사진을 반복 저장(변경 없음) → 후보 테이블에 중복 행이 안 쌓이는지 확인
