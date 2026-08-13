import { Text, View } from 'react-native';
import { daysUntil } from '@/lib/dates';
import { Product } from '@/lib/types';

export default function SummaryHeader({ products }: { products: Product[] }) {
  const expired = products.filter((p) => daysUntil(p.expiryDate) < 0).length;
  const urgent = products.filter((p) => {
    const d = daysUntil(p.expiryDate);
    return d >= 0 && d <= 3;
  }).length;

  return (
    <View className="mx-4 mb-3 mt-2 flex-row gap-2">
      <Stat label="만료" value={expired} color="text-primary" />
      <Stat label="3일 이내" value={urgent} color="text-warn" />
      <Stat label="전체" value={products.length} color="text-ink" />
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 items-center rounded-xl border border-line bg-paper py-3">
      <Text className={`${color} text-xl font-bold`}>{value}</Text>
      <Text className="text-muted mt-0.5 text-xs">{label}</Text>
    </View>
  );
}
