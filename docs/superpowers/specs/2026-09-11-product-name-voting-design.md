# 상품명(name) 좋아요/싫어요 투표 — 유통기한·발주 공용

**날짜:** 2026-09-11
**대상 프로젝트:** expiry-keeper

## 배경

바코드 하나의 상품명은 두 개의 독립된 공용 캐시에 따로 저장된다.

- `barcode_catalog.name` — 유통기한 앱이 스캔 시 자동채움에 쓴다. `saveProduct()`가 저장할 때마다 `upsertBarcodeCatalog()`로 **무조건 덮어씀** (`src/lib/repo.ts:177`, `src/lib/barcode-catalog.ts`). RLS도 로그인 사용자 누구나 update 가능 — "마지막에 저장한 사람이 이김" 구조.
- `order_catalog.name` — 발주 앱의 정답 소스. 신규 등록(`kind='new'`)은 자동승인으로 즉시 반영되지만, 기존 상품의 이름 오류는 `reportOrderProductIssue()` → `order_product_reports`(kind='fix') → **관리자가 Supabase 대시보드에서 수동 승인**해야 `apply_approved_order_report` 트리거가 반영한다. 승인 전까지는 각 사용자가 "Update" 버튼을 눌러야 로컬에도 반영된다.

두 경로 모두 근본적으로 같은 문제를 갖고 있다: **이름의 품질을 비교하는 로직이 없다.** 재고 쪽은 아무나 덮어쓸 수 있어 오염에 취약하고, 발주 쪽은 관리자 병목 때문에 반영이 느리다.

정확히 같은 문제를 사진(`image_uri`)에서는 이미 해결했다 — `order_catalog_photos`/`order_photo_votes`(득표 최고 사진이 실시간 대표 사진, `migration-order-photo-voting.sql`)를 만들고, `migration-barcode-catalog-photo-voting.sql`로 barcode_catalog까지 같은 후보 풀을 공유하도록 확장했다. 이 설계는 **같은 패턴을 상품명에도 그대로 적용**한다.

## 범위

- **대상 필드는 이름(`barcode_catalog.name` / `order_catalog.name`) 하나뿐.** 사진은 이미 완성되어 있으므로 그대로 둔다. 가격/카테고리/브랜드는 이 설계와 무관 — 기존 `order_product_reports`(kind='fix') 관리자 승인 흐름 그대로 유지.
- 새 테이블 2개(`product_name_candidates`, `product_name_votes`)를 만들고, 사진과 마찬가지로 **바코드당 하나의 공용 후보/투표 풀을 두 카탈로그가 공유**한다 — 상품의 "진짜 이름"은 재고 앱에서 보든 발주 앱에서 보든 같아야 하므로, catalog 구분 컬럼 없이 대표 이름을 `barcode_catalog.name`과 `order_catalog.name` 양쪽에 동시 반영한다.
- **재고(`barcode_catalog`) 최초 등록은 지금처럼 즉시 반영된다.** 후보가 0개인 바코드에 처음 이름이 제출되면 그 후보가 유일하므로 즉시 대표가 되어, 실질적으로 지금과 체감 차이가 없다. 이미 후보(득표)가 있는 바코드에 다른 이름을 저장하면 새 0표 후보로만 추가되고, 투표로 득표해야 대표 자리를 넘겨받는다.
- **발주(`order_catalog`)의 `order_product_reports`(kind='fix') 이름 필드 처리를 폐기하고 후보/투표로 대체.** `apply_approved_order_report` 트리거는 더 이상 `name`을 건드리지 않는다(사진 때 `image_uri`를 뺀 것과 동일한 방식). brand/price/category는 그대로 이 트리거가 처리한다.
- **후보 백필 필요.** 사진 때와 똑같은 이유로, 새 테이블 도입 시 기존 이름을 0표 후보로 먼저 채워넣지 않으면 누군가 새 이름을 제안하는 즉시 (동점 시 최초 등록 우선 규칙에 따라) 기존 이름을 밀어낸다. `order_catalog`와 `barcode_catalog`에 이미 있는 이름을 각각 첫 후보로 백필한다(같은 바코드에 이미 후보가 생겼으면 건너뜀 — 두 테이블의 기존 이름이 서로 다를 수 있으므로, 어느 쪽이 먼저 백필되든 그 이름이 초기 대표가 되는 일회성 정리로 취급한다).

## 아키텍처 / 데이터 흐름

```
[재고 상품 저장] saveProduct(p) — src/lib/repo.ts
  1. products upsert (기존과 동일)
  2. upsertBarcodeCatalog(barcode, name, imageUri) — 여전히 즉시 upsert (최초 등록 시 NOT NULL 제약 충족 + 빠른 초기값)
  3. submitNameCandidateIfChanged(barcode, name) — 신규
     로컬 기록(submittedNameCandidates:v1)의 마지막 제출값과 다르면 product_name_candidates에 새 후보 insert
     → 트리거가 대표 이름 재계산 (후보가 이것뿐이면 그대로 대표, 아니면 기존 고득표 이름 유지)

[발주 상품 저장] saveOrderProduct(p) — src/lib/order-repo.ts
  1. 로컬 저장 (기존과 동일)
  2. upsertBarcodeCatalog(barcode, name, imageUri) — 기존과 동일 (barcode_catalog 즉시 upsert)
  3. isNew → submitNewOrderProduct(p) (기존과 동일, order_catalog에 최초 등록)
  4. submitNameCandidateIfChanged(barcode, name) — 신규, 신규/수정 모두 호출
     (기존에는 수정 시 이름이 order_catalog에 전혀 반영되지 않았음 — 이 설계로 처음 반영 경로가 생김)

[정보 수정 제안 — 이름] 사용자가 상품 화면 "이름 후보 보기/제안" → 새 이름 입력
  submitNameCandidate(barcode, name) → product_name_candidates insert (0표로 시작)
  → 트리거가 대표 이름 재계산

[투표] "이름 후보 보기/투표" 화면에서 후보별 좋아요/싫어요
  voteOnName(candidateId, vote) → product_name_votes upsert (사용자당 후보당 1행)
  → 트리거가 그 바코드의 대표 이름 재계산

[정보 오류 신고 승인 — 이름 제외] (kind='fix', brand/price/category만)
  order_product_reports.status → 'approved'
  → 트리거가 brand/price/category만 갱신, name은 더 이상 건드리지 않음
```

**대표 이름 선정 규칙:** 그 바코드의 후보 이름 중 (좋아요 수 − 싫어요 수)가 가장 높은 것. 동점이면 먼저 등록된 후보. (사진과 동일한 규칙.)

## 컴포넌트 상세

### Supabase 스키마 (신규 `supabase/migration-product-name-voting.sql`)

```sql
create table if not exists public.product_name_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  name text not null,
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists product_name_candidates_barcode_idx on public.product_name_candidates(barcode);

alter table public.product_name_candidates enable row level security;
create policy "product_name_candidates select all" on public.product_name_candidates for select using (true);
create policy "product_name_candidates insert own" on public.product_name_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다. 사진과 달리 저작권 삭제 같은 필요가 없다.

create table if not exists public.product_name_votes (
  candidate_id uuid not null references public.product_name_candidates(id) on delete cascade,
  voter_id uuid not null references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (candidate_id, voter_id)
);

alter table public.product_name_votes enable row level security;
create policy "product_name_votes select all" on public.product_name_votes for select using (true);
create policy "product_name_votes insert own" on public.product_name_votes
  for insert with check (auth.uid() = voter_id);
create policy "product_name_votes update own" on public.product_name_votes
  for update using (auth.uid() = voter_id);
create policy "product_name_votes delete own" on public.product_name_votes
  for delete using (auth.uid() = voter_id);

-- 대표 이름 재계산 (득표 최고 → 동점이면 최초 등록 우선). order_catalog/barcode_catalog 양쪽에 반영.
create or replace function public.recalc_product_name_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_name text;
begin
  select c.name into winner_name
  from public.product_name_candidates c
  left join (
    select candidate_id, sum(vote) as score
    from public.product_name_votes
    group by candidate_id
  ) v on v.candidate_id = c.id
  where c.barcode = target_barcode
  order by coalesce(v.score, 0) desc, c.created_at asc
  limit 1;

  if winner_name is null then
    return;
  end if;

  update public.order_catalog set name = winner_name, updated_at = now() where barcode = target_barcode;
  update public.barcode_catalog set name = winner_name, updated_at = now() where barcode = target_barcode;
end;
$$;

create or replace function public.product_name_candidates_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_product_name_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_name_candidates_recalc on public.product_name_candidates;
create trigger product_name_candidates_recalc
  after insert or delete on public.product_name_candidates
  for each row execute function public.product_name_candidates_recalc_trigger();

create or replace function public.product_name_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.product_name_candidates
  where id = coalesce(new.candidate_id, old.candidate_id);
  perform public.recalc_product_name_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_name_votes_recalc on public.product_name_votes;
create trigger product_name_votes_recalc
  after insert or update or delete on public.product_name_votes
  for each row execute function public.product_name_votes_recalc_trigger();

-- 백필: order_catalog를 우선으로 첫 후보 채우기
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where name is not null
  and not exists (select 1 from public.product_name_candidates c where c.barcode = order_catalog.barcode);

-- 백필: barcode_catalog 중 아직 후보가 없는 바코드만 추가
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.barcode_catalog
where not exists (select 1 from public.product_name_candidates c where c.barcode = barcode_catalog.barcode);

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 name을 건드리지 않도록 교체
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

  insert into public.order_catalog (barcode, brand, price, category, updated_at)
  values (new.barcode, nullif(new.brand, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    brand = coalesce(nullif(excluded.brand, ''), order_catalog.brand),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;
```

`submitted_by`는 백필(대시보드 SQL 실행 컨텍스트라 `auth.uid()`가 null)이라 사진 백필과 동일하게 sentinel uuid를 쓴다. 이 컬럼엔 FK가 있어 실제 사용자 제출은 반드시 로그인 상태여야 한다(사진과 동일).

### `src/lib/name-candidates.ts` (신규, `photo-candidates.ts` 그대로 미러링)

- 로컬 오버라이드 기록(`submittedNameCandidates:v1`, barcode → 마지막 제출 이름)을 읽고 쓰는 `getSubmittedNameCandidates()`/`recordSubmittedNameCandidate()` — `photo-candidates.ts`의 동명 함수와 동일한 구조.
- `submitNameCandidateIfChanged(barcode, name)`: 로컬 기록의 마지막 제출 이름과 다를 때만 기록을 갱신하고 `submitNameCandidate()`를 호출한다(같은 이름 반복 저장 시 후보 중복 방지). 재고(`repo.ts`)와 발주(`order-repo.ts`) 양쪽에서 이 함수를 공유한다.
- `submitNameCandidate(barcode, name)`: `product_name_candidates`에 insert만 하는 얇은 함수 — 사진과 달리 업로드 과정이 없어 `photo-candidates.ts`의 "업로드 후 URL 보정" 로직은 필요 없다.
- `listNameCandidates(barcode)`: `product_name_candidates` + `product_name_votes`를 조회해 후보별 좋아요/싫어요 수와 내 투표 상태를 계산해 반환 — `order-report.ts`의 `listPhotoCandidates()`와 동일 구조, 반환 타입은 `{ id, name, likes, dislikes, myVote }[]`.
- `voteOnName(candidateId, vote)`: `product_name_votes`에 upsert, 같은 값으로 재투표하면 delete(취소) — `order-report.ts`의 `voteOnPhoto()`와 동일 구조.

### `src/lib/repo.ts` (수정)

```ts
await upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
if (uploaded.barcode) {
  submitNameCandidateIfChanged(uploaded.barcode, uploaded.name).catch(() => {});
}
if (uploaded.barcode && uploaded.imageUri) {
  submitPhotoCandidateIfChanged(uploaded.barcode, uploaded.imageUri).catch(() => {});
}
```

### `src/lib/order-repo.ts` (수정)

```ts
upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
if (p.barcode) {
  submitNameCandidateIfChanged(p.barcode, p.name).catch(() => {});
}
if (isNew) {
  submitNewOrderProduct(p).catch(() => {});
} else if (p.barcode && p.imageUri) {
  await submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
}
```

### `src/lib/order-report.ts` (수정 불필요)

`order_product_reports.name`은 `not null` 컬럼이라 `reportOrderProductIssue()`가 계속 `product.name`을 채워 보내야 insert 자체가 성공한다. 코드 변경은 필요 없다 — Task 1의 `apply_approved_order_report` 트리거 교체만으로 그 값이 더 이상 `order_catalog.name`에 반영되지 않는다(전송은 되지만 트리거가 무시).

### UI (`src/components/NameCandidatesModal.tsx` 신규, `PhotoCandidatesModal.tsx` 구조 재사용)

- 텍스트 목록 + 후보별 좋아요/싫어요 버튼 + 득표수. 화면 하단에 "다른 이름 제안하기" 입력창 → `submitNameCandidate` 호출.
- `product-form.tsx`(재고), `order-product-form.tsx`(발주) 양쪽에 기존 "사진 후보 보기/투표" 링크 옆에 "이름 후보 보기/투표" 링크 추가. 현재 대표 이름 옆에 득표 현황을 작게 표시(예: "두부 · 👍3 👎0")해 사용자가 굳이 모달을 열지 않아도 신뢰도를 바로 볼 수 있게 한다.

## 참여도를 높이는 방법 (가볍게)

무거운 포인트/뱃지 시스템 백엔드를 새로 만들지 않고, 이미 있는 로컬 기록만으로 할 수 있는 것부터:

1. **득표 현황 상시 노출** — 위 UI에서 언급한 "두부 · 👍3 👎0" 표시. 자기 확신 없이 던지는 신고보다, "이미 3명이 동의했다"는 사회적 증거가 투표 참여를 늘린다(사진 때는 이 표시가 없었음 — 이번엔 처음부터 넣는다).
2. **내 제안 채택 알림** — `submittedNameCandidates:v1`(로컬)에 기록된 값과 서버의 현재 대표 이름이 같아졌는지 다음 실행 시 비교해서, 처음 일치가 확인되는 순간 가벼운 토스트("회원님이 제안한 이름이 채택되었어요!")를 한 번 띄운다. 새 서버 자원 없이 클라이언트 비교만으로 가능.
3. **내 기여 요약(설정 화면)** — "내가 제안한 정보 N건 · 채택 M건"을 `submittedNameCandidates`/`submittedPhotoCandidates` 로컬 기록 개수 + 서버 값과의 일치 여부로 근사 계산해 표시. 정확한 전수조사가 아니라 동기부여용 근사치임을 UI에 작게 명시.
4. (범위 밖, 나중에 필요해지면) 리더보드나 포인트 같은 본격 게이미피케이션은 별도 설계로 — 지금은 신뢰도 체계 자체를 먼저 안정시키는 게 우선이라 뒤로 미룬다.

## 마이그레이션 절차 (실행 순서)

1. `supabase/migration-product-name-voting.sql` (신규 테이블/트리거/RLS + 백필 + `apply_approved_order_report` 교체) 대시보드 SQL Editor에서 실행
2. 앱 코드 변경 배포 (`name-candidates.ts` 신규, `repo.ts`/`order-repo.ts`/`order-report.ts` 수정, `NameCandidatesModal` 추가)
3. 백필 직후에는 두 카탈로그의 기존 이름이 서로 다를 수 있는 바코드들이 한 번에 한쪽으로 정리된다(어느 백필 insert가 먼저 실행됐는지에 따라 order_catalog 우선). 사용자에게 공지할 필요는 없음 — 사진 백필 때도 조용히 처리됐던 것과 동일한 성격.

## 에러 처리

- `product_name_candidates`/`product_name_votes` insert 실패(네트워크 등): 전부 best-effort, catch로 무시 — 로컬 저장 흐름을 막지 않는다(사진과 동일).
- 대표 이름 재계산 트리거 실패 시 원본 insert/delete 자체가 롤백된다(Postgres 기본 동작).
- 자기 이름 제안에 자기가 투표하는 것은 막지 않는다 — 사진 때와 동일한 트레이드오프, 악용 사례가 나오면 `submitted_by <> voter_id` 체크를 추가한다(지금은 범위 밖).
- 빈 문자열 이름 제안은 클라이언트에서 막는다(`name.trim()` 체크, `upsertBarcodeCatalog`와 동일한 관례).

## 테스트

자동화 테스트 스위트가 없는 수동 QA 앱(기존 관례 유지). 구현 후 아래 시나리오를 수동으로 확인한다.

1. 한 번도 등록 안 된 바코드를 재고 앱에서 신규 등록 → 대표 이름이 즉시 그 이름으로 뜨는지 확인 (기존 체감과 동일해야 함)
2. 발주 앱에서 같은 바코드를 다른 이름으로 신규 등록(발주 쪽이 먼저 등록된 상황 재현) → 재고 앱에서 봐도 발주 쪽 이름이 보이는지 확인 (공유 풀 확인)
3. 기존에 득표가 있는 상품명을 다른 사용자가 다른 이름으로 재고 화면에서 저장 → 대표 이름이 **바뀌지 않고** 그대로인지 확인(투표 없이는 안 바뀌어야 함)
4. 여러 사용자가 새 이름 후보에 좋아요를 기존 이름 좋아요 수보다 많이 누름 → 대표 이름이 새 이름으로 자동 전환되고, 재고·발주 양쪽 화면에 모두 반영되는지 확인
5. 같은 사용자가 같은 후보에 반복 투표(같은 값 재클릭) → 투표 취소(중립)로 바뀌는지 확인
6. 브랜드/가격 오류 신고가 관리자 승인됨 → 이름은 전혀 안 바뀌는지 확인
7. 내가 제안한 이름이 채택된 뒤 앱 재실행 → "채택되었어요" 토스트가 한 번만 뜨는지 확인
