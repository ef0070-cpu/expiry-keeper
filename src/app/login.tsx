import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
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
  const other = provider === 'google' ? '카카오 로그인이나 이메일 로그인' : provider === 'kakao' ? '구글 로그인이나 이메일 로그인' : '다른 로그인 방법';
  const workspaceNote =
    provider === 'google' ? '\n\n회사 Workspace 계정입니다. 개인 구글 계정 또는 다른 접속 방법으로 시도해주세요.' : '';
  return `${workspaceNote}\n\n대신 ${other}을 이용해주세요.`;
}

export default function Login() {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [emailBusy, setEmailBusy] = useState(false);
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

  const emailAuth = async () => {
    if (!supabase) return;
    if (!email.trim() || !password) {
      Alert.alert('입력 확인', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setEmailBusy(true);
    try {
      if (authMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          Alert.alert('가입 완료', '입력하신 이메일로 인증 메일을 보냈습니다. 확인 후 로그인해주세요.');
          setAuthMode('signin');
        }
      }
    } catch (e) {
      Alert.alert(
        authMode === 'signin' ? '로그인 오류' : '회원가입 오류',
        e instanceof Error ? e.message : '요청에 실패했습니다.',
      );
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
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
            disabled={busy !== null || emailBusy}
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
            disabled={busy !== null || emailBusy}
            className="items-center rounded-xl bg-[#FEE500] py-4 active:opacity-70"
          >
            {busy === 'kakao' ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text className="text-base font-bold text-[#191919]">카카오로 시작하기</Text>
            )}
          </Pressable>
        </View>

        <View className="mt-6 flex-row items-center gap-3">
          <View className="h-[1px] flex-1 bg-line" />
          <Text className="text-muted text-xs">또는</Text>
          <View className="h-[1px] flex-1 bg-line" />
        </View>

        <View className="mt-6 gap-2.5">
          <TextInput
            className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
            placeholder="이메일"
            placeholderTextColor="#BBBBBB"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
            placeholder="비밀번호"
            placeholderTextColor="#BBBBBB"
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Pressable
            onPress={emailAuth}
            disabled={busy !== null || emailBusy}
            className="mt-1 items-center rounded-xl border border-line bg-paper py-4 active:opacity-70"
          >
            {emailBusy ? (
              <ActivityIndicator color="#191919" />
            ) : (
              <Text className="text-ink text-base font-bold">
                {authMode === 'signin' ? '이메일로 로그인' : '이메일로 회원가입'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}
            disabled={busy !== null || emailBusy}
            className="items-center py-2"
          >
            <Text className="text-muted text-sm">
              {authMode === 'signin' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
