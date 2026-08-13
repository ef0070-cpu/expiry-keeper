import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, Pressable, View } from 'react-native';
import { AppMode, setAppMode } from '@/lib/settings';

export default function ModeSelect() {
  return (
    <View className="flex-1 justify-center bg-bg px-6">
      <Text className="text-ink text-2xl font-bold">어떤 용도로 사용하시나요?</Text>
      <Text className="text-muted mt-2 text-sm">설정에서 언제든지 바꿀 수 있어요.</Text>

      <ModeCard
        mode="home"
        icon="home-variant-outline"
        title="가정용"
        description={'집 냉장고·식재료 유통기한 관리\n임박 재료로 만들 수 있는 레시피 추천'}
      />
      <ModeCard
        mode="retail"
        icon="storefront-outline"
        title="소매점용"
        description={'매장 상품 유통기한 관리\n소진·폐기 기록과 폐기율 통계'}
      />
    </View>
  );
}

function ModeCard({
  mode,
  icon,
  title,
  description,
}: {
  mode: AppMode;
  icon: 'home-variant-outline' | 'storefront-outline';
  title: string;
  description: string;
}) {
  return (
    <Pressable
      onPress={() => setAppMode(mode)}
      className="mt-4 flex-row items-center rounded-2xl border border-line bg-paper p-5 active:opacity-70"
    >
      <View className="h-14 w-14 items-center justify-center rounded-xl bg-bg">
        <MaterialCommunityIcons name={icon} size={30} color="#CC2222" />
      </View>
      <View className="ml-4 flex-1">
        <Text className="text-ink text-lg font-bold">{title}</Text>
        <Text className="text-muted mt-1 text-sm leading-5">{description}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={24} color="#BBBBBB" />
    </Pressable>
  );
}
