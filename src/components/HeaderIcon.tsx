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
      {/* 작아서 잘 안 보인다는 의견으로 키움(27→31, 10→11px). 제목 옆 폭이 빠듯해 글자는 폰 글자 크기를
          최대 1.3배까지만 따라가게 한다(더 크면 제목과 겹침) */}
      <MaterialCommunityIcons name={icon} size={31} color={color} />
      <Text className="mt-0.5 text-[11px] leading-none" style={{ color }} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}
