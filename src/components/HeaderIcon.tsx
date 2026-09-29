import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

/** 헤더 오른쪽 아이콘 버튼 — 아이콘 아래에 이름을 함께 보여 준다(홈·발주 화면 공용). */
export default function HeaderIcon({
  icon,
  label,
  onPress,
  color = '#1A1A1A',
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="items-center"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={27} color={color} />
      <Text className="mt-0.5 text-[10px] leading-none" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}
