// 홍보 게시물 카드 이미지(1080×1350 JPEG) 자동 생성.
// docs/marketing/<날짜>/publish.json 각 항목의 slides를 장마다 카드로 그려 images/<id>-<번호>.jpg로 저장하고,
// 그 항목의 images 목록을 생성한 파일로 맞춘다. 설치된 Chrome을 화면 없이 띄워(개발자 프로토콜) 찍는다 — 추가 패키지 없음.
//
//   node scripts/make-promo-cards.mjs docs/marketing/2026-10-21
//
// slide 형식: { "text": "카드 문구(줄바꿈은 \n)", "image": "스크린샷 경로(계획 폴더 기준, 선택)", "html": "카드 HTML(선택)" }
//   html 있음 → ek-design이 디자인한 1080×1350 HTML을 그대로 찍는다(권장)
//   html 없음 → 기본 틀: image 없으면 글자 카드, 있으면 위 문구 + 아래 스크린샷(임시용)
// 스크린샷 파일이 아직 없는 장이 있으면 그 항목은 만들지 않고 알려 준다(빈 장으로 게시되는 것 방지).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const W = 1080;
const H = 1350;
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const lines = (s) => esc(s).split('\n').join('<br>');

// 가장 긴 줄이 한 줄에 들어가게 글자 크기를 줄인다(한글 한 글자 폭 ≈ 글자 크기, 내용 폭 920px)
const fitSize = (text, max) => Math.max(40, Math.min(max, Math.floor(920 / Math.max(...text.split('\n').map((l) => l.length)))));

function cardHtml(slide, imageDataUrl, pageNo, total) {
  const body = imageDataUrl
    ? `<div class="cap" style="font-size:${fitSize(slide.text, 54)}px">${lines(slide.text)}</div><div class="shot"><img src="${imageDataUrl}"></div>`
    : `<div class="big" style="font-size:${fitSize(slide.text, 76)}px">${lines(slide.text)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;800&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; word-break: keep-all;
         background: ${imageDataUrl ? '#F4F1EA' : '#2E4A62'}; color: ${imageDataUrl ? '#1A1A1A' : '#FFFFFF'};
         display: grid; grid-template-rows: auto 1fr auto; padding: 90px 80px 70px; }
  .big { grid-row: 1 / 3; display: flex; align-items: center; font-weight: 800; line-height: 1.35; }
  .cap { font-weight: 800; line-height: 1.35; margin-bottom: 50px; }
  /* 세로로 긴 스크린샷(581×1426)이 카드보다 커서 칸 크기가 안 정해지면 문구·하단이 밀려났다 — 칸 안에 절대 위치로 맞춤 */
  .shot { position: relative; min-height: 0; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 18px 30px rgba(0,0,0,.18)); }
  .foot { display: flex; justify-content: space-between; font-size: 30px; font-weight: 500; opacity: .7; margin-top: 40px; }
</style></head><body>${body}<div class="foot"><span>유통기한 매니저</span><span>${pageNo} / ${total}</span></div></body></html>`;
}

/** 화면 없는 Chrome을 띄우고 개발자 프로토콜 페이지 하나에 연결한다 */
async function openChrome() {
  const exe = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome 또는 Edge를 찾지 못했습니다.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-cards-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank']);
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('Chrome이 바로 종료됐습니다.')));
  });
  const port = new URL(wsUrl).port;
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  // Chrome이 완전히 끝난 뒤 임시 프로필을 지운다(바로 지우면 파일이 잠겨 EPERM). 못 지워도 결과엔 영향 없음
  const close = async () => {
    ws.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // 임시 폴더라 OS가 나중에 정리한다
    }
  };
  return { send, close };
}

/** html: 기본 틀로 만든 문자열, fileUrl: ek-design이 만든 카드 HTML 파일(상대 경로 이미지가 열리게 파일 주소로 연다) */
async function render(page, { html, fileUrl }) {
  if (fileUrl) {
    await page.send('Page.navigate', { url: fileUrl });
    await page.send('Runtime.evaluate', {
      expression: `new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true }))`,
      awaitPromise: true,
    });
  } else {
    const { frameId } = await page.send('Page.navigate', { url: 'about:blank' });
    await page.send('Page.setDocumentContent', { frameId, html });
  }
  // 웹 폰트·이미지가 다 그려진 뒤 찍는다. fonts.ready만 기다리면 폰트를 받기 전에 끝나 글자가 빈 채로 찍혔다
  // (display=block이라 받는 동안 글자를 숨김) — 쓰는 굵기를 직접 불러온다
  await page.send('Runtime.evaluate', {
    expression: `Promise.all([
      document.fonts.load('800 54px "Noto Sans KR"', document.body.innerText),
      document.fonts.load('500 30px "Noto Sans KR"', document.body.innerText),
      ...[...document.images].map(i => i.decode().catch(() => {})),
    ]).then(() => document.fonts.ready)`,
    awaitPromise: true,
  });
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 90,
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

async function main() {
  const dir = path.resolve(process.argv[2] ?? '');
  const planPath = path.join(dir, 'publish.json');
  if (!fs.existsSync(planPath)) throw new Error(`publish.json이 없습니다: ${planPath}`);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const page = await openChrome();
  try {
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    for (const item of plan.items) {
      if (!item.slides?.length) continue;
      const missing = item.slides
        .flatMap((s) => [s.image, s.html])
        .filter((f) => f && !fs.existsSync(path.join(dir, f)));
      if (missing.length) {
        console.log(`✗ ${item.id} 건너뜀 — 스크린샷 없음: ${missing.join(', ')}`);
        item.images = [];
        continue;
      }
      const out = [];
      for (const [i, slide] of item.slides.entries()) {
        const file = `images/${item.id}-${i + 1}.jpg`;
        if (slide.html) {
          fs.writeFileSync(path.join(dir, file), await render(page, { fileUrl: pathToFileURL(path.join(dir, slide.html)).href }));
          out.push(file);
          continue;
        }
        const img = slide.image
          ? `data:image/${path.extname(slide.image).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(path.join(dir, slide.image)).toString('base64')}`
          : null;
        fs.writeFileSync(path.join(dir, file), await render(page, { html: cardHtml(slide, img, i + 1, item.slides.length) }));
        out.push(file);
      }
      item.images = out;
      console.log(`✓ ${item.id} ${out.length}장`);
    }
  } finally {
    await page.close();
  }
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exitCode = 1;
});
