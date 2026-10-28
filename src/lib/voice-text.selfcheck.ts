// npx tsx src/lib/voice-text.selfcheck.ts
import assert from 'node:assert/strict';
import { cleanTranscript } from './voice-text';

assert.equal(cleanTranscript('메로나'), '메로나');
assert.equal(cleanTranscript(' 메로나. '), '메로나');
assert.equal(cleanTranscript('메로나 두 박스'), '메로나');
assert.equal(cleanTranscript('월드콘 5개 주세요'), '월드콘');
assert.equal(cleanTranscript('딸기 요거트 바'), '딸기 요거트 바'); // 상품명 속 말은 그대로
assert.equal(cleanTranscript('열 박스'), ''); // 이름 없이 수량만 있으면 빈 글자
assert.equal(cleanTranscript(''), '');

console.log('voice-text 자가검사 통과');
