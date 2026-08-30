const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 완성형 한글 음절은 초성 자음으로, 나머지 문자는 그대로 남긴다. */
function toChosung(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    result += code >= 0xac00 && code <= 0xd7a3 ? CHOSUNG[Math.floor((code - 0xac00) / 588)] : ch;
  }
  return result;
}

/** 검색어의 모든 글자가 초성 자음인지 확인한다 (예: "ㄱㄱㅂ"). */
function isChosungOnly(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => CHOSUNG.includes(ch));
}

/**
 * 일반 부분일치 또는 초성(자음) 검색으로 target이 query와 매칭되는지 확인한다.
 * 초성 변환 비교는 검색어가 온전히 자음으로만 이뤄졌을 때만, 그리고 target의
 * 맨 앞부터 순서대로 일치할 때만 적용한다 — 중간에서 우연히 초성이 겹치는
 * 무관한 상품(예: "ㅇㄷ" 검색 시 "마이디저트"의 "이디" 부분)이 걸리는 것을 막는다.
 *
 * 검색어의 공백은 매칭이 실패했을 때만 무시하고 재시도한다(target의 공백은
 * 그대로 둔다) — target이 여러 단어일 때 공백 없는 검색어가 단어 경계를
 * 넘어 붙는 오검색은 계속 막으면서, 사용자가 한 단어 상품명에 실수로 띄어쓴
 * 검색어("구구스트로 베리바" → "구구스트로베리바")는 매칭되게 한다.
 */
export function matchesSearch(target: string, query: string): boolean {
  const t = target.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  if (isChosungOnly(q)) return toChosung(t).startsWith(q);

  const qNoSpace = q.replace(/\s+/g, '');
  if (qNoSpace !== q) {
    if (t.includes(qNoSpace)) return true;
    if (isChosungOnly(qNoSpace)) return toChosung(t).startsWith(qNoSpace);
  }
  return false;
}
