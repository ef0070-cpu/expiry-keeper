import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';

// 쿠팡 파트너스 공식 검색 위젯(로고 포함)을 그대로 띄운다. 로고·코드를 앱에서 바꾸면 파트너스
// 약관 위반이 될 수 있어 위젯 페이지는 손대지 않는다.
const WIDGET_URL = 'https://coupa.ng/cpRyII';
// 위젯 자체가 열리는 주소들 — 이 밖으로 나가는 이동(검색 결과)은 앱 밖에서 연다(실적 집계)
const WIDGET_HOSTS = ['coupa.ng', 'ads-partners.coupang.com', 'partners.coupangcdn.com'];

function isWidgetUrl(url: string): boolean {
  try {
    return WIDGET_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export default function CoupangSearchWidget() {
  return (
    <View style={{ height: 44 }} className="overflow-hidden rounded-xl">
      <WebView
        source={{ uri: WIDGET_URL }}
        scrollEnabled={false}
        setSupportMultipleWindows
        // 위젯은 검색 시 window.open으로 새 창을 연다
        onOpenWindow={(e) => Linking.openURL(e.nativeEvent.targetUrl).catch(() => {})}
        onShouldStartLoadWithRequest={(req) => {
          if (isWidgetUrl(req.url) || req.url === 'about:blank') return true;
          Linking.openURL(req.url).catch(() => {});
          return false;
        }}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
