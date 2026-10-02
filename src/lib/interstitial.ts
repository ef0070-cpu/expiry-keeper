import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { getCachedEntitlement } from './entitlement';
import { shouldShowInterstitial } from './interstitial-rule';

// 가정용 전면 광고 — 상품 저장 직후에만, 하루 1회, 설치 3일 뒤부터, 광고 제거 구매자 제외(docs/monetization.md 1-2).
// 닫으면 "광고 없이 쓰기" 안내로 평생 결제(광고 제거)를 권한다.
// 실제 광고 단위 ID는 애드몹에서 만들어 받으면 넣는다 — 비어 있으면 스토어 앱에선 띄우지 않는다.
const INTERSTITIAL_UNIT_ID = '';
const INSTALLED_KEY = 'installedAt:v1';
const SHOWN_KEY = 'interstitialShownAt:v1';

let Ads: typeof import('react-native-google-mobile-ads') | null = null;
try {
  Ads = require('react-native-google-mobile-ads');
} catch {
  Ads = null;
}

async function installedAt(): Promise<number> {
  const raw = await AsyncStorage.getItem(INSTALLED_KEY);
  if (raw) return Number(raw);
  const now = Date.now();
  await AsyncStorage.setItem(INSTALLED_KEY, String(now));
  return now;
}

/** 앱 시작 때 불러 설치 시각을 남겨 둔다(첫 상품 저장 시점이 아니라 설치부터 3일을 세려고) */
export function markInstalled(): void {
  installedAt().catch(() => {});
}

export async function maybeShowInterstitial(): Promise<void> {
  try {
    if (!Ads) return;
    const unitId = __DEV__ ? Ads.TestIds.INTERSTITIAL : INTERSTITIAL_UNIT_ID;
    if (!unitId) return;
    const raw = await AsyncStorage.getItem(SHOWN_KEY);
    const ok = shouldShowInterstitial({
      adFree: getCachedEntitlement().adFree,
      installedAt: await installedAt(),
      lastShownAt: raw ? Number(raw) : null,
      now: Date.now(),
    });
    if (!ok) return;

    const { InterstitialAd, AdEventType } = Ads;
    const ad = InterstitialAd.createForAdRequest(unitId);
    const offLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      offLoaded();
      AsyncStorage.setItem(SHOWN_KEY, String(Date.now())).catch(() => {});
      ad.show().catch(() => {});
    });
    const offClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      offClosed();
      Alert.alert('광고 없이 쓰기', '한 번 결제로 광고가 모두 사라져요.', [
        { text: '닫기', style: 'cancel' },
        { text: '알아보기', onPress: () => router.push('/premium') },
      ]);
    });
    ad.addAdEventListener(AdEventType.ERROR, () => {}); // 광고가 없거나 실패해도 조용히 넘어간다
    ad.load();
  } catch {
    // 광고 실패는 저장 흐름에 영향을 주지 않는다
  }
}
