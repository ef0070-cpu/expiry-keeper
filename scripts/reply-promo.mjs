// 스레드 댓글 자동 응대. 정해진 문구(템플릿)로만 답하고, 분류되지 않는 댓글은 답하지 않는다.
// 규칙: docs/marketing/BRAND-VOICE.md 4-2장.
//
//   node scripts/reply-promo.mjs          미리보기(어떤 댓글에 무슨 답을 할지 표시, 실제 답글 없음)
//   node scripts/reply-promo.mjs --live   실제 답글
//
// 필요한 토큰 권한: threads_basic, threads_read_replies, threads_manage_replies (.env의 THREADS_*)
// 처리한 댓글 id만 docs/marketing/reply-state.json에 남긴다(작성자 이름·본문은 저장하지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'docs', 'marketing', 'reply-state.json');
const API = 'https://graph.threads.net/v1.0';
const MAX_PER_RUN = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LEN = 300;

const REPLIES = {
  price: '문의해 주셔서 감사합니다. 가격과 이용 조건은 앱 안 안내를 참고해 주세요.',
  request: '의견 남겨 주셔서 감사합니다. 개선에 참고하겠습니다.',
  thanks: '감사합니다. 유통기한 매니저 운영팀이 계속 소식을 올리겠습니다.',
};

// 이 단어가 하나라도 있으면 답하지 않는다(사장님이 직접 본다)
const BLOCK = /https?:\/\/|www\.|\.com|\.kr|카톡|오픈채팅|전화|010[- ]?\d|@\w|환불|고소|신고|소송|법|사기|욕|씨발|병신|개인정보|비밀번호|경쟁|타사|다른 앱|쿠팡/i;
const PRICE = /가격|얼마|무료|유료|구독|결제|비용|요금|월정액|공짜/;
const REQUEST = /기능|추가|있으면|됐으면|했으면|불편|오류|버그|안 ?돼|안돼|개선|건의|요청|문의/;
const THANKS = /감사|고맙|좋아요|좋네|유용|도움|멋지|훌륭|응원/;

/** 댓글 문장 → {kind, reply} 또는 null(답하지 않음). 순수 함수. */
export function classify(text) {
  const t = (text ?? '').trim();
  if (!t || t.length > MAX_LEN || BLOCK.test(t)) return null;
  if (PRICE.test(t)) return { kind: 'price', reply: REPLIES.price };
  if (REQUEST.test(t)) return { kind: 'request', reply: REPLIES.request };
  if (THANKS.test(t)) return { kind: 'thanks', reply: REPLIES.thanks };
  return null;
}

async function call(url, opts, token) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(String(json.error?.message ?? `HTTP ${res.status}`).replaceAll(token, '[token]'));
  return json;
}

async function run() {
  const live = process.argv.includes('--live');
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // .env가 없으면 아래 토큰 검사에서 걸린다
  }
  const user = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!user || !token) return console.log('.env에 THREADS_USER_ID, THREADS_ACCESS_TOKEN이 필요합니다');

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { handled: {} };
  const get = (p, q = {}) => call(`${API}/${p}?${new URLSearchParams({ ...q, access_token: token })}`, undefined, token);
  const me = await get('me', { fields: 'username' });
  const posts = (await get(`${user}/threads`, { fields: 'id,timestamp', limit: '25' })).data ?? [];
  console.log(`== 스레드 댓글 응대 (${live ? '실제 답글' : '미리보기 — 답글 안 함'})`);

  let done = 0;
  for (const post of posts) {
    const replies = (await get(`${post.id}/replies`, { fields: 'id,text,username,timestamp' })).data ?? [];
    for (const r of replies) {
      if (state.handled[r.id] || r.username === me.username) continue;
      if (Date.now() - Date.parse(r.timestamp) > MAX_AGE_MS) continue;
      const hit = classify(r.text);
      if (!hit) {
        state.handled[r.id] = { at: new Date().toISOString(), kind: 'skipped' };
        console.log(`  - ${r.id} 답하지 않음(사장님이 직접 확인): ${(r.text ?? '').slice(0, 40)}`);
        continue;
      }
      if (done >= MAX_PER_RUN) continue;
      console.log(`  → ${r.id} [${hit.kind}] "${(r.text ?? '').slice(0, 40)}" ⇒ "${hit.reply}"`);
      if (live) {
        const c = await call(`${API}/${user}/threads`, { method: 'POST', body: new URLSearchParams({ media_type: 'TEXT', text: hit.reply, reply_to_id: r.id, access_token: token }) }, token);
        await new Promise((x) => setTimeout(x, 4000));
        await call(`${API}/${user}/threads_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: c.id, access_token: token }) }, token);
        state.handled[r.id] = { at: new Date().toISOString(), kind: hit.kind };
      }
      done += 1;
    }
  }
  if (live || Object.keys(state.handled).length) fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(`처리 ${done}건`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((e) => {
    console.log('실패:', e.message);
    process.exitCode = 1;
  });
}
