import { Pressable, Text } from 'react-native';

export default function Chip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`self-start justify-center rounded-full border px-3.5 py-1.5 ${
        active ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-paper' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
