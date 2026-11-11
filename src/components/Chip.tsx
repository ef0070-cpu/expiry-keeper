import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, Text } from 'react-native';

export default function Chip({
  label,
  active,
  onPress,
  onLongPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** 글자 앞에 붙이는 작은 아이콘(선택) — 홈 구역 칩의 '여러 개'·✓ 표시용 */
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      // 화면 읽기 기능이 어떤 분류가 선택됐는지 알 수 있게 — 색으로만 구분하던 상태를 전달
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? '추가' : label}
      accessibilityState={{ selected: active }}
      className={`self-start justify-center rounded-full border px-3.5 py-1.5 ${icon ? 'flex-row items-center gap-1' : ''} ${
        active ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={14} color={active ? '#FFFFFF' : '#888888'} /> : null}
      <Text className={`text-sm font-medium ${active ? 'text-paper' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
