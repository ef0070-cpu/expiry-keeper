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
import CoupangSearchWidget from '@/components/CoupangSearchWidget';
import Thumbnail from '@/components/Thumbnail';
import { searchProductImageCandidates } from '@/lib/barcode-lookup';
import { COUPANG_DISCLOSURE, openCoupangSearch } from '@/lib/coupang';
import { daysUntil, ddayLabel } from '@/lib/dates';
import { getCachedProducts } from '@/lib/repo';

export interface RebuyItem {
  name: string;
  imageUri: string | null;
  expiryDate?: string;
}

// 상품명 → 웹 검색 첫 사진. 화면을 열 때마다 서버를 다시 부르지 않게 앱 실행 동안 기억한다.
const webImageCache = new Map<string, string | null>();

/** 가정용 보관 중 상품 중 유통기한 7일 이내(지난 것 포함)를 가까운 순으로 최대 5개. */
export function imminentRebuyItems(): RebuyItem[] {
  return getCachedProducts()
    .filter((p) => p.mode === 'home' && p.status === 'active' && daysUntil(p.expiryDate) <= 7)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    .slice(0, 5)
    .map((p) => ({ name: p.name, imageUri: p.imageUri, expiryDate: p.expiryDate }));
}

/**
 * 쿠팡 구매하기 카드: 임박 상품 이름이 검색창에 한 글자씩 입력되며 차례로 바뀌고(사진·D-day도 함께),
 * [구매하기]는 지금 보이는 상품을 쿠팡에서 검색한다. 아래에는 쿠팡 공식 검색 위젯(로고)을 그대로 붙인다.
 * 실제 쿠팡 상품(사진·가격)은 파트너스 API 승인 후에만 — 쿠팡 페이지를 긁어 오면 약관 위반.
 * '동작 줄이기'를 켠 사용자에겐 타이핑·흔들림을 끈다.
 */
export default function CoupangRebuyCard({
  items,
  onOpened,
}: {
  items: RebuyItem[];
  onOpened?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const tilt = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const item = items[index % Math.max(items.length, 1)];
  const name = item?.name.trim() ?? '';
  // 내 사진이 없으면(두부처럼 사진 없이 등록) 웹 검색 첫 사진으로 대신 보여 준다
  const [, setWebTick] = useState(0);

  useEffect(() => {
    if (!name || item?.imageUri || webImageCache.has(name)) return;
    searchProductImageCandidates(name)
      .then((urls) => {
        webImageCache.set(name, urls[0] ?? null);
        setWebTick((t) => t + 1);
      })
      .catch(() => {});
  }, [name, item?.imageUri]);

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

  if (!item) return null;
  const dday = item.expiryDate ? daysUntil(item.expiryDate) : null;

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(400).springify()}>
      <View className="rounded-2xl border bg-paper p-3" style={{ borderColor: '#F0C4C4' }}>
        <View className="flex-row items-center">
          <Thumbnail uri={item.imageUri ?? webImageCache.get(name) ?? null} size={56} radius={12} />
          <View className="ml-3 flex-1">
            <View className="flex-row items-center">
              <Text className="text-muted text-xs">유통기한 임박</Text>
              {dday !== null ? (
                <Text className="text-primary ml-1.5 text-xs font-bold">{ddayLabel(dday)}</Text>
              ) : null}
            </View>
            {/* 검색창처럼 보이는 칸에 상품명이 입력된다 */}
            <View className="mt-1 flex-row items-center rounded-lg bg-bg px-2 py-1.5">
              <MaterialCommunityIcons name="magnify" size={14} color="#888888" />
              <TypingText
                key={`${index}-${name}`}
                text={name}
                still={reduceMotion}
                onDone={() => items.length > 1 && setIndex((i) => i + 1)}
              />
            </View>
          </View>
          <Pressable
            onPress={() => {
              openCoupangSearch(name);
              onOpened?.();
            }}
            className="ml-2 flex-row items-center rounded-full bg-primary px-3 py-2 active:opacity-80"
            accessibilityRole="link"
            accessibilityLabel={`쿠팡에서 ${name} 구매하기`}
          >
            <Animated.View style={cartStyle}>
              <MaterialCommunityIcons name="cart-outline" size={18} color="#FFFFFF" />
            </Animated.View>
            <Text className="text-paper ml-1 text-sm font-bold">구매하기</Text>
          </Pressable>
        </View>
        <View className="mt-3">
          <CoupangSearchWidget />
        </View>
      </View>
      <Text className="text-muted mt-1.5 text-center text-[11px]">{COUPANG_DISCLOSURE}</Text>
    </Animated.View>
  );
}

/** 한 글자씩 입력하는 효과. 다 치면 2초 멈춘 뒤 onDone(다음 상품으로) — 상품이 하나면 처음부터 다시. */
function TypingText({ text, still, onDone }: { text: string; still: boolean; onDone: () => void }) {
  const [count, setCount] = useState(still ? text.length : 0);
  useEffect(() => {
    if (still) return;
    if (count >= text.length) {
      const t = setTimeout(() => {
        onDone();
        setCount(0);
      }, 2000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c + 1), 150);
    return () => clearTimeout(t);
  }, [count, text, still, onDone]);
  return (
    <Text className="text-ink ml-1 flex-1 text-sm" numberOfLines={1} accessibilityLabel={text}>
      {text.slice(0, count)}
      {still ? '' : '▍'}
    </Text>
  );
}
