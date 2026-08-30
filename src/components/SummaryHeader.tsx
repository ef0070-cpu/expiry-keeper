import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { daysUntil } from '@/lib/dates';
import { Product } from '@/lib/types';

function SummaryHeader({ products }: { products: Product[] }) {
  // 두 번 filter()하며 daysUntil을 상품마다 최대 2번 호출하던 것을 단일 reduce로 합침
  const { expired, urgent } = useMemo(() => {
    return products.reduce(
      (acc, p) => {
        const d = daysUntil(p.expiryDate);
        if (d < 0) acc.expired++;
        else if (d <= 3) acc.urgent++;
        return acc;
      },
      { expired: 0, urgent: 0 },
    );
  }, [products]);

  return (
    <View className="mx-4 mb-3 mt-2 flex-row gap-2">
      <Stat label="만료" value={expired} color="text-primary" />
      <Stat label="3일 이내" value={urgent} color="text-warn" />
      <Stat label="전체" value={products.length} color="text-ink" />
    </View>
  );
}

export default memo(SummaryHeader);

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 items-center rounded-xl border border-line bg-paper py-3">
      <Text className={`${color} text-xl font-bold`}>{value}</Text>
      <Text className="text-muted mt-0.5 text-xs">{label}</Text>
    </View>
  );
}
