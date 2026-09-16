import { Pressable, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  onPress: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  label?: string;
  accessibilityLabel?: string;
};

export default function Fab({ onPress, icon = 'barcode-scan', label, accessibilityLabel = '바코드 스캔' }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      className={`absolute right-6 h-16 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-80 ${label ? 'px-6' : 'w-16'}`}
      style={{ elevation: 6, bottom: Math.max(insets.bottom, 48) + 32 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <MaterialCommunityIcons name={icon} size={28} color="#FFFFFF" />
      {label ? <Text className="text-base font-bold text-white">{label}</Text> : null}
    </Pressable>
  );
}
