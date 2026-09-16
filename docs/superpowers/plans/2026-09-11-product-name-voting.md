# 상품명(name) 좋아요/싫어요 투표 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재고(`barcode_catalog`)와 발주(`order_catalog`)가 공유하는 상품명을, 사진과 동일한 "후보 + 투표, 최고 득표가 실시간 대표값" 방식으로 관리자 개입 없이 자동 반영되게 만든다.

**Architecture:** 새 테이블 `product_name_candidates`/`product_name_votes`를 도입하고, DB 트리거가 득표 최고 후보를 `barcode_catalog.name`과 `order_catalog.name` 양쪽에 동시 반영한다. 클라이언트는 상품 저장 시 이름을 후보로 제출하고, 별도 모달에서 후보 목록에 투표한다. `photo-candidates.ts`/`order-report.ts`의 사진 후보/투표 패턴을 그대로 미러링한다.

**Tech Stack:** Expo/React Native, Supabase(Postgres + RLS + trigger), AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-09-11-product-name-voting-design.md`

## Global Constraints

- 대상 필드는 이름(`name`)뿐 — 사진/가격/카테고리/브랜드는 건드리지 않는다.
- `barcode_catalog`/`order_catalog`는 하나의 공유 후보 풀을 쓴다 (catalog 구분 컬럼 없음).
- 대표 이름 선정 규칙: (좋아요 − 싫어요)가 가장 높은 후보, 동점이면 가장 먼저 등록된 후보.
- 이 저장소는 자동화 테스트 스위트가 없다 — 각 태스크는 자동 테스트 대신 수동 검증 단계로 끝난다(기존 관례).
- 모든 신규 Supabase 호출은 best-effort(`.catch(() => {})`)로 감싸 로컬 저장 흐름을 막지 않는다 — 기존 `submitPhotoCandidateIfChanged` 호출부와 동일한 관례.

---

### Task 1: Supabase 마이그레이션 (`product_name_candidates`/`product_name_votes` + 트리거 + 백필)

**Files:**
- Create: `supabase/migration-product-name-voting.sql`

**Interfaces:**
- Produces: 테이블 `product_name_candidates(id, barcode, name, submitted_by, created_at)`, `product_name_votes(candidate_id, voter_id, vote, created_at)`. 함수 `recalc_product_name_representative(target_barcode text)`. 이후 모든 태스크가 이 두 테이블에 insert/select한다.

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 상품명 좋아요/싫어요 투표 (2026-09-11)
-- 재고(barcode_catalog)와 발주(order_catalog)가 공유하는 상품명을 사진과 동일한
-- "후보 + 투표, 최고 득표가 실시간 대표값" 방식으로 바꾼다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.product_name_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  name text not null,
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists product_name_candidates_barcode_idx on public.product_name_candidates(barcode);

alter table public.product_name_candidates enable row level security;
drop policy if exists "product_name_candidates select all" on public.product_name_candidates;
create policy "product_name_candidates select all" on public.product_name_candidates for select using (true);
drop policy if exists "product_name_candidates insert own" on public.product_name_candidates;
create policy "product_name_candidates insert own" on public.product_name_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다.

create table if not exists public.product_name_votes (
  candidate_id uuid not null references public.product_name_candidates(id) on delete cascade,
  voter_id uuid not null references auth.users(id),
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

- [ ] **Step 2: Supabase 대시보드 SQL Editor에서 실행**

Supabase 프로젝트 대시보드 → SQL Editor → 위 SQL 전체 붙여넣고 실행.

- [ ] **Step 3: 수동 검증 — 테이블/백필/트리거 확인**

SQL Editor에서 순서대로 실행하며 확인한다.

```sql
-- (a) 두 테이블이 생겼는지
select count(*) from public.product_name_candidates;
select count(*) from public.product_name_votes;

-- (b) 백필이 order_catalog/barcode_catalog 건수만큼 후보를 만들었는지
-- (barcode_catalog 쪽은 order_catalog와 겹치는 바코드가 있으면 그만큼 적게 나오는 게 정상)
select count(distinct barcode) from public.order_catalog;
select count(distinct barcode) from public.barcode_catalog;
select count(distinct barcode) from public.product_name_candidates;

-- (c) 트리거 반영 확인: 임의의 새 바코드로 후보를 추가해도 에러 없이 끝나는지
-- (barcode_catalog/order_catalog에 해당 바코드 행이 없으므로 update는 0행 영향)
insert into public.product_name_candidates (barcode, name, submitted_by)
values ('__migration_test_barcode__', '__migration_test__', '00000000-0000-0000-0000-000000000000');

-- (d) 테스트 데이터 정리
delete from public.product_name_candidates where barcode = '__migration_test_barcode__';
```

Expected: (a)(b)는 0보다 큰 값, (c)(d)는 에러 없이 실행됨.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-product-name-voting.sql
git commit -m "feat: 상품명 후보/투표 Supabase 스키마 추가"
```

---

### Task 2: `src/lib/name-candidates.ts` 신규 — 후보 제출/조회/투표 + 참여 유도 헬퍼

**Files:**
- Create: `src/lib/name-candidates.ts`

**Interfaces:**
- Consumes: `supabase`(`./supabase`), `AsyncStorage`(`@react-native-async-storage/async-storage`), Task 1의 `product_name_candidates`/`product_name_votes` 테이블.
- Produces:
  - `submitNameCandidateIfChanged(barcode: string, name: string): Promise<void>` — Task 3, 4가 사용.
  - `type NameCandidate = { id: string; name: string; likes: number; dislikes: number; myVote: 1 | -1 | null }`, `listNameCandidates(barcode: string): Promise<NameCandidate[]>`, `voteOnName(candidateId: string, vote: 1 | -1): Promise<void>`, `submitNameCandidate(barcode: string, name: string): Promise<void>` — Task 5가 사용.
  - `checkAdoptedNameCandidates(): Promise<string[]>` — Task 8이 사용.
  - `getMyContributionStats(): Promise<{ submittedNames: number; adoptedNames: number }>` — Task 9가 사용.

- [ ] **Step 1: 파일 작성**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const SUBMITTED_NAME_KEY = 'submittedNameCandidates:v1';
const NOTIFIED_ADOPTED_KEY = 'notifiedAdoptedNameCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 제출한 상품명. 대표 이름 계산은 서버 투표가 하지만,
 * 같은 이름을 반복 저장할 때 후보가 중복으로 쌓이지 않도록 이 값과 비교한다. */
export async function getSubmittedNameCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_NAME_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedNameCandidate(barcode: string, name: string): Promise<void> {
  const map = await getSubmittedNameCandidates();
  map.set(barcode, name);
  await AsyncStorage.setItem(SUBMITTED_NAME_KEY, JSON.stringify(Object.fromEntries(map)));
}

/** 이름 후보를 product_name_candidates에 추가한다. 검토 없이 즉시 접수되지만, 대표 이름이
 * 되려면 다른 사용자의 좋아요를 받아야 한다(대표 선정은 DB 트리거가 득표수로 자동 결정). */
export async function submitNameCandidate(barcode: string, name: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('product_name_candidates').insert({ barcode, name });
}

/** 이 바코드에 마지막으로 제출한 이름과 다를 때만 새 후보로 제출한다 (같은 이름 반복 저장 시
 * 후보 중복 방지). 재고(repo.ts)와 발주(order-repo.ts) 양쪽에서 공유한다. */
export async function submitNameCandidateIfChanged(barcode: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const map = await getSubmittedNameCandidates();
  if (map.get(barcode) === trimmed) return;
  await recordSubmittedNameCandidate(barcode, trimmed);
  submitNameCandidate(barcode, trimmed).catch(() => {});
}

export type NameCandidate = {
  id: string;
  name: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 이름 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listNameCandidates(barcode: string): Promise<NameCandidate[]> {
  if (!supabase) return [];
  const { data: candidates, error } = await supabase
    .from('product_name_candidates')
    .select('id, name')
    .eq('barcode', barcode)
    .order('created_at', { ascending: true });
  if (error || !candidates || candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const { data: votes } = await supabase
    .from('product_name_votes')
    .select('candidate_id, voter_id, vote')
    .in('candidate_id', ids);
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id;

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

/** 이름 후보에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnName(candidateId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: userData } = await supabase.auth.getUser();
  const voterId = userData.user?.id;
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

async function getNotifiedAdoptedBarcodes(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(NOTIFIED_ADOPTED_KEY);
  return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
}

async function markNotifiedAdopted(barcodes: string[]): Promise<void> {
  const set = await getNotifiedAdoptedBarcodes();
  barcodes.forEach((b) => set.add(b));
  await AsyncStorage.setItem(NOTIFIED_ADOPTED_KEY, JSON.stringify([...set]));
}

/** 로컬에서 내가 제안한 이름 중, 서버 대표 이름으로 채택되어 아직 알리지 않은 것들을 찾아
 * 그 이름 목록을 반환하고 알림 완료로 기록한다(재알림 방지). 새 서버 자원 없이 barcode_catalog
 * 조회 + 로컬 비교만으로 판단한다. */
export async function checkAdoptedNameCandidates(): Promise<string[]> {
  if (!supabase) return [];
  const submitted = await getSubmittedNameCandidates();
  const notified = await getNotifiedAdoptedBarcodes();
  const pending = [...submitted.entries()].filter(([barcode]) => !notified.has(barcode));
  if (pending.length === 0) return [];

  const { data } = await supabase
    .from('barcode_catalog')
    .select('barcode, name')
    .in('barcode', pending.map(([barcode]) => barcode));
  if (!data) return [];

  const adoptedBarcodes = pending
    .filter(([barcode, name]) => data.some((row) => row.barcode === barcode && row.name === name))
    .map(([barcode]) => barcode);
  if (adoptedBarcodes.length === 0) return [];

  await markNotifiedAdopted(adoptedBarcodes);
  return adoptedBarcodes.map((barcode) => submitted.get(barcode)!);
}

/** 내가 제안한 상품명 중 몇 건이 실제로 대표 이름으로 채택됐는지 근사 집계한다(설정 화면 표시용). */
export async function getMyContributionStats(): Promise<{
  submittedNames: number;
  adoptedNames: number;
}> {
  if (!supabase) return { submittedNames: 0, adoptedNames: 0 };
  const submitted = await getSubmittedNameCandidates();
  if (submitted.size === 0) return { submittedNames: 0, adoptedNames: 0 };
  const { data } = await supabase
    .from('barcode_catalog')
    .select('barcode, name')
    .in('barcode', [...submitted.keys()]);
  const adoptedNames = (data ?? []).filter((row) => submitted.get(row.barcode) === row.name).length;
  return { submittedNames: submitted.size, adoptedNames };
}
```

- [ ] **Step 2: 타입 체크로 문법/타입 오류 확인**

Run: `npx tsc --noEmit`
Expected: `src/lib/name-candidates.ts` 관련 에러 없음 (기존에 있던 무관한 에러는 무시).

- [ ] **Step 3: Commit**

```bash
git add src/lib/name-candidates.ts
git commit -m "feat: 상품명 후보 제출/조회/투표 + 참여 유도 헬퍼 추가"
```

---

### Task 3: 재고 저장(`repo.ts`)에 이름 후보 제출 연결

**Files:**
- Modify: `src/lib/repo.ts:1-6` (import 추가), `src/lib/repo.ts:171-182` (`saveProduct` 내부)

**Interfaces:**
- Consumes: Task 2의 `submitNameCandidateIfChanged(barcode, name)`.

- [ ] **Step 1: import 추가**

`src/lib/repo.ts` 상단 import 블록에 추가:

```ts
import { submitNameCandidateIfChanged } from './name-candidates';
```

- [ ] **Step 2: `saveProduct` 내부에 호출 추가**

기존 코드:

```ts
    await upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
    if (uploaded.barcode && uploaded.imageUri) {
      submitPhotoCandidateIfChanged(uploaded.barcode, uploaded.imageUri).catch(() => {});
    }
```

변경 후:

```ts
    await upsertBarcodeCatalog(uploaded.barcode, uploaded.name, uploaded.imageUri).catch(() => {});
    if (uploaded.barcode) {
      submitNameCandidateIfChanged(uploaded.barcode, uploaded.name).catch(() => {});
    }
    if (uploaded.barcode && uploaded.imageUri) {
      submitPhotoCandidateIfChanged(uploaded.barcode, uploaded.imageUri).catch(() => {});
    }
```

- [ ] **Step 3: 수동 검증**

실기기(Expo dev client)에서 앱 실행 → 재고 상품 신규 등록(바코드 있는 것) → 저장 후 Supabase 대시보드에서 `select * from product_name_candidates order by created_at desc limit 5;` 실행해 방금 등록한 바코드/이름 행이 보이는지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/lib/repo.ts
git commit -m "feat: 재고 상품 저장 시 상품명 후보 제출"
```

---

### Task 4: 발주 저장(`order-repo.ts`)에 이름 후보 제출 연결

**Files:**
- Modify: `src/lib/order-repo.ts` (import 추가), `src/lib/order-repo.ts:54-77` (`saveOrderProduct` 내부)

**Interfaces:**
- Consumes: Task 2의 `submitNameCandidateIfChanged(barcode, name)`.

- [ ] **Step 1: import 추가**

`src/lib/order-repo.ts` 상단 import 블록에 추가:

```ts
import { submitNameCandidateIfChanged } from './name-candidates';
```

- [ ] **Step 2: `saveOrderProduct` 내부에 호출 추가**

기존 코드:

```ts
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
```

변경 후:

```ts
  await writeOrderProducts(items);
  upsertBarcodeCatalog(p.barcode, p.name, p.imageUri).catch(() => {});
  if (p.barcode) {
    submitNameCandidateIfChanged(p.barcode, p.name).catch(() => {});
  }
  if (isNew) {
    submitNewOrderProduct(p).catch(() => {});
  } else if (p.barcode && p.imageUri) {
```

(이 아래 `await submitPhotoCandidateIfChanged(...)` 줄은 그대로 둔다.)

- [ ] **Step 3: 수동 검증**

실기기에서 발주 상품 수정(이름 변경) 저장 → Supabase에서 `select * from product_name_candidates order by created_at desc limit 5;`로 새 후보 확인. 기존에는 발주 상품 수정 시 이름이 `order_catalog`에 전혀 반영되지 않았던 경로였으므로, 이 태스크가 그 첫 반영 경로다.

- [ ] **Step 4: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 발주 상품 저장 시 상품명 후보 제출"
```

---

### Task 5: `NameCandidatesModal` 컴포넌트 신규

**Files:**
- Create: `src/components/NameCandidatesModal.tsx`

**Interfaces:**
- Consumes: Task 2의 `listNameCandidates`, `voteOnName`, `submitNameCandidate`, `type NameCandidate`.
- Produces: `NameCandidatesModal({ visible, barcode, onClose }: { visible: boolean; barcode: string; onClose: () => void })` — Task 6, 7이 사용.

- [ ] **Step 1: 파일 작성** (`PhotoCandidatesModal.tsx` 구조를 텍스트 목록 + 새 이름 입력창으로 변형)

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { listNameCandidates, submitNameCandidate, voteOnName, type NameCandidate } from '@/lib/name-candidates';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

/**
 * 이 바코드에 등록된 상품명 후보들을 보여주고 좋아요/싫어요 투표를 받는다. 새 이름을 제안할 수도
 * 있다. 대표 이름은 DB 트리거가 득표수로 자동 결정하므로, 여기서 직접 "이걸로 확정" 선택은 없다.
 */
export default function NameCandidatesModal({
  visible,
  barcode,
  onClose,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<NameCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => listNameCandidates(barcode).then(setCandidates);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [visible, barcode]);

  const vote = async (candidateId: string, value: 1 | -1) => {
    setVotingId(candidateId);
    try {
      await voteOnName(candidateId, value);
      await refresh();
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  const submitNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await submitNameCandidate(barcode, trimmed);
      setNewName('');
      await refresh();
    } catch (e) {
      Alert.alert('제안 실패', errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">이름 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 후보 이름이 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className="mb-3 flex-row items-center rounded-xl border border-line p-2"
                >
                  <Text className="text-ink flex-1 text-sm">{c.name}</Text>
                  <View className="flex-row items-center justify-around" style={{ width: 96 }}>
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
          <View className="mt-3 flex-row items-center gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="다른 이름 제안하기"
              placeholderTextColor="#BBBBBB"
              value={newName}
              onChangeText={setNewName}
            />
            <Pressable
              onPress={submitNew}
              disabled={submitting || !newName.trim()}
              className="items-center justify-center rounded-xl bg-primary px-3 py-2 active:opacity-80"
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-paper text-xs font-bold">제안</Text>
              )}
            </Pressable>
          </View>
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
Expected: `src/components/NameCandidatesModal.tsx` 관련 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/components/NameCandidatesModal.tsx
git commit -m "feat: 이름 후보 보기/투표/제안 모달 추가"
```

---

### Task 6: 재고 화면(`product-form.tsx`)에 이름 투표 UI 연결

**Files:**
- Modify: `src/app/product-form.tsx`

**Interfaces:**
- Consumes: Task 5의 `NameCandidatesModal`, Task 2의 `listNameCandidates`.

- [ ] **Step 1: import 추가**

`PhotoCandidatesModal` import 바로 아래에 추가:

```ts
import NameCandidatesModal from '@/components/NameCandidatesModal';
```

`@/lib/name-candidates`에서 `listNameCandidates`도 import:

```ts
import { listNameCandidates } from '@/lib/name-candidates';
```

- [ ] **Step 2: state 추가**

`showPhotoCandidates` state 선언부 근처에 추가:

```ts
const [showNameCandidates, setShowNameCandidates] = useState(false);
const [nameVoteStats, setNameVoteStats] = useState<{ likes: number; dislikes: number } | null>(null);

const refreshNameVoteStats = () => {
  if (!barcode) {
    setNameVoteStats(null);
    return;
  }
  listNameCandidates(barcode).then((candidates) => {
    const current = candidates.find((c) => c.name === name);
    setNameVoteStats(current ? { likes: current.likes, dislikes: current.dislikes } : null);
  });
};

useEffect(() => {
  refreshNameVoteStats();
}, [barcode]);
```

(`useEffect`가 이미 이 파일에 import돼 있지 않다면 `react`의 `useEffect`를 import 목록에 추가한다.)

- [ ] **Step 3: 모달 렌더링 추가**

`<PhotoCandidatesModal ... />` 바로 아래에 추가:

```tsx
      <NameCandidatesModal
        visible={showNameCandidates}
        barcode={barcode ?? ''}
        onClose={() => {
          setShowNameCandidates(false);
          refreshNameVoteStats();
        }}
      />
```

- [ ] **Step 4: 링크 + 득표 표시 추가**

기존 "사진 후보 보기 / 투표" `Pressable` 바로 아래(같은 `barcode ? (...) : null` 블록 안, 상품명 `TextInput` 다음)에 추가:

```tsx
            {barcode ? (
              <View className="mt-1.5 flex-row items-center gap-2">
                <Pressable onPress={() => setShowNameCandidates(true)}>
                  <Text className="text-muted text-xs underline">이름 후보 보기 / 투표</Text>
                </Pressable>
                {nameVoteStats ? (
                  <Text className="text-muted text-xs">
                    👍{nameVoteStats.likes} 👎{nameVoteStats.dislikes}
                  </Text>
                ) : null}
              </View>
            ) : null}
```

- [ ] **Step 5: 수동 검증**

실기기에서 바코드 있는 기존 재고 상품 편집 화면 진입 → "이름 후보 보기 / 투표" 링크가 상품명 아래 보이는지 확인 → 탭해서 모달 열림, 후보 목록(백필된 기존 이름 최소 1개) 확인 → 좋아요 눌러 득표수 올라가는지 확인 → 모달 닫으면 옆에 👍/👎 숫자가 갱신되는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/app/product-form.tsx
git commit -m "feat: 재고 상품 화면에 이름 후보 보기/투표 연결"
```

---

### Task 7: 발주 화면(`order-product-form.tsx`)에 이름 투표 UI 연결

**Files:**
- Modify: `src/app/order-product-form.tsx`

**Interfaces:**
- Consumes: Task 5의 `NameCandidatesModal`, Task 2의 `listNameCandidates`.

- [ ] **Step 1: import 추가**

Task 6과 동일하게 `NameCandidatesModal`, `listNameCandidates` import 추가.

- [ ] **Step 2: state 추가**

Task 6과 동일한 `showNameCandidates`/`nameVoteStats`/`refreshNameVoteStats` 블록 추가. 이 파일은 `barcode`가 `string`(옵셔널 아님, 빈 문자열 가능)이므로 조건은 `barcode.trim()` 기준으로 맞춘다:

```ts
const [showNameCandidates, setShowNameCandidates] = useState(false);
const [nameVoteStats, setNameVoteStats] = useState<{ likes: number; dislikes: number } | null>(null);

const refreshNameVoteStats = () => {
  const bc = barcode.trim();
  if (!bc) {
    setNameVoteStats(null);
    return;
  }
  listNameCandidates(bc).then((candidates) => {
    const current = candidates.find((c) => c.name === name);
    setNameVoteStats(current ? { likes: current.likes, dislikes: current.dislikes } : null);
  });
};

useEffect(() => {
  refreshNameVoteStats();
}, [barcode]);
```

- [ ] **Step 3: 모달 렌더링 추가**

`<PhotoCandidatesModal ... />` 바로 아래에 추가:

```tsx
      <NameCandidatesModal
        visible={showNameCandidates}
        barcode={barcode.trim()}
        onClose={() => {
          setShowNameCandidates(false);
          refreshNameVoteStats();
        }}
      />
```

- [ ] **Step 4: 링크 + 득표 표시 추가**

기존 "사진 후보 보기 / 투표" `Pressable`(`isEdit && barcode.trim() ? (...) : null` 블록) 바로 아래에 추가:

```tsx
            {isEdit && barcode.trim() ? (
              <View className="mt-1.5 flex-row items-center gap-2">
                <Pressable onPress={() => setShowNameCandidates(true)}>
                  <Text className="text-muted text-xs underline">이름 후보 보기 / 투표</Text>
                </Pressable>
                {nameVoteStats ? (
                  <Text className="text-muted text-xs">
                    👍{nameVoteStats.likes} 👎{nameVoteStats.dislikes}
                  </Text>
                ) : null}
              </View>
            ) : null}
```

- [ ] **Step 5: 수동 검증**

실기기에서 기존 발주 상품 수정 화면 진입 → "이름 후보 보기 / 투표" 링크 확인 → 모달 열어 후보/득표 확인 → 새 이름 제안 입력 후 "제안" 버튼 → 목록에 0표 후보로 추가되는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주 상품 화면에 이름 후보 보기/투표 연결"
```

---

### Task 8: 채택 알림 토스트 (`index.tsx`)

**Files:**
- Modify: `src/app/index.tsx`

**Interfaces:**
- Consumes: Task 2의 `checkAdoptedNameCandidates(): Promise<string[]>`.

- [ ] **Step 1: import 추가**

```ts
import { checkAdoptedNameCandidates } from '@/lib/name-candidates';
```

- [ ] **Step 2: 마운트 시 1회 체크하는 `useEffect` 추가**

기존 `useEffect(() => { if (scanParams.scannedBarcode) {...} }, [...])` 다음에 추가:

```ts
  useEffect(() => {
    checkAdoptedNameCandidates().then((names) => {
      if (names.length === 0) return;
      Alert.alert('반영 완료', `회원님이 제안한 이름 "${names.join('", "')}"이(가) 채택됐어요!`);
    });
  }, []);
```

- [ ] **Step 3: 수동 검증**

Task 6에서 새 이름을 제안·저장했던 바코드에 대해, 다른 계정으로 그 후보에 좋아요를 충분히 눌러 대표 이름을 바꾼 뒤(또는 Supabase 대시보드에서 `product_name_votes`에 직접 좋아요 몇 건 insert), 원래 계정으로 앱을 재실행(홈 화면 진입) → "반영 완료" Alert가 한 번 뜨는지, 앱을 다시 재실행해도 같은 Alert가 반복되지 않는지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/app/index.tsx
git commit -m "feat: 내가 제안한 이름이 채택되면 홈 화면에서 알림"
```

---

### Task 9: 설정 화면에 "내 기여" 요약 추가

**Files:**
- Modify: `src/app/settings.tsx`

**Interfaces:**
- Consumes: Task 2의 `getMyContributionStats(): Promise<{ submittedNames: number; adoptedNames: number }>`.

- [ ] **Step 1: import 추가**

```ts
import { getMyContributionStats } from '@/lib/name-candidates';
```

(`useCallback`, `useFocusEffect`는 이미 이 파일에 import돼 있다.)

- [ ] **Step 2: state + 로드 로직 추가**

컴포넌트 최상단 상태 선언부에 추가:

```ts
const [contribStats, setContribStats] = useState({ submittedNames: 0, adoptedNames: 0 });
const [contribLoading, setContribLoading] = useState(true);

useFocusEffect(
  useCallback(() => {
    setContribLoading(true);
    getMyContributionStats()
      .then(setContribStats)
      .finally(() => setContribLoading(false));
  }, []),
);
```

- [ ] **Step 3: UI 섹션 추가**

`<SectionTitle text="기능" />` 블록 바로 다음, `isCloudMode`로 감싼 "계정" 섹션 앞에 추가:

```tsx
      {isCloudMode ? (
        <>
          <SectionTitle text="내 기여" />
          <View className="overflow-hidden rounded-xl border border-line bg-paper p-4">
            {contribLoading ? (
              <ActivityIndicator color="#CC2222" />
            ) : (
              <>
                <Text className="text-ink text-base font-bold">
                  상품명 제안 {contribStats.submittedNames}건 · 채택 {contribStats.adoptedNames}건
                </Text>
                <Text className="text-muted mt-1 text-xs">
                  내가 제안한 상품명이 다른 사용자 투표로 대표 이름이 되면 채택으로 집계돼요 (이 기기
                  기록 기준 근사치)
                </Text>
              </>
            )}
          </View>
        </>
      ) : null}
```

- [ ] **Step 4: 수동 검증**

실기기에서 설정 화면 진입 → "내 기여" 섹션에 지금까지 이 기기에서 제안한 상품명 건수/채택 건수가 표시되는지 확인 (Task 6/7에서 만든 테스트 데이터 기준으로 1건 이상이어야 함).

- [ ] **Step 5: Commit**

```bash
git add src/app/settings.tsx
git commit -m "feat: 설정 화면에 내 상품명 제안/채택 요약 추가"
```

---

## Self-Review 결과

- **스펙 커버리지:** 배경/범위/아키텍처(Task 1-4), 컴포넌트 상세의 스키마(Task 1)·`name-candidates.ts`(Task 2)·`repo.ts`/`order-repo.ts`(Task 3-4)·UI(Task 5-7), 참여도 항목 1-3(Task 6-9) 모두 태스크로 매핑됨. `order-report.ts` 관련 항목은 스펙 수정으로 "코드 변경 불필요"임을 확인해 태스크에서 제외.
- **플레이스홀더 스캔:** TBD/TODO 없음, 모든 코드 블록이 실제 실행 가능한 완성 코드.
- **타입 일관성:** `NameCandidate`/`submitNameCandidateIfChanged`/`listNameCandidates`/`voteOnName`/`checkAdoptedNameCandidates`/`getMyContributionStats` 시그니처가 Task 2 정의와 Task 3-9 사용처에서 동일하게 유지됨.
