import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { daysUntil, ddayLabel } from '@/lib/dates';
import { RecipeMatch, matchRecipes, urgentProducts } from '@/lib/recipes';
import { listProducts } from '@/lib/repo';
import { Product } from '@/lib/types';

export default function Recipes() {
  const [products, setProducts] = useState<Product[]>([]);

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts('active'));
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const urgent = useMemo(() => urgentProducts(products), [products]);
  const matches = useMemo(() => matchRecipes(urgent), [urgent]);

  return (
    <FlatList
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={matches}
      keyExtractor={(m) => m.recipe.name}
      ListHeaderComponent={
        urgent.length > 0 ? (
          <View className="mb-4 rounded-xl border border-line bg-paper p-4">
            <Text className="text-ink text-sm font-bold">
              7일 이내 소진해야 할 재료 {urgent.length}개
            </Text>
            <View className="mt-2.5 flex-row flex-wrap gap-2">
              {urgent.map((p) => (
                <View
                  key={p.id}
                  className="flex-row items-center rounded-full border border-line bg-bg px-3 py-1.5"
                >
                  <Text className="text-ink text-sm">{p.name}</Text>
                  <Text className="text-primary ml-1.5 text-xs font-bold">
                    {ddayLabel(daysUntil(p.expiryDate))}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null
      }
      renderItem={({ item }) => <RecipeCard match={item} />}
      ListEmptyComponent={
        <View className="mt-20 items-center">
          <MaterialCommunityIcons name="chef-hat" size={48} color="#CCCCCC" />
          {urgent.length === 0 ? (
            <>
              <Text className="text-muted mt-4 text-base">임박한 재료가 없어요</Text>
              <Text className="text-muted mt-1 px-8 text-center text-sm">
                유통기한이 7일 이내로 남은 재료가 생기면 만들 수 있는 요리를 추천해 드려요
              </Text>
            </>
          ) : (
            <>
              <Text className="text-muted mt-4 text-base">추천할 레시피를 찾지 못했어요</Text>
              <Text className="text-muted mt-1 px-8 text-center text-sm">
                상품명에 재료 이름(예: 우유, 계란, 두부)이 들어 있으면 더 잘 찾을 수 있어요
              </Text>
            </>
          )}
        </View>
      }
    />
  );
}

function RecipeCard({ match }: { match: RecipeMatch }) {
  const { recipe, matchedProducts } = match;
  return (
    <View className="mb-3 rounded-xl border border-line bg-paper p-4">
      <View className="flex-row items-center">
        <MaterialCommunityIcons name="silverware-fork-knife" size={18} color="#CC2222" />
        <Text className="text-ink ml-2 flex-1 text-base font-bold">{recipe.name}</Text>
        <View className="rounded bg-primary px-1.5 py-0.5">
          <Text className="text-paper text-xs font-bold">임박 재료 {matchedProducts.length}</Text>
        </View>
      </View>

      <Text className="text-muted mt-2 text-xs">
        내 재료:{' '}
        <Text className="text-primary font-medium">
          {matchedProducts.map((p) => p.name).join(', ')}
        </Text>
      </Text>
      <Text className="text-muted mt-1 text-xs">재료: {recipe.ingredients}</Text>
      <Text className="text-ink mt-2 text-sm leading-5">{recipe.tip}</Text>
    </View>
  );
}
