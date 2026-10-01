import { Linking } from 'react-native';

// 쿠팡 파트너스 검색 링크. 파트너스 "검색 위젯"(coupa.ng/cpQrqu)이 검색어를 넣어 여는 주소 형식을
// 그대로 쓴다 — 상품명으로 쿠팡 검색 결과를 열고, 그 뒤 구매가 내 실적(lptag)으로 잡힌다.
// ponytail: 검색 결과 링크만 — 정확한 상품 페이지는 파트너스 API 승인 후 서버 함수로 바꿀 것
const TRACKING_CODE = 'AF2370659';
const TRACE_ID = 'V0-411-2c3a664870f025f4-I20261001094743341-l2';

/** 공정위 추천·보증 심사지침에 따른 경제적 이해관계 표시. 링크 근처에 반드시 함께 보여 준다. */
export const COUPANG_DISCLOSURE = '쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

export function coupangSearchUrl(keyword: string): string {
  return (
    'https://link.coupang.com/re/AFFSRP' +
    `?pageKey=${encodeURIComponent(keyword.trim())}` +
    `&lptag=${TRACKING_CODE}&subid=&subparam=&traceid=${TRACE_ID}`
  );
}

/** 앱 밖(쿠팡 앱·브라우저)에서 연다 — 앱 안 웹뷰로 열면 실적 집계가 빠질 수 있다. */
export function openCoupangSearch(keyword: string): void {
  Linking.openURL(coupangSearchUrl(keyword)).catch(() => {});
}
