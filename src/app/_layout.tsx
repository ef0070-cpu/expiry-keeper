import '../global.css';

import { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppMode } from '@/lib/settings';
import {
  dedupeOrderProductsByBarcode,
  migrateLocalOrderDataToCloud,
  syncOrderCatalog,
  syncOrderStores,
} from '@/lib/order-repo';
import { isCloudMode, supabase } from '@/lib/supabase';

// Expo Go는 원격 푸시를 지원하지 않는다는 경고 — 이 앱은 로컬 알림만 쓰므로 해당 없음
LogBox.ignoreLogs(['expo-notifications: Android Push notifications']);

export default function RootLayout() {
  const [ready, setReady] = useState(!isCloudMode);
  const [session, setSession] = useState<Session | null>(null);
  const mode = useAppMode(); // undefined = 로딩 중, null = 아직 선택 전

  const syncTriggeredRef = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    // getSession()과 onAuthStateChange 초기 콜백이 같은 로그인에 대해 거의 동시에 둘 다
    // 발생할 수 있어, 동기 플래그로 한 번만 실행되게 막는다(비동기 완료 플래그 체크만으로는
    // 두 호출이 그 체크를 통과한 뒤에야 플래그가 세워지는 TOCTOU 레이스가 있었다).
    const syncOrderStoreData = () => {
      if (syncTriggeredRef.current) return;
      syncTriggeredRef.current = true;
      migrateLocalOrderDataToCloud().then(() => syncOrderStores());
    };
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
      if (data.session) syncOrderStoreData();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) syncOrderStoreData();
      else syncTriggeredRef.current = false;
    });
    syncOrderCatalog();
    dedupeOrderProductsByBarcode();
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready || mode === undefined) return null;

  const authed = !isCloudMode || !!session;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTintColor: '#1A1A1A',
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#F7F7F7' },
        }}
      >
        <Stack.Protected guard={authed && mode !== null}>
          <Stack.Screen name="index" options={{ title: '유통기한 지킴이' }} />
          <Stack.Screen name="calendar" options={{ title: '유통기한 달력' }} />
          <Stack.Screen name="team" options={{ title: '팀 설정' }} />
          <Stack.Screen name="team-invite" options={{ title: '멤버 초대' }} />
          <Stack.Screen name="scan" options={{ title: '바코드 스캔' }} />
          <Stack.Screen name="product-form" options={{ title: '상품 등록' }} />
          <Stack.Screen name="product-duplicates" options={{ title: '이미 등록된 상품' }} />
          <Stack.Screen name="stats" options={{ title: '소진·폐기 통계' }} />
          <Stack.Screen name="price-tag-maker" options={{ title: '가격표 만들기' }} />
          <Stack.Screen name="recipes" options={{ title: '레시피 추천' }} />
          <Stack.Screen name="recipe-video" options={{ title: '레시피 영상' }} />
          <Stack.Screen name="settings" options={{ title: '설정' }} />
          <Stack.Screen name="csv-import" options={{ title: 'CSV로 가져오기' }} />
        </Stack.Protected>
        <Stack.Protected guard={authed && mode === 'retail'}>
          <Stack.Screen name="order" options={{ title: '발주 관리' }} />
          <Stack.Screen name="order-product-form" options={{ title: '발주 상품' }} />
          <Stack.Screen name="margin-calculator" options={{ title: '원가 계산기' }} />
          <Stack.Screen
            name="order-cart"
            options={{
              headerShown: false,
              presentation: 'formSheet',
              sheetAllowedDetents: [0.9],
              sheetCornerRadius: 24,
              sheetGrabberVisible: true,
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={authed && mode === null}>
          <Stack.Screen name="mode-select" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
