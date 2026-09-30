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

    // 사진 정리 — 계정을 지우기 전에(누가 올렸는지 알 수 있을 때) 한다. 다른 사람이 쓰는 사진은
    // 남기고 소유자 정보만 지우며, 개인 사진만 파일째 삭제(migration-account-photo-cleanup.sql).
    // 실패해도 탈퇴는 막지 않는다(탈퇴 요청이 우선) — 남은 개수를 응답에 담아 추적할 수 있게 한다.
    let photosDeleted = 0;
    let photosFailed = 0;
    const { data: photos, error: photoError } = await adminClient.rpc('account_photo_cleanup', {
      p_uid: uid,
      p_apply: true,
    });
    if (photoError) {
      console.error('account_photo_cleanup failed', photoError.message);
    } else {
      const byBucket = new Map<string, string[]>();
      for (const p of (photos ?? []) as { bucket_id: string; name: string; in_use: boolean }[]) {
        if (p.in_use) continue;
        byBucket.set(p.bucket_id, [...(byBucket.get(p.bucket_id) ?? []), p.name]);
      }
      for (const [bucket, names] of byBucket) {
        for (let i = 0; i < names.length; i += 100) {
          const chunk = names.slice(i, i + 100);
          const { error } = await adminClient.storage.from(bucket).remove(chunk);
          if (error) {
            photosFailed += chunk.length;
            console.error('photo remove failed', bucket, error.message);
          } else {
            photosDeleted += chunk.length;
          }
        }
      }
    }

    // auth.users 삭제 시 products/team_members는 FK cascade로 함께 삭제됨(schema.sql 참고).
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({ success: true, photosDeleted, photosFailed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
