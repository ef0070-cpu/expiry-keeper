import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Fab({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      className="absolute right-6 h-16 w-16 items-center justify-center rounded-full bg-primary active:opacity-80"
      style={{ elevation: 6, bottom: Math.max(insets.bottom, 48) + 32 }}
      accessibilityRole="button"
      accessibilityLabel="바코드 스캔"
    >
      <MaterialCommunityIcons name="barcode-scan" size={28} color="#FFFFFF" />
    </Pressable>
  );
}
