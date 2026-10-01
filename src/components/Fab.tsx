import { Pressable, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  onPress: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  label?: string;
  accessibilityLabel?: string;
  /** 아래에 배너가 붙어 있으면 그 위로 띄울 거리(안내바 여백은 배너가 맡는다) */
  bottom?: number;
};

export default function Fab({ onPress, icon = 'barcode-scan', label, accessibilityLabel = '바코드 스캔', bottom }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      className={`absolute right-6 h-16 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-80 ${label ? 'px-6' : 'w-16'}`}
      style={{ elevation: 6, bottom: bottom ?? Math.max(insets.bottom, 48) + 32 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <MaterialCommunityIcons name={icon} size={28} color="#FFFFFF" />
      {label ? <Text className="text-base font-bold text-white">{label}</Text> : null}
    </Pressable>
  );
}
