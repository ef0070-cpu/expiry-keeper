import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { daysUntil, ddayLabel } from '@/lib/dates';
import { RecipeMatch, matchRecipes, urgentProducts } from '@/lib/recipes';
import { listProducts } from '@/lib/repo';
import { Product } from '@/lib/types';

function openVideoSearch(query: string) {
  router.push({ pathname: '/recipe-video', params: { query } });
}

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
  const unmatched = useMemo(() => {
    const matchedIds = new Set(matches.flatMap((m) => m.matchedProducts.map((p) => p.id)));
    return urgent.filter((p) => !matchedIds.has(p.id));
  }, [urgent, matches]);

  return (
    <FlatList
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={matches}
      keyExtractor={(m) => m.recipe.name}
      ListFooterComponent={
        unmatched.length > 0 ? (
          <View className="mt-1">
            <Text className="text-muted mb-2 text-xs">
              고정 레시피는 없지만, 영상으로 바로 찾아볼 수 있어요
            </Text>
            {unmatched.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => openVideoSearch(`${p.name} 레시피`)}
                className="mb-2 flex-row items-center justify-between rounded-xl border border-line bg-paper p-4 active:opacity-70"
              >
                <Text className="text-ink text-sm font-bold">{p.name}</Text>
                <View className="flex-row items-center">
                  <MaterialCommunityIcons name="youtube" size={16} color="#CC2222" />
                  <Text className="text-primary ml-1 text-xs font-medium">영상으로 레시피 찾기</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null
      }
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
            <Text className="text-muted mt-4 text-base">고정 레시피는 없지만, 아래에서 영상으로 찾아보세요</Text>
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

      <Pressable
        onPress={() => openVideoSearch(`${recipe.name} 레시피`)}
        className="mt-3 flex-row items-center self-start active:opacity-70"
      >
        <MaterialCommunityIcons name="youtube" size={16} color="#CC2222" />
        <Text className="text-primary ml-1 text-xs font-medium">영상으로 레시피 보기</Text>
      </Pressable>
    </View>
  );
}
