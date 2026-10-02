import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import LICENSES from '@/lib/oss-licenses.json';

// 오픈소스 라이선스 고지(설정 > 오픈소스 라이선스). 목록은 scripts/gen-licenses.mjs로 만든다.
type Item = { name: string; version: string; license: string; text: string | null };

export default function Licenses() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <FlatList
      className="flex-1 bg-bg"
      contentContainerClassName="p-4 pb-12"
      data={LICENSES as Item[]}
      keyExtractor={(i) => i.name}
      ListHeaderComponent={
        <Text className="text-muted mb-3 text-xs">이 앱은 아래 공개 소프트웨어를 사용합니다. 항목을 누르면 라이선스 원문을 볼 수 있어요.</Text>
      }
      ItemSeparatorComponent={() => <View className="h-px bg-line" />}
      renderItem={({ item }) => (
        <Pressable className="bg-paper px-4 py-3" onPress={() => setOpen(open === item.name ? null : item.name)}>
          <Text className="text-ink text-sm font-medium">
            {item.name} <Text className="text-muted text-xs">{item.version}</Text>
          </Text>
          <Text className="text-muted text-xs">{item.license}</Text>
          {open === item.name && item.text ? <Text className="text-ink mt-2 text-xs leading-5">{item.text}</Text> : null}
        </Pressable>
      )}
    />
  );
}
