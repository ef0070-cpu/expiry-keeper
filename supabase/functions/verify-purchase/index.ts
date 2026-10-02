// 구글 플레이 구매 검증 → 유료 권한 기록(entitlements). 앱은 권한을 직접 쓸 수 없고, 여기서 구글 API로
// 영수증을 확인한 것만 기록한다. 구매 토큰은 처음 검증한 계정에만 묶는다(한 결제로 여러 계정 해제 방지).
// 필요한 secret: GOOGLE_SERVICE_ACCOUNT_JSON (플레이 콘솔에 초대한 서비스 계정 키 JSON 전체)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const PACKAGE = 'com.shlab.expirykeeper';
const LIFETIME = 'ad_free_lifetime';
const MONTHLY = 'retail_monthly';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const b64url = (data: ArrayBuffer | string) =>
  btoa(typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

// 서비스 계정 키로 구글 API 접근 토큰 발급(JWT bearer 방식)
async function googleAccessToken(): Promise<string> {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`google token: ${body.error ?? res.status}`);
  return body.access_token;
}

async function play(path: string, token: string) {
  const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null; // 없는 토큰·다른 앱 토큰
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const uid = userData.user.id;

    const { productId, purchaseToken } = await req.json();
    if ((productId !== LIFETIME && productId !== MONTHLY) || typeof purchaseToken !== 'string' || !purchaseToken) {
      return json({ error: 'bad request' }, 400);
    }

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: bound } = await admin.from('purchase_tokens').select('user_id').eq('token', purchaseToken).maybeSingle();
    if (bound && bound.user_id !== uid) return json({ error: '이 구매는 다른 계정에 적용되어 있어요' }, 403);

    const token = await googleAccessToken();
    const { data: current } = await admin.from('entitlements').select('*').eq('user_id', uid).maybeSingle();
    let patch: Record<string, unknown>;

    if (productId === LIFETIME) {
      const p = await play(`purchases/products/${LIFETIME}/tokens/${encodeURIComponent(purchaseToken)}`, token);
      if (!p || p.purchaseState !== 0) return json({ error: '결제가 완료되지 않았어요' }, 402); // 0=구매 완료
      patch = { ad_free: true };
    } else {
      const s = await play(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, token);
      const expiry: string | undefined = s?.lineItems?.[0]?.expiryTime;
      if (!expiry) return json({ error: '구독 정보를 확인하지 못했어요' }, 402);
      // 이벤트 기간이 더 길면 그대로 둔다(구독이 이벤트를 줄이지 않게)
      const keepPromo = current?.retail_until && new Date(current.retail_until) > new Date(expiry);
      patch = keepPromo ? {} : { retail_until: expiry, retail_source: 'subscription' };
    }

    if (!bound) {
      await admin.from('purchase_tokens').insert({ token: purchaseToken, user_id: uid, product_id: productId });
    }
    const { error } = await admin
      .from('entitlements')
      .upsert({ user_id: uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (e) {
    console.error('verify-purchase', e instanceof Error ? e.message : e);
    return json({ error: '구매 확인 중 문제가 생겼어요. 잠시 뒤 [구매 복원]을 눌러 주세요.' }, 500);
  }
});
