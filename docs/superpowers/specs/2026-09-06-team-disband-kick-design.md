# 팀 해체·팀원 강퇴 — 설계

## 배경

출시 전 UI/UX 점검에서, 팀장이 팀 자체를 해체(삭제)하거나 특정 멤버를 강퇴하는 기능이 없다는 게 지적됨. DB에는 이미 `teams.owner_id`(팀장 식별)가 있고, `leave_team()`이 "팀장은 다른 멤버가 모두 나간 뒤에야 나갈 수 있다"는 규칙을 갖고 있지만, 그 규칙을 실제로 풀어줄 수단(해체/강퇴)이 없어 팀장이 사실상 막혀 있었음.

사용자 확인 사항(브레인스토밍 과정에서 결정):
- **오너 이전(팀장 권한을 다른 멤버에게 넘기는 기능)은 범위 밖** — 필요해지면 나중에 별도로 브레인스토밍

## 검토한 접근 방식

**A. 기존 패턴대로 Postgres RPC 함수 추가 (채택)** — `disband_team()`, `kick_member(target_user_id)`를 `leave_team()`과 동일한 `security definer` 패턴으로 추가.

**B. RLS 정책만으로 클라이언트 직접 delete (기각)** — `schema.sql`에 이미 "팀 생성/참여/탈퇴는 함수로만 가능 (직접 insert/delete 불가)"라는 명시적 설계 원칙이 있음. RLS로 우회하면 이 기존 아키텍처 원칙과 어긋남.

## 범위

- 신규 SQL: `supabase/migration-team-disband-kick.sql` (기존 `migration-*.sql` 관례 — 사용자가 Supabase SQL Editor에 직접 붙여넣어 실행)
- `supabase/schema.sql`에도 동일 함수를 "4) 팀 관리 함수" 섹션에 추가(프로젝트 관례 — 기존 마이그레이션들도 전부 schema.sql에 최종 반영돼 있음, 신규 설치 시 바로 최신 상태가 되도록)
- `src/lib/types.ts` — `Team` 인터페이스에 `ownerId` 추가
- `src/lib/team.ts` — `disbandTeam()`, `kickMember(userId)` 추가, `getMyTeam()`이 `ownerId`도 매핑하도록 수정
- `src/app/team.tsx` — 멤버 강퇴 UI, 팀장 전용 "팀 해체" 버튼

## DB 함수

```sql
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

두 함수 모두 `teams.owner_id = auth.uid()`로 팀장 여부를 검증한다 — 새 권한 개념을 추가하지 않고 기존 컬럼만 사용한다. 기존 `leave_team()`은 수정하지 않는다(그대로 둠 — 팀장 UI가 아래처럼 "해체"로 대체되므로 자연히 팀장은 이 경로를 쓰지 않게 된다).

## 클라이언트

### `src/lib/types.ts`

```ts
export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  ownerId: string;
}
```

### `src/lib/team.ts`

`TeamRow`/`fromTeamRow`에 `owner_id`/`ownerId` 매핑 추가:

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

새 함수 추가:

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

`getMyTeam()`은 이미 `select('*')`로 `owner_id`를 raw row에서 받고 있으므로, `fromTeamRow` 수정만으로 충분하다(쿼리 자체는 변경 없음). `createTeam`/`joinTeam` RPC의 반환 컬럼은 그대로 둔다 — `team.tsx`의 `onCreate`/`onJoin`이 성공 후 항상 `load()`(=`getMyTeam()` 재조회)를 호출하므로 RPC 반환값에 `ownerId`가 없어도 화면엔 곧바로 최신값이 채워진다.

## UI (`src/app/team.tsx`)

- `isOwner = team.ownerId === myId` 계산
- 멤버 목록에서 `isOwner && m.userId !== myId`인 행에만 강퇴 아이콘(`account-remove-outline`) 추가. 탭하면:
  ```
  Alert.alert(
    '멤버 강퇴',
    `${m.email ?? '이 멤버'}님을 팀에서 내보낼까요?\n이 멤버가 등록한 상품은 개인 상품으로 돌아갑니다.`,
    [
      { text: '취소', style: 'cancel' },
      { text: '내보내기', style: 'destructive', onPress: () => run(async () => { await kickMember(m.userId); await load(); }) },
    ],
  );
  ```
- 하단 액션 버튼: `isOwner`면 기존 "팀 나가기" 자리에 **"팀 해체"**(빨간 destructive)를 대신 렌더링:
  ```
  Alert.alert(
    '팀 해체',
    `이 팀에는 멤버가 ${members.length}명 있습니다.\n해체하면 모든 멤버가 팀에서 빠지고, 각자 등록한 상품은 개인 상품으로 돌아갑니다. 계속할까요?`,
    [
      { text: '취소', style: 'cancel' },
      { text: '해체하기', style: 'destructive', onPress: () => run(async () => { await disbandTeam(); await load(); }) },
    ],
  );
  ```
  `isOwner`가 아니면 기존 `onLeave`/"팀 나가기" 버튼을 그대로 둔다(변경 없음).

## 영향 없음

- `leave_team()`, `createTeam`, `joinTeam` 로직 변경 없음(비팀장 사용자 경로는 100% 기존 그대로)
- 다른 기능(발주, 유통기한 알림, CSV 가져오기 등)과 파일 겹침 없음
- 오너 이전 기능은 범위 밖(사용자 확인)

## 테스트

이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱. SQL 함수와 RLS는 `*.selfcheck.ts` 대상이 아니므로(순수 로직이 아니라 DB I/O), `npx tsc --noEmit` + 수동 시나리오로 검증한다.

수동 QA 체크리스트:
1. Supabase SQL Editor에서 `migration-team-disband-kick.sql` 실행 → 에러 없이 함수 생성 확인
2. 팀장 계정으로 팀 생성 → 다른 계정으로 참여 → 팀장 화면에서 "팀 해체" 버튼이 보이고, 참여 계정 화면에는 "팀 나가기"만 보이는지 확인
3. 팀장이 멤버 목록에서 본인 아닌 멤버 옆 강퇴 아이콘으로 강퇴 → 강퇴된 계정이 팀 화면을 다시 열면 "팀 없음"(만들기/참여) 화면으로 바뀌는지, 그 계정이 등록했던 팀 상품이 그 계정의 개인 상품 목록에 나타나는지 확인
4. 팀장이 "팀 해체" 실행(멤버가 남아있는 상태로) → 모든 계정이 "팀 없음" 화면으로 바뀌는지, 각자 등록한 상품이 개인 상품으로 돌아가는지 확인
5. 비팀장 계정에는 강퇴 아이콘이 안 보이는지 확인(RLS/UI 양쪽 방어 — RPC도 `is_owner` 체크로 막지만 UI에서 애초에 안 보여야 함)
6. (참고, 회귀 확인용) 팀장이 유일한 멤버일 때 기존 "팀 나가기"로도 팀이 삭제됐었는데, 이제는 "팀 해체" 버튼 하나로 동일한 결과가 나오는지 확인
