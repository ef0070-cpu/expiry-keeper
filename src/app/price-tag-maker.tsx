import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PRICE_TAG_MAKER_HTML } from '@/lib/price-tag-maker-html';

const BASE_URL = 'https://price-tag-maker.expiry-keeper.local/';

/** src/lib/price-tag-maker-html.ts(자체완결형 React 앱, CDN 리소스 사용, 빌드 스크립트로
 * 생성된 JS 문자열 상수)를 WebView로 띄운다. 예전엔 assets/html/*.html을 expo-asset으로
 * 내려받아 썼는데, 기기에 캐시된 예전 파일을 계속 읽는 문제가 있어 일반 소스처럼 Metro가
 * 그대로 새로고침해주는 JS 상수 방식으로 바꿨다. */
export default function PriceTagMaker() {
  const router = useRouter();

  /** "저장"/"카톡 전송"을 누르면 HTML이 자체적으로(html2canvas) 캡처해 만든 PNG를
   * base64 데이터 URL로 postMessage 보낸다. 예전엔 WebView 자체를 네이티브로 리사이즈한
   * 뒤 react-native-view-shot으로 캡처했는데, 안드로이드 일부 기기에서 리사이즈가 내부
   * 렌더링 서피스에 반영되지 않아(레이아웃 좌표는 새 크기인데 실제 그림은 예전 작은 크기로
   * 고정) 이미지가 잘리거나 화면이 확대된 채 안 돌아오는 문제가 있었다. WebView 크기를
   * 전혀 건드리지 않는 이 방식으로 그 문제를 근본적으로 피한다. */
  const handleMessage = async (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; dataUrl?: string };
      if (msg.type !== 'save' && msg.type !== 'share') return;
      if (!msg.dataUrl) return;

      const base64 = msg.dataUrl.replace(/^data:image\/png;base64,/, '');
      const file = new File(Paths.cache, `price-tag-${Date.now()}.png`);
      file.write(base64, { encoding: 'base64' });
      const fileUri = file.uri;

      if (msg.type === 'save') {
        // 갤러리에 새 사진을 저장하는 데는 쓰기 권한만 있으면 된다. 기본값(읽기+쓰기)으로
        // 요청하면 안드로이드가 "선택한 사진만 허용" 사진 선택기를 띄워 사용자가 매번
        // 사진을 골라야 하는 것처럼 보이는 문제가 있어, 쓰기 전용으로 요청한다.
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status !== 'granted') {
          Alert.alert('저장 불가', '갤러리 접근 권한이 필요해요.');
          return;
        }
        await MediaLibrary.saveToLibraryAsync(fileUri);
        Alert.alert('저장 완료', '갤러리에 가격표 이미지를 저장했어요.');
        return;
      }

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('공유 불가', '이 기기에서는 공유를 지원하지 않아요.');
        return;
      }
      await Sharing.shareAsync(fileUri, { mimeType: 'image/png', dialogTitle: '가격표 공유' });
    } catch (e) {
      Alert.alert('실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  };

  return (
    <View className="flex-1 bg-bg">
      {/* 네이티브 헤더는 숨기고 Modal 안에 직접 그린다 — Modal은 별도 네이티브 레이어라
       * 헤더까지 함께 가려지기 때문. 아래 SafeAreaView 헤더가 이를 대체한다. */}
      <Stack.Screen options={{ title: '가격표 만들기', headerShown: false }} />
      <Modal visible transparent={false} animationType="none">
        <SafeAreaView edges={['top']} style={{ backgroundColor: '#FFFFFF' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#E5E5E5',
            }}
          >
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ paddingRight: 12 }}>
              <Text style={{ fontSize: 22, color: '#1A1A1A' }}>‹</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1A1A1A' }}>가격표 만들기</Text>
          </View>
        </SafeAreaView>
        {/* 하단(제스처 내비게이션 바) 여백 확보 — 없으면 설정 화면 맨 아래 체크박스가
         * 내비게이션 바에 가려 탭할 수 없었다. */}
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <WebView
            source={{ html: PRICE_TAG_MAKER_HTML, baseUrl: BASE_URL }}
            style={{ flex: 1 }}
            originWhitelist={[BASE_URL]}
            onShouldStartLoadWithRequest={(request) => request.url.startsWith(BASE_URL) || request.url === 'about:blank'}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            onMessage={handleMessage}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
