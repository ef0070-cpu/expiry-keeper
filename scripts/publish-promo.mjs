// 홍보 묶음의 인스타그램·스레드 게시 자동화.
// docs/marketing/<날짜>/publish.json(게시 계획)에서 게시 시각이 된 항목만 올리고, 결과를 같은 폴더
// publish-state.json에 남긴다. 사장님이 계획 파일의 "approved"를 true로 바꾸기 전엔 아무것도 올리지 않는다.
//
//   node scripts/publish-promo.mjs            미리보기(검사 + 지금 올릴 항목 표시, 실제 게시 없음)
//   node scripts/publish-promo.mjs --live     실제 게시 (작업 스케줄러가 30분마다 실행)
//
// 토큰은 .env(커밋 안 됨): IG_USER_ID, IG_ACCESS_TOKEN, THREADS_USER_ID, THREADS_ACCESS_TOKEN
// 사진은 저장소(공개)에 커밋·푸시된 파일을 raw.githubusercontent.com 주소로 Meta에 넘긴다.
// 설정 방법: docs/marketing/AUTO-PUBLISH.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKETING = path.join(ROOT, 'docs', 'marketing');
const RAW_BASE = 'https://raw.githubusercontent.com/ef0070-cpu/expiry-keeper/main/';
const IG_API = 'https://graph.instagram.com/v23.0';
const THREADS_API = 'https://graph.threads.net/v1.0';
// 예정 시각보다 이만큼 넘게 늦었으면(PC가 꺼져 있었음 등) 자동으로 올리지 않는다 — 밤 9시 글이 새벽에 나가지 않게
const MAX_LATE_MS = 3 * 60 * 60 * 1000;

const LIMITS = {
  instagram: { text: 2200, minImages: 1, maxImages: 10, hashtags: 30 },
  threads: { text: 500, minImages: 0, maxImages: 20, hashtags: Infinity },
};

/** 항목 하나의 문제 목록(빈 배열이면 통과). fileExists는 계획 폴더 기준 상대 경로를 받는다. IO 없는 순수 함수. */
export function validateItem(item, fileExists) {
  const errors = [];
  const limit = LIMITS[item.channel];
  if (!limit) return [`채널은 instagram 또는 threads: ${item.channel}`];
  if (!item.id) errors.push('id 없음');
  if (Number.isNaN(Date.parse(item.at ?? ''))) errors.push(`게시 시각(at) 형식 오류: ${item.at}`);
  const text = item.text ?? '';
  if (!text.trim() && !(item.images ?? []).length) errors.push('글도 사진도 없음');
  if (text.length > limit.text) errors.push(`글 ${text.length}자 — ${item.channel}는 ${limit.text}자까지`);
  const tags = (text.match(/#[^\s#]+/g) ?? []).length;
  if (tags > limit.hashtags) errors.push(`해시태그 ${tags}개 — ${limit.hashtags}개까지`);
  if (/\[촬영 필요|\[사진|TODO/.test(text)) errors.push('글에 자리 표시([촬영 필요] 등)가 남아 있음');
  const images = item.images ?? [];
  // 카드 생성기가 스크린샷이 없어 건너뛴 항목(slides는 있는데 images가 빔) — 사진 없이 글만 나가지 않게 막는다
  if (item.slides?.length && !images.length) errors.push('카드 이미지 없음 — slides의 스크린샷을 넣고 make-promo-cards.mjs 실행');
  else if (images.length < limit.minImages) errors.push(`사진 ${limit.minImages}장 이상 필요`);
  if (images.length > limit.maxImages) errors.push(`사진 ${images.length}장 — ${limit.maxImages}장까지`);
  for (const img of images) {
    if (!/\.jpe?g$/i.test(img)) errors.push(`JPEG만 가능: ${img}`);
    else if (!fileExists(img)) errors.push(`사진 파일 없음: ${img}`);
  }
  return errors;
}

/** 지금 올릴 항목: 승인됐고, 아직 안 올렸고, 예정 시각이 지났고, 너무 늦지 않은 것. IO 없는 순수 함수. */
export function dueItems(plan, state, now) {
  if (plan.approved !== true) return [];
  return plan.items.filter((item) => {
    if (state[item.id]?.postedAt) return false;
    const at = Date.parse(item.at);
    return at <= now && now - at <= MAX_LATE_MS;
  });
}

// ---------- Meta API ----------

async function call(url, params, method = 'POST') {
  const u = new URL(url);
  const opts = { method };
  if (method === 'GET') Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  else opts.body = new URLSearchParams(params);
  const res = await fetch(u, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

/** 컨테이너(올릴 준비물)가 처리될 때까지 기다린다 — 바로 게시하면 "아직 준비 안 됨" 오류가 난다 */
async function waitReady(api, id, token, field) {
  for (let i = 0; i < 30; i++) {
    const r = await call(`${api}/${id}`, { fields: field, access_token: token }, 'GET');
    const s = r[field];
    if (s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`컨테이너 처리 실패: ${s}`);
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  throw new Error('컨테이너 처리 대기 시간 초과');
}

async function publishInstagram(item, urls, env) {
  const user = env.IG_USER_ID;
  const token = env.IG_ACCESS_TOKEN;
  let creationId;
  if (urls.length === 1) {
    creationId = (await call(`${IG_API}/${user}/media`, { image_url: urls[0], caption: item.text ?? '', access_token: token })).id;
  } else {
    const children = [];
    for (const image_url of urls) {
      children.push((await call(`${IG_API}/${user}/media`, { image_url, is_carousel_item: 'true', access_token: token })).id);
    }
    for (const c of children) await waitReady(IG_API, c, token, 'status_code');
    creationId = (
      await call(`${IG_API}/${user}/media`, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: item.text ?? '',
        access_token: token,
      })
    ).id;
  }
  await waitReady(IG_API, creationId, token, 'status_code');
  const { id } = await call(`${IG_API}/${user}/media_publish`, { creation_id: creationId, access_token: token });
  const { permalink } = await call(`${IG_API}/${id}`, { fields: 'permalink', access_token: token }, 'GET');
  return { id, permalink };
}

async function publishThreads(item, urls, env) {
  const user = env.THREADS_USER_ID;
  const token = env.THREADS_ACCESS_TOKEN;
  const text = item.text ?? '';
  let creationId;
  if (urls.length <= 1) {
    const params = urls.length
      ? { media_type: 'IMAGE', image_url: urls[0], text, access_token: token }
      : { media_type: 'TEXT', text, access_token: token };
    creationId = (await call(`${THREADS_API}/${user}/threads`, params)).id;
  } else {
    const children = [];
    for (const image_url of urls) {
      children.push((await call(`${THREADS_API}/${user}/threads`, { media_type: 'IMAGE', image_url, is_carousel_item: 'true', access_token: token })).id);
    }
    for (const c of children) await waitReady(THREADS_API, c, token, 'status');
    creationId = (
      await call(`${THREADS_API}/${user}/threads`, { media_type: 'CAROUSEL', children: children.join(','), text, access_token: token })
    ).id;
  }
  await waitReady(THREADS_API, creationId, token, 'status');
  const { id } = await call(`${THREADS_API}/${user}/threads_publish`, { creation_id: creationId, access_token: token });
  const { permalink } = await call(`${THREADS_API}/${id}`, { fields: 'permalink', access_token: token }, 'GET');
  return { id, permalink };
}

// ---------- 실행 ----------

function loadEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // .env가 없으면 아래 토큰 검사에서 걸린다
  }
  return process.env;
}

function pushed(relFromRoot) {
  const posix = relFromRoot.split(path.sep).join('/');
  try {
    // origin/main에 있는 파일이어야 raw.githubusercontent.com에서 열린다(커밋+푸시 확인)
    execFileSync('git', ['cat-file', '-e', `origin/main:${posix}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const live = process.argv.includes('--live');
  const env = loadEnv();
  const now = Date.now();
  try {
    execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // 오프라인이면 마지막으로 받아 둔 origin/main 기준으로 검사
  }
  const folders = fs.readdirSync(MARKETING).filter((d) => fs.existsSync(path.join(MARKETING, d, 'publish.json')));
  let failed = false;

  for (const folder of folders) {
    const dir = path.join(MARKETING, folder);
    const plan = JSON.parse(fs.readFileSync(path.join(dir, 'publish.json'), 'utf8'));
    const statePath = path.join(dir, 'publish-state.json');
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
    const rel = (img) => path.relative(ROOT, path.join(dir, img));
    const exists = (img) => fs.existsSync(path.join(dir, img));

    console.log(`\n== ${folder} (${plan.approved === true ? '승인됨' : '승인 전 — 게시 안 함'})`);
    for (const item of plan.items) {
      const errs = validateItem(item, exists);
      const done = state[item.id]?.postedAt ? ` 게시 완료 ${state[item.id].permalink ?? ''}` : '';
      console.log(`  ${errs.length ? '✗' : '✓'} ${item.id} ${item.channel} ${item.at}${done}`);
      errs.forEach((e) => console.log(`      - ${e}`));
    }

    for (const item of dueItems(plan, state, now)) {
      const errs = validateItem(item, exists);
      const notPushed = (item.images ?? []).filter((img) => exists(img) && !pushed(rel(img)));
      if (notPushed.length) errs.push(`사진이 GitHub에 푸시되지 않음: ${notPushed.join(', ')}`);
      const need = item.channel === 'instagram' ? ['IG_USER_ID', 'IG_ACCESS_TOKEN'] : ['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN'];
      const missing = need.filter((k) => !env[k]);
      if (missing.length) errs.push(`.env에 없음: ${missing.join(', ')}`);
      if (errs.length) {
        failed = true;
        console.log(`  ! ${item.id} 게시 시각이지만 보류:`);
        errs.forEach((e) => console.log(`      - ${e}`));
        continue;
      }
      const urls = (item.images ?? []).map((img) => RAW_BASE + rel(img).split(path.sep).map(encodeURIComponent).join('/'));
      if (!live) {
        console.log(`  → ${item.id} 지금 올릴 차례 (미리보기라 게시 안 함, --live로 실행하면 게시)`);
        continue;
      }
      try {
        const result = await (item.channel === 'instagram' ? publishInstagram : publishThreads)(item, urls, env);
        state[item.id] = { postedAt: new Date().toISOString(), ...result };
        console.log(`  ✓ ${item.id} 게시 완료 ${result.permalink ?? ''}`);
      } catch (e) {
        failed = true;
        state[item.id] = { ...state[item.id], lastError: `${new Date().toISOString()} ${e.message}` };
        console.log(`  ✗ ${item.id} 게시 실패: ${e.message}`);
      }
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
