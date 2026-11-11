// 사진 시트 목업 HTML 생성기 (스크래치 전용). node gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const mi = (hex, size, color = 'inherit', extra = '') => `<span class="mi" style="font-size:${size}px;color:${color};${extra}">&#x${hex};</span>`;
const I = { close: 'f0156', camera: 'f0100', check: 'f012c', restore: 'f099b', image: 'f0976', wifi: 'f0928', sig: 'f08be', bat: 'f0081' };

const CSS = `
@font-face { font-family: 'MDI'; src: url(MaterialCommunityIcons.ttf); }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1350px; overflow: hidden; }
body { position: relative; font-family: 'Pretendard', sans-serif; color: #1A1A1A; word-break: keep-all; letter-spacing: -0.03em; background: linear-gradient(180deg, #EDEFF2, #F7F7F7); -webkit-font-smoothing: antialiased; }
.mi { font-family: 'MDI' !important; font-weight: 400; font-style: normal; line-height: 1; display: inline-block; letter-spacing: 0; }
.h1 { position: absolute; left: 72px; right: 72px; top: 52px; font-size: 54px; font-weight: 800; letter-spacing: -0.05em; white-space: nowrap; }
.h2 { position: absolute; left: 72px; right: 72px; top: 124px; font-size: 28px; font-weight: 500; color: #555; white-space: nowrap; }
.tag { display: inline-block; vertical-align: middle; margin-left: 14px; padding: 4px 16px; border-radius: 999px; background: #1A1A1A; color: #fff; font-size: 24px; font-weight: 700; }
.foot { position: absolute; left: 0; right: 0; bottom: 22px; text-align: center; font-size: 22px; color: #666; font-weight: 500; }
.plabel { position: absolute; text-align: center; font-size: 30px; font-weight: 800; }
.plabel.bad { color: #CC2222; } .plabel.good { color: #1B7F3B; }
.phone { position: absolute; padding: 16px; border-radius: 56px; background: #16181B; box-shadow: 0 30px 60px rgba(20,30,50,.28), inset 0 0 0 2px #3A3F45; }
.vp { position: relative; border-radius: 42px; overflow: hidden; background: #F7F7F7; }
.app { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; background: #F7F7F7;
  font-family: 'Gamja Flower', 'Pretendard', sans-serif; font-weight: 400; letter-spacing: 0; color: #1A1A1A; line-height: 1.3; }
.app * { font-family: inherit; }
.app .mi { font-family: 'MDI' !important; }
.sbar { height: 28px; background: #FFF; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; font-size: 14px; position: relative; }
.sbar .cam { position: absolute; left: 50%; top: 8px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #16181B; }
.sbar .ic { display: flex; gap: 4px; }
.hdr { height: 56px; background: #FFF; display: flex; align-items: center; padding: 0 16px; gap: 20px; font-size: 25px; font-weight: 700; }
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,.55); z-index: 5; }
.sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 6; background: #FFF; border-radius: 24px 24px 0 0; padding: 10px 18px 30px; }
.handle { width: 44px; height: 5px; border-radius: 3px; background: #DDD; margin: 0 auto 10px; }
.xbtn { position: absolute; right: 14px; top: 14px; z-index: 2; }
.ttl { font-size: 22px; line-height: 26px; font-weight: 900; text-align: center; color: #1A1A1A; }
.dsc { text-align: center; color: #333; font-size: 13.5px; line-height: 20px; margin-top: 6px; }
.cam { position: relative; margin-top: 14px; width: 100%; border-radius: 18px; overflow: hidden; background: #2A2F33; }
.cam.shot { background: #3C4349; }
.cam .gv { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.35); }
.cam .gh { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,.35); }
.cam .guide { position: absolute; top: 13%; left: 0; right: 0; text-align: center; color: #FFF; font-size: 15px; font-weight: bold; text-shadow: 0 0 4px rgba(0,0,0,.6); }
.cam .cn { position: absolute; width: 34px; height: 34px; border: 0 solid #FFF; }
.cam .shutter0 { position: absolute; left: 50%; top: 50%; margin: -42px 0 0 -42px; width: 84px; height: 84px; border-radius: 42px; background: rgba(0,0,0,.45); border: 3px solid rgba(255,255,255,.9); display: flex; flex-direction: column; align-items: center; justify-content: center; color: #FFF; font-size: 12px; font-weight: bold; }
/* 일반 아이스크림 바 실루엣(단색, 상표·글자 없음) */
.bar { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -52%); width: 1em; height: 1em; }
.bar .body { position: absolute; left: .39em; top: .17em; width: .22em; height: .38em; border-radius: .11em .11em .035em .035em; background: #E7B7A4; box-shadow: inset .035em 0 0 rgba(255,255,255,.28), inset -.03em 0 0 rgba(0,0,0,.12); }
.bar .stick { position: absolute; left: .4725em; top: .55em; width: .055em; height: .16em; border-radius: 0 0 .03em .03em; background: #C9A66B; }
.bar .bite { position: absolute; left: .575em; top: .2em; width: .07em; height: .07em; border-radius: 50%; background: #2A2F33; }
.cam.shot .bar .bite { background: #3C4349; }
.btn { height: 56px; border-radius: 18px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 18px; font-weight: 800; }
.btn.red { background: #B81F26; color: #FFF; }
.btn.line { border: 1.5px solid #222; color: #111; }
.chk { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; }
.chk .bx { width: 26px; height: 26px; border-radius: 6px; background: #1A1A1A; display: flex; align-items: center; justify-content: center; flex: none; }
.chk .tx { flex: 1; font-size: 13.5px; line-height: 19px; color: #222; }
.navbar { position: absolute; left: 0; right: 0; bottom: 0; height: 24px; display: flex; align-items: center; justify-content: center; z-index: 40; }
.navbar i { width: 108px; height: 4px; border-radius: 2px; background: #1A1A1A; }
/* 번호 표시·짚기 */
.ring { position: absolute; border: 4px solid #FF002B; border-radius: 22px; box-shadow: 0 0 0 3px #FFF, 0 0 0 7px rgba(255,0,43,.25); z-index: 30; pointer-events: none; }
.ring.round { border-radius: 999px; }
.nb { position: absolute; z-index: 31; width: 48px; height: 48px; border-radius: 50%; background: #FF002B; color: #FFF; font-family: 'Pretendard', sans-serif !important; font-size: 30px; font-weight: 800; line-height: 48px; text-align: center; box-shadow: 0 0 0 4px #FFF, 0 4px 10px rgba(0,0,0,.35); letter-spacing: 0; }
.nb.s { width: 40px; height: 40px; line-height: 40px; font-size: 25px; }
.legend { position: absolute; left: 72px; right: 72px; }
.lg { display: flex; align-items: center; gap: 18px; height: 60px; font-size: 29px; font-weight: 700; letter-spacing: -0.04em; white-space: nowrap; }
.lg .nb { position: static; flex: none; }
.lg.bad .nb { background: #FF002B; } .lg.good .nb { background: #1B7F3B; }
.lg b { font-weight: 800; color: #CC2222; } .lg.good b { color: #1B7F3B; }
`;

function appBase({ w, ah, k, inner }) {
  return `<div class="vp" style="width:${w * k}px;height:${ah * k}px"><div class="app" style="width:${w}px;height:${ah}px;transform:scale(${k})">
<div class="sbar"><span>9:41</span><i class="cam"></i><span class="ic">${mi(I.sig, 14)}${mi(I.wifi, 14)}${mi(I.bat, 14)}</span></div>
<div class="hdr">${mi('f0141', 24)}<span>상품 등록</span></div>
<div class="scrim"></div>${inner}<div class="navbar"><i></i></div></div></div>`;
}

function camera({ w, h, shot, shutter }) {
  const fs = h; // em 기준
  const grid = shot ? '' : [1, 2].map((i) => `<div class="gv" style="left:${(i * 100) / 3}%"></div><div class="gh" style="top:${(i * 100) / 3}%"></div>`).join('')
    + `<div class="guide">여기에 상품을 맞춰주세요</div>`
    + (shutter ? `<div class="shutter0">${mi(I.camera, 28, '#FFF')}<span>셔터</span></div>` : '');
  const corner = (pos, b) => `<div class="cn" style="${pos};${b}"></div>`;
  return `<div class="cam ${shot ? 'shot' : ''}" style="height:${h}px">
<div class="bar" style="font-size:${fs}px"><div class="body"></div><div class="stick"></div><div class="bite"></div></div>${grid}
${corner('left:16px;top:16px', 'border-left-width:3px;border-top-width:3px;border-top-left-radius:10px')}
${corner('right:16px;top:16px', 'border-right-width:3px;border-top-width:3px;border-top-right-radius:10px')}
${corner('left:16px;bottom:16px', 'border-left-width:3px;border-bottom-width:3px;border-bottom-left-radius:10px')}
${corner('right:16px;bottom:16px', 'border-right-width:3px;border-bottom-width:3px;border-bottom-right-radius:10px')}</div>`;
}

const head = `<div class="handle"></div><div class="xbtn">${mi(I.close, 28, '#222')}</div>
<div class="ttl">📷 상품 사진 직접 등록</div>
<div class="dsc">바코드를 찍었으나 아직 등록된 이미지가 없어요.<br>이름과 바코드에 맞는 상품 사진을 직접 찍어 등록해 주세요!</div>`;
const check = `<div class="chk"><div class="bx">${mi(I.check, 18, '#FFF')}</div><div class="tx">내가 촬영한 사진을 다른 사장님들과 함께 공유하고 서비스에 사용하는 데 동의합니다</div></div>`;

/** 현재(소스 그대로) 시트. 반환: 시트 HTML */
function sheetCur({ w, shot, extra = '' }) {
  const h = (w - 36) / 1.08;
  return `<div class="sheet">${head}${camera({ w, h, shot, shutter: !shot })}
<div class="btn red" style="margin-top:12px">${mi(shot ? I.check : I.camera, 22, '#FFF')}<span>${shot ? '이 사진으로 등록' : '사진 촬영하기'}</span></div>
<div class="btn line" style="margin-top:10px">${mi(shot ? I.restore : I.image, 22, '#111')}<span>${shot ? '다시 찍기' : '갤러리에서 선택'}</span></div>
${check}${extra}</div>`;
}
/** 개선안 A 시트 */
function sheetA({ w, ah, shot, extra = '' }) {
  const h = Math.min((w - 36) / 1.08, 0.4 * ah);
  const row = shot
    ? `<div style="display:flex;gap:10px;margin-top:14px"><div class="btn line" style="flex:1">${mi(I.restore, 22, '#111')}<span>다시 찍기</span></div><div class="btn red" style="flex:1.6">${mi(I.check, 22, '#FFF')}<span>저장하기</span></div></div>`
    : `<div id="srow" style="position:relative;height:72px;margin-top:14px;display:flex;justify-content:center;align-items:center">
<div class="btn line" style="position:absolute;left:0;top:8px;width:56px;gap:0">${mi(I.image, 28, '#111')}</div>
<div style="width:72px;height:72px;border-radius:36px;background:#B81F26;border:4px solid #FFF;box-shadow:0 0 0 3px #B81F26;display:flex;align-items:center;justify-content:center">${mi(I.camera, 30, '#FFF')}</div></div>`;
  return `<div class="sheet">${head}${camera({ w, h, shot, shutter: false })}${row}${check}${extra}</div>`;
}

function phone({ left, top, w, ah, k, inner }) {
  return `<div class="phone" style="left:${left}px;top:${top}px;width:${w * k + 32}px;height:${ah * k + 32}px">${appBase({ w, ah, k, inner })}</div>`;
}
const page = (title, sub, tag, body, foot) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link href="https://fonts.googleapis.com/css2?family=Gamja+Flower&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="h1">${title}</div><div class="h2">${sub}<span class="tag">${tag}</span></div>${body}
<div class="foot">${foot}</div></body></html>`;

const FOOT = '기기 화면이 아니라 앱 소스(PhotoCaptureSheet.tsx) 기준 재현이며 일부 값은 추정입니다';
const FOOT3 = '계산 기반 추정입니다. 기기 재현이 아니라 앱 소스 기준 계산(673 x 841dp 가정)이며 실제와 다를 수 있습니다';

// ---- 1, 2: 일반 폰(392 x 760dp, k=1) ----
const W = 392, AH = 760, K = 1, PT = 205;
const L1 = 88, L2 = 88 + 424 + 56;
const nb = (n, x, y, cls = '') => `<div class="nb ${cls}" style="left:${x}px;top:${y}px">${n}</div>`;
// 시트 안 요소 위치: 시트 하단 기준으로 계산하지 않고 브라우저에서 측정하기 어려우므로 시트 내부에 절대 위치 표식을 둔다
const inSheet = (html) => html; // 표식은 .sheet 안(position:absolute) 기준

function cur(shot) {
  const marks = shot
    ? `<div class="ring" style="left:12px;top:0;right:12px;height:0;display:none"></div>`
    : '';
  return phone({ left: shot ? L2 : L1, top: PT, w: W, ah: AH, k: K, inner: sheetCur({ w: W, shot, extra: marks }) });
}

// 표식(링·번호)은 시트 좌표(왼쪽 위 기준)로 직접 지정 — 아래 값은 렌더 후 확인하며 맞춘다
const P = JSON.parse(fs.readFileSync(path.join(dir, 'pos.json'), 'utf8'));

function withMarks(shot, variant) {
  const m = P[variant][shot ? 'shot' : 'pre'];
  const extra = m.map((o) => (o.type === 'ring' ? `<div class="ring ${o.round ? 'round' : ''}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px"></div>` : `<div class="nb" style="left:${o.x}px;top:${o.y}px">${o.n}</div>`)).join('');
  return variant === 'cur' ? sheetCur({ w: W, shot, extra }) : sheetA({ w: W, ah: AH, shot, extra });
}
const ph = (shot, variant) => phone({ left: shot ? L2 : L1, top: PT, w: W, ah: AH, k: K, inner: withMarks(shot, variant) });
const lab = (shot, t, cls) => `<div class="plabel ${cls}" style="left:${shot ? L2 : L1}px;width:424px;top:${PT + 832 + 4}px;display:none">${t}</div>`;

const legend1 = `<div class="legend" style="top:${PT + 792 + 30}px">
<div class="lg bad"><div class="nb">1</div><span>셔터가 카메라 <b>정중앙</b>에 있어 상품을 가림</span></div>
<div class="lg bad"><div class="nb">2</div><span>저장 버튼 문구가 <b>‘이 사진으로 등록’</b>, 시트 아래쪽</span></div>
<div class="lg bad"><div class="nb">3</div><span>버튼이 <b>두 줄로 쌓여</b> 시트가 길다</span></div></div>`;
const legend2 = `<div class="legend" style="top:${PT + 792 + 22}px">
<div class="lg good"><div class="nb">1</div><span>가운데 큰 셔터를 없애 <b>상품이 안 가려짐</b></span></div>
<div class="lg good"><div class="nb">2</div><span>큰 빨간 셔터 + 갤러리를 <b>한 줄로</b> 합쳐 시트가 짧아짐</span></div>
<div class="lg good"><div class="nb">3</div><span>촬영 후 <b>[다시 찍기] [저장하기]</b> 한 줄, 문구는 ‘저장하기’</span></div>
<div class="lg good"><div class="nb">4</div><span>카메라 높이를 <b>폭 비율·화면 40% 중 작은 쪽</b>으로 제한</span></div></div>`;

fs.writeFileSync(path.join(dir, 'design/1.html'), page('현재 모습 — 사진 등록 시트', '바코드를 조회했는데 상품 사진이 없을 때 뜨는 팝업', '현재 · 문제 확인',
  ph(false, 'cur') + ph(true, 'cur') + legend1, FOOT));
fs.writeFileSync(path.join(dir, 'design/2.html'), page('개선안 A — 사진 등록 시트', '셔터를 카메라 아래로, 버튼은 한 줄로', '개선안 A',
  ph(false, 'A') + ph(true, 'A') + legend2, FOOT));

// ---- 3: 큰 화면(673 x 841dp) ----
const BW = 673, BAH = 841, BK = 0.651, FW = BW * BK + 32;
const B1 = 40, B2 = 1080 - 40 - FW, BT = 350;
const bigMarks = (v) => P.big[v].map((o) => (o.type === 'ring' ? `<div class="ring" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;border-width:6px"></div>` : '')).join('');
const bigCur = phone({ left: B1, top: BT, w: BW, ah: BAH, k: BK, inner: sheetCur({ w: BW, shot: false, extra: bigMarks('cur') }) });
const bigA = phone({ left: B2, top: BT, w: BW, ah: BAH, k: BK, inner: sheetA({ w: BW, ah: BAH, shot: false, extra: bigMarks('A') }) });
const bh = BAH * BK + 32;
const bigLab = (l, t, cls) => `<div class="plabel ${cls}" style="left:${l}px;width:${FW}px;top:${BT - 56}px">${t}</div>`;
const legend3 = `<div class="legend" style="top:${BT + bh + 40}px">
<div class="lg bad" style="height:auto;white-space:normal;align-items:flex-start;margin-bottom:22px"><div class="nb">1</div><span><b>현재</b> — 시트가 화면보다 약 55dp 길어 위쪽(손잡이·✕·제목)이 잘림. 닫기 ✕가 안 보임 <b>(계산 추정)</b></span></div>
<div class="lg good" style="height:auto;white-space:normal;align-items:flex-start"><div class="nb">2</div><span><b>개선안 A</b> — 카메라를 화면 높이 40%로 제한해 시트 전체(✕·제목·셔터)가 한 화면에 들어옴 <b>(계산 추정)</b></span></div></div>`;
fs.writeFileSync(path.join(dir, 'design/3.html'), page('큰 화면(폴드 펼침)에서 비교', '약 673 x 841dp 가정 · 폰 비율은 실제 비율', '계산 기반 추정',
  bigLab(B1, '현재 (계산 추정)', 'bad') + bigLab(B2, '개선안 A (계산 추정)', 'good') + bigCur + bigA + legend3, FOOT3));

fs.writeFileSync(path.join(dir, 'publish.json'), JSON.stringify({ items: ['1', '2', '3'].map((id) => ({ id: 'm' + id, slides: [{ text: 'mock ' + id, html: `design/${id}.html` }] })) }, null, 2));
console.log('ok');
