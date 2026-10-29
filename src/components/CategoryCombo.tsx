import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

/**
 * 카테고리 콤보박스(2026-10-28) — 칩 줄 대신 한 칸을 눌러 목록에서 고른다. 칸에는 고른 카테고리와 상품 개수를 보여 준다.
 * onAdd·onToggleEdit을 주면 목록 맨 아래에 "+ 카테고리"·"편집" 버튼을 둔다(검색발주 화면의 카테고리 관리).
 * editMode이고 onPickForEdit이 있으면 항목을 눌렀을 때 고르는 대신 이름 고치기·삭제 흐름으로 넘긴다.
 * editMode이고 onMove가 있으면 항목마다 ▲▼ 버튼으로 순서를 바꿀 수 있다(목록은 열린 채 그대로).
 */
export default function CategoryCombo({
  value,
  categories,
  counts,
  total,
  onChange,
  editMode = false,
  onPickForEdit,
  onAdd,
  onToggleEdit,
  onMove,
}: {
  value: string;
  categories: string[];
  counts: Record<string, number>;
  total: number;
  onChange: (category: string) => void;
  editMode?: boolean;
  onPickForEdit?: (category: string) => void;
  onAdd?: () => void;
  onToggleEdit?: () => void;
  /** 편집 모드에서 항목 오른쪽에 ▲▼를 두고, 누르면 그 카테고리를 한 칸 위(-1)·아래(1)로 옮긴다 */
  onMove?: (category: string, delta: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = value === '전체' ? total : counts[value] ?? 0;

  const pick = (c: string) => {
    setOpen(false);
    if (editMode && onPickForEdit && c !== '전체') onPickForEdit(c);
    else onChange(c);
  };

  const row = (c: string, n: number) => {
    const on = !editMode && value === c;
    return (
      <Pressable
        key={c}
        onPress={() => pick(c)}
        className={`flex-row items-center rounded-xl px-3 py-3 active:bg-bg ${on ? 'bg-primary/10' : ''}`}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${c} ${n}개`}
      >
        <Text className={`flex-1 text-base ${on ? 'text-primary font-bold' : 'text-ink'}`}>
          {editMode && c !== '전체' ? `✎ ${c}` : c}
        </Text>
        <Text className="text-muted mr-2 text-sm">{n}개</Text>
        {on ? <MaterialCommunityIcons name="check" size={18} color="#CC2222" /> : null}
        {editMode && onMove && c !== '전체' ? (
          <View className="flex-row" style={{ gap: 6 }}>
            {([-1, 1] as const).map((d) => {
              const i = categories.indexOf(c);
              const disabled = d === -1 ? i <= 0 : i >= categories.length - 1;
              return (
                <Pressable
                  key={d}
                  onPress={() => onMove(c, d)}
                  disabled={disabled}
                  hitSlop={4}
                  className="h-10 w-10 items-center justify-center rounded-lg border border-line active:bg-bg"
                  style={{ opacity: disabled ? 0.3 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={`${c} ${d === -1 ? '위로' : '아래로'} 옮기기`}
                >
                  <MaterialCommunityIcons name={d === -1 ? 'chevron-up' : 'chevron-down'} size={26} color="#1A1A1A" />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="h-11 flex-row items-center rounded-xl border border-line bg-paper px-3 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel={`카테고리 선택, 지금 ${value} ${count}개`}
      >
        <Text className="text-muted text-xs">카테고리</Text>
        <Text className="text-ink ml-1.5 flex-1 text-sm font-bold" numberOfLines={1}>
          {value} ({count})
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color="#888888" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-center bg-ink/40 px-4" onPress={() => setOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation()} className="rounded-2xl bg-paper p-1.5" style={{ maxHeight: '75%' }}>
            {editMode ? (
              <View className="mx-1 mb-1 rounded-xl px-3 py-2" style={{ backgroundColor: '#FFF4D6' }}>
                <Text style={{ color: '#8A5A00', fontSize: 13, fontWeight: 'bold' }}>
                  ▲▼ 버튼으로 순서를 바꿔요. 이름을 고치거나 지우려면 카테고리 이름을 누르세요. 다 끝나면 '편집 끝'을 누르세요.
                </Text>
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {row('전체', total)}
              {categories.map((c) => row(c, counts[c] ?? 0))}
            </ScrollView>
            {onAdd || onToggleEdit ? (
              <View className="mt-1 flex-row border-t border-line p-2" style={{ gap: 8 }}>
                {onAdd ? (
                  <Pressable
                    onPress={() => {
                      setOpen(false);
                      onAdd();
                    }}
                    className="flex-1 items-center rounded-xl border border-line py-2.5 active:opacity-70"
                    accessibilityRole="button"
                  >
                    <Text className="text-ink text-sm font-medium">+ 카테고리</Text>
                  </Pressable>
                ) : null}
                {onToggleEdit ? (
                  <Pressable
                    onPress={onToggleEdit}
                    className="flex-1 items-center rounded-xl border border-line py-2.5 active:opacity-70"
                    accessibilityRole="button"
                  >
                    <Text className="text-ink text-sm font-medium">{editMode ? '편집 끝' : '편집'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
