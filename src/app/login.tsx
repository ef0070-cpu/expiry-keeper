import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { WebView } from 'react-native-webview';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

type Provider = 'google' | 'kakao';

const PROVIDER_LABEL: Record<Provider, string> = {
  google: '구글',
  kakao: '카카오',
};

// 소셜 로그인이 실패했을 때, 다른 로그인 수단으로 안내한다.
// 구글은 회사(Workspace) 계정 관리자가 외부 앱 접근을 막아둔 경우가 흔해 별도 문구를 덧붙인다.
function loginFailureHint(provider: Provider | null): string {
  const other = provider === 'google' ? '카카오 로그인' : provider === 'kakao' ? '구글 로그인' : '다른 로그인 방법';
  const workspaceNote =
    provider === 'google' ? '\n\n회사 Workspace 계정입니다. 개인 구글 계정 또는 다른 접속 방법으로 시도해주세요.' : '';
  return `${workspaceNote}\n\n대신 ${other}을 이용해주세요.`;
}

export default function Login() {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [webViewSession, setWebViewSession] = useState<{ url: string; redirectTo: string } | null>(null);
  const incomingUrl = Linking.useURL();
  const handledUrls = useRef(new Set<string>());

  const completeLogin = async (callbackUrl: string, provider: Provider | null) => {
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
      const label = provider ? PROVIDER_LABEL[provider] : '소셜';
      const message = e instanceof Error ? e.message : '로그인에 실패했습니다.';
      Alert.alert(`${label} 로그인 오류`, message + loginFailureHint(provider));
    } finally {
      setBusy(null);
    }
  };

  // 외부 앱 전환 등으로 브라우저 세션이 먼저 닫혀도, 마지막 리다이렉트가
  // 딥링크로 도착하면 여기서 받아 로그인을 마무리한다.
  useEffect(() => {
    console.log('[login] incomingUrl:', incomingUrl);
    if (incomingUrl && incomingUrl.includes('code=')) {
      completeLogin(incomingUrl, null);
    } else if (incomingUrl && incomingUrl.includes('error_description=')) {
      completeLogin(incomingUrl, null);
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

      // 카카오는 카카오톡이 설치된 기기에서 외부 브라우저(Custom Tabs)로 열면
      // 안드로이드가 카카오 로그인 주소를 App Link로 가로채 카카오톡 앱으로 전환시키고,
      // 그 순간 원래 열려있던 인증 세션이 끊겨 dismiss로 닫혀버린다.
      // WebView는 App Link 가로채기 대상이 아니라 이 문제를 피할 수 있다.
      // 구글은 반대로 WebView를 통한 로그인을 정책상 차단하므로 외부 브라우저를 그대로 쓴다.
      if (provider === 'kakao') {
        setWebViewSession({ url: data.url, redirectTo });
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      console.log('[login] browser result:', JSON.stringify(result));
      if (result.type === 'success') {
        await completeLogin(result.url, provider);
        return;
      }
      // dismiss/cancel이어도 딥링크로 세션만 끊겨 뒤늦게 도착하는 경우가 있어
      // 잠시 기다렸다가, 그래도 세션이 안 생기면 조용히 버튼만 풀지 않고 알려준다.
      setTimeout(async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        setBusy(null);
        if (!sessionData.session) {
          Alert.alert(
            `${PROVIDER_LABEL[provider]} 로그인 실패`,
            '로그인 창이 완료되지 않고 닫혔습니다. 기본 브라우저가 Chrome인지 확인한 뒤 다시 시도해주세요.' +
              loginFailureHint(provider),
          );
        }
      }, 1500);
    } catch (e) {
      Alert.alert(
        `${PROVIDER_LABEL[provider]} 로그인 오류`,
        (e instanceof Error ? e.message : '로그인에 실패했습니다.') + loginFailureHint(provider),
      );
      setBusy(null);
    }
  };

  const handleWebViewNavigation = (url: string) => {
    console.log('[login] webview nav:', url);
    if (webViewSession && url.startsWith(webViewSession.redirectTo)) {
      setWebViewSession(null);
      completeLogin(url, 'kakao');
      return false;
    }
    // 카카오 페이지 안의 "카카오톡으로 로그인" 등 커스텀 스킴 링크를 눌러도
    // 앱 전환이 일어나지 않도록 http(s)가 아닌 이동은 모두 막는다.
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.log('[login] webview blocked non-http scheme:', url);
      return false;
    }
    return true;
  };

  return (
    <>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
        className="bg-paper px-8"
      >
        <Image
          source={require('@/assets/images/icon.png')}
          style={{ width: 96, height: 96, borderRadius: 22 }}
        />
        <Text className="text-ink mt-4 text-3xl font-bold">유통기한 지킴이</Text>
        <Text className="text-muted mt-2 text-base">
          로그인하면 어느 기기에서든 재고를 확인할 수 있습니다.
        </Text>

        <View className="mt-10 gap-3">
          <Pressable
            onPress={() => oauthLogin('google')}
            disabled={busy !== null}
            className="items-center rounded-xl border border-line bg-paper py-4 active:opacity-70"
          >
            {busy === 'google' ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text className="text-ink text-base font-bold">Google로 시작하기</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => oauthLogin('kakao')}
            disabled={busy !== null}
            className="items-center rounded-xl bg-[#FEE500] py-4 active:opacity-70"
          >
            {busy === 'kakao' ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text className="text-base font-bold text-[#191919]">카카오로 시작하기</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

    <Modal visible={webViewSession !== null} animationType="slide" onRequestClose={() => { setWebViewSession(null); setBusy(null); }}>
      <View className="flex-1 bg-paper">
        <View className="flex-row items-center justify-between border-b border-line px-4 py-3 pt-14">
          <Text className="text-ink text-base font-bold">카카오 로그인</Text>
          <Pressable onPress={() => { setWebViewSession(null); setBusy(null); }} className="px-2 py-1">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </View>
        {webViewSession && (
          <WebView
            key={webViewSession.url}
            incognito
            source={{ uri: webViewSession.url }}
            onShouldStartLoadWithRequest={(request) => handleWebViewNavigation(request.url)}
            onNavigationStateChange={(navState) => handleWebViewNavigation(navState.url)}
            onLoadStart={(e) => console.log('[login] webview onLoadStart:', e.nativeEvent.url)}
            onError={(e) => console.log('[login] webview onError:', JSON.stringify(e.nativeEvent))}
            onHttpError={(e) => console.log('[login] webview onHttpError:', JSON.stringify(e.nativeEvent))}
            startInLoadingState
            renderLoading={() => (
              <View className="absolute inset-0 items-center justify-center">
                <ActivityIndicator color="#191919" />
              </View>
            )}
          />
        )}
      </View>
    </Modal>
    </>
  );
}
