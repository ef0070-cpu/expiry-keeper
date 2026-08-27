// 일회성 스크립트: order-seed-data.ts의 388개 기본 상품 중 imageUri가 null인 항목을
// 바코드 기반 조회(우선) + 상품명/브랜드 보완 검색으로 채워 파일에 직접 저장한다.
// 앱 코드가 아니라 개발자 PC에서 한 번 실행하고 버리는 스크립트라 src/ 밖(scripts/)에 둔다.
//
// 실행: node scripts/backfill-seed-photos.mjs
// 환경변수 필요: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY

import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const SEED_PATH = path.join(process.cwd(), 'src/lib/order-seed-data.ts');
const LINE_RE =
  /^(\s*\{ name: '((?:[^'\\]|\\.)*)', brand: '((?:[^'\\]|\\.)*)', price: \d+, category: '(?:[^'\\]|\\.)*', barcode: '(\d+)', imageUri: )null(\s*\},?\s*)$/;

async function callFunction(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

async function findImageUrl(barcode, name, brand) {
  const info = await callFunction('barcode-lookup', { barcode, brand });
  if (info?.imageUrl) return info.imageUrl;
  const query = brand ? `${brand} ${name}` : name;
  const search = await callFunction('image-search', { query });
  return search?.imageUrl ?? null;
}

function unescape(s) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

async function main() {
  const src = fs.readFileSync(SEED_PATH, 'utf8');
  const lines = src.split('\n');

  const targets = [];
  lines.forEach((line, i) => {
    const m = LINE_RE.exec(line);
    if (m) targets.push({ index: i, name: unescape(m[2]), brand: unescape(m[3]), barcode: m[4] });
  });

  console.log(`대상 ${targets.length}건 (사진 없는 항목)`);

  let filled = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let imageUrl = null;
    try {
      imageUrl = await findImageUrl(t.barcode, t.name, t.brand);
    } catch (e) {
      console.error(`  [${i + 1}/${targets.length}] ${t.name} - 오류: ${e.message}`);
    }
    if (imageUrl) {
      const m = LINE_RE.exec(lines[t.index]);
      lines[t.index] = `${m[1]}'${imageUrl.replace(/'/g, "\\'")}'${m[5]}`;
      filled++;
      console.log(`  [${i + 1}/${targets.length}] ${t.name} - 채움`);
    } else {
      console.log(`  [${i + 1}/${targets.length}] ${t.name} - 못 찾음`);
    }
    // 외부 검색 API에 과도한 연속 호출을 피하기 위한 간단한 텀
    await new Promise((r) => setTimeout(r, 150));
  }

  fs.writeFileSync(SEED_PATH, lines.join('\n'));
  console.log(`완료: ${filled} / ${targets.length}건 채움. ${SEED_PATH} 저장됨.`);
}

main();
