import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isEntitlementLoaded, useEntitlement, whenEntitlementLoaded } from '@/lib/entitlement';

// 애드몹 배너(가정용 메인 목록 하단 고정). 개발 중(__DEV__)엔 구글 테스트 광고만 —
// 실제 광고 ID로 테스트하다 본인이 누르면 무효 클릭으로 계정이 정지될 수 있다.
const BANNER_UNIT_ID = 'ca-app-pub-9764423893666665/8301231577';

// 광고 모듈이 없는 예전 개발용 앱에서도 화면이 죽지 않게 늦게 불러온다(없으면 배너를 안 그림)
let Ads: typeof import('react-native-google-mobile-ads') | null = null;
try {
  Ads = require('react-native-google-mobile-ads');
  Ads?.default().initialize().catch(() => {});
} catch {
  Ads = null;
}

/** 이 앱에 광고 모듈이 들어 있는가 — 없으면 배너가 안 그려지니 상품추가 버튼도 원래 자리에 둔다 */
export const adsAvailable = Ads !== null;

/** 배너가 실제로 보이는가 — 광고 모듈이 있고 광고 제거(평생 결제·테스터)가 아닐 때 */
export function useAdsVisible(): boolean {
  const ent = useEntitlement();
  // 저장된 권한을 읽기 전엔 무료로 보여 매장 유료 사용자에게 배너가 잠깐 붙었다 사라졌다 — 읽은 뒤에 판단
  const [loaded, setLoaded] = useState(isEntitlementLoaded);
  useEffect(() => {
    if (!loaded) whenEntitlementLoaded().then(() => setLoaded(true), () => setLoaded(true));
  }, [loaded]);
  return adsAvailable && loaded && !ent.adFree;
}

/** placement="top": 화면 아래가 큰 버튼(계산기 키패드)이라 바로 붙이면 실수 클릭이 많은 화면용 */
export default function HomeBanner({ placement = 'bottom' }: { placement?: 'top' | 'bottom' }) {
  const insets = useSafeAreaInsets();
  const visible = useAdsVisible();
  if (!Ads || !visible) return null;
  const { BannerAd, BannerAdSize, TestIds } = Ads;
  const top = placement === 'top';
  return (
    // 하단이면 안내바 높이만큼 아래를 띄워 배너가 안내바에 겹치지 않게
    <View
      className={`items-center border-line bg-paper ${top ? 'mt-3 border-y' : 'border-t'}`}
      style={{ paddingBottom: top ? 0 : insets.bottom }}
    >
      <BannerAd
        unitId={__DEV__ ? TestIds.ADAPTIVE_BANNER : BANNER_UNIT_ID}
        // 화면 폭에 맞춰 높이가 정해지는 고정형 배너 — 폴드 접힘/펼침 모두 맞는다
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      />
    </View>
  );
}
