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
