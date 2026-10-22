// .bak(JSX 소스)를 Babel로 컴파일해 src/lib/price-tag-maker-html.ts를 재생성한다.
// price-tag-maker-html.ts 파일 상단 주석에 적힌 빌드 방법을 실행 가능한 스크립트로 옮긴 것.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const srcPath = path.join(__dirname, '..', 'assets', 'html', 'price-tag-maker.html.bak');
const outPath = path.join(__dirname, '..', 'src', 'lib', 'price-tag-maker-html.ts');

let html = fs.readFileSync(srcPath, 'utf8');

// Babel standalone(런타임 JSX 파싱용 CDN 스크립트)은 컴파일된 결과물에는 필요 없다.
html = html.replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\n/, '\n');

// 첫 실행 로딩 단축: 열 때마다 CDN에서 받던 스크립트를 빌드 시점에 HTML 안으로 넣는다.
// (예전엔 Tailwind Play CDN이 받은 뒤 폰에서 CSS를 실시간 생성해 가장 느렸다.)
const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error(`치환 대상을 찾지 못했습니다: ${from}`);
  html = html.replace(from, () => to);
};
const inlineScript = (code) => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
const vendor = (name) => fs.readFileSync(path.join(__dirname, '..', 'assets', 'html', 'vendor', name), 'utf8');

// React 18.3.1 UMD(assets/html/vendor/, jsdelivr에서 받은 원본 그대로)
replaceOnce(
  '<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>',
  inlineScript(vendor('react.production.min.js'))
);
replaceOnce(
  '<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>',
  inlineScript(vendor('react-dom.production.min.js'))
);

// html2canvas는 앱 밖 브라우저 폴백에서만 쓴다(앱은 react-native-view-shot으로 캡처) — 앱에선 안 받는다.
replaceOnce(
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>',
  `<script>if (!window.ReactNativeWebView) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; document.head.appendChild(s); }</script>`
);

const scriptTagRe = /<script type="text\/babel">([\s\S]*)<\/script>/;
const match = html.match(scriptTagRe);
if (!match) throw new Error('text/babel 스크립트 블록을 찾지 못했습니다.');

const { code } = babel.transform(match[1], {
  presets: ['@babel/preset-react'],
  plugins: ['@babel/plugin-transform-object-rest-spread'],
  babelrc: false,
  configFile: false,
});

html = html.replace(scriptTagRe, () => `<script>${code}</script>`);

// Tailwind: Play CDN 대신 설치된 tailwindcss로 미리 만든 CSS(소스에 쓰인 클래스만)를 넣는다.
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
postcss([tailwindcss({ content: [{ raw: fs.readFileSync(srcPath, 'utf8'), extension: 'html' }] })])
  .process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined })
  .then(({ css }) => {
    replaceOnce('<script src="https://cdn.tailwindcss.com"></script>', `<style>${css}</style>`);

    const ts =
      '// 이 파일은 assets/html/price-tag-maker.html.bak(JSX 소스)에서 빌드 스크립트로 생성됨 —\n' +
      '// 직접 수정하지 말 것. 수정하려면 .bak 파일을 고치고 빌드 스크립트를 다시 실행할 것.\n' +
      `export const PRICE_TAG_MAKER_HTML = ${JSON.stringify(html)};\n`;

    fs.writeFileSync(outPath, ts);
    console.log('생성 완료:', outPath, `(${ts.length} bytes)`);
  });
