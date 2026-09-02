// 일회성 스크립트: order-seed-data.ts의 388개 기본 상품을 order_catalog 초기 삽입 SQL로 변환한다.
// 앱 코드가 아니라 개발자 PC에서 한 번 실행하고 버리는 스크립트라 src/ 밖(scripts/)에 둔다.
//
// 실행: node scripts/generate-order-catalog-seed-sql.mjs

import fs from 'node:fs';
import path from 'node:path';

const SEED_PATH = path.join(process.cwd(), 'src/lib/order-seed-data.ts');
const OUT_PATH = path.join(process.cwd(), 'supabase/migration-order-catalog-seed.sql');

const LINE_RE =
  /^\s*\{ name: '((?:[^'\\]|\\.)*)', brand: '((?:[^'\\]|\\.)*)', price: (\d+), category: '((?:[^'\\]|\\.)*)', barcode: '(\d+)', imageUri: (null|'(?:[^'\\]|\\.)*')\s*\},?\s*$/;

function unescapeJs(s) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function sqlString(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

function main() {
  const src = fs.readFileSync(SEED_PATH, 'utf8');
  const lines = src.split('\n');

  const rows = [];
  for (const line of lines) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, name, brand, price, category, barcode, imageUriRaw] = m;
    const imageUri = imageUriRaw === 'null' ? null : unescapeJs(imageUriRaw.slice(1, -1));
    rows.push({ name: unescapeJs(name), brand: unescapeJs(brand), price: Number(price), category: unescapeJs(category), barcode, imageUri });
  }

  if (rows.length === 0) {
    console.error('파싱된 상품이 0건입니다 — LINE_RE가 order-seed-data.ts 포맷과 안 맞는지 확인하세요.');
    process.exit(1);
  }

  const values = rows
    .map(
      (r) =>
        `(${sqlString(r.barcode)}, ${sqlString(r.name)}, ${sqlString(r.brand)}, ${r.price}, ${sqlString(r.category)}, ${r.imageUri ? sqlString(r.imageUri) : 'null'})`,
    )
    .join(',\n  ');

  const sql = `-- order_catalog 초기 시드 (order-seed-data.ts ${rows.length}건에서 자동 생성, 2026-09-02)
-- Supabase 대시보드 > SQL Editor 에서 migration-order-catalog-source.sql 실행 이후에 실행하세요.

insert into public.order_catalog (barcode, name, brand, price, category, image_uri)
values
  ${values}
on conflict (barcode) do nothing;
`;

  fs.writeFileSync(OUT_PATH, sql);
  console.log(`완료: ${rows.length}건 -> ${OUT_PATH}`);
}

main();
