// 음성 인식 결과를 검색창에 넣을 글자로 다듬는다(2026-10-28 C안). IO 없는 순수 함수
// (자가검사: npx tsx src/lib/voice-text.selfcheck.ts).
// 말을 해석해 바로 담지 않고 검색창에 넣어 사람이 목록에서 고르므로, 끝의 수량 말("두 박스")·문장부호만 걷어 낸다.

const QTY_TAIL = /\s*(?:\d+|[한두세네다섯여섯일곱여덟아홉열]+)\s*(?:박스|개|봉|팩|상자)\s*(?:주세요|줘|요)?\s*$/;

export function cleanTranscript(raw: string): string {
  let t = raw.replace(/[.,!?。]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(QTY_TAIL, '').trim();
  return t;
}
