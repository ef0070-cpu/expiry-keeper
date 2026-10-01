import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import { daysUntil, ddayLabel } from '@/lib/dates';

// 쿠팡 파트너스 검색 위젯이 쓰는 공식 로고(img1a.coupangcdn.com/.../logo-coupang.png)를 앱에 담았다
const COUPANG_LOGO = require('../../assets/images/coupang-logo.png');

// 상품명 → 웹 검색 첫 사진. 화면을 열 때마다 서버를 다시 부르지 않게 앱 실행 동안 기억한다.
const webImageCache = new Map<string, string | null>();

/**
 * 상세 화면 전용 쿠팡 구매하기 카드: 위에 쿠팡 공식 로고, 검색칸에 이 상품명이 한 글자씩 입력되고,
 * [쿠팡에서 구매하기]는 이 상품을 쿠팡에서 검색한다. 내 사진이 없으면 웹 검색 첫 사진을 쓴다.
 * 실제 쿠팡 상품(사진·가격)은 파트너스 API 승인 후에만 — 쿠팡 페이지를 긁어 오면 약관 위반.
 * '동작 줄이기'를 켠 사용자에겐 타이핑·흔들림을 끈다.
 */
export default function CoupangRebuyCard({
  name,
  imageUri,
  expiryDate,
}: {
  name: string;
  imageUri: string | null;
  expiryDate?: string;
}) {
  const reduceMotion = useReducedMotion();
  const tilt = useSharedValue(0);
  const key = name.trim();
  const [webImage, setWebImage] = useState<string | null>(() => webImageCache.get(key) ?? null);

  useEffect(() => {
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
  }, [imageUri, key]);

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
  const dday = expiryDate ? daysUntil(expiryDate) : null;

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(400).springify()}>
      {/* 저장·삭제 버튼과 확실히 떨어뜨려 잘못 누르지 않게: 구분선 + 작은 제목 */}
      <View className="mb-3 flex-row items-center">
        <View className="h-px flex-1 bg-line" />
        <Text className="text-muted mx-3 text-xs">쿠팡에서 다시 구매</Text>
        <View className="h-px flex-1 bg-line" />
      </View>
      <View className="overflow-hidden rounded-2xl border border-line bg-paper">
        <View className="border-b border-line px-4 py-2.5">
          <CoupangAdHeader />
        </View>

        <View className="p-4">
          <View className="flex-row items-center">
            <Thumbnail uri={imageUri ?? webImage} size={56} radius={12} />
            <View className="ml-3 flex-1">
              <View className="flex-row items-center">
                <Text className="text-ink text-base font-bold" numberOfLines={1}>
                  {key}
                </Text>
                {dday !== null ? (
                  <Text className="text-primary ml-2 text-xs font-bold">{ddayLabel(dday)}</Text>
                ) : null}
              </View>
              {/* 검색칸처럼 보이는 줄에 상품명이 입력된다 */}
              <View className="mt-1.5 flex-row items-center rounded-lg border border-line bg-bg px-2 py-1.5">
                <MaterialCommunityIcons name="magnify" size={14} color="#888888" />
                <TypingText text={key} still={reduceMotion} />
              </View>
            </View>
          </View>

          {/* 빨간 꽉 찬 버튼은 앱의 주 동작(수정 저장)만 — 쿠팡은 테두리 버튼으로 구분 */}
          <Pressable
            onPress={() => openCoupangSearch(key)}
            className="mt-3 flex-row items-center justify-center rounded-xl border border-line bg-paper py-3 active:opacity-70"
            accessibilityRole="link"
            accessibilityLabel={`쿠팡에서 ${key} 구매하기`}
          >
            <Animated.View style={cartStyle}>
              <MaterialCommunityIcons name="cart-outline" size={18} color="#1A1A1A" />
            </Animated.View>
            <Text className="text-ink ml-1.5 text-base font-bold">쿠팡에서 구매하기</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#888888" style={{ marginLeft: 2 }} />
          </Pressable>
        </View>
      </View>
      <Text className="text-muted mt-1.5 text-center text-[11px]">{COUPANG_DISCLOSURE}</Text>
    </Animated.View>
  );
}

/** 쿠팡 영역 머리줄(공용): 왼쪽 공식 로고, 오른쪽 회색 "광고" 배지 — 광고임을 분명히 해 신뢰를 지킨다. */
export function CoupangAdHeader({ small, label }: { small?: boolean; label?: string }) {
  const w = small ? 52 : 75;
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center">
        <Image source={COUPANG_LOGO} style={{ width: w, height: w * 0.227 }} contentFit="contain" accessibilityLabel="쿠팡" />
        {label ? <Text className="text-ink ml-2 text-xs font-bold">{label}</Text> : null}
      </View>
      <View className="rounded bg-bg px-1.5 py-0.5">
        <Text className="text-muted text-[10px] font-medium">광고</Text>
      </View>
    </View>
  );
}

/** 한 글자씩 입력하는 효과: 다 치면 2초 멈췄다가 처음부터. still이면(동작 줄이기) 그냥 전체 표시. */
function TypingText({ text, still }: { text: string; still: boolean }) {
  const [count, setCount] = useState(still ? text.length : 0);
  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => setCount((c) => (c >= text.length ? 0 : c + 1)), count >= text.length ? 2000 : 150);
    return () => clearTimeout(t);
  }, [count, text, still]);
  return (
    <Text className="text-ink ml-1 flex-1 text-sm" numberOfLines={1} accessibilityLabel={text}>
      {still ? text : text.slice(0, count)}
      {still ? '' : '▍'}
    </Text>
  );
}
