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

const scriptTagRe = /<script type="text\/babel">([\s\S]*)<\/script>/;
const match = html.match(scriptTagRe);
if (!match) throw new Error('text/babel 스크립트 블록을 찾지 못했습니다.');

const { code } = babel.transform(match[1], {
  presets: ['@babel/preset-react'],
  plugins: ['@babel/plugin-transform-object-rest-spread'],
  babelrc: false,
  configFile: false,
});

html = html.replace(scriptTagRe, `<script>${code}</script>`);

const ts =
  '// 이 파일은 assets/html/price-tag-maker.html.bak(JSX 소스)에서 빌드 스크립트로 생성됨 —\n' +
  '// 직접 수정하지 말 것. 수정하려면 .bak 파일을 고치고 빌드 스크립트를 다시 실행할 것.\n' +
  `export const PRICE_TAG_MAKER_HTML = ${JSON.stringify(html)};\n`;

fs.writeFileSync(outPath, ts);
console.log('생성 완료:', outPath, `(${ts.length} bytes)`);
