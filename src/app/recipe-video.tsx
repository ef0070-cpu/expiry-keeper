import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';

/** 검색어로 유튜브 검색 결과를 앱 안에서 그대로 보여준다 (외부 앱/브라우저로 안 나감). */
export default function RecipeVideo() {
  const { query } = useLocalSearchParams<{ query: string }>();
  const url = `https://m.youtube.com/results?search_query=${encodeURIComponent(query ?? '레시피')}`;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: query || '레시피 영상' }} />
      <WebView
        source={{ uri: url }}
        style={{ flex: 1 }}
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        startInLoadingState
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-bg">
            <ActivityIndicator size="large" color="#CC2222" />
          </View>
        )}
      />
    </View>
  );
}
