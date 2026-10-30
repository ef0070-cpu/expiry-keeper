// 주간 홍보 묶음 자동 승인(사장님 결정 2026-10-30, "완전 자동화").
// 조건을 모두 만족하는 묶음만 publish.json의 approved를 true로 바꾸고, 그 묶음의 카드 이미지·계획만 커밋·푸시한다.
//   조건: ① REVIEW.md 판정이 "통과"(반려 아님) ② LEGAL-REVIEW.md "높음" 지적 0건 ③ 게시 글에 자리 표시([촬영 필요 등] 없음
// 하나라도 어긋나면 승인하지 않고 이유를 출력한다(에이전트는 approved를 바꾸지 못한다 — 이 스크립트만 바꾼다).
//
//   node scripts/auto-approve.mjs          미리보기(판단만)
//   node scripts/auto-approve.mjs --apply  승인 + 커밋·푸시
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKETING = path.join(ROOT, 'docs', 'marketing');

/** 승인 여부 판단. IO 없는 순수 함수. */
export function decide({ review, legal, plan }) {
  const reasons = [];
  if (plan.approved === true) return { ok: false, reasons: ['이미 승인됨'] };
  if (!review) reasons.push('REVIEW.md 없음(팀장 심사 전)');
  else {
    const verdict = review.split('\n').find((l) => l.includes('판정:')) ?? '';
    if (!verdict.includes('통과') || verdict.includes('반려')) reasons.push(`팀장 심사가 통과가 아님: ${verdict.trim() || '판정 줄 없음'}`);
  }
  if (!legal) reasons.push('LEGAL-REVIEW.md 없음(법무 검토 전)');
  else {
    const m = legal.match(/높음\s*\|\s*(\d+)/);
    if (!m) reasons.push('법무 검토에서 "높음" 건수를 찾지 못함');
    else if (Number(m[1]) > 0) reasons.push(`법무 검토 "높음" ${m[1]}건`);
  }
  for (const item of plan.items ?? []) {
    if (/\[촬영 필요|\[사진|TODO/.test(item.text ?? '')) reasons.push(`${item.id}: 글에 자리 표시가 남아 있음`);
  }
  if (!(plan.items ?? []).length) reasons.push('게시 항목이 없음');
  return { ok: reasons.length === 0, reasons };
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function run() {
  const apply = process.argv.includes('--apply');
  const folders = fs
    .readdirSync(MARKETING)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(MARKETING, d, 'publish.json')))
    .sort();
  for (const folder of folders) {
    const dir = path.join(MARKETING, folder);
    const planPath = path.join(dir, 'publish.json');
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    if (plan.approved === true) continue;
    const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
    const { ok, reasons } = decide({ review: read('REVIEW.md'), legal: read('LEGAL-REVIEW.md'), plan });
    if (!ok) {
      console.log(`✗ ${folder} 승인 안 함:`);
      reasons.forEach((r) => console.log(`    - ${r}`));
      continue;
    }
    console.log(`✓ ${folder} 승인 조건 충족${apply ? '' : ' (미리보기라 승인 안 함)'}`);
    if (!apply) continue;
    plan.approved = true;
    plan.note = `${plan.note ?? ''} [자동 승인 ${new Date().toISOString()}: 팀장 심사 통과·법무 높음 0건]`.trim();
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
    try {
      const rel = (p) => path.relative(ROOT, path.join(dir, p)).split(path.sep).join('/');
      git(['add', '--', rel('publish.json'), rel('images')]);
      git(['commit', '-m', `chore(promo): ${folder} 홍보 묶음 자동 승인 — 카드 이미지·게시 계획`, '--', rel('publish.json'), rel('images')]);
      git(['push', 'origin', 'main']);
      console.log(`  → ${folder} 커밋·푸시 완료`);
    } catch (e) {
      console.log(`  ! 커밋·푸시 실패(사진이 GitHub에 없으면 게시가 보류됨): ${e.message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
