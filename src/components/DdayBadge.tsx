import { Text, View } from 'react-native';
import { ddayLabel, signalOf, SIGNAL_BG } from '@/lib/dates';

export default function DdayBadge({ days }: { days: number }) {
  const bg = SIGNAL_BG[signalOf(days)];

  return (
    <View className={`${bg} self-start rounded-md px-1 py-1`} style={{ flexShrink: 0 }}>
      <Text className="text-paper text-xs font-bold" numberOfLines={1}>
        {ddayLabel(days)}
      </Text>
    </View>
  );
}
