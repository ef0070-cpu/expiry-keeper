# 상품명 투표 구현 + 후보 투표 화면 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품명(name) 좋아요/싫어요 투표를 사진·브랜드와 동일한 구조로 신규 구현하고, 필드마다 따로였던 사진/브랜드/상품명 후보-투표 모달을 탭 하나의 공용 `CandidatesModal`로 통합한다.

**Architecture:** Supabase에 `product_name_candidates`/`product_name_votes` 테이블과 대표값 재계산 트리거를 추가해 사진(`order_catalog_photos`)·브랜드(`product_brand_candidates`)와 동일한 "후보+투표, 득표 1위가 실시간 대표값" 패턴을 이름에도 적용한다. 클라이언트는 `order-report.ts`/`name-candidates.ts`에 브랜드와 동일한 구조의 함수를 추가하고, 기존 `PhotoCandidatesModal`/`BrandCandidatesModal` 두 컴포넌트를 탭(사진/브랜드/상품명) 하나짜리 `CandidatesModal`로 합쳐 재고(`product-form.tsx`)·발주(`order-product-form.tsx`) 화면에 배선한다.

**Tech Stack:** React Native (Expo Router), TypeScript, NativeWind(Tailwind 클래스), Supabase(Postgres + RLS + 트리거), AsyncStorage.

## Global Constraints

- 이 프로젝트에는 자동화 테스트 스위트가 없다(수동 QA 앱, 기존 관례). 각 코드 작업 후 자동 검증은 `npx tsc --noEmit`(타입 체크)로 하고, 동작 검증은 명시된 수동 QA 절차로 한다. **베이스라인**: 이 플랜 작업 시작 전에도 `src/app/login.tsx(115,45): error TS18047: 'supabase' is possibly 'null'.` 에러 1건이 이미 존재한다(이 플랜과 무관, 손대지 않는다) — `tsc --noEmit` 결과를 볼 때 이 한 줄 외에 **새 에러가 없는지**만 확인한다.
- 모든 후보 제출/투표 네트워크 호출은 best-effort로 `.catch(() => {})` 처리해 로컬 저장 흐름을 막지 않는다 — 단 `voteOnX()` 함수 자체는 예외로, 호출자(모달)가 실패를 `Alert`로 사용자에게 보여줘야 하므로 에러를 던진다(기존 `voteOnBrand`/`voteOnPhoto`와 동일).
- UI 문구는 전부 한국어. 디자인 토큰(`bg-primary`/`text-primary`/`bg-paper`/`text-muted`/`border-line`/`text-ink`)은 기존 파일에서 쓰던 값을 그대로 재사용한다 — 새 색상 코드를 만들지 않는다.
- Supabase 마이그레이션 SQL은 대시보드 SQL Editor에 직접 붙여넣어 실행하는 방식이다(마이그레이션 도구 없음, 기존 관례). 이 플랜의 SQL 작업(Task 1)은 사람이 대시보드에서 직접 실행해야 하며, 에이전트가 대신 실행할 수 없다 — 실행 후 확인 쿼리로 검증한다.

---

### Task 1: Supabase 마이그레이션 — 상품명 투표 테이블/트리거

**Files:**
- Create: `supabase/migration-product-name-voting.sql`

**Interfaces:**
- Consumes: 기존 `public.order_catalog`(컬럼 `barcode`, `name`, `price`, `category`, `updated_at`), `public.barcode_catalog`(컬럼 `barcode`, `name`, `updated_at`), `public.order_product_reports`(컬럼 `status`, `barcode`, `price`, `category` — `apply_approved_order_report` 트리거가 참조). 직전 상태는 `supabase/migration-order-brand-voting.sql`이 정의한 `apply_approved_order_report()`(현재 `name`/`price`/`category`만 갱신, `brand`는 이미 제외됨)이다.
- Produces: 테이블 `public.product_name_candidates(id, barcode, name, submitted_by, created_at)`, `public.product_name_votes(candidate_id, voter_id, vote, created_at)`. Task 2가 이 두 테이블에 직접 SQL 쿼리를 날린다 — 컬럼명이 정확히 일치해야 한다.

> ⚠️ 중요: 이 문서의 전제 문서인 `docs/superpowers/specs/2026-09-11-product-name-voting-design.md`의 SQL 초안을 **그대로 복사하지 말 것**. 그 초안은 `submitted_by uuid not null references auth.users(id)`(FK 있음)로 되어 있는데, 이후 브랜드 투표(`migration-order-brand-voting.sql`)에서 리뷰로 발견된 버그였다 — 백필이 대시보드 실행 컨텍스트(`auth.uid()`가 null)라 sentinel uuid로 넣는데, FK가 있으면 그 sentinel uuid가 `auth.users`에 없어 백필 전체가 롤백된다. 브랜드는 이 버그를 고치면서 FK를 제거(`default auth.uid()`만 사용)했고, 아래 SQL은 그 수정된 패턴을 따른다. 또한 브랜드 리뷰에서 추가된 `(barcode, lower(btrim(brand)))` 유니크 인덱스(표 분산 방지)도 이름에 동일하게 적용한다.

- [ ] **Step 1: SQL 파일 작성**

`supabase/migration-product-name-voting.sql` 생성:

```sql
-- 상품명 좋아요/싫어요 투표 (2026-09-15)
-- 사진(order_catalog_photos/order_photo_votes)·브랜드(product_brand_candidates/votes)와 동일한
-- "후보 + 투표, 득표 1위가 실시간 대표값" 방식을 barcode_catalog.name / order_catalog.name에
-- 적용한다. 두 카탈로그가 후보 풀을 공유한다(바코드 하나의 "진짜 이름"은 앱과 무관하게 동일).
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.product_name_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  name text not null,
  -- submitted_by에 FK 없음: 아래 백필이 대시보드 실행 컨텍스트(auth.uid()가 null)에서 sentinel
  -- uuid를 넣기 때문. FK가 있으면 백필이 실패해 스크립트 전체가 롤백된다(브랜드와 동일한 이유).
  submitted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists product_name_candidates_barcode_idx on public.product_name_candidates(barcode);
-- 같은 이름 텍스트를 여러 기기가 각각 제안하면 표가 갈려 대표 선정이 안 된다.
-- 대소문자/앞뒤 공백을 무시한 유니크 인덱스로 한 후보에 표가 모이게 한다(브랜드와 동일).
create unique index if not exists product_name_candidates_barcode_name_idx
  on public.product_name_candidates (barcode, lower(btrim(name)));

alter table public.product_name_candidates enable row level security;
drop policy if exists "product_name_candidates select all" on public.product_name_candidates;
create policy "product_name_candidates select all" on public.product_name_candidates for select using (true);
drop policy if exists "product_name_candidates insert own" on public.product_name_candidates;
create policy "product_name_candidates insert own" on public.product_name_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다.

create table if not exists public.product_name_votes (
  candidate_id uuid not null references public.product_name_candidates(id) on delete cascade,
  voter_id uuid not null default auth.uid() references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (candidate_id, voter_id)
);

alter table public.product_name_votes enable row level security;
drop policy if exists "product_name_votes select all" on public.product_name_votes;
create policy "product_name_votes select all" on public.product_name_votes for select using (true);
drop policy if exists "product_name_votes insert own" on public.product_name_votes;
create policy "product_name_votes insert own" on public.product_name_votes
  for insert with check (auth.uid() = voter_id);
drop policy if exists "product_name_votes update own" on public.product_name_votes;
create policy "product_name_votes update own" on public.product_name_votes
  for update using (auth.uid() = voter_id);
drop policy if exists "product_name_votes delete own" on public.product_name_votes;
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

-- 백필: order_catalog를 우선으로 첫 후보 채우기 (빈 문자열/null 제외)
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where name is not null and name <> ''
  and not exists (select 1 from public.product_name_candidates c where c.barcode = order_catalog.barcode);

-- 백필: barcode_catalog 중 아직 후보가 없는 바코드만 추가
insert into public.product_name_candidates (barcode, name, submitted_by)
select barcode, name, '00000000-0000-0000-0000-000000000000'::uuid
from public.barcode_catalog
where name is not null and name <> ''
  and not exists (select 1 from public.product_name_candidates c where c.barcode = barcode_catalog.barcode);

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 name을 건드리지 않도록 트리거 교체.
-- (직전 버전은 migration-order-brand-voting.sql이 정의한, brand를 이미 뺀 버전이다. 이번엔 그 위에
-- name까지 빼서 최종적으로 price/category만 갱신하는 버전으로 교체한다.)
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

  insert into public.order_catalog (barcode, price, category, updated_at)
  values (new.barcode, new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;
```

- [ ] **Step 2: Supabase 대시보드에서 실행**

Supabase 프로젝트 대시보드 → SQL Editor → 위 SQL 전체 붙여넣고 Run. 에러 없이 완료되는지 확인.

- [ ] **Step 3: 백필 결과 확인 쿼리**

같은 SQL Editor에서 실행:

```sql
select count(*) from public.product_name_candidates;
select barcode, name from public.product_name_candidates limit 5;
```

`order_catalog`/`barcode_catalog`에 있던 기존 바코드 수만큼 후보가 생겼는지(0건이 아닌지) 확인.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-product-name-voting.sql
git commit -m "feat: 상품명 투표 Supabase 마이그레이션 추가"
```

---

### Task 2: `order-report.ts`에 상품명 후보 CRUD 함수 추가

**Files:**
- Modify: `src/lib/order-report.ts` (파일 끝, 현재 304줄 — `voteOnBrand` 뒤에 추가)

**Interfaces:**
- Consumes: Task 1이 만든 `product_name_candidates`/`product_name_votes` 테이블. 같은 파일에 이미 있는 `supabase` 클라이언트(파일 상단에서 import됨, 별도 작업 불필요).
- Produces: `submitNameCandidate(barcode: string, name: string): Promise<void>`, `type NameCandidate = { id: string; name: string; likes: number; dislikes: number; myVote: 1 | -1 | null }`, `listNameCandidates(barcode: string): Promise<NameCandidate[]>`, `voteOnName(candidateId: string, vote: 1 | -1): Promise<void>`. Task 3(`name-candidates.ts`)이 `submitNameCandidate`를, Task 6(`CandidatesModal.tsx`)이 `NameCandidate`/`listNameCandidates`/`voteOnName`을 가져다 쓴다.

이 파일의 `submitBrandCandidate`(204~231줄)/`BrandCandidate`(233~239줄)/`listBrandCandidates`(242~274줄)/`voteOnBrand`(277~304줄)를 그대로 미러링한다 — `brand`→`name`, `product_brand_candidates`→`product_name_candidates`, `product_brand_votes`→`product_name_votes`로만 치환.

- [ ] **Step 1: 파일 끝에 함수 4개 추가**

`src/lib/order-report.ts` 304줄(파일 끝) 뒤에 추가:

```ts

/** 상품명 후보를 product_name_candidates에 추가하고 제출자가 자동으로 좋아요를 누른다.
 * 자동 좋아요가 없으면 기존 이름(배포 시 0표로 백필됨)과 득표 동점이 되고, 동점이면
 * 먼저 등록된 후보가 우선하는 규칙 때문에 방금 낸 후보가 절대 대표값이 되지 못한다
 * (브랜드와 동일한 이유 — submitBrandCandidate 참고). */
export async function submitNameCandidate(barcode: string, name: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: inserted, error } = await supabase
      .from('product_name_candidates')
      .insert({ barcode, name })
      .select('id')
      .single();
    let candidateId = inserted?.id as string | undefined;
    if (error) {
      // 유니크 제약(barcode, lower(btrim(name))) 충돌 = 이미 같은 텍스트의 후보가 있음.
      // 이 경우에도 그 기존 후보에 좋아요를 눌러줘야 자동 좋아요 효과가 있다.
      const { data: existing } = await supabase
        .from('product_name_candidates')
        .select('id')
        .eq('barcode', barcode)
        .ilike('name', name.trim())
        .maybeSingle();
      candidateId = existing?.id;
    }
    if (!candidateId) return;
    await supabase
      .from('product_name_votes')
      .upsert({ candidate_id: candidateId, vote: 1 }, { onConflict: 'candidate_id,voter_id' });
  } catch {
    // best-effort
  }
}

export type NameCandidate = {
  id: string;
  name: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 상품명 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listNameCandidates(barcode: string): Promise<NameCandidate[]> {
  if (!supabase) return [];
  const [{ data: candidates, error }, { data: sessionData }] = await Promise.all([
    supabase
      .from('product_name_candidates')
      .select('id, name')
      .eq('barcode', barcode)
      .order('created_at', { ascending: true }),
    supabase.auth.getSession(),
  ]);
  if (error || !candidates || candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const { data: votes } = await supabase
    .from('product_name_votes')
    .select('candidate_id, voter_id, vote')
    .in('candidate_id', ids);
  const myId = sessionData.session?.user.id;

  return candidates.map((c) => {
    const candidateVotes = (votes ?? []).filter((v) => v.candidate_id === c.id);
    const likes = candidateVotes.filter((v) => v.vote === 1).length;
    const dislikes = candidateVotes.filter((v) => v.vote === -1).length;
    const mine = candidateVotes.find((v) => v.voter_id === myId);
    return {
      id: c.id,
      name: c.name,
      likes,
      dislikes,
      myVote: (mine?.vote as 1 | -1 | undefined) ?? null,
    };
  });
}

/** 상품명 후보에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnName(candidateId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: sessionData } = await supabase.auth.getSession();
  const voterId = sessionData.session?.user.id;
  if (!voterId) throw new Error('로그인이 필요합니다.');

  const { data: existing } = await supabase
    .from('product_name_votes')
    .select('vote')
    .eq('candidate_id', candidateId)
    .eq('voter_id', voterId)
    .maybeSingle();

  if (existing?.vote === vote) {
    const { error } = await supabase
      .from('product_name_votes')
      .delete()
      .eq('candidate_id', candidateId)
      .eq('voter_id', voterId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('product_name_votes')
    .upsert({ candidate_id: candidateId, vote }, { onConflict: 'candidate_id,voter_id' });
  if (error) throw error;
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: `src/app/login.tsx(115,45)` 기존 에러 외 새 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/order-report.ts
git commit -m "feat: order-report.ts에 상품명 후보 CRUD 함수 추가"
```

---

### Task 3: `name-candidates.ts` 신규 (로컬 제출 기록)

**Files:**
- Create: `src/lib/name-candidates.ts`

**Interfaces:**
- Consumes: Task 2가 만든 `submitNameCandidate(barcode, name)` (`./order-report`에서 import).
- Produces: `submitNameCandidateIfChanged(barcode: string, name: string): Promise<void>`. Task 4(`repo.ts`, `order-repo.ts`)가 이 함수를 가져다 쓴다.

`src/lib/brand-candidates.ts`를 그대로 미러링한다 — `brand`→`name`, `submittedBrandCandidates:v1`→`submittedNameCandidates:v1`, `submitBrandCandidate`→`submitNameCandidate`로만 치환.

- [ ] **Step 1: 파일 작성**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitNameCandidate } from './order-report';

const SUBMITTED_NAME_KEY = 'submittedNameCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 제출한 이름. 순수하게 "같은 값 반복 제출 방지"용
 * 기록이다(브랜드와 동일 구조 — brand-candidates.ts 참고). */
export async function getSubmittedNameCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_NAME_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedNameCandidate(barcode: string, name: string): Promise<void> {
  const map = await getSubmittedNameCandidates();
  map.set(barcode, name);
  await AsyncStorage.setItem(SUBMITTED_NAME_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 이름과 다를 때만 새 후보로 제출한다(같은 값 반복 저장 시
 * 후보 중복 방지). 로컬 기록은 네트워크 제출 성공 여부와 무관하게 즉시 저장한다.
 */
export async function submitNameCandidateIfChanged(barcode: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = await getSubmittedNameCandidates();
  if (map.get(barcode) === trimmed) return;
  await recordSubmittedNameCandidate(barcode, trimmed);
  submitNameCandidate(barcode, trimmed).catch(() => {});
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/name-candidates.ts
git commit -m "feat: name-candidates.ts 신규 (상품명 로컬 제출 기록)"
```

---

### Task 4: `repo.ts` / `order-repo.ts` 저장 시 상품명 후보 제출 연결

**Files:**
- Modify: `src/lib/repo.ts:1-6` (import), `src/lib/repo.ts:177-180` (saveProduct)
- Modify: `src/lib/order-repo.ts:1-11` (import), `src/lib/order-repo.ts:71-80` (saveOrderProduct)

**Interfaces:**
- Consumes: Task 3의 `submitNameCandidateIfChanged(barcode, name)`.
- Produces: 없음(배선만) — 재고/발주 어느 화면에서 상품을 저장해도 이름이 후보로 제출됨.

- [ ] **Step 1: `repo.ts` import 추가**

`src/lib/repo.ts` 3번째 줄(`import { submitPhotoCandidateIfChanged } from './photo-candidates';`) 바로 아래에 추가:

```ts
import { submitNameCandidateIfChanged } from './name-candidates';
```

- [ ] **Step 2: `repo.ts`의 `saveProduct` 안에서 호출**

기존(177~180줄):

```ts
    await upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
    if (uploaded.barcode && uploaded.imageUri) {
      submitPhotoCandidateIfChanged(uploaded.barcode, uploaded.imageUri).catch(() => {});
    }
```

교체:

```ts
    await upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
    if (uploaded.barcode) {
      submitNameCandidateIfChanged(uploaded.barcode, uploaded.name).catch(() => {});
    }
    if (uploaded.barcode && uploaded.imageUri) {
      submitPhotoCandidateIfChanged(uploaded.barcode, uploaded.imageUri).catch(() => {});
    }
```

- [ ] **Step 3: `order-repo.ts` import 추가**

`src/lib/order-repo.ts` 5번째 줄(`import { submitBrandCandidateIfChanged } from './brand-candidates';`) 바로 아래에 추가:

```ts
import { submitNameCandidateIfChanged } from './name-candidates';
```

- [ ] **Step 4: `order-repo.ts`의 `saveOrderProduct` 안에서 호출**

기존(71~80줄):

```ts
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
    // 로컬 오버라이드 기록까지는 기다린다(빠른 로컬 저장) — 그래야 저장 직후 목록으로 돌아가
    // syncOrderCatalog가 실행돼도 방금 고른 사진이 도로 덮어써지지 않는다. 네트워크 후보 제출
    // 자체는 이 함수 내부에서 best-effort로 처리되어 여기서 더 기다리지 않는다. 이 로컬 기록이
    // 실패해도(예: AsyncStorage 오류) 이미 저장된 상품 자체는 살아있으니 저장 실패로 취급하지 않는다.
    await submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
  }
```

교체:

```ts
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (p.barcode) {
    submitNameCandidateIfChanged(p.barcode, p.name).catch(() => {});
  }
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
    // 로컬 오버라이드 기록까지는 기다린다(빠른 로컬 저장) — 그래야 저장 직후 목록으로 돌아가
    // syncOrderCatalog가 실행돼도 방금 고른 사진이 도로 덮어써지지 않는다. 네트워크 후보 제출
    // 자체는 이 함수 내부에서 best-effort로 처리되어 여기서 더 기다리지 않는다. 이 로컬 기록이
    // 실패해도(예: AsyncStorage 오류) 이미 저장된 상품 자체는 살아있으니 저장 실패로 취급하지 않는다.
    await submitPhotoCandidateIfChanged(p.barcode, p.imageUri).catch(() => {});
  }
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음.

- [ ] **Step 6: 수동 QA**

앱 실행 후 재고 화면에서 새 상품을 등록(이름 입력) → Supabase 대시보드에서 `select * from product_name_candidates where barcode = '<방금 등록한 바코드>';` 실행 → 방금 입력한 이름으로 후보가 하나 생겼는지 확인. 같은 이름으로 다시 저장해도 후보가 중복 생성되지 않는지 확인(한 번 더 저장 후 같은 쿼리로 행 수 불변 확인).

- [ ] **Step 7: Commit**

```bash
git add src/lib/repo.ts src/lib/order-repo.ts
git commit -m "feat: 상품 저장 시 상품명 후보 제출 연결"
```

---

### Task 5: `CandidatesModal.tsx` 신규 — 사진/브랜드/상품명 통합 탭 컴포넌트

**Files:**
- Create: `src/components/CandidatesModal.tsx`

**Interfaces:**
- Consumes: `listPhotoCandidates`, `voteOnPhoto`, `listBrandCandidates`, `voteOnBrand`, `listNameCandidates`(Task 2), `voteOnName`(Task 2), 타입 `PhotoCandidate`, `BrandCandidate`, `NameCandidate`(Task 2) — 전부 `@/lib/order-report`. `submitBrandCandidateIfChanged`(`@/lib/brand-candidates`), `submitNameCandidateIfChanged`(Task 3, `@/lib/name-candidates`). `applyOrderProductPhoto`(`@/lib/order-repo`). 컴포넌트 `Chip`(`@/components/Chip`, props `{label, active, onPress}` — 이미 존재).
- Produces: `export default function CandidatesModal(props: { visible: boolean; barcode: string; initialTab: 'photo' | 'brand' | 'name'; onClose: () => void; onPhotoApplied?: (photoUri: string) => void }): JSX.Element`. Task 6·7이 이 컴포넌트를 `product-form.tsx`/`order-product-form.tsx`에 배선한다.

`PhotoCandidatesModal.tsx`(사진 후보 목록/투표/좋아요 시 즉시 적용 로직)와 `BrandCandidatesModal.tsx`(브랜드 후보 목록/투표/제안 입력창)의 로직을 그대로 옮기고, 탭 전환 UI만 추가한다 — 새 매칭/투표 로직은 없다.

- [ ] **Step 1: 파일 작성**

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Chip from '@/components/Chip';
import { submitBrandCandidateIfChanged } from '@/lib/brand-candidates';
import { submitNameCandidateIfChanged } from '@/lib/name-candidates';
import { applyOrderProductPhoto } from '@/lib/order-repo';
import {
  listPhotoCandidates,
  voteOnPhoto,
  listBrandCandidates,
  voteOnBrand,
  listNameCandidates,
  voteOnName,
  type PhotoCandidate,
  type BrandCandidate,
  type NameCandidate,
} from '@/lib/order-report';

type Tab = 'photo' | 'brand' | 'name';
type AnyCandidate = PhotoCandidate | BrandCandidate | NameCandidate;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

function candidateLabel(tab: Tab, c: AnyCandidate): string {
  if (tab === 'brand') return (c as BrandCandidate).brand;
  if (tab === 'name') return (c as NameCandidate).name;
  return '';
}

const TAB_CONFIG: Record<
  Tab,
  {
    title: string;
    list: (barcode: string) => Promise<AnyCandidate[]>;
    vote: (candidateId: string, value: 1 | -1) => Promise<void>;
    submit: ((barcode: string, value: string) => Promise<void>) | null;
    placeholder?: string;
    emptyText: string;
  }
> = {
  photo: {
    title: '사진',
    list: listPhotoCandidates,
    vote: voteOnPhoto,
    submit: null,
    emptyText: '등록된 후보 사진이 없습니다.',
  },
  brand: {
    title: '브랜드',
    list: listBrandCandidates,
    vote: voteOnBrand,
    submit: submitBrandCandidateIfChanged,
    placeholder: '다른 브랜드 제안하기',
    emptyText: '등록된 후보가 없습니다.',
  },
  name: {
    title: '상품명',
    list: listNameCandidates,
    vote: voteOnName,
    submit: submitNameCandidateIfChanged,
    placeholder: '다른 이름 제안하기',
    emptyText: '등록된 후보가 없습니다.',
  },
};

/**
 * 이 바코드의 사진/브랜드/상품명 후보를 탭으로 전환하며 보여주고 좋아요/싫어요 투표를 받는다.
 * initialTab으로 열리지만 상단 탭으로 자유롭게 다른 탭으로 전환할 수 있다. 대표값은 DB 트리거가
 * 득표수로 자동 결정하므로, 여기서 직접 "이걸로 확정" 선택은 없다(사진 탭의 좋아요만 예외 —
 * 아래 vote() 참고).
 */
export default function CandidatesModal({
  visible,
  barcode,
  initialTab,
  onClose,
  onPhotoApplied,
}: {
  visible: boolean;
  barcode: string;
  initialTab: Tab;
  onClose: () => void;
  /** 사진 탭에서 좋아요를 눌러 그 사진이 내 상품 사진으로 즉시 반영됐을 때 알려준다. */
  onPhotoApplied?: (photoUri: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [candidates, setCandidates] = useState<AnyCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTab(initialTab);
  }, [visible, initialTab]);

  useEffect(() => {
    if (!visible) return;
    setNewValue('');
    setLoading(true);
    TAB_CONFIG[tab]
      .list(barcode)
      .then(setCandidates)
      .finally(() => setLoading(false));
  }, [visible, barcode, tab]);

  const vote = async (candidateId: string, value: 1 | -1) => {
    const target = candidates.find((c) => c.id === candidateId);
    // 이미 좋아요 상태에서 다시 누르면 투표 취소(중립)이지 "선택"이 아니므로, 그때는 적용하지 않는다.
    const applyAsMyPhoto = tab === 'photo' && value === 1 && target?.myVote !== 1;
    setVotingId(candidateId);
    try {
      await TAB_CONFIG[tab].vote(candidateId, value);
      const fresh = await TAB_CONFIG[tab].list(barcode);
      setCandidates(fresh);
      if (applyAsMyPhoto && target) {
        const photoUri = (target as PhotoCandidate).photoUri;
        await applyOrderProductPhoto(barcode, photoUri);
        onPhotoApplied?.(photoUri);
      }
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  const submitNew = async () => {
    const submit = TAB_CONFIG[tab].submit;
    const v = newValue.trim();
    if (!submit || !v) return;
    setSubmitting(true);
    try {
      await submit(barcode, v);
      setNewValue('');
      setCandidates(await TAB_CONFIG[tab].list(barcode));
    } finally {
      setSubmitting(false);
    }
  };

  const config = TAB_CONFIG[tab];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="mb-3 flex-row" style={{ gap: 8 }}>
            {(Object.keys(TAB_CONFIG) as Tab[]).map((t) => (
              <Chip key={t} label={TAB_CONFIG[t].title} active={tab === t} onPress={() => setTab(t)} />
            ))}
          </View>
          <Text className="text-ink mb-3 text-base font-bold">{config.title} 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">{config.emptyText}</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className={`mb-3 flex-row items-center rounded-xl border border-line ${
                    tab === 'photo' ? 'p-2' : 'p-3'
                  }`}
                >
                  {tab === 'photo' ? (
                    <Image
                      source={{ uri: (c as PhotoCandidate).photoUri }}
                      style={{ width: 64, height: 64, borderRadius: 8 }}
                      contentFit="cover"
                    />
                  ) : (
                    <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                      {candidateLabel(tab, c)}
                    </Text>
                  )}
                  <View
                    className={tab === 'photo' ? 'ml-3 flex-1 flex-row items-center justify-around' : 'flex-row items-center'}
                    style={tab === 'photo' ? undefined : { gap: 16 }}
                  >
                    <Pressable
                      onPress={() => vote(c.id, 1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      hitSlop={11}
                      accessibilityRole="button"
                      accessibilityLabel="좋아요"
                    >
                      {votingId === c.id ? (
                        <ActivityIndicator size="small" color="#2E7D32" />
                      ) : (
                        <MaterialCommunityIcons
                          name={c.myVote === 1 ? 'thumb-up' : 'thumb-up-outline'}
                          size={22}
                          color={c.myVote === 1 ? '#2E7D32' : '#888888'}
                        />
                      )}
                      <Text className="text-ink mt-0.5 text-xs">{c.likes}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => vote(c.id, -1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      hitSlop={11}
                      accessibilityRole="button"
                      accessibilityLabel="싫어요"
                    >
                      {votingId === c.id ? (
                        <ActivityIndicator size="small" color="#C62828" />
                      ) : (
                        <MaterialCommunityIcons
                          name={c.myVote === -1 ? 'thumb-down' : 'thumb-down-outline'}
                          size={22}
                          color={c.myVote === -1 ? '#C62828' : '#888888'}
                        />
                      )}
                      <Text className="text-ink mt-0.5 text-xs">{c.dislikes}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          {config.submit ? (
            <View className="mt-3 flex-row gap-2">
              <TextInput
                className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                placeholder={config.placeholder}
                placeholderTextColor="#BBBBBB"
                value={newValue}
                onChangeText={setNewValue}
                onSubmitEditing={submitNew}
              />
              <Pressable
                onPress={submitNew}
                disabled={submitting}
                className="items-center justify-center rounded-xl border border-line bg-bg px-4 active:opacity-70"
              >
                <Text className="text-ink text-sm font-medium">{submitting ? '제출 중' : '제안'}</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음(특히 `AnyCandidate`/`as PhotoCandidate` 캐스팅 관련 에러가 없는지 확인).

- [ ] **Step 3: Commit**

```bash
git add src/components/CandidatesModal.tsx
git commit -m "feat: 사진/브랜드/상품명 통합 CandidatesModal 컴포넌트 추가"
```

---

### Task 6: `product-form.tsx`(재고 화면) 배선 교체

**Files:**
- Modify: `src/app/product-form.tsx:20-21` (import), `:68` (state), `:350-354` (모달 마운트), `:478-482` (링크)

**Interfaces:**
- Consumes: Task 5의 `CandidatesModal`(default export).
- Produces: 없음(화면 배선) — 재고 화면에서 사진/상품명/브랜드 세 탭을 모두 쓸 수 있게 됨.

- [ ] **Step 1: import 교체**

기존(20~21줄):

```ts
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import PhotoCandidatesModal from '@/components/PhotoCandidatesModal';
```

교체:

```ts
import CandidatesModal from '@/components/CandidatesModal';
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
```

- [ ] **Step 2: state 교체**

기존(68줄):

```ts
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
```

교체:

```ts
  const [candidatesTab, setCandidatesTab] = useState<'photo' | 'brand' | 'name' | null>(null);
```

- [ ] **Step 3: 모달 마운트 교체**

기존(350~354줄):

```tsx
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode ?? ''}
        onClose={() => setShowPhotoCandidates(false)}
      />
```

교체:

```tsx
      <CandidatesModal
        visible={candidatesTab !== null}
        barcode={barcode ?? ''}
        initialTab={candidatesTab ?? 'photo'}
        onClose={() => setCandidatesTab(null)}
      />
```

- [ ] **Step 4: 링크 교체 + 상품명/브랜드 링크 추가**

기존(478~482줄):

```tsx
            {barcode ? (
              <Pressable onPress={() => setShowPhotoCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
```

교체:

```tsx
            {barcode ? (
              <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 12 }}>
                <Pressable onPress={() => setCandidatesTab('photo')}>
                  <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
                </Pressable>
                <Pressable onPress={() => setCandidatesTab('name')}>
                  <Text className="text-muted text-xs underline">상품명 후보 보기 / 투표</Text>
                </Pressable>
                <Pressable onPress={() => setCandidatesTab('brand')}>
                  <Text className="text-muted text-xs underline">브랜드 후보 보기 / 투표</Text>
                </Pressable>
              </View>
            ) : null}
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음(`showPhotoCandidates` 미사용 잔존 참조 없는지 특히 확인).

- [ ] **Step 6: 수동 QA**

앱 실행 → 재고 화면에서 바코드가 있는 상품 수정 화면 진입 → "사진 후보 보기 / 투표" 클릭 시 사진 탭으로 열리는지, "상품명 후보 보기 / 투표" 클릭 시 상품명 탭으로 열리는지, "브랜드 후보 보기 / 투표" 클릭 시 브랜드 탭으로 열리는지 확인. 모달 안에서 탭을 눌러 다른 탭으로도 전환되는지 확인.

- [ ] **Step 7: Commit**

```bash
git add src/app/product-form.tsx
git commit -m "feat: 재고 화면에 통합 CandidatesModal 배선 (상품명/브랜드 탭 추가)"
```

---

### Task 7: `order-product-form.tsx`(발주 화면) 배선 교체 + 기존 모달 파일 삭제

**Files:**
- Modify: `src/app/order-product-form.tsx:19,21` (import), `:70,72` (state), `:360-370` (모달 마운트), `:424-427` (사진 링크 + 상품명 링크 추가), `:469-472` (브랜드 링크)
- Delete: `src/components/PhotoCandidatesModal.tsx`
- Delete: `src/components/BrandCandidatesModal.tsx`

**Interfaces:**
- Consumes: Task 5의 `CandidatesModal`.
- Produces: 없음(화면 배선) — 발주 화면에서 사진/브랜드/상품명 세 탭을 모두 쓸 수 있게 됨. 이 작업 이후 `PhotoCandidatesModal`/`BrandCandidatesModal`을 참조하는 파일이 하나도 남지 않는다(Task 6에서 이미 `product-form.tsx`의 `PhotoCandidatesModal` 참조를 제거했음).

- [ ] **Step 1: import 교체**

기존(19, 21줄):

```ts
import BrandCandidatesModal from '@/components/BrandCandidatesModal';
import Chip from '@/components/Chip';
import PhotoCandidatesModal from '@/components/PhotoCandidatesModal';
```

교체:

```ts
import CandidatesModal from '@/components/CandidatesModal';
import Chip from '@/components/Chip';
```

- [ ] **Step 2: state 교체**

기존(70, 72줄):

```ts
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [showBrandCandidates, setShowBrandCandidates] = useState(false);
```

교체:

```ts
  const [candidatesTab, setCandidatesTab] = useState<'photo' | 'brand' | 'name' | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState(false);
```

- [ ] **Step 3: 모달 마운트 교체**

기존(360~370줄):

```tsx
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode.trim()}
        onClose={() => setShowPhotoCandidates(false)}
        onPhotoApplied={setImageUri}
      />
      <BrandCandidatesModal
        visible={showBrandCandidates}
        barcode={barcode.trim()}
        onClose={() => setShowBrandCandidates(false)}
      />
```

교체:

```tsx
      <CandidatesModal
        visible={candidatesTab !== null}
        barcode={barcode.trim()}
        initialTab={candidatesTab ?? 'photo'}
        onClose={() => setCandidatesTab(null)}
        onPhotoApplied={setImageUri}
      />
```

- [ ] **Step 4: 사진 링크 교체 + 상품명 링크 추가**

기존(424~427줄):

```tsx
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setShowPhotoCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
```

교체:

```tsx
            {isEdit && barcode.trim() ? (
              <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 12 }}>
                <Pressable onPress={() => setCandidatesTab('photo')}>
                  <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
                </Pressable>
                <Pressable onPress={() => setCandidatesTab('name')}>
                  <Text className="text-muted text-xs underline">상품명 후보 보기 / 투표</Text>
                </Pressable>
              </View>
            ) : null}
```

- [ ] **Step 5: 브랜드 링크 교체**

기존(469~472줄):

```tsx
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setShowBrandCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">브랜드 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
```

교체:

```tsx
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setCandidatesTab('brand')} className="mt-1.5">
                <Text className="text-muted text-xs underline">브랜드 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
```

- [ ] **Step 6: 기존 모달 파일 삭제**

```bash
git rm src/components/PhotoCandidatesModal.tsx src/components/BrandCandidatesModal.tsx
```

- [ ] **Step 7: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 기존 베이스라인 에러 외 새 에러 없음(특히 삭제된 두 파일을 import하는 곳이 더는 없는지 — 있다면 에러로 드러남).

- [ ] **Step 8: 남은 참조 확인**

Run: `grep -rn "PhotoCandidatesModal\|BrandCandidatesModal" src/`
Expected: 결과 없음(삭제한 두 파일 자체 내용 제외 — 이미 삭제했으므로 아예 안 나와야 함).

- [ ] **Step 9: 수동 QA**

앱 실행 → 발주 화면에서 기존 상품 수정 화면 진입 → 사진/상품명/브랜드 세 링크가 각각 맞는 탭으로 여는지 확인. 사진 탭에서 좋아요를 누르면 기존과 동일하게 그 사진이 내 상품 사진으로 즉시 반영되는지(폼 상단 미리보기가 바뀌는지) 확인 — 이후 브랜드/상품명 탭으로 전환했다가 닫아도 이 부작용이 사진 탭에서만 일어났는지 확인. 모달을 닫고 다른 필드 링크로 다시 열었을 때 이전 탭이 남아있지 않고 매번 해당 필드 탭으로 초기화되는지 확인.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: 발주 화면에 통합 CandidatesModal 배선, 기존 개별 모달 삭제"
```

---

## Self-Review Notes (계획 작성자용, 실행 불필요)

- **스펙 커버리지**: 09-15 스펙의 4개 범위 항목(백엔드/UI 통합/재고 브랜드 링크/배지 범위 제한) 전부 Task 1~7에 대응됨. 09-11 스펙의 백엔드 부분은 Task 1~4가 구현하되, FK/유니크 인덱스는 실제 배포된 브랜드 마이그레이션의 수정본을 따르도록 09-11 초안에서 교정했음(Task 1 상단 경고 참고).
- **플레이스홀더 스캔**: 없음 — 전 Task 코드가 실제 파일 내용 기준 완성된 diff.
- **타입 일관성**: `NameCandidate`(Task 2) → `CandidatesModal`(Task 5)의 `AnyCandidate` 유니언에 포함, `candidateLabel()`이 `c.name`으로 접근 — 필드명 일치 확인됨. `candidatesTab` state 타입(`'photo' | 'brand' | 'name' | null`)이 Task 6·7 양쪽에서 동일하게 사용됨.
