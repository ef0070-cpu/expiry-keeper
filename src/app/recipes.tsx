import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import HomeBanner from '@/components/HomeBanner';
import { daysUntil, ddayLabel } from '@/lib/dates';
import { RecipeMatch, matchRecipes, urgentProducts } from '@/lib/recipes';
import { getCachedActiveProducts, listProducts } from '@/lib/repo';
import { CoupangAdHeader } from '@/components/CoupangRebuyCard';
import { COUPANG_DISCLOSURE, openCoupangSearch } from '@/lib/coupang';
import { RECIPE_SHOPPING, missingIngredients } from '@/lib/recipe-shopping';
import { useCoupangSuggestEnabled } from '@/lib/settings';
import { Product } from '@/lib/types';

function openVideoSearch(query: string) {
  router.push({ pathname: '/recipe-video', params: { query } });
}

export default function Recipes() {
  // 목록 화면이 이미 받아 둔 상품으로 바로 그리고, 서버 최신값은 뒤에서 받아 바꾼다
  const [products, setProducts] = useState<Product[]>(getCachedActiveProducts);
  const [loaded, setLoaded] = useState(products.length > 0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts('active'));
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoaded(true);
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
    // 레시피 목록 아래에 애드몹 배너 고정(가정용 전용 화면). 쿠팡 칩과 붙지 않게 배너는 목록 밖에 둔다
    <View className="flex-1 bg-bg">
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
          <UrgentPicker
            urgent={urgent}
            selectedIds={selectedIds}
            pickedCount={picked.length}
            onToggle={toggle}
            onClear={() => setSelectedIds(new Set())}
          />
        ) : null
      }
      renderItem={({ item }) => <RecipeCard match={item} haveNames={haveNames} showShop={coupangSuggest} />}
      ListEmptyComponent={
        !loaded ? (
          // 첫 응답 전엔 "없어요" 대신 로딩 표시 — 예전엔 잠깐 "임박한 재료가 없어요"가 보였다 바뀌었다
          <View className="mt-20 items-center">
            <ActivityIndicator color="#CC2222" />
          </View>
        ) : (
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
        )
      }
    />
    <HomeBanner />
    </View>
  );
}

const EXPANDED_KEY = 'recipeUrgentExpanded:v1';

/**
 * 임박 재료 고르기(접었다 펴기). 접힘: 한 줄 가로 스크롤(작은 칩), 펼침: 여러 줄 큰 칩(누르기 쉬운 높이).
 * 재료 4개 이하면 처음부터 펼치고, 그 이상이면 마지막에 둔 상태(접힘/펼침)를 기억해 그대로 보여 준다.
 * 고른 재료는 맨 앞 — 접힌 상태에서도 무엇을 골랐는지 바로 보이게.
 */
function UrgentPicker({
  urgent,
  selectedIds,
  pickedCount,
  onToggle,
  onClear,
}: {
  urgent: Product[];
  selectedIds: Set<string>;
  pickedCount: number;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const few = urgent.length <= 4;
  const [saved, setSaved] = useState<boolean | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    AsyncStorage.getItem(EXPANDED_KEY)
      .then((v) => setSaved(v === null ? null : v === '1'))
      .catch(() => {});
  }, []);
  const expanded = few || (saved ?? false);

  const toggleExpanded = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !expanded;
    setSaved(next);
    AsyncStorage.setItem(EXPANDED_KEY, next ? '1' : '0').catch(() => {});
  };

  const ordered = [...urgent].sort((a, b) => Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)));
  const chips = ordered.map((p) => {
    const on = selectedIds.has(p.id);
    return (
      <Pressable
        key={p.id}
        onPress={() => onToggle(p.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        className={`flex-row items-center rounded-full border active:opacity-70 ${
          expanded ? 'px-3.5' : 'px-2.5 py-1'
        } ${on ? 'border-primary bg-primary' : 'border-line bg-bg'}`}
        style={expanded ? { minHeight: 40 } : undefined}
      >
        <Text className={`${expanded ? 'text-sm' : 'text-xs'} ${on ? 'text-paper font-bold' : 'text-ink'}`}>
          {p.name}
        </Text>
        <Text className={`ml-1 ${expanded ? 'text-xs' : 'text-[10px]'} font-bold ${on ? 'text-paper' : 'text-primary'}`}>
          {ddayLabel(daysUntil(p.expiryDate))}
        </Text>
      </Pressable>
    );
  });

  return (
    <View className="mb-3 rounded-xl border border-line bg-paper px-3 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-ink flex-1 text-xs font-bold">
          7일 이내 소진할 재료 {urgent.length}개
          {pickedCount > 0 ? <Text className="text-primary"> · 선택 {pickedCount}</Text> : null}
        </Text>
        {few ? null : (
          <Pressable
            onPress={toggleExpanded}
            hitSlop={10}
            className="ml-2 flex-row items-center active:opacity-70"
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? '재료 목록 접기' : '재료 목록 펼치기'}
          >
            <Text className="text-muted text-xs">{expanded ? '접기' : '펼치기'}</Text>
            <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#888888" />
          </Pressable>
        )}
      </View>
      {expanded ? (
        <>
          <Text className="text-muted mt-1 text-xs">재료를 눌러 원하는 것만 골라보세요</Text>
          <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
            {chips}
          </View>
          {pickedCount > 0 ? (
            <Pressable onPress={onClear} hitSlop={8} className="mt-2.5 self-end active:opacity-70">
              <Text className="text-primary text-xs font-medium">선택 해제 (전체 보기)</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2" contentContainerStyle={{ gap: 6 }}>
          {chips}
        </ScrollView>
      )}
    </View>
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
        <View className="mt-2.5 rounded-lg border border-line bg-bg px-2.5 py-2">
          <CoupangAdHeader small label="부족한 재료" />
          <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 4 }}>
            {missing.map((m) => (
              <Pressable
                key={m.name}
                onPress={() => openCoupangSearch(m.name)}
                className="rounded-full border border-line bg-paper px-2.5 py-1 active:opacity-70"
                accessibilityRole="link"
                accessibilityLabel={`쿠팡에서 ${m.name} 검색`}
              >
                <Text className={`text-xs ${m.staple ? 'text-muted' : 'text-ink'}`}>{m.name}</Text>
              </Pressable>
            ))}
            {mealkit ? (
              <Pressable
                onPress={() => openCoupangSearch(`${recipe.name} 밀키트`)}
                className="rounded-full border border-line bg-paper px-2.5 py-1 active:opacity-70"
                accessibilityRole="link"
                accessibilityLabel={`쿠팡에서 ${recipe.name} 밀키트 검색`}
              >
                <Text className="text-ink text-xs font-bold">🍱 밀키트 한 번에</Text>
              </Pressable>
            ) : null}
          </View>
          {/* 법적 표시 문구라 잘리면 안 된다 — 줄임표 없이 두 줄까지 */}
          <Text className="text-muted mt-1.5 text-[9px] leading-3">{COUPANG_DISCLOSURE}</Text>
        </View>
      ) : null}
    </View>
  );
}
