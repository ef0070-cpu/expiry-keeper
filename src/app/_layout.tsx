import '../global.css';

import { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { useAppMode } from '@/lib/settings';
import { isCloudMode, supabase } from '@/lib/supabase';

// Expo Go는 원격 푸시를 지원하지 않는다는 경고 — 이 앱은 로컬 알림만 쓰므로 해당 없음
LogBox.ignoreLogs(['expo-notifications: Android Push notifications']);

export default function RootLayout() {
  const [ready, setReady] = useState(!isCloudMode);
  const [session, setSession] = useState<Session | null>(null);
  const mode = useAppMode(); // undefined = 로딩 중, null = 아직 선택 전

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready || mode === undefined) return null;

  const authed = !isCloudMode || !!session;

  return (
    <>
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
          <Stack.Screen name="scan" options={{ title: '바코드 스캔' }} />
          <Stack.Screen name="product-form" options={{ title: '상품 등록' }} />
          <Stack.Screen name="stats" options={{ title: '소진·폐기 통계' }} />
          <Stack.Screen name="recipes" options={{ title: '레시피 추천' }} />
          <Stack.Screen name="settings" options={{ title: '설정' }} />
        </Stack.Protected>
        <Stack.Protected guard={authed && mode === null}>
          <Stack.Screen name="mode-select" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
