// 앱에 들어가는 공개 프로그램(package.json dependencies)의 라이선스 원문을 모아 src/lib/oss-licenses.json으로.
// MIT·Apache 등은 배포할 때 저작권 고지를 요구한다 → 설정 > 오픈소스 라이선스 화면에서 보여 준다.
// 패키지를 추가·업데이트하면 다시 실행: node scripts/gen-licenses.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const mit = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const deps = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).dependencies).sort();
const out = deps.map((name) => {
  const dir = join('node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? '확인 필요';
  const author = (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) ?? `${name} contributors`;
  // Expo 패키지 등은 LICENSE 파일 없이 배포된다 — MIT면 표준 문구에 작성자를 넣어 고지한다
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : license === 'MIT' ? mit(author) : null;
  return { name, version: pkg.version, license, text };
});
console.assert(out.length === deps.length, '항목 수 불일치');
writeFileSync('src/lib/oss-licenses.json', JSON.stringify(out));
console.log(`${out.length}개 패키지, 원문 없는 것 ${out.filter((x) => !x.text).length}개`);
