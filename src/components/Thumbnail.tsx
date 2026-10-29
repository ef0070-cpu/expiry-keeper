import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

// 사진 불러오기가 한 번 실패하면(순간 네트워크 끊김 등) 화면을 새로 그리기 전까지 회색 칸으로 남았다
// (2026-10-21 빠른발주, 앱 재시작하니 정상). 잠시 뒤 다시 시도하고, 계속 실패하면 "사진 없음" 아이콘.
const RETRY_DELAYS_MS = [1500, 5000];

export default function Thumbnail({
  uri,
  size,
  radius = 8,
  iconSize,
  fallback,
}: {
  uri: string | null | undefined;
  size: number;
  radius?: number;
  iconSize?: number;
  /** 사진이 없거나 끝내 못 불러올 때 "사진 없음" 아이콘 대신 보여 줄 것(예: 글자 카드) */
  fallback?: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [uri]);

  const onError = () => {
    if (attempt >= RETRY_DELAYS_MS.length) return setFailed(true);
    retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt]);
  };

  if (!uri || failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <View
        className="items-center justify-center bg-bg"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <MaterialCommunityIcons
          name="image-off-outline"
          size={iconSize ?? size * 0.35}
          color="#BBBBBB"
        />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <Image
        key={attempt}
        source={{ uri }}
        onError={onError}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#F0F0F0' }}
        contentFit="cover"
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.1)',
        }}
      />
    </View>
  );
}
