// node scripts/auto-approve.selfcheck.mjs — 자동 승인 판단 규칙이 깨지지 않았는지 확인(파일·API 없음)
import assert from 'node:assert/strict';
import { decide } from './auto-approve.mjs';

const plan = { approved: false, items: [{ id: 'th-1', text: '글' }] };
const pass = '판정: **통과** (점수)';
const legal0 = '| 높음 | 0 | — |';

assert.equal(decide({ review: pass, legal: legal0, plan }).ok, true);

// 승인되면 안 되는 경우들
assert.equal(decide({ review: '판정: **반려**', legal: legal0, plan }).ok, false);
assert.equal(decide({ review: '판정: 통과 후 반려', legal: legal0, plan }).ok, false);
assert.equal(decide({ review: '', legal: legal0, plan }).ok, false);
assert.equal(decide({ review: pass, legal: '', plan }).ok, false);
assert.equal(decide({ review: pass, legal: '| 높음 | 2 | 항목 |', plan }).ok, false);
assert.equal(decide({ review: pass, legal: 'no table', plan }).ok, false);
assert.equal(decide({ review: pass, legal: legal0, plan: { items: [{ id: 'x', text: '[촬영 필요: a.jpg]' }] } }).ok, false);
assert.equal(decide({ review: pass, legal: legal0, plan: { items: [] } }).ok, false);
assert.equal(decide({ review: pass, legal: legal0, plan: { approved: true, items: plan.items } }).ok, false);

console.log('auto-approve 자가검사 통과');
