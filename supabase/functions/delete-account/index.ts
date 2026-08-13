import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const uid = userData.user.id;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 다른 멤버가 있는 팀의 팀장은 삭제 불가 — leave_team() RPC와 동일한 정책.
    const { data: ownedTeam } = await adminClient
      .from('teams')
      .select('id')
      .eq('owner_id', uid)
      .maybeSingle();

    if (ownedTeam) {
      const { count } = await adminClient
        .from('team_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('team_id', ownedTeam.id);
      if ((count ?? 0) > 1) {
        return json(
          {
            error:
              '다른 멤버가 있는 팀의 팀장은 계정을 삭제할 수 없습니다. 먼저 팀을 나가거나 멤버를 내보내주세요.',
          },
          400,
        );
      }
    }

    // auth.users 삭제 시 products/team_members는 FK cascade로 함께 삭제됨(schema.sql 참고).
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
