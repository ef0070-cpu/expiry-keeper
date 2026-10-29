import { memo, useEffect, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import VoiceMicButton, { FLOAT_SIZE } from '@/components/VoiceMicButton';

const SIZE = FLOAT_SIZE;
const DEFAULT_X_RATIO = 0.74; // 기본 위치(가로): 남는 폭의 74% 지점
const DEFAULT_Y_RATIO = 0.74; // 기본 위치(세로): 남는 높이의 74% 지점
const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 화면에 띄우는 누르고 말하기 마이크 버튼(2026-10-29). 기본 위치는 발주 화면의 가로 74%·세로 74% 지점(사장님이 정한 자리).
 * 누른 채로 손가락을 끌면(가만히 누르고 있으면 말하기) 그 자리로 옮겨지고, 놓으면 onPosChange로 위치를 넘긴다. 옮기는 순간 듣기는 취소된다.
 * pos가 없으면 기본 위치. 화면 크기가 달라도 비슷한 곳에 오도록 비율로 잡는다.
 */
const FloatingMic = memo(function FloatingMic({
  onHeard,
  pos,
  onPosChange,
}: {
  onHeard: (text: string) => void;
  pos: { x: number; y: number } | null;
  onPosChange: (x: number, y: number) => void;
}) {
  const [moving, setMoving] = useState(false);
  // 좌표는 화면 전체가 아니라 이 버튼이 올라앉는 발주 화면 영역 기준이다(위쪽 제목 줄만큼 어긋나지 않게 직접 잰다)
  const win = useWindowDimensions();
  const [area, setArea] = useState({ w: win.width, h: win.height });
  const width = area.w;
  const height = area.h;
  const insets = useSafeAreaInsets();
  const minX = MARGIN;
  const maxX = width - SIZE - MARGIN;
  const minY = MARGIN;
  const maxY = height - SIZE - MARGIN;
  const defX = clamp((width - SIZE) * DEFAULT_X_RATIO, minX, maxX);
  const defY = clamp((height - SIZE) * DEFAULT_Y_RATIO, minY, maxY);
  const x = pos ? clamp(pos.x, minX, maxX) : defX;
  const y = pos ? clamp(pos.y, minY, maxY) : defY;

  const tx = useSharedValue(x);
  const ty = useSharedValue(y);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  useEffect(() => {
    tx.value = x;
    ty.value = y;
  }, [x, y, tx, ty]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .activeOffsetY([-12, 12])
        .onStart(() => {
          'worklet';
          sx.value = tx.value;
          sy.value = ty.value;
          scheduleOnRN(setMoving, true);
        })
        .onUpdate((e) => {
          'worklet';
          tx.value = Math.min(maxX, Math.max(minX, sx.value + e.translationX));
          ty.value = Math.min(maxY, Math.max(minY, sy.value + e.translationY));
        })
        .onFinalize(() => {
          'worklet';
          scheduleOnRN(setMoving, false);
        })
        .onEnd(() => {
          'worklet';
          scheduleOnRN(onPosChange, tx.value, ty.value);
        }),
    [maxX, maxY, minX, minY, onPosChange, sx, sy, tx, ty],
  );

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }] }));

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, zIndex: 30 }, style]}>
          <VoiceMicButton onHeard={onHeard} variant="floating" disabled={moving} bubbleAlign={x < width / 2 ? 'left' : 'right'} />
          {moving ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -4,
                left: -4,
                width: SIZE + 8,
                height: SIZE + 8,
                borderRadius: (SIZE + 8) / 2,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#1A1A1A',
              }}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

export default FloatingMic;
