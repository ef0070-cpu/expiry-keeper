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
 * 초성 변환 비교는 검색어가 온전히 자음으로만 이뤄졌을 때만 적용한다 — 일반 글자
 * 검색어까지 초성으로 바꿔 비교하면 우연히 초성이 겹치는 무관한 상품이 걸린다
 * (예: "월드" → ㅇㄷ, "마이디저트"의 "이디" → ㅇㄷ로 우연히 일치).
 */
export function matchesSearch(target: string, query: string): boolean {
  const t = target.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  if (isChosungOnly(q)) return toChosung(t).includes(q);
  return false;
}
