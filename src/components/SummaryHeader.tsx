import { memo, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  daysUntil,
  signalOf,
  SIGNAL_BG,
  SIGNAL_ORDER,
  SIGNAL_TEXT,
  SIGNAL_TITLES,
  SignalKey,
} from '@/lib/dates';
import { Product } from '@/lib/types';

interface Props {
  products: Product[];
  activeSignal: SignalKey | null;
  onSelectSignal: (key: SignalKey | null) => void;
}

function SummaryHeader({ products, activeSignal, onSelectSignal }: Props) {
  // 검색어/카테고리/신호 필터와 무관하게 항상 전체 상품 기준으로 센다
  const counts = useMemo(() => {
    const c: Record<SignalKey, number> = { red: 0, yellow: 0, green: 0 };
    products.forEach((p) => {
      c[signalOf(daysUntil(p.expiryDate))]++;
    });
    return c;
  }, [products]);

  return (
    <View className="mx-4 mb-3 mt-2 flex-row gap-2">
      {SIGNAL_ORDER.map((key) => (
        <SignalStat
          key={key}
          signalKey={key}
          label={SIGNAL_TITLES[key]}
          value={counts[key]}
          active={activeSignal === key}
          onPress={() => onSelectSignal(activeSignal === key ? null : key)}
        />
      ))}
    </View>
  );
}

export default memo(SummaryHeader);

function SignalStat({
  signalKey,
  label,
  value,
  active,
  onPress,
}: {
  signalKey: SignalKey;
  label: string;
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${active ? '필터 해제' : '필터'}`}
      className={`flex-1 items-center rounded-xl border py-3 ${
        active ? `${SIGNAL_BG[signalKey]} border-transparent` : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-xl font-bold ${active ? 'text-paper' : SIGNAL_TEXT[signalKey]}`}>
        {value}
      </Text>
      <Text className={`mt-0.5 text-xs ${active ? 'text-paper' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}
