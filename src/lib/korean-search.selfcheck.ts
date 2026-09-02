import { matchesSearch } from './korean-search';

console.assert(matchesSearch('구구바', '구바'), '연속 부분일치 실패');
console.assert(matchesSearch('구구바', 'ㄱㄱㅂ'), '초성검색 실패');
console.assert(!matchesSearch('구구바 스트로베리', '구스트'), '단어 경계 넘는 조합은 매칭되면 안 됨');
console.assert(matchesSearch('메로나', ''), '빈 검색어는 항상 매칭');
console.assert(!matchesSearch('메로나', '월드콘'), '무관한 검색어는 매칭되면 안 됨');
console.assert(matchesSearch('월드콘', '월드'), '일반 글자 부분일치는 정상 동작해야 함');
console.assert(!matchesSearch('마이디저트 딸기초코', '월드'), '일반 글자 검색어는 초성으로 변환해 비교하면 안 됨 (우연한 초성 일치 오검색 방지)');
console.assert(matchesSearch('월드콘', 'ㅇㄷ'), '초성검색은 target 맨 앞부터 일치하면 매칭돼야 함');
console.assert(!matchesSearch('마이디저트 딸기초코', 'ㅇㄷ'), '초성검색은 target 중간에서 우연히 일치하면 안 됨');

console.assert(matchesSearch('구구스트로베리바', '구구스트로 베리바'), '한 단어 상품명에 실수로 띄어쓴 검색어도 매칭돼야 함');
console.assert(matchesSearch('구구스트로베리바', '구구'), '앞부분 부분일치');
console.assert(matchesSearch('구구스트로베리바', 'ㄱㄱ'), '초성 부분일치');
console.assert(matchesSearch('구구스트로베리바', '구구스트로'), '더 긴 부분일치');
console.assert(!matchesSearch('구구바 스트로베리', '구스트'), '공백 무시 재시도가 기존 단어 경계 보호를 깨면 안 됨 (회귀 방지)');

console.assert(matchesSearch('거꾸로 수박바', '거꾸로수박바'), '상품명에 공백 있고 검색어에 없어도 매칭돼야 함');
console.assert(matchesSearch('거꾸로 수박바', '거꾸로 수박바'), '상품명과 검색어 공백이 동일하면 매칭돼야 함');
console.assert(matchesSearch('거꾸로 수박바', '수박바'), '상품명 뒷부분 단어만 검색해도 매칭돼야 함');
console.assert(matchesSearch('거꾸로 수박바', 'ㄱㄲㄹㅅㅂㅂ'), '상품명에 공백 있어도 공백 없는 초성 검색어가 매칭돼야 함');
console.assert(!matchesSearch('구구바 스트로베리', 'ㄱㅅㅌ'), '초성도 공백 무시 재시도가 단어 경계 보호를 깨면 안 됨 (회귀 방지)');

console.log('korean-search selfcheck OK');
