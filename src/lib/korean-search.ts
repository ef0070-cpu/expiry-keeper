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

/**
 * 검색어가 target 맨 앞부터 순서대로 일치하는지 확인한다. 검색어의 각 글자는 초성 자음이면
 * target 글자의 초성과, 그 외(완성형 글자 등)면 target 글자 자체와 비교한다 — "ㅁㄹ나"처럼
 * 초성과 완성형 글자가 섞인 검색어로 "메로나"를 찾는 경우까지 포함한다(순수 초성만인
 * "ㄱㄱㅂ"도 이 규칙의 특수한 경우).
 *
 * 항상 맨 앞부터만 비교하는 이유: 중간부터 우연히 겹치는 무관한 상품(예: "ㅇㄷ" 검색 시
 * "마이디저트"의 "이디" 부분)이 걸리는 것을 막기 위함.
 */
function matchesChosungPatternFromStart(target: string, query: string): boolean {
  if (query.length === 0 || query.length > target.length) return false;
  for (let i = 0; i < query.length; i++) {
    const qc = query[i];
    const tc = target[i];
    if (CHOSUNG.includes(qc)) {
      if (toChosung(tc) !== qc) return false;
    } else if (tc !== qc) {
      return false;
    }
  }
  return true;
}

/**
 * target 전체 맨 앞, 또는 공백으로 나눈 각 단어의 맨 앞부터 초성/혼합 패턴이 일치하는지
 * 확인한다 — "거꾸로 수박바"에서 "ㅅㅂㅂ"(두 번째 단어 "수박바"의 초성)처럼 단어 단위로도
 * 찾을 수 있게 하되, 단어 경계를 넘나드는 조합(예: "구구바 스트로베리"에서 "바 스"에
 * 걸치는 "ㅂㅅ")은 여전히 걸리지 않는다.
 */
function matchesChosungPatternAnyWordStart(target: string, query: string): boolean {
  if (matchesChosungPatternFromStart(target, query)) return true;
  return target.split(/\s+/).some((word) => matchesChosungPatternFromStart(word, query));
}

/**
 * 일반 부분일치 또는 초성(자음)/혼합(초성+완성형) 검색으로 target이 query와 매칭되는지
 * 확인한다.
 *
 * 공백이 있는 그대로 매칭이 실패하면, target과 query 양쪽 공백을 모두 지우고
 * 재시도한다 — "거꾸로 수박바"(상품명)와 "거꾸로수박바"(검색어)처럼 어느 한쪽에만
 * 공백이 있어도 서로 매칭되게 한다.
 */
export function matchesSearch(target: string, query: string): boolean {
  const t = target.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  if (matchesChosungPatternAnyWordStart(t, q)) return true;

  const tNoSpace = t.replace(/\s+/g, '');
  const qNoSpace = q.replace(/\s+/g, '');
  if (tNoSpace.includes(qNoSpace)) return true;
  return matchesChosungPatternFromStart(tNoSpace, qNoSpace);
}
