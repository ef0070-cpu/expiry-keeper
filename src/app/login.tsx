import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

type Provider = 'google';

const PROVIDER_LABEL: Record<Provider, string> = {
  google: '구글',
};

export default function Login() {
  const [busy, setBusy] = useState<Provider | null>(null);
  const incomingUrl = Linking.useURL();
  const handledUrls = useRef(new Set<string>());

  const completeLogin = async (callbackUrl: string, providerLabel: string) => {
    if (!supabase || handledUrls.current.has(callbackUrl)) return;
    handledUrls.current.add(callbackUrl);
    console.log('[login] completeLogin callbackUrl:', callbackUrl);
    try {
      const url = new URL(callbackUrl);
      const errorDescription = url.searchParams.get('error_description');
      if (errorDescription) throw new Error(errorDescription);
      const code = url.searchParams.get('code');
      if (!code) throw new Error('인증 코드를 받지 못했습니다.');
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      console.log('[login] exchangeCodeForSession error:', error);
      if (error) throw error;
    } catch (e) {
      console.log('[login] completeLogin failed:', e);
      Alert.alert(
        `${providerLabel} 로그인 오류`,
        e instanceof Error ? e.message : '로그인에 실패했습니다.',
      );
    } finally {
      setBusy(null);
    }
  };

  // 외부 앱 전환 등으로 브라우저 세션이 먼저 닫혀도, 마지막 리다이렉트가
  // 딥링크로 도착하면 여기서 받아 로그인을 마무리한다.
  useEffect(() => {
    console.log('[login] incomingUrl:', incomingUrl);
    if (incomingUrl && incomingUrl.includes('code=')) {
      completeLogin(incomingUrl, '소셜');
    } else if (incomingUrl && incomingUrl.includes('error_description=')) {
      completeLogin(incomingUrl, '소셜');
    }
  }, [incomingUrl]);

  const oauthLogin = async (provider: Provider) => {
    if (!supabase) return;
    setBusy(provider);
    try {
      // Expo Go에서는 exp://[PC IP]:8081/--/login 형태의 주소가 된다
      const redirectTo = Linking.createURL('login');
      console.log('[login] redirectTo:', redirectTo);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      console.log('[login] auth url:', data.url);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      console.log('[login] browser result:', JSON.stringify(result));
      if (result.type === 'success') {
        await completeLogin(result.url, PROVIDER_LABEL[provider]);
        return;
      }
      // dismiss/cancel이어도 딥링크로 세션만 끊긴 경우일 수 있다.
      // 이때는 위 useEffect가 딥링크를 받아 이어서 처리하므로 오류로 취급하지 않는다.
      setBusy(null);
    } catch (e) {
      Alert.alert(
        `${PROVIDER_LABEL[provider]} 로그인 오류`,
        e instanceof Error ? e.message : '로그인에 실패했습니다.',
      );
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 justify-center bg-paper px-8">
      <Image
        source={require('@/assets/images/icon.png')}
        style={{ width: 96, height: 96, borderRadius: 22 }}
      />
      <Text className="text-ink mt-4 text-3xl font-bold">유통기한 지킴이</Text>
      <Text className="text-muted mt-2 text-base">
        로그인하면 어느 기기에서든 재고를 확인할 수 있습니다.
      </Text>

      <Pressable
        onPress={() => oauthLogin('google')}
        disabled={busy !== null}
        className="mt-10 items-center rounded-xl border border-line bg-paper py-4 active:opacity-70"
      >
        {busy === 'google' ? (
          <ActivityIndicator color="#191919" />
        ) : (
          <Text className="text-ink text-base font-bold">Google로 시작하기</Text>
        )}
      </Pressable>
    </View>
  );
}
