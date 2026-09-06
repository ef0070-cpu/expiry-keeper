# 팀 해체·팀원 강퇴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀장이 팀을 해체(삭제)하거나 특정 멤버를 강퇴할 수 있게 한다.

**Architecture:** DB 쪽엔 `leave_team()`과 동일한 `security definer` RPC 패턴으로 `disband_team()`/`kick_member()`를 추가하고, 클라이언트는 `Team.ownerId`를 노출해 `team.tsx`가 팀장 여부에 따라 다른 버튼을 보여주게 한다.

**Tech Stack:** Supabase (Postgres RPC, RLS 기존 그대로), React Native + Expo Router, NativeWind.

## Global Constraints

- 팀장 여부는 `teams.owner_id = auth.uid()`로만 판정한다 — 새 권한 컬럼/테이블을 추가하지 않는다.
- `disband_team()`/`kick_member()`는 팀 생성/참여/탈퇴와 동일하게 `security definer` + `set search_path = public` RPC 함수로만 만든다(직접 `insert`/`delete` 금지 — 기존 `schema.sql`의 명시적 원칙).
- 기존 `leave_team()`, `create_team()`, `join_team_by_code()`는 수정하지 않는다.
- 강퇴/해체로 인해 팀에서 빠지는 멤버가 등록한 상품은 `leave_team()`과 동일하게 개인 상품으로 되돌린다(`team_id = null`).
- **SQL 마이그레이션(`migration-team-disband-kick.sql`) 실행은 이 계획의 어떤 태스크에서도 자동으로 하지 않는다** — 프로덕션 Supabase DB에 대한 변경이므로, 실행은 사람이 Supabase 대시보드 SQL Editor에서 직접 한다(기존 프로젝트 관례 — README와 다른 `migration-*.sql` 파일들도 전부 이 방식).
- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱 — `npx tsc --noEmit` + 수동 시나리오로 검증한다. SQL 함수는 `*.selfcheck.ts` 대상이 아니다(DB I/O라 순수 로직이 아님).
- 참고 스펙 문서: `docs/superpowers/specs/2026-09-06-team-disband-kick-design.md`

---

### Task 1: DB 함수 (`disband_team`, `kick_member`)

**Files:**
- Create: `supabase/migration-team-disband-kick.sql`
- Modify: `supabase/schema.sql` (`leave_team()` 함수 바로 뒤에 추가)

**Interfaces:**
- Consumes: 없음 (기존 `teams.owner_id`, `team_members`, `products.team_id`, `my_team_id()`만 사용)
- Produces: RPC `disband_team()` — 인자 없음, 반환 없음. RPC `kick_member(target_user_id uuid)` — 반환 없음.

이 태스크는 SQL만 작성한다. 자동 테스트나 실행이 없다 — 아래 두 함수를 **문자 그대로** 두 파일에 작성하고, `leave_team()`(같은 파일에 이미 있음)과 문법 스타일이 일치하는지 눈으로 대조하는 것이 유일한 검증이다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migration-team-disband-kick.sql` (새 파일):

```sql
-- 팀 해체·팀원 강퇴 마이그레이션 (2026-09-06)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

-- 팀 해체 (팀장 전용) — 멤버가 남아있어도 즉시 팀을 없앤다.
--  · team_members는 teams FK의 on delete cascade로 자동 삭제
--  · 팀 상품(team_id)은 products FK의 on delete set null로 각자 개인 상품으로 돌아감
create or replace function public.disband_team()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  my_team uuid;
  is_owner boolean;
begin
  my_team := public.my_team_id();
  if my_team is null then
    raise exception '소속된 팀이 없습니다';
  end if;

  select (t.owner_id = auth.uid()) into is_owner from public.teams t where t.id = my_team;
  if not is_owner then
    raise exception '팀장만 팀을 해체할 수 있습니다';
  end if;

  delete from public.teams t where t.id = my_team;
end;
$$;

-- 팀원 강퇴 (팀장 전용, 본인은 대상이 될 수 없음)
create or replace function public.kick_member(target_user_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  my_team uuid;
  is_owner boolean;
begin
  my_team := public.my_team_id();
  if my_team is null then
    raise exception '소속된 팀이 없습니다';
  end if;

  select (t.owner_id = auth.uid()) into is_owner from public.teams t where t.id = my_team;
  if not is_owner then
    raise exception '팀장만 멤버를 내보낼 수 있습니다';
  end if;

  if target_user_id = auth.uid() then
    raise exception '본인은 강퇴할 수 없습니다. 팀 나가기 또는 팀 해체를 이용하세요';
  end if;

  if not exists (
    select 1 from public.team_members m where m.team_id = my_team and m.user_id = target_user_id
  ) then
    raise exception '해당 멤버를 찾을 수 없습니다';
  end if;

  -- 강퇴된 멤버가 등록한 상품은 개인 상품으로 되돌린다 (leave_team과 동일 정책)
  update public.products p set team_id = null
  where p.team_id = my_team and p.user_id = target_user_id;

  delete from public.team_members m where m.team_id = my_team and m.user_id = target_user_id;
end;
$$;
```

- [ ] **Step 2: `schema.sql`에도 동일 함수 추가**

`supabase/schema.sql`에서 `leave_team()` 함수 정의(`$$;`로 끝나는 줄) 바로 다음 줄에 Step 1과 **완전히 동일한 SQL**(주석 첫 줄 `-- 팀 해체·팀원 강퇴 마이그레이션 (2026-09-06)`는 제외하고 두 `create or replace function` 블록만)을 그대로 붙여넣는다. `schema.sql`은 신규 설치 시 한 번에 최신 스키마를 만드는 파일이므로, 이 프로젝트의 기존 관례대로 마이그레이션 내용이 여기에도 반영돼야 한다.

- [ ] **Step 3: 육안 대조**

두 파일의 `disband_team`/`kick_member` 함수가 문자 그대로 동일한지(복사 실수 없는지), 그리고 `leave_team()`과 같은 스타일(`language plpgsql security definer`, `set search_path = public`)을 쓰는지 확인한다. 실행 검증은 이 태스크에서 하지 않는다(Global Constraints 참고 — Task 4에서 사람이 직접 실행).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migration-team-disband-kick.sql supabase/schema.sql
git commit -m "feat: 팀 해체·강퇴 DB 함수 추가"
```

---

### Task 2: 클라이언트 — `team.ts`/`types.ts`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/team.ts`

**Interfaces:**
- Consumes: RPC `disband_team()`, `kick_member(target_user_id)` (Task 1 — 이 태스크에서는 함수가 아직 DB에 배포 안 됐어도 클라이언트 코드 작성/타입체크는 가능하다)
- Produces:
  ```ts
  export interface Team {
    id: string;
    name: string;
    inviteCode: string;
    ownerId: string;
  }
  export async function disbandTeam(): Promise<void>;
  export async function kickMember(userId: string): Promise<void>;
  ```
  `getMyTeam()`의 반환값에 `ownerId`가 채워진다(기존 `getMyTeam(): Promise<Team | null>` 시그니처는 그대로).

- [ ] **Step 1: `Team` 타입에 `ownerId` 추가**

`src/lib/types.ts`의 기존:

```ts
export interface Team {
  id: string;
  name: string;
  inviteCode: string;
}
```

를 아래로 교체:

```ts
export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
}
```

- [ ] **Step 2: `team.ts`에 매핑/함수 추가**

`src/lib/team.ts`의 기존:

```ts
interface TeamRow {
  id: string;
  name: string;
  invite_code: string;
}

function fromTeamRow(r: TeamRow): Team {
  return { id: r.id, name: r.name, inviteCode: r.invite_code };
}
```

를 아래로 교체:

```ts
interface TeamRow {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
}

function fromTeamRow(r: TeamRow): Team {
  return { id: r.id, name: r.name, inviteCode: r.invite_code, ownerId: r.owner_id };
}
```

파일 맨 아래(`moveMyProductsToTeam` 함수 뒤)에 추가:

```ts
/** 팀 해체 (팀장 전용) */
export async function disbandTeam(): Promise<void> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { error } = await supabase.rpc('disband_team');
  if (error) throw new Error(error.message);
}

/** 팀원 강퇴 (팀장 전용) */
export async function kickMember(userId: string): Promise<void> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { error } = await supabase.rpc('kick_member', { target_user_id: userId });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit`
Expected: `src/lib/team.ts`, `src/lib/types.ts` 관련 에러 없음. (`login.tsx:115`의 기존 무관 에러는 그대로 남아있어도 됨.)

`getMyTeam()` 함수 본문(`supabase.from('teams').select('*')`)은 이미 전체 컬럼을 가져오므로 수정할 필요가 없다 — 확인만 한다.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/team.ts src/lib/types.ts
git commit -m "feat: Team에 ownerId 노출, disbandTeam/kickMember 클라이언트 함수 추가"
```

---

### Task 3: UI — `team.tsx`

**Files:**
- Modify: `src/app/team.tsx`

**Interfaces:**
- Consumes: `Team.ownerId` (Task 2), `disbandTeam()`, `kickMember(userId)` (Task 2)
- Produces: 없음 (최종 화면)

- [ ] **Step 1: import에 `disbandTeam`, `kickMember` 추가**

기존:

```tsx
import {
  createTeam,
  getMyTeam,
  joinTeam,
  leaveTeam,
  listMembers,
  moveMyProductsToTeam,
} from '@/lib/team';
```

를 아래로 교체:

```tsx
import {
  createTeam,
  disbandTeam,
  getMyTeam,
  joinTeam,
  kickMember,
  leaveTeam,
  listMembers,
  moveMyProductsToTeam,
} from '@/lib/team';
```

- [ ] **Step 2: `onLeave` 함수 뒤에 `onDisband`, `onKick` 추가**

기존 `onLeave` 함수(파일 내 `const onLeave = () => { ... };` 블록) 바로 다음에 추가:

```tsx
  const onDisband = (team: Team) => {
    Alert.alert(
      '팀 해체',
      `이 팀에는 멤버가 ${members.length}명 있습니다.\n해체하면 모든 멤버가 팀에서 빠지고, 각자 등록한 상품은 개인 상품으로 돌아갑니다. 계속할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '해체하기',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await disbandTeam();
              await load();
            }),
        },
      ],
    );
  };

  const onKick = (member: TeamMember) => {
    Alert.alert(
      '멤버 강퇴',
      `${member.email ?? '이 멤버'}님을 팀에서 내보낼까요?\n이 멤버가 등록한 상품은 개인 상품으로 돌아갑니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '내보내기',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await kickMember(member.userId);
              await load();
            }),
        },
      ],
    );
  };
```

- [ ] **Step 3: 멤버 목록에 강퇴 아이콘 추가**

멤버 목록 렌더 부분의 기존:

```tsx
        <Text className="text-ink mb-2 mt-6 text-sm font-bold">멤버 {members.length}명</Text>
        <View className="rounded-xl border border-line bg-paper">
          {members.map((m, i) => (
            <View
              key={m.userId}
              className={`flex-row items-center px-4 py-3 ${
                i > 0 ? 'border-t border-line' : ''
              }`}
            >
              <MaterialCommunityIcons
                name={m.userId === myId ? 'account-circle' : 'account-circle-outline'}
                size={22}
                color={m.userId === myId ? '#CC2222' : '#888888'}
              />
              <Text className="text-ink ml-2.5 flex-1 text-sm" numberOfLines={1}>
                {m.email ?? '(이메일 없음)'}
              </Text>
              {m.userId === myId ? <Text className="text-muted text-xs">나</Text> : null}
            </View>
          ))}
        </View>
```

를 아래로 교체:

```tsx
        <Text className="text-ink mb-2 mt-6 text-sm font-bold">멤버 {members.length}명</Text>
        <View className="rounded-xl border border-line bg-paper">
          {members.map((m, i) => (
            <View
              key={m.userId}
              className={`flex-row items-center px-4 py-3 ${
                i > 0 ? 'border-t border-line' : ''
              }`}
            >
              <MaterialCommunityIcons
                name={m.userId === myId ? 'account-circle' : 'account-circle-outline'}
                size={22}
                color={m.userId === myId ? '#CC2222' : '#888888'}
              />
              <Text className="text-ink ml-2.5 flex-1 text-sm" numberOfLines={1}>
                {m.email ?? '(이메일 없음)'}
              </Text>
              {m.userId === myId ? <Text className="text-muted text-xs">나</Text> : null}
              {isOwner && m.userId !== myId ? (
                <Pressable
                  onPress={() => onKick(m)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.email ?? '이 멤버'} 강퇴`}
                  className="ml-2 p-1"
                >
                  <MaterialCommunityIcons name="account-remove-outline" size={20} color="#CC2222" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
```

- [ ] **Step 4: 하단 버튼 — 팀장이면 "팀 해체", 아니면 기존 "팀 나가기"**

기존:

```tsx
        <Pressable
          onPress={onLeave}
          disabled={busy}
          className="mt-3 items-center rounded-xl border border-line py-3.5 active:opacity-70"
        >
          <Text className="text-primary text-sm font-medium">팀 나가기</Text>
        </Pressable>
      </ScrollView>
    );
  }
```

를 아래로 교체:

```tsx
        {isOwner ? (
          <Pressable
            onPress={() => onDisband(team)}
            disabled={busy}
            className="mt-3 items-center rounded-xl border border-line py-3.5 active:opacity-70"
          >
            <Text className="text-primary text-sm font-medium">팀 해체</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onLeave}
            disabled={busy}
            className="mt-3 items-center rounded-xl border border-line py-3.5 active:opacity-70"
          >
            <Text className="text-primary text-sm font-medium">팀 나가기</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }
```

- [ ] **Step 5: `isOwner` 계산 삽입**

기존:

```tsx
  if (team) {
    return (
```

를 아래로 교체:

```tsx
  if (team) {
    const isOwner = team.ownerId === myId;
    return (
```

- [ ] **Step 6: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/app/team.tsx
git commit -m "feat: 팀 해체·멤버 강퇴 UI 추가"
```

---

### Task 4: 통합 수동 QA (SQL 실행 포함)

**Files:** 없음 (코드 변경 없음, 문제 발견 시에만 수정 후 별도 커밋)

**Interfaces:**
- Consumes: Task 1~3 전체
- Produces: 없음

- [ ] **Step 1: SQL 마이그레이션 실행**

사람이 직접 Supabase 대시보드 > SQL Editor에서 `supabase/migration-team-disband-kick.sql` 내용을 붙여넣고 실행한다. 에러 없이 "Success" 뜨는지 확인.

- [ ] **Step 2: 팀장/팀원 화면 분기 확인**

계정 A로 팀 생성(팀장) → 계정 B로 초대 코드 참여 → 계정 A 화면 하단에 "팀 해체" 버튼, 계정 B 화면 하단에 "팀 나가기" 버튼만 보이는지 확인. 계정 B에게는 멤버 목록에 강퇴 아이콘이 안 보이는지 확인.

- [ ] **Step 3: 강퇴 확인**

계정 A(팀장)가 멤버 목록에서 계정 B 옆 강퇴 아이콘 탭 → 확인 Alert → "내보내기" → 계정 B가 그 상품을 등록한 상태였다면, 계정 B에서 앱을 다시 열었을 때 팀 화면이 "팀 없음"(만들기/참여) 화면으로 바뀌는지, 그 상품이 계정 B의 개인 상품 목록에 나타나는지 확인.

- [ ] **Step 4: 해체 확인**

다시 계정 A로 새 팀 생성 → 계정 B 재참여 → 계정 A가 "팀 해체" 실행 → 계정 A, B 둘 다 "팀 없음" 화면으로 바뀌는지, 각자 등록했던 상품이 각자 개인 상품으로 돌아가는지 확인.

- [ ] **Step 5: 회귀 확인**

팀장 혼자만 있는 팀에서 "팀 해체"를 실행해도 정상적으로 팀이 사라지는지 확인(기존에 "팀 나가기"로 되던 동작을 "팀 해체"가 대체하는 시나리오).

문제를 발견하면 해당 파일을 수정하고 아래처럼 별도 커밋:

```bash
git add <수정한 파일>
git commit -m "fix: 팀 해체·강퇴 QA 중 발견한 문제 수정"
```
