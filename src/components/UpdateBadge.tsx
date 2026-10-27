import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import type { CatalogUpdateBadge } from '@/lib/order-repo';

export const UPDATE_BADGE_META: Record<CatalogUpdateBadge, { label: string; color: string }> = {
  new: { label: '신규', color: '#2962FF' },
  updated: { label: '수정', color: '#F9A825' },
};

/** 신규=맥박(커졌다 작아지고 테두리 링이 퍼짐), 수정=빛 훑기(흰 띠가 왼쪽→오른쪽). 움직임 줄이기가 켜져 있으면 정적. */
export default function UpdateBadge({ kind, animate }: { kind: CatalogUpdateBadge; animate: boolean }) {
  const meta = UPDATE_BADGE_META[kind];
  const [reduceMotion, setReduceMotion] = useState(false);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const running = animate && !reduceMotion;
  useEffect(() => {
    t.setValue(0);
    if (!running) return;
    const nat = { useNativeDriver: true } as const;
    const loop =
      kind === 'new'
        ? Animated.loop(Animated.timing(t, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), ...nat }))
        : Animated.loop(
            Animated.sequence([
              Animated.timing(t, { toValue: 1, duration: 600, easing: Easing.linear, ...nat }),
              Animated.delay(1000),
              Animated.timing(t, { toValue: 0, duration: 0, ...nat }),
            ]),
          );
    loop.start();
    return () => {
      loop.stop();
      t.setValue(0);
    };
  }, [running, kind, t]);

  const label = (
    <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
      {meta.label}
    </Text>
  );
  const a11y = { accessible: true, accessibilityLabel: kind === 'new' ? '신규 상품' : '수정된 상품' } as const;

  if (kind === 'new') {
    const pulse = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.14, 1] });
    return (
      <View {...a11y}>
        {running ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: meta.color,
              opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
              transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
            }}
          />
        ) : null}
        <Animated.View
          className="rounded px-1.5 py-0.5"
          style={{ backgroundColor: meta.color, transform: [{ scale: running ? pulse : 1 }] }}
        >
          {label}
        </Animated.View>
      </View>
    );
  }

  return (
    <View {...a11y} className="overflow-hidden rounded px-1.5 py-0.5" style={{ backgroundColor: meta.color }}>
      {label}
      {running ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -4,
            bottom: -4,
            left: 0,
            width: 10,
            backgroundColor: 'rgba(255,255,255,0.55)',
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-14, 44] }) },
              { rotate: '20deg' },
            ],
          }}
        />
      ) : null}
    </View>
  );
}
