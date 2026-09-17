import * as MediaLibrary from 'expo-media-library';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PRICE_TAG_MAKER_HTML } from '@/lib/price-tag-maker-html';

const BASE_URL = 'https://price-tag-maker.expiry-keeper.local/';
const originWhitelist = [BASE_URL];
const onShouldStartLoadWithRequest = (request: { url: string }) =>
  request.url.startsWith(BASE_URL) || request.url === 'about:blank';

// 캡처 전용 WebView의 고정 크기. 웹 쪽 A4_WIDTH_PX/A4_HEIGHT_PX(794×1123, 최대 18개 태그가
// 들어가는 한 페이지 분량)에 여유 여백을 더했다. 이 크기로 딱 한 번 만들고 다시는
// 리사이즈하지 않는다 — 아래 CaptureWebView 주석 참고.
const CAPTURE_WIDTH = 820;
const CAPTURE_HEIGHT = 1160;

type CaptureRequest = {
  id: number;
  kind: 'save' | 'share';
  tagsList: unknown[];
};

/** src/lib/price-tag-maker-html.ts(자체완결형 React 앱, CDN 리소스 사용, 빌드 스크립트로
 * 생성된 JS 문자열 상수)를 WebView로 띄운다. 예전엔 assets/html/*.html을 expo-asset으로
 * 내려받아 썼는데, 기기에 캐시된 예전 파일을 계속 읽는 문제가 있어 일반 소스처럼 Metro가
 * 그대로 새로고침해주는 JS 상수 방식으로 바꿨다. */
export default function PriceTagMaker() {
  const router = useRouter();
  const mainWebViewRef = useRef<WebView>(null);
  const captureWebViewRef = useRef<WebView>(null);
  const captureWrapperRef = useRef<View>(null);
  const hydratedRef = useRef(false);
  const [captureRequest, setCaptureRequest] = useState<CaptureRequest | null>(null);

  const finishCapture = (ok: boolean, message?: string) => {
    mainWebViewRef.current?.injectJavaScript(
      `window.__onNativeCaptureDone && window.__onNativeCaptureDone(${ok ? 'true' : 'false'}, ${JSON.stringify(message ?? '')}); true;`
    );
    setCaptureRequest(null);
  };

  const deliverOutput = async (kind: 'save' | 'share', fileUri: string) => {
    if (kind === 'save') {
      // 갤러리에 새 사진을 저장하는 데는 쓰기 권한만 있으면 된다. 기본값(읽기+쓰기)으로
      // 요청하면 안드로이드가 "선택한 사진만 허용" 사진 선택기를 띄워 사용자가 매번
      // 사진을 골라야 하는 것처럼 보이는 문제가 있어, 쓰기 전용으로 요청한다.
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        throw new Error('갤러리 접근 권한이 필요해요.');
      }
      await MediaLibrary.saveToLibraryAsync(fileUri);
      Alert.alert('저장 완료', '갤러리에 가격표 이미지를 저장했어요.');
      return;
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      throw new Error('이 기기에서는 공유를 지원하지 않아요.');
    }
    await Sharing.shareAsync(fileUri, { mimeType: 'image/png', dialogTitle: '가격표 공유' });
  };

  /** 원래 보이는 WebView가 저장/카톡 전송 버튼을 누르면 보내는 요청만 받는다 — 이 WebView
   * 자체는 전혀 건드리지 않고, 아래 캡처 전용 WebView를 새로 띄운다. */
  const handleMainMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type: string;
        kind?: 'save' | 'share';
        tagsList?: unknown[];
      };
      if (msg.type !== 'requestNativeCapture' || !msg.kind) return;
      hydratedRef.current = false;
      setCaptureRequest({ id: Date.now(), kind: msg.kind, tagsList: msg.tagsList ?? [] });
    } catch {
      // 이 WebView가 보낼 수 있는 다른 메시지 타입은 없음 — 무시
    }
  };

  /** 캡처 전용 WebView가 로딩을 마치면(onLoadEnd) 요청받은 태그 목록을 그대로 재현시킨다.
   * html2canvas(자체 CSS 레이아웃 재구현이라 실제 화면과 다르게 나오는 문제가 반복됐다 —
   * 폰트가 깨지거나 기본체로 나옴, flex 축소 계산이 달라 글자가 잘림)를 쓰지 않고,
   * react-native-view-shot으로 이 WebView가 실제로 그린 화면 그대로를 찍기 위해서다. */
  const handleCaptureLoadEnd = () => {
    if (!captureRequest || hydratedRef.current) return;
    hydratedRef.current = true;
    const tagsListJson = JSON.stringify(JSON.stringify(captureRequest.tagsList));
    captureWebViewRef.current?.injectJavaScript(
      `window.__hydrateForCapture && window.__hydrateForCapture(${tagsListJson}); true;`
    );
  };

  const handleCaptureMessage = async (event: WebViewMessageEvent) => {
    if (!captureRequest) return;
    let msg: { type: string; message?: string };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.type === 'hydrateError') {
      finishCapture(false, msg.message || '가격표를 불러오지 못했어요.');
      return;
    }
    if (msg.type !== 'hydratedReady') return;

    try {
      const uri = await captureRef(captureWrapperRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await deliverOutput(captureRequest.kind, uri);
      finishCapture(true);
    } catch (e) {
      finishCapture(false, e instanceof Error ? e.message : '캡처에 실패했습니다.');
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
            <Pressable
              onPress={() => router.back()}
              hitSlop={16}
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 30, color: '#1A1A1A' }}>‹</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1A1A1A' }}>가격표 만들기</Text>
          </View>
        </SafeAreaView>
        {/* 하단(제스처 내비게이션 바) 여백 확보 — 없으면 설정 화면 맨 아래 체크박스가
         * 내비게이션 바에 가려 탭할 수 없었다. */}
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
          <WebView
            ref={mainWebViewRef}
            source={{ html: PRICE_TAG_MAKER_HTML, baseUrl: BASE_URL }}
            style={{ flex: 1 }}
            originWhitelist={originWhitelist}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            onMessage={handleMainMessage}
          />
        </SafeAreaView>
      </Modal>

      {captureRequest ? (
        // 화면엔 안 보이지만(opacity:0) 실제로는 렌더링되는 캡처 전용 WebView.
        // collapsable={false}: 안드로이드가 배경/스타일이 단순한 View를 최적화 과정에서
        // 통째로 생략해버리면(view flattening) view-shot이 찍을 실제 네이티브 뷰가 없어져
        // 캡처가 실패한다 — 그걸 막는다.
        // key={captureRequest.id}: 요청마다 완전히 새로 마운트해 고정 크기로만 만들고,
        // 기존 WebView를 리사이즈하는 일이 없게 한다(안드로이드 일부 기기에서 리사이즈가
        // 내부 렌더링 서피스에 반영되지 않아 잘리거나 확대된 채 캡처되는 문제가 있었다).
        <View
          ref={captureWrapperRef}
          collapsable={false}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, opacity: 0 }}
        >
          <WebView
            key={captureRequest.id}
            ref={captureWebViewRef}
            source={{ html: PRICE_TAG_MAKER_HTML, baseUrl: BASE_URL }}
            style={{ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT }}
            originWhitelist={originWhitelist}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            onLoadEnd={handleCaptureLoadEnd}
            onMessage={handleCaptureMessage}
          />
        </View>
      ) : null}
    </View>
  );
}
