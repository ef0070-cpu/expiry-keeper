import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

/**
 * 카테고리 콤보박스(2026-10-28) — 칩 줄 대신 한 칸을 눌러 목록에서 고른다. 칸에는 고른 카테고리와 상품 개수를 보여 준다.
 * onAdd·onToggleEdit을 주면 목록 맨 아래에 "+ 카테고리"·"편집" 버튼을 둔다(검색발주 화면의 카테고리 관리).
 * editMode이고 onPickForEdit이 있으면 항목을 눌렀을 때 고르는 대신 이름 고치기·삭제 흐름으로 넘긴다.
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
                    onPress={() => {
                      setOpen(false);
                      onToggleEdit();
                    }}
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
