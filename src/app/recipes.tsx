import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { daysUntil, ddayLabel } from '@/lib/dates';
import { RecipeMatch, matchRecipes, urgentProducts } from '@/lib/recipes';
import { listProducts } from '@/lib/repo';
import { CoupangAdHeader } from '@/components/CoupangRebuyCard';
import { COUPANG_DISCLOSURE, openCoupangSearch } from '@/lib/coupang';
import { RECIPE_SHOPPING, missingIngredients } from '@/lib/recipe-shopping';
import { useCoupangSuggestEnabled } from '@/lib/settings';
import { Product } from '@/lib/types';

function openVideoSearch(query: string) {
  router.push({ pathname: '/recipe-video', params: { query } });
}

export default function Recipes() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  // 부족 재료 계산은 임박 상품만이 아니라 보관 중인 상품 전부와 비교한다(냉장고에 양파가 있으면 빼야 하니까)
  const haveNames = useMemo(() => products.map((p) => p.name), [products]);
  const coupangSuggest = useCoupangSuggestEnabled();
  // 선택한 재료만 추천 대상으로. 선택이 없거나 목록에서 사라진 재료뿐이면 전체 임박 재료 사용.
  const picked = useMemo(() => urgent.filter((p) => selectedIds.has(p.id)), [urgent, selectedIds]);
  const target = picked.length > 0 ? picked : urgent;
  const matches = useMemo(() => matchRecipes(target), [target]);
  const unmatched = useMemo(() => {
    const matchedIds = new Set(matches.flatMap((m) => m.matchedProducts.map((p) => p.id)));
    return target.filter((p) => !matchedIds.has(p.id));
  }, [target, matches]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
            <View className="flex-row items-center justify-between">
              <Text className="text-ink flex-1 text-sm font-bold">
                {picked.length > 0
                  ? `선택한 재료 ${picked.length}개로 추천 중`
                  : `7일 이내 소진해야 할 재료 ${urgent.length}개`}
              </Text>
              {picked.length > 0 ? (
                <Pressable
                  onPress={() => setSelectedIds(new Set())}
                  hitSlop={8}
                  className="ml-2 active:opacity-70"
                >
                  <Text className="text-primary text-xs font-medium">전체 보기</Text>
                </Pressable>
              ) : null}
            </View>
            <Text className="text-muted mt-1 text-xs">재료를 눌러 원하는 것만 골라보세요</Text>
            <View className="mt-2.5 flex-row flex-wrap gap-2">
              {urgent.map((p) => {
                const on = selectedIds.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    className={`flex-row items-center rounded-full border px-3 py-1.5 active:opacity-70 ${
                      on ? 'border-primary bg-primary' : 'border-line bg-bg'
                    }`}
                  >
                    <Text className={`text-sm ${on ? 'text-paper font-bold' : 'text-ink'}`}>
                      {p.name}
                    </Text>
                    <Text
                      className={`ml-1.5 text-xs font-bold ${on ? 'text-paper' : 'text-primary'}`}
                    >
                      {ddayLabel(daysUntil(p.expiryDate))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null
      }
      renderItem={({ item }) => <RecipeCard match={item} haveNames={haveNames} showShop={coupangSuggest} />}
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

function RecipeCard({
  match,
  haveNames,
  showShop,
}: {
  match: RecipeMatch;
  haveNames: string[];
  showShop: boolean;
}) {
  const { recipe, matchedProducts } = match;
  const missing = showShop ? missingIngredients(recipe.name, haveNames) : [];
  const mealkit = showShop && RECIPE_SHOPPING[recipe.name]?.mealkit;
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

      {/* 부족 재료 → 쿠팡 검색. 칩 하나만 눌러도 그 뒤 24시간 쿠팡 구매가 실적이 된다.
          쿠팡은 앱 전체에서 테두리 버튼(빨간 꽉 찬 버튼은 앱 자체 동작만)으로 통일 */}
      {missing.length > 0 || mealkit ? (
        <View className="mt-3 rounded-xl border border-line bg-bg p-3">
          <CoupangAdHeader small />
          {missing.length > 0 ? (
            <>
              <Text className="text-ink mt-2.5 text-xs font-bold">🛒 부족한 재료</Text>
              <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 6 }}>
                {missing.map((m) => (
                  <Pressable
                    key={m.name}
                    onPress={() => openCoupangSearch(m.name)}
                    className="rounded-full border border-line bg-paper px-3 py-1.5 active:opacity-70"
                    accessibilityRole="link"
                    accessibilityLabel={`쿠팡에서 ${m.name} 검색`}
                  >
                    <Text className={`text-sm ${m.staple ? 'text-muted' : 'text-ink'}`}>{m.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {mealkit ? (
            <Pressable
              onPress={() => openCoupangSearch(`${recipe.name} 밀키트`)}
              className="mt-2.5 flex-row items-center justify-center rounded-lg border border-line bg-paper py-2.5 active:opacity-70"
              accessibilityRole="link"
            >
              <Text className="text-ink text-sm font-bold">🍱 {recipe.name} 밀키트 한 번에 보기</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color="#888888" />
            </Pressable>
          ) : null}
          <Text className="text-muted mt-2 text-[10px]">{COUPANG_DISCLOSURE}</Text>
        </View>
      ) : null}
    </View>
  );
}
