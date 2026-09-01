import { Text, View } from 'react-native';
import { ddayLabel, signalOf, SIGNAL_BG } from '@/lib/dates';

export default function DdayBadge({ days }: { days: number }) {
  const bg = SIGNAL_BG[signalOf(days)];

  return (
    <View className={`${bg} rounded-md px-2.5 py-1`}>
      <Text className="text-paper text-xs font-bold">{ddayLabel(days)}</Text>
    </View>
  );
}
