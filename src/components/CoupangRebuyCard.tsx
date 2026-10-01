import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Thumbnail from '@/components/Thumbnail';
import { searchProductImageCandidates } from '@/lib/barcode-lookup';
import { COUPANG_DISCLOSURE, openCoupangSearch } from '@/lib/coupang';

// 상품명 → 웹 검색 첫 사진. 화면을 열 때마다 서버를 다시 부르지 않게 앱 실행 동안 기억한다.
const webImageCache = new Map<string, string | null>();

/**
 * 쿠팡 다시 사기 카드: 내 상품 사진 + 아래에서 떠오르며 등장 + 장바구니 아이콘이 몇 초마다 살짝 흔들림.
 * 실제 쿠팡 상품(사진·가격)은 파트너스 API 승인 후에만 보여 줄 수 있다 — 쿠팡 페이지를 긁어 오면 약관 위반.
 * 기기에서 '동작 줄이기'를 켠 사용자에겐 흔들림을 끈다.
 */
export default function CoupangRebuyCard({
  name,
  imageUri,
  onOpened,
}: {
  name: string;
  imageUri: string | null;
  onOpened?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const tilt = useSharedValue(0);
  // 내 사진이 없으면(두부처럼 사진 없이 등록) 웹 검색 첫 사진으로 대신 보여 준다
  const [webImage, setWebImage] = useState<string | null>(() => webImageCache.get(name.trim()) ?? null);

  useEffect(() => {
    const key = name.trim();
    if (imageUri || !key || webImageCache.has(key)) return;
    let cancelled = false;
    searchProductImageCandidates(key)
      .then((urls) => {
        webImageCache.set(key, urls[0] ?? null);
        if (!cancelled) setWebImage(urls[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imageUri, name]);

  useEffect(() => {
    if (reduceMotion) return;
    // 3초 쉬고 → 좌우로 짧게 4번 흔들기, 반복
    tilt.value = withRepeat(
      withDelay(
        3000,
        withSequence(
          withTiming(-14, { duration: 80 }),
          withTiming(14, { duration: 80 }),
          withTiming(-10, { duration: 80 }),
          withTiming(10, { duration: 80 }),
          withTiming(0, { duration: 80 }),
        ),
      ),
      -1,
    );
  }, [reduceMotion, tilt]);

  const cartStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(400).springify()}>
      <Pressable
        onPress={() => {
          openCoupangSearch(name);
          onOpened?.();
        }}
        className="flex-row items-center rounded-2xl border bg-paper p-3 active:opacity-80"
        style={{ borderColor: '#F0C4C4' }}
        accessibilityRole="link"
        accessibilityLabel={`쿠팡에서 ${name.trim()} 다시 사기`}
      >
        <Thumbnail uri={imageUri ?? webImage} size={56} radius={12} />
        <View className="ml-3 flex-1">
          <Text className="text-ink text-base font-bold" numberOfLines={1}>
            {name.trim()}
          </Text>
          <Text className="text-muted mt-0.5 text-xs">쿠팡에서 바로 찾아보기</Text>
        </View>
        <View className="flex-row items-center rounded-full bg-primary px-3 py-2">
          <Animated.View style={cartStyle}>
            <MaterialCommunityIcons name="cart-outline" size={18} color="#FFFFFF" />
          </Animated.View>
          <Text className="text-paper ml-1 text-sm font-bold">다시 사기</Text>
        </View>
      </Pressable>
      <Text className="text-muted mt-1.5 text-center text-[11px]">{COUPANG_DISCLOSURE}</Text>
    </Animated.View>
  );
}
