import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RefObject, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

export type CoachStep = {
  key: string;
  target: RefObject<View | null>;
  title: string;
  body: string;
  /** true면 [다음] 버튼으로 넘어간다(설명만 하는 단계). false면 강조한 버튼을 실제로 써야 넘어간다 */
  ack: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 6;
const DIM = 'rgba(0,0,0,0.62)';

/**
 * 따라하기 안내(2026-10-22): 화면을 어둡게 덮고 눌러야 할 버튼 하나만 뚫어 보여 준다.
 * 강조 영역 둘레 네 면만 덮으므로 뚫린 곳의 실제 버튼은 그대로 눌린다(그 밖은 눌리지 않음).
 * 대상 위치는 화면이 스크롤·변경돼도 따라가게 주기적으로 다시 잰다.
 */
export default function CoachMarks({
  step,
  index,
  total,
  onNext,
  onSkip,
}: {
  step: CoachStep | null;
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const rootRef = useRef<View>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const { height: winH, width: winW } = useWindowDimensions();

  useEffect(() => {
    setRect(null);
    if (!step) return;
    let alive = true;
    const measure = () =>
      rootRef.current?.measureInWindow((rx, ry) => {
        step.target.current?.measureInWindow((x, y, w, h) => {
          if (!alive) return;
          if (!w || !h) return setRect(null); // 아직 화면에 없음
          setRect((prev) => {
            const next = { x: x - rx, y: y - ry, w, h };
            return prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 && prev.w === next.w && prev.h === next.h ? prev : next;
          });
        });
      });
    measure();
    const t = setInterval(measure, 400);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [step]);

  // 대상을 재기 전에도 루트는 그려 둔다(루트를 재야 위치를 계산할 수 있다)
  if (!step) return null;
  if (!rect) return <View ref={rootRef} pointerEvents="none" collapsable={false} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />;

  const hx = rect.x - PAD;
  const hy = rect.y - PAD;
  const hw = rect.w + PAD * 2;
  const hh = rect.h + PAD * 2;
  // 대상이 화면 위쪽이면 말풍선을 아래에, 아래쪽이면 위에
  const below = rect.y + rect.h / 2 < winH * 0.5;
  const arrowLeft = Math.min(Math.max(rect.x + rect.w / 2 - 12, 28), winW - 52);

  return (
    <View
      ref={rootRef}
      collapsable={false}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100 }}
    >
      {/* 강조 영역 둘레 네 면 — 이 안을 누르면 아무 일도 없다 */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, hy), backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: hy + hh, bottom: 0, backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: 0, width: Math.max(0, hx), top: hy, height: hh, backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: hx + hw, right: 0, top: hy, height: hh, backgroundColor: DIM }} />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: hx - 2, top: hy - 2, width: hw + 4, height: hh + 4, borderRadius: 16, borderWidth: 3, borderColor: '#FFD43B' }}
      />
      {!step.ack ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: rect.x + rect.w / 2 - 8, top: rect.y + rect.h / 2 - 4 }}>
          <MaterialCommunityIcons name="gesture-tap" size={34} color="#FFFFFF" />
        </View>
      ) : null}

      <View style={{ position: 'absolute', left: 16, right: 16, ...(below ? { top: hy + hh + 16 } : { bottom: winH - hy + 16 }) }}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: arrowLeft - 16,
            ...(below ? { top: -12 } : { bottom: -12 }),
            width: 0,
            height: 0,
            borderLeftWidth: 12,
            borderRightWidth: 12,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            ...(below ? { borderBottomWidth: 13, borderBottomColor: '#FFFFFF' } : { borderTopWidth: 13, borderTopColor: '#FFFFFF' }),
          }}
        />
        <View className="rounded-2xl bg-paper px-4 py-3.5" style={{ elevation: 8 }} accessibilityLiveRegion="polite">
          <Text style={{ color: '#CC2222', fontSize: 12, fontWeight: 'bold' }}>
            {index + 1} / {total}
          </Text>
          <Text className="text-ink mt-0.5" style={{ fontSize: 17, fontWeight: 'bold' }}>
            {step.title}
          </Text>
          <Text className="text-muted mt-1 text-sm">{step.body}</Text>
          <View className="mt-3 flex-row items-center justify-between">
            <View className="flex-row" style={{ gap: 5 }}>
              {Array.from({ length: total }, (_, i) => (
                <View key={i} style={{ width: i === index ? 18 : 7, height: 7, borderRadius: 4, backgroundColor: i === index ? '#CC2222' : '#DDDDDD' }} />
              ))}
            </View>
            <View className="flex-row items-center" style={{ gap: 14 }}>
              <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel="안내 건너뛰기">
                <Text className="text-muted text-sm font-bold">건너뛰기</Text>
              </Pressable>
              {step.ack ? (
                <Pressable onPress={onNext} className="bg-primary rounded-full px-4 py-2 active:opacity-80" accessibilityRole="button" accessibilityLabel="다음">
                  <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>{index + 1 === total ? '알겠어요' : '다음'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
