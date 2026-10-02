// scripts/gen-promo-codes.mjs — node scripts/gen-promo-codes.mjs 100 "단톡방 무료 이용 이벤트" 6 2026-12-31
import { randomInt, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const [count = '100', batch = '단톡방 무료 이용 이벤트', months = '6', deadline = '2026-12-31'] = process.argv.slice(2);
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 0/O·1/I/L 제외
const group = () => Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('');
const make = () => [group(), group(), group()].join('-');
const hash = (c) => createHash('sha256').update(c.replace(/[^0-9A-Z]/g, '')).digest('hex');

const codes = new Set();
while (codes.size < Number(count)) codes.add(make());
const list = [...codes];

console.assert(list.every((c) => /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(c)), '형식 오류');
console.assert(hash('ABCD-EFGH-JKMN') === hash('ABCDEFGHJKMN'), '하이픈 무시 해시 불일치');

mkdirSync('.private', { recursive: true });
const csv = '﻿번호,코드,이벤트,보낸 사람,메모\n' + list.map((c, i) => `${i + 1},${c},${batch},,`).join('\n');
writeFileSync('.private/promo-codes.csv', csv);
const sql = list
  .map((c) => `insert into public.promo_codes (code_hash, batch, months, redeem_deadline) values ('${hash(c)}', '${batch}', ${months}, '${deadline}T23:59:59+09:00');`)
  .join('\n');
writeFileSync('.private/promo-codes.sql', sql);
console.log(`${list.length}개 생성 → .private/promo-codes.csv(사장님용), .private/promo-codes.sql(서버용, 해시만)`);
