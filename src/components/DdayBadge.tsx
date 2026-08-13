import { Text, View } from 'react-native';
import { ddayLabel } from '@/lib/dates';

export default function DdayBadge({ days }: { days: number }) {
  let bg = 'bg-ok';
  if (days < 0) bg = 'bg-ink';
  else if (days <= 1) bg = 'bg-primary';
  else if (days <= 7) bg = 'bg-warn';

  return (
    <View className={`${bg} rounded-md px-2.5 py-1`}>
      <Text className="text-paper text-xs font-bold">{ddayLabel(days)}</Text>
    </View>
  );
}
