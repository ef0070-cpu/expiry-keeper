# 브랜드 투표 + 가격 참고정보 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 상품의 브랜드를 사진(`order_catalog_photos`/`order_photo_votes`)과 동일한 "후보 제출 + 좋아요/싫어요 투표, 득표 1위가 자동 대표값" 방식으로 바꾸고, 가격은 공용 대표값을 만들지 않는 대신 다른 매장이 등록한 참고 가격을 읽기 전용으로 보여준다.

**Architecture:** 새 테이블 `product_brand_candidates`/`product_brand_votes` + 트리거로 `order_catalog.brand`를 자동 갱신한다(barcode_catalog는 brand 컬럼이 없어 영향 없음). `apply_approved_order_report`(정보 오류 신고 승인 트리거)에서 brand를 제외해 신고 승인이 더 이상 brand를 못 건드리게 막는다. 클라이언트는 `photo-candidates.ts`/`PhotoCandidatesModal.tsx`/`order-report.ts`의 사진 투표 코드를 그대로 미러링한다. 가격은 새 테이블 없이 `syncOrderCatalog()`가 이미 받아오는 `order_catalog.price`를 별도 키에 원본 그대로 저장해 참고용으로만 표시한다.

**Tech Stack:** Expo/React Native, Supabase(Postgres + RLS + trigger), AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-09-14-brand-voting-price-reference-design.md`

## Global Constraints

- 이 저장소는 자동화 테스트 스위트가 없다 — 각 태스크는 자동 테스트 대신 수동 검증 단계로 끝난다(기존 관례).
- 모든 신규 Supabase 호출은 best-effort(`.catch(() => {})`)로 감싸 로컬 저장 흐름을 막지 않는다 — 기존 `submitPhotoCandidateIfChanged` 호출부와 동일한 관례.
- brand는 `order_catalog.brand`에만 존재한다(`barcode_catalog`에는 brand 컬럼 자체가 없음) — 이 계획은 재고 화면(`product-form.tsx`, `src/lib/repo.ts`)을 건드리지 않는다. 발주 화면(`order-product-form.tsx`, `src/lib/order-repo.ts`)에만 적용한다.
- 이번 기능이 배포되면 기존 로컬 오버라이드(`recordBrandOverride`/`getBrandOverrides`, `orderBrandOverrides:v1`)는 투표 결과가 대표값이 되므로 더는 필요 없다 — Task 5에서 제거한다. 가격 쪽 로컬 오버라이드(`recordPriceOverride`/`getPriceOverrides`)는 그대로 유지한다(가격은 여전히 매장별 값).
- 각 Supabase 마이그레이션 SQL 파일은 Supabase 대시보드 SQL Editor에서 사람이 직접 실행한다(이 저장소는 마이그레이션 자동 적용 도구가 없다) — 태스크의 "Step: 실행" 단계는 사용자에게 파일 내용을 보여주고 실행을 요청하는 것으로 완료 처리한다.

---

### Task 1: Supabase 마이그레이션 — 브랜드 후보/투표 테이블 + 트리거 + 백필

**Files:**
- Create: `supabase/migration-order-brand-voting.sql`

**Interfaces:**
- Produces: 테이블 `product_brand_candidates(id, barcode, brand, submitted_by, created_at)`, `product_brand_votes(candidate_id, voter_id, vote, created_at)`. 함수 `recalc_order_brand_representative(target_barcode text)`. 이후 Task 3(`order-report.ts`)이 이 두 테이블에 insert/select한다.

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 발주 브랜드 좋아요/싫어요 투표 (2026-09-14)
-- 사진(order_catalog_photos/order_photo_votes)과 동일한 "후보 + 투표, 득표 1위가 실시간
-- 대표값" 방식을 order_catalog.brand에 적용한다. barcode_catalog에는 brand 컬럼이 없으므로
-- order_catalog 한 곳만 갱신한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.product_brand_candidates (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  brand text not null,
  submitted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists product_brand_candidates_barcode_idx on public.product_brand_candidates(barcode);

alter table public.product_brand_candidates enable row level security;
drop policy if exists "product_brand_candidates select all" on public.product_brand_candidates;
create policy "product_brand_candidates select all" on public.product_brand_candidates for select using (true);
drop policy if exists "product_brand_candidates insert own" on public.product_brand_candidates;
create policy "product_brand_candidates insert own" on public.product_brand_candidates
  for insert with check (auth.uid() = submitted_by);
-- update/delete 정책 없음: 후보는 감사 기록으로 남긴다.

create table if not exists public.product_brand_votes (
  candidate_id uuid not null references public.product_brand_candidates(id) on delete cascade,
  voter_id uuid not null references auth.users(id),
  vote smallint not null check (vote in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (candidate_id, voter_id)
);

alter table public.product_brand_votes enable row level security;
drop policy if exists "product_brand_votes select all" on public.product_brand_votes;
create policy "product_brand_votes select all" on public.product_brand_votes for select using (true);
drop policy if exists "product_brand_votes insert own" on public.product_brand_votes;
create policy "product_brand_votes insert own" on public.product_brand_votes
  for insert with check (auth.uid() = voter_id);
drop policy if exists "product_brand_votes update own" on public.product_brand_votes;
create policy "product_brand_votes update own" on public.product_brand_votes
  for update using (auth.uid() = voter_id);
drop policy if exists "product_brand_votes delete own" on public.product_brand_votes;
create policy "product_brand_votes delete own" on public.product_brand_votes
  for delete using (auth.uid() = voter_id);

-- 대표 브랜드 재계산 (득표 최고 → 동점이면 최초 등록 우선). order_catalog.brand에만 반영.
create or replace function public.recalc_order_brand_representative(target_barcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  winner_brand text;
begin
  select c.brand into winner_brand
  from public.product_brand_candidates c
  left join (
    select candidate_id, sum(vote) as score
    from public.product_brand_votes
    group by candidate_id
  ) v on v.candidate_id = c.id
  where c.barcode = target_barcode
  order by coalesce(v.score, 0) desc, c.created_at asc
  limit 1;

  if winner_brand is null then
    return;
  end if;

  update public.order_catalog set brand = winner_brand, updated_at = now() where barcode = target_barcode;
end;
$$;

create or replace function public.product_brand_candidates_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalc_order_brand_representative(coalesce(new.barcode, old.barcode));
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_brand_candidates_recalc on public.product_brand_candidates;
create trigger product_brand_candidates_recalc
  after insert or delete on public.product_brand_candidates
  for each row execute function public.product_brand_candidates_recalc_trigger();

create or replace function public.product_brand_votes_recalc_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_barcode text;
begin
  select barcode into affected_barcode from public.product_brand_candidates
  where id = coalesce(new.candidate_id, old.candidate_id);
  perform public.recalc_order_brand_representative(affected_barcode);
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_brand_votes_recalc on public.product_brand_votes;
create trigger product_brand_votes_recalc
  after insert or update or delete on public.product_brand_votes
  for each row execute function public.product_brand_votes_recalc_trigger();

-- 백필: order_catalog에 이미 있는 브랜드를 0표 후보로 먼저 채운다 (빈 문자열/null 제외).
-- 이게 없으면 새로 제안되는 0표 후보가 그 바코드의 유일한 후보가 되어 기존 브랜드를 즉시 대체해버린다.
insert into public.product_brand_candidates (barcode, brand, submitted_by)
select barcode, brand, '00000000-0000-0000-0000-000000000000'::uuid
from public.order_catalog
where brand is not null and brand <> ''
  and not exists (
    select 1 from public.product_brand_candidates c where c.barcode = order_catalog.barcode
  );

-- 정보 오류 신고(kind='fix') 승인 시 더 이상 brand를 건드리지 않도록 트리거 교체.
-- (직전 버전은 migration-order-photo-voting.sql이 정의한, image_uri를 이미 뺀 버전이다.)
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

  insert into public.order_catalog (barcode, name, price, category, updated_at)
  values (new.barcode, nullif(new.name, ''), new.price, nullif(new.category, ''), now())
  on conflict (barcode) do update set
    name = coalesce(nullif(excluded.name, ''), order_catalog.name),
    price = coalesce(excluded.price, order_catalog.price),
    category = coalesce(nullif(excluded.category, ''), order_catalog.category),
    updated_at = now();

  return new;
end;
$$;
```

- [ ] **Step 2: Supabase 대시보드 SQL Editor에서 실행**

사용자에게 위 SQL 전체를 보여주고 Supabase 대시보드 SQL Editor에 붙여넣어 실행해달라고 요청한다. "Success. No rows returned"가 뜨면 완료.

- [ ] **Step 3: 수동 검증 — 테이블/백필 확인**

Supabase 대시보드 Table Editor에서:
- `product_brand_candidates`에 기존 `order_catalog`의 브랜드 개수만큼 행이 백필됐는지 확인 (브랜드가 비어있던 상품은 제외됨).
- 아무 바코드나 골라 `product_brand_candidates`에 새 행을 하나 더 수동 insert(`barcode`, `brand`, `submitted_by`는 아무 로그인 사용자 uuid)한 뒤, `order_catalog.brand`가 그대로인지 확인(신규 후보는 0표라 기존 백필 후보를 못 이김 — 동점이면 먼저 등록된 것이 이기므로).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-order-brand-voting.sql
git commit -m "docs: 발주 브랜드 좋아요/싫어요 투표 마이그레이션 추가"
```

---

### Task 2: `src/lib/brand-candidates.ts` 신규

**Files:**
- Create: `src/lib/brand-candidates.ts` (`src/lib/photo-candidates.ts` 구조를 그대로 미러링)

**Interfaces:**
- Consumes: 없음 (AsyncStorage만 사용).
- Produces: `getSubmittedBrandCandidates(): Promise<Map<string, string>>`, `recordSubmittedBrandCandidate(barcode: string, brand: string): Promise<void>`, `clearSubmittedBrandCandidate(barcode: string): Promise<void>`, `submitBrandCandidateIfChanged(barcode: string, brand: string): Promise<void>`. Task 5(`order-repo.ts`)가 `submitBrandCandidateIfChanged`를 호출한다.

- [ ] **Step 1: 파일 작성**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitBrandCandidate } from './order-report';

const SUBMITTED_BRAND_KEY = 'submittedBrandCandidates:v1';

/** 이 기기가 각 바코드에 대해 마지막으로 제출한 브랜드. 투표로 대표 브랜드가 되기 전까지
 * syncOrderCatalog가 공용 값으로 덮어쓰지 않도록 이 값을 쓰지는 않는다(브랜드는 오버라이드
 * 없이 투표 결과를 그대로 받는다) — 순수하게 "같은 값 반복 제출 방지"용 기록이다. */
export async function getSubmittedBrandCandidates(): Promise<Map<string, string>> {
  const raw = await AsyncStorage.getItem(SUBMITTED_BRAND_KEY);
  return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {}));
}

async function recordSubmittedBrandCandidate(barcode: string, brand: string): Promise<void> {
  const map = await getSubmittedBrandCandidates();
  map.set(barcode, brand);
  await AsyncStorage.setItem(SUBMITTED_BRAND_KEY, JSON.stringify(Object.fromEntries(map)));
}

/**
 * 이 바코드에 마지막으로 제출한 브랜드와 다를 때만 새 후보로 제출한다(같은 값 반복 저장 시
 * 후보 중복 방지). 로컬 기록은 네트워크 제출 성공 여부와 무관하게 즉시 저장한다.
 */
export async function submitBrandCandidateIfChanged(barcode: string, brand: string): Promise<void> {
  const trimmed = brand.trim();
  if (!trimmed) return;
  const map = await getSubmittedBrandCandidates();
  if (map.get(barcode) === trimmed) return;
  await recordSubmittedBrandCandidate(barcode, trimmed);
  submitBrandCandidate(barcode, trimmed).catch(() => {});
}
```

- [ ] **Step 2: 타입 체크로 문법/타입 오류 확인**

Run: `npx tsc --noEmit -p .`
Expected: `src/app/login.tsx(115,45)` 기존 무관 오류 외에 `brand-candidates.ts` 관련 오류 없음. (이 시점엔 `submitBrandCandidate`가 아직 없어 import 오류가 날 수 있음 — Task 3 완료 후 다시 확인하면 된다. 지금은 파일 문법만 확인.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/brand-candidates.ts
git commit -m "feat: 브랜드 후보 로컬 제출 기록 유틸 추가"
```

---

### Task 3: `src/lib/order-report.ts`에 브랜드 후보/투표 함수 추가

**Files:**
- Modify: `src/lib/order-report.ts` (파일 끝에 추가 — `listPhotoCandidates`/`voteOnPhoto`/`PhotoCandidate` 타입을 그대로 미러링)

**Interfaces:**
- Consumes: `supabase` (`./supabase`에서 이미 import됨).
- Produces: `submitBrandCandidate(barcode: string, brand: string): Promise<void>`, `type BrandCandidate = { id: string; brand: string; likes: number; dislikes: number; myVote: 1 | -1 | null }`, `listBrandCandidates(barcode: string): Promise<BrandCandidate[]>`, `voteOnBrand(candidateId: string, vote: 1 | -1): Promise<void>`. Task 2가 `submitBrandCandidate`를 쓰고, Task 4(`BrandCandidatesModal.tsx`)가 `listBrandCandidates`/`voteOnBrand`/`BrandCandidate`를 쓴다.

- [ ] **Step 1: 파일 끝에 추가**

`src/lib/order-report.ts` 맨 아래에 추가:

```ts
/** 브랜드 후보를 product_brand_candidates에 추가한다. 검토 없이 즉시 접수되지만, 대표
 * 브랜드가 되려면 다른 사용자의 좋아요를 받아야 한다(사진과 동일한 패턴). */
export async function submitBrandCandidate(barcode: string, brand: string): Promise<void> {
  if (!supabase) return;
  try {
    const { error } = await supabase.from('product_brand_candidates').insert({ barcode, brand });
    if (error) throw error;
  } catch {
    // best-effort
  }
}

export type BrandCandidate = {
  id: string;
  brand: string;
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

/** 이 바코드의 브랜드 후보들과 각 후보의 득표 현황, 내 투표 상태를 조회한다. */
export async function listBrandCandidates(barcode: string): Promise<BrandCandidate[]> {
  if (!supabase) return [];
  const [{ data: candidates, error }, { data: sessionData }] = await Promise.all([
    supabase
      .from('product_brand_candidates')
      .select('id, brand')
      .eq('barcode', barcode)
      .order('created_at', { ascending: true }),
    supabase.auth.getSession(),
  ]);
  if (error || !candidates || candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const { data: votes } = await supabase
    .from('product_brand_votes')
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
      brand: c.brand,
      likes,
      dislikes,
      myVote: (mine?.vote as 1 | -1 | undefined) ?? null,
    };
  });
}

/** 브랜드 후보에 좋아요/싫어요 투표한다. 이미 같은 값으로 투표했으면 취소(중립)한다. */
export async function voteOnBrand(candidateId: string, vote: 1 | -1): Promise<void> {
  if (!supabase) throw new Error('로그인이 필요합니다.');
  const { data: sessionData } = await supabase.auth.getSession();
  const voterId = sessionData.session?.user.id;
  if (!voterId) throw new Error('로그인이 필요합니다.');

  const { data: existing } = await supabase
    .from('product_brand_votes')
    .select('vote')
    .eq('candidate_id', candidateId)
    .eq('voter_id', voterId)
    .maybeSingle();

  if (existing?.vote === vote) {
    const { error } = await supabase
      .from('product_brand_votes')
      .delete()
      .eq('candidate_id', candidateId)
      .eq('voter_id', voterId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('product_brand_votes')
    .upsert({ candidate_id: candidateId, vote }, { onConflict: 'candidate_id,voter_id' });
  if (error) throw error;
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 기존 `login.tsx` 오류 외에 없음. Task 2의 `brand-candidates.ts` import 오류도 이제 사라져야 한다.

- [ ] **Step 3: Commit**

```bash
git add src/lib/order-report.ts
git commit -m "feat: 브랜드 후보 제출/조회/투표 API 추가"
```

---

### Task 4: `src/components/BrandCandidatesModal.tsx` 신규

**Files:**
- Create: `src/components/BrandCandidatesModal.tsx` (`src/components/PhotoCandidatesModal.tsx` 구조를 텍스트 목록 + 새 브랜드 입력창으로 변형)

**Interfaces:**
- Consumes: `listBrandCandidates`, `voteOnBrand`, `BrandCandidate` (Task 3), `submitBrandCandidateIfChanged` (Task 2).
- Produces: `export default function BrandCandidatesModal({ visible, barcode, onClose }: { visible: boolean; barcode: string; onClose: () => void })`. Task 6(`order-product-form.tsx`)이 이 컴포넌트를 렌더링한다.

- [ ] **Step 1: 파일 작성**

```tsx
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { submitBrandCandidateIfChanged } from '@/lib/brand-candidates';
import { listBrandCandidates, voteOnBrand, type BrandCandidate } from '@/lib/order-report';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

/**
 * 이 바코드에 등록된 브랜드 후보들을 보여주고 좋아요/싫어요 투표를 받는다. 하단에서 새
 * 브랜드도 제안할 수 있다. 대표 브랜드는 DB 트리거가 득표수로 자동 결정하므로, 여기서 직접
 * "이걸로 확정" 선택은 없다.
 */
export default function BrandCandidatesModal({
  visible,
  barcode,
  onClose,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<BrandCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    listBrandCandidates(barcode)
      .then(setCandidates)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, barcode]);

  const vote = async (candidateId: string, value: 1 | -1) => {
    setVotingId(candidateId);
    try {
      await voteOnBrand(candidateId, value);
      load();
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  const submitNew = async () => {
    const v = newBrand.trim();
    if (!v) return;
    setSubmitting(true);
    try {
      await submitBrandCandidateIfChanged(barcode, v);
      setNewBrand('');
      load();
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
          <Text className="text-ink mb-3 text-base font-bold">브랜드 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 후보가 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className="mb-3 flex-row items-center rounded-xl border border-line p-3"
                >
                  <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                    {c.brand}
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 16 }}>
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
          <View className="mt-3 flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="다른 브랜드 제안하기"
              placeholderTextColor="#BBBBBB"
              value={newBrand}
              onChangeText={setNewBrand}
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

Run: `npx tsc --noEmit -p .`
Expected: 기존 `login.tsx` 오류 외에 없음.

- [ ] **Step 3: Commit**

```bash
git add src/components/BrandCandidatesModal.tsx
git commit -m "feat: 브랜드 후보 보기/투표 모달 추가"
```

---

### Task 5: `order-repo.ts` 수정 — 브랜드 투표 연결 + 기존 로컬 오버라이드 제거

**Files:**
- Modify: `src/lib/order-repo.ts`

**Interfaces:**
- Consumes: `submitBrandCandidateIfChanged` (Task 2).
- Produces: `saveOrderProduct`/`syncOrderCatalog` 시그니처는 그대로(내부 동작만 변경). `getBrandOverrides`/`recordBrandOverride`/`BRAND_OVERRIDE_KEY` 제거 — 이 함수들을 참조하는 다른 파일이 없는지 Step 1에서 먼저 확인한다.

- [ ] **Step 1: 다른 파일에서 브랜드 오버라이드 함수를 쓰는 곳이 없는지 확인**

Run: `grep -rn "getBrandOverrides\|recordBrandOverride" src/`
Expected: `src/lib/order-repo.ts` 자기 자신 안의 정의/호출부만 나와야 한다(정의 1곳 + `saveOrderProduct`/`syncOrderCatalog` 안의 호출부). 다른 파일에서 걸리면 그 파일도 같이 정리해야 하므로 이 계획을 진행하기 전에 먼저 확인.

- [ ] **Step 2: import 교체**

`src/lib/order-repo.ts` 상단 import에서:

```ts
import { reportOrderProductIssue, submitNewOrderProduct } from './order-report';
```

를 그대로 두고, 새로 추가:

```ts
import { submitBrandCandidateIfChanged } from './brand-candidates';
```

- [ ] **Step 3: `BRAND_OVERRIDE_KEY` 상수와 `getBrandOverrides`/`recordBrandOverride` 함수 삭제**

`const BRAND_OVERRIDE_KEY = 'orderBrandOverrides:v1';` 줄을 삭제한다(바로 아래 `PRICE_OVERRIDE_KEY`는 유지).

`getBrandOverrides`/`recordBrandOverride` 함수 정의(`getCategoryOverrides`/`recordCategoryOverride` 다음, `getPriceOverrides`/`recordPriceOverride` 이전에 있음)를 통째로 삭제한다.

- [ ] **Step 4: `saveOrderProduct` 수정**

현재:

```ts
  // 가격/브랜드 수정도 카테고리와 같은 이유로 로컬 오버라이드를 남긴다. 추가로, 다른 사용자에게도
  // 반영되려면 관리자 승인이 필요하므로(가격은 오탈자·낚시성 입력 위험이 있어 카테고리처럼 즉시
  // 신뢰하지 않음) 신고 테이블(order_product_reports, kind 기본값 'fix')에 자동 제출한다 —
  // 관리자가 대시보드에서 승인하면 트리거가 공용 카탈로그(order_catalog)에 반영해 모두에게 퍼진다.
  if ((brandChanged || priceChanged) && p.barcode) {
    if (brandChanged) recordBrandOverride(p.barcode, p.brand).catch(() => {});
    if (priceChanged) recordPriceOverride(p.barcode, p.price).catch(() => {});
    reportOrderProductIssue(p, '가격/브랜드 수정 (앱에서 자동 제출됨)').catch(() => {});
  }
```

로 되어 있다. 이걸로 교체:

```ts
  // 브랜드는 이제 투표로 대표값이 결정되므로, 로컬 오버라이드 대신 후보로 제출한다(다른 후보와
  // 동률/신규일 때만 즉시 대표가 되고, 그 외엔 투표를 받아야 한다).
  if (brandChanged && p.barcode) {
    submitBrandCandidateIfChanged(p.barcode, p.brand).catch(() => {});
  }
  // 가격 수정은 매장마다 실제로 다를 수 있어(가맹점별 판매가 차이) 대표값으로 만들지 않는다.
  // 로컬 오버라이드만 남겨 동기화가 내 가격을 덮어쓰지 못하게 하고, 참고용 신고만 접수한다.
  if (priceChanged && p.barcode) {
    recordPriceOverride(p.barcode, p.price).catch(() => {});
    reportOrderProductIssue(p, '가격 수정 (앱에서 자동 제출됨)').catch(() => {});
  }
```

그리고 함수 맨 위쪽의 `const brandChanged = ...` 줄은 그대로 둔다(위 코드에서 여전히 씀).

- [ ] **Step 5: `syncOrderCatalog` 수정 — brand 오버라이드 적용 제거**

현재:

```ts
    const [items, removedBarcodes, categoryOverrides, brandOverrides, priceOverrides, photoOverrides] =
      await Promise.all([
        listOrderProducts(),
        getRemovedBarcodes(),
        getCategoryOverrides(),
        getBrandOverrides(),
        getPriceOverrides(),
        getSubmittedPhotoCandidates(),
      ]);
    const rows = (data as OrderCatalogRow[]).map((row) => {
      const withCategory = categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row;
      const withBrand = brandOverrides.has(row.barcode)
        ? { ...withCategory, brand: brandOverrides.get(row.barcode)! }
        : withCategory;
      const withPrice = priceOverrides.has(row.barcode)
        ? { ...withBrand, price: priceOverrides.get(row.barcode)! }
        : withBrand;
      // 이 기기에서 직접 고른 사진은 투표로 대표사진이 되기 전까지 공용 값이 덮어쓰지 않게 한다
      // (카테고리 오버라이드와 같은 이유).
      return photoOverrides.has(row.barcode)
        ? { ...withPrice, image_uri: photoOverrides.get(row.barcode)! }
        : withPrice;
    });
```

로 되어 있다. 이걸로 교체(brand는 이제 공용 카탈로그 값을 그대로 신뢰 — 투표 결과이므로):

```ts
    const [items, removedBarcodes, categoryOverrides, priceOverrides, photoOverrides] = await Promise.all([
      listOrderProducts(),
      getRemovedBarcodes(),
      getCategoryOverrides(),
      getPriceOverrides(),
      getSubmittedPhotoCandidates(),
    ]);
    const rows = (data as OrderCatalogRow[]).map((row) => {
      const withCategory = categoryOverrides.has(row.barcode)
        ? { ...row, category: categoryOverrides.get(row.barcode)! }
        : row;
      const withPrice = priceOverrides.has(row.barcode)
        ? { ...withCategory, price: priceOverrides.get(row.barcode)! }
        : withCategory;
      // 이 기기에서 직접 고른 사진은 투표로 대표사진이 되기 전까지 공용 값이 덮어쓰지 않게 한다
      // (카테고리 오버라이드와 같은 이유). 브랜드는 이제 오버라이드 없이 공용 값(투표 결과)을 그대로 쓴다.
      return photoOverrides.has(row.barcode)
        ? { ...withPrice, image_uri: photoOverrides.get(row.barcode)! }
        : withPrice;
    });
```

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 기존 `login.tsx` 오류 외에 없음. `getBrandOverrides`/`recordBrandOverride`를 참조하는 곳이 남아있으면 여기서 에러로 드러난다.

- [ ] **Step 7: 수동 검증**

앱에서 바코드 있는 발주 상품의 브랜드를 수정 → 저장 직후 값이 바뀌어 보이는지 확인. 화면을 나갔다 들어와도(로컬 저장이라 유지) 값이 그대로인지 확인. (실제로 다른 사용자 화면까지 바뀌려면 그 브랜드가 투표에서 이겨야 하므로, 이 단계에서는 "내 화면에서 바로 반영"까지만 확인.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "refactor: 발주 브랜드 수정을 로컬 오버라이드 대신 투표 후보 제출로 전환"
```

---

### Task 6: 가격 참고정보 저장 — `order-repo.ts`

**Files:**
- Modify: `src/lib/order-repo.ts`

**Interfaces:**
- Consumes: 없음(기존 `syncOrderCatalog` 내부 데이터 재사용).
- Produces: `getCatalogReferencePrice(barcode: string): Promise<number | null>`. Task 7(`order-product-form.tsx`)이 이 함수를 쓴다.

- [ ] **Step 1: 상수 추가**

`PRICE_OVERRIDE_KEY` 선언부 근처에 추가:

```ts
const CATALOG_REFERENCE_PRICE_KEY = 'orderCatalogReferencePrice:v1';
```

- [ ] **Step 2: `getCatalogReferencePrice` 함수 추가**

`getPriceOverrides`/`recordPriceOverride` 정의 바로 다음에 추가:

```ts
/** 공용 카탈로그(order_catalog)에 등록된 참고 가격 — 매장마다 실제 가격이 다를 수 있어
 * 내 가격에 자동 반영하지 않고, 화면에 "다른 매장 참고가"로만 보여주는 용도. */
export async function getCatalogReferencePrice(barcode: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(CATALOG_REFERENCE_PRICE_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[barcode] ?? null;
}

async function writeCatalogReferencePrices(map: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(CATALOG_REFERENCE_PRICE_KEY, JSON.stringify(map));
}
```

- [ ] **Step 3: `syncOrderCatalog`에서 원본 가격 기록**

`syncOrderCatalog` 안, `const rows = (data as OrderCatalogRow[]).map(...)` 줄 바로 앞에 추가:

```ts
    const referencePrices: Record<string, number> = {};
    for (const row of data as OrderCatalogRow[]) {
      if (row.price != null) referencePrices[row.barcode] = row.price;
    }
    writeCatalogReferencePrices(referencePrices).catch(() => {});

```

(이 블록은 override 적용 *전* 원본 `data`를 순회하므로, 로컬 가격 오버라이드로 치환되기 전의 진짜 공용 카탈로그 값이 저장된다.)

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 기존 `login.tsx` 오류 외에 없음.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-repo.ts
git commit -m "feat: 공용 카탈로그 참고 가격 저장 함수 추가"
```

---

### Task 7: `order-product-form.tsx` UI 통합

**Files:**
- Modify: `src/app/order-product-form.tsx`

**Interfaces:**
- Consumes: `BrandCandidatesModal` (Task 4), `getCatalogReferencePrice` (Task 6).
- Produces: 없음(화면 UI만).

- [ ] **Step 1: import 추가**

```ts
import BrandCandidatesModal from '@/components/BrandCandidatesModal';
```

`import { ... } from '@/lib/order-repo';` 블록에 `getCatalogReferencePrice` 추가.

- [ ] **Step 2: state 추가**

`const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);` 옆에 추가:

```ts
  const [showBrandCandidates, setShowBrandCandidates] = useState(false);
  const [referencePrice, setReferencePrice] = useState<number | null>(null);
```

- [ ] **Step 3: 참고 가격 로드**

바코드가 바뀔 때마다(초기 로드 포함) 참고 가격을 읽어온다. 기존에 바코드로 상품 정보를 불러오는 `useEffect`(파일 상단, `params.id`로 기존 상품을 불러오는 부분) 근처에 새 `useEffect`를 추가:

```ts
  useEffect(() => {
    const trimmed = barcode.trim();
    if (!trimmed) {
      setReferencePrice(null);
      return;
    }
    getCatalogReferencePrice(trimmed).then(setReferencePrice);
  }, [barcode]);
```

- [ ] **Step 4: 브랜드 필드 옆에 후보 링크 추가**

현재:

```tsx
          <View className="flex-1">
            <Label text="브랜드" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 빙그레"
              placeholderTextColor="#BBBBBB"
              value={brand}
              onChangeText={setBrand}
            />
          </View>
```

로 되어 있다(가격 입력 옆, `flex-row gap-3` 안). 이걸로 교체:

```tsx
          <View className="flex-1">
            <Label text="브랜드" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 빙그레"
              placeholderTextColor="#BBBBBB"
              value={brand}
              onChangeText={setBrand}
            />
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setShowBrandCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">브랜드 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
          </View>
```

- [ ] **Step 5: 가격 필드 밑에 참고정보 추가**

현재:

```tsx
          <View className="flex-1">
            <Label text="가격 (원)" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 400"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              value={price}
              onChangeText={setPrice}
            />
          </View>
```

로 되어 있다. 이걸로 교체:

```tsx
          <View className="flex-1">
            <Label text="가격 (원)" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 400"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              value={price}
              onChangeText={setPrice}
            />
            {referencePrice != null && String(referencePrice) !== price.trim() ? (
              <Text className="text-muted mt-1.5 text-xs">
                참고: 공용 카탈로그 가격 {referencePrice.toLocaleString()}원 (내 매장 가격과 다를 수 있어요)
              </Text>
            ) : null}
          </View>
```

- [ ] **Step 6: 모달 렌더링 추가**

기존 `<PhotoCandidatesModal .../>` 바로 다음에 추가:

```tsx
      <BrandCandidatesModal
        visible={showBrandCandidates}
        barcode={barcode.trim()}
        onClose={() => setShowBrandCandidates(false)}
      />
```

- [ ] **Step 7: 타입 체크**

Run: `npx tsc --noEmit -p .`
Expected: 기존 `login.tsx` 오류 외에 없음.

- [ ] **Step 8: 수동 검증**

1. 바코드 있는 기존 발주 상품 편집 화면 진입 → "브랜드 후보 보기 / 투표" 링크가 뜨는지 확인.
2. 눌러서 모달 열기 → 기존 브랜드가 후보로 이미 있는지(백필 확인), 좋아요 누르면 득표수가 올라가는지 확인.
3. 하단 입력창에 새 브랜드 제안 → 후보 목록에 추가되는지 확인.
4. 다른 매장 가격이 등록된 바코드(또는 Supabase에서 `order_catalog.price`를 수동으로 다른 값으로 바꿔서 테스트) → 내 가격 입력값과 다르면 "참고: 공용 카탈로그 가격 ...원" 문구가 뜨고, 내 가격 입력값은 안 바뀌는지 확인.
5. 참고 가격과 내 입력값이 같으면 문구가 안 뜨는지 확인.

- [ ] **Step 9: Commit**

```bash
git add src/app/order-product-form.tsx
git commit -m "feat: 발주 상품 화면에 브랜드 투표 링크와 가격 참고정보 표시 추가"
```

---

### Task 8: 전체 수동 회귀 확인

**Files:** 없음(코드 변경 없이 검증만).

- [ ] **Step 1: 브랜드 투표 전체 시나리오**

1. 바코드 없는 신규 상품 등록 → 정상 동작(브랜드 후보 로직은 바코드 있을 때만 동작하므로 영향 없어야 함).
2. 기존 후보가 있는 브랜드를 다른 기기(또는 다른 로그인 계정)에서 다른 값으로 저장 → 대표 브랜드가 즉시 안 바뀌고, 투표를 더 받아야 바뀌는지 확인.
3. 여러 좋아요를 받은 새 브랜드 후보가 기존 대표 브랜드보다 득표가 높아지면, 자동으로 대표 브랜드가 바뀌고 다른 기기에서 `syncOrderCatalog`가 돌면 그 값이 반영되는지 확인.
4. 정보 오류 신고(kind='fix')가 관리자 승인됨 → 브랜드는 전혀 안 바뀌고 가격/카테고리만 바뀌는지 확인 (Task 1에서 트리거를 교체했으므로).

- [ ] **Step 2: 가격 참고정보 회귀**

발주 화면을 여러 번 오가며 내 가격 입력값이 절대 자동으로 안 바뀌는지 재확인(참고 문구만 갱신).

- [ ] **Step 3: 기존 기능 회귀**

카테고리 로컬 오버라이드(이번 계획에서 안 건드림), 사진 투표(이번 계획에서 안 건드림), 신규 상품 등록(kind='new' 자동승인 경로)이 여전히 정상 동작하는지 확인.
