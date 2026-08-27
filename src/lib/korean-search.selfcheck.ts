import { matchesSearch } from './korean-search';

console.assert(matchesSearch('구구바', '구바'), '연속 부분일치 실패');
console.assert(matchesSearch('구구바', 'ㄱㄱㅂ'), '초성검색 실패');
console.assert(!matchesSearch('구구바 스트로베리', '구스트'), '단어 경계 넘는 조합은 매칭되면 안 됨');
console.assert(matchesSearch('메로나', ''), '빈 검색어는 항상 매칭');
console.assert(!matchesSearch('메로나', '월드콘'), '무관한 검색어는 매칭되면 안 됨');

console.log('korean-search selfcheck OK');
