import { supabase } from './supabase';
import { Team, TeamMember } from './types';

/**
 * 팀(매장) 관리 — 클라우드 모드 전용.
 * 팀 생성/참여/탈퇴는 Supabase의 서버 함수(rpc)로 처리한다 (schema.sql 참조).
 */

interface TeamRow {
  id: string;
  name: string;
  invite_code: string;
}

function fromTeamRow(r: TeamRow): Team {
  return { id: r.id, name: r.name, inviteCode: r.invite_code };
}

/** 내가 속한 팀. 없으면 null */
export async function getMyTeam(): Promise<Team | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('teams').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromTeamRow(data as TeamRow) : null;
}

/** 우리 팀 멤버 목록 */
export async function listMembers(): Promise<TeamMember[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('team_members')
    .select('user_id, email, joined_at')
    .order('joined_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { user_id: string; email: string | null; joined_at: string }[]).map((r) => ({
    userId: r.user_id,
    email: r.email,
    joinedAt: r.joined_at,
  }));
}

/** 팀 만들기 — 초대 코드가 담긴 팀 정보를 돌려준다 */
export async function createTeam(name: string): Promise<Team> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { data, error } = await supabase.rpc('create_team', { team_name: name });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as TeamRow;
  return fromTeamRow(row);
}

/** 초대 코드로 팀 참여 */
export async function joinTeam(code: string): Promise<Team> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { data, error } = await supabase.rpc('join_team_by_code', { code });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as TeamRow;
  return fromTeamRow(row);
}

/** 팀 나가기 */
export async function leaveTeam(): Promise<void> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { error } = await supabase.rpc('leave_team');
  if (error) throw new Error(error.message);
}

/** 내 개인 상품을 전부 팀 상품으로 전환. 옮긴 개수를 돌려준다 */
export async function moveMyProductsToTeam(teamId: string): Promise<number> {
  if (!supabase) throw new Error('클라우드 모드가 아닙니다');
  const { data, error } = await supabase
    .from('products')
    .update({ team_id: teamId })
    .is('team_id', null)
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
