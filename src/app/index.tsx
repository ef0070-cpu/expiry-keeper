import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import Chip from '@/components/Chip';
import Fab from '@/components/Fab';
import ProductCard from '@/components/ProductCard';
import SummaryHeader from '@/components/SummaryHeader';
import { lookupBarcode } from '@/lib/barcode-lookup';
import { SIGNAL_ORDER, SIGNAL_TITLES, SIGNAL_BG, SignalKey, daysUntil, signalOf } from '@/lib/dates';
import { cancelExpiryAlerts } from '@/lib/notifications';
import { matchesSearch } from '@/lib/korean-search';
import { deleteProduct, listProducts, resolveProduct } from '@/lib/repo';
import { useAppMode } from '@/lib/settings';
import { BarcodeInfo, Product } from '@/lib/types';

export default function Dashboard() {
  const mode = useAppMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [signalFilter, setSignalFilter] = useState<SignalKey | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<BarcodeInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const load = useCallback(async () => {
    try {
      setProducts(await listProducts());
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (scanParams.scannedBarcode) {
      setQuery(scanParams.scannedBarcode);
      setScannedBarcode(scanParams.scannedBarcode);
      setLookupResult(null);
    }
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.categories.forEach((c) => set.add(c)));
    return [...set].sort();
  }, [products]);

  // 검색어를 낮은 우선순위로 반영 — 타이핑 중 매 키 입력마다 전체 목록을 즉시
  // 재필터링하면 저사양 기기에서 입력이 밀릴 수 있어, React가 필터 재계산을 뒤로 미루게 한다.
  const deferredQuery = useDeferredValue(query);

  const sections = useMemo(() => {
    const filtered = products.filter((p) => {
      if (selectedCategories.size > 0 && !p.categories.some((c) => selectedCategories.has(c)))
        return false;
      if (signalFilter && signalOf(daysUntil(p.expiryDate)) !== signalFilter) return false;
      if (!deferredQuery.trim()) return true;
      return (
        matchesSearch(p.name, deferredQuery) ||
        (p.barcode ?? '').includes(deferredQuery.trim()) ||
        matchesSearch(p.memo ?? '', deferredQuery)
      );
    });
    const grouped = new Map<SignalKey, Product[]>();
    filtered.forEach((p) => {
      const key = signalOf(daysUntil(p.expiryDate));
      const arr = grouped.get(key) ?? [];
      arr.push(p);
      grouped.set(key, arr);
    });
    return SIGNAL_ORDER.filter((k) => grouped.has(k)).map((k) => ({
      key: k,
      title: SIGNAL_TITLES[k],
      data: grouped.get(k)!.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    }));
  }, [products, deferredQuery, selectedCategories, signalFilter]);

  useEffect(() => {
    if (!scannedBarcode) return;
    if (query !== scannedBarcode) {
      // 사용자가 검색어를 직접 수정함 — 스캔 배너를 더 이상 보여주지 않는다
      setScannedBarcode(null);
      setLookupResult(null);
      setLookingUp(false);
      return;
    }
    const registeredLocally = products.some((p) => p.barcode === scannedBarcode);
    if (registeredLocally) {
      setLookingUp(false);
      return;
    }

    let cancelled = false;
    setLookingUp(true);
    lookupBarcode(scannedBarcode)
      .then((result) => {
        if (!cancelled) setLookupResult(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLookingUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scannedBarcode, query, products]);

  const toggleCategory = (c: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const confirmDelete = useCallback(
    (p: Product) => {
      Alert.alert('상품 삭제', `'${p.name}' 을(를) 삭제할까요?\n(통계에도 남지 않습니다)`, [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            await deleteProduct(p.id);
            await cancelExpiryAlerts(p.id);
            load();
          },
        },
      ]);
    },
    [load],
  );

  const resolve = useCallback(
    async (p: Product, status: 'consumed' | 'discarded') => {
      try {
        await resolveProduct(p.id, status);
        await cancelExpiryAlerts(p.id);
        load();
      } catch (e) {
        Alert.alert('처리 실패', e instanceof Error ? e.message : '알 수 없는 오류');
      }
    },
    [load],
  );

  const showActions = useCallback(
    (p: Product) => {
      Alert.alert(
        p.name,
        '어떻게 처리할까요? 소진·폐기 기록은 통계 화면에 남아요.',
        [
          { text: '소진 완료', onPress: () => resolve(p, 'consumed') },
          { text: '폐기', onPress: () => resolve(p, 'discarded') },
          { text: '삭제…', style: 'destructive', onPress: () => confirmDelete(p) },
        ],
        { cancelable: true },
      );
    },
    [resolve, confirmDelete],
  );

  const handleOpenProduct = useCallback((id: string) => {
    router.push({ pathname: '/product-form', params: { id } });
  }, []);

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 16 }}>
              {mode === 'retail' ? (
                <Pressable
                  onPress={() => router.push('/margin-calculator')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="원가 계산기"
                >
                  <MaterialCommunityIcons name="calculator-variant" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
              {mode === 'retail' ? (
                <Pressable
                  onPress={() => router.push('/order')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="발주 관리"
                >
                  <MaterialCommunityIcons name="cart-outline" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
              {mode === 'home' ? (
                <Pressable
                  onPress={() => router.push('/recipes')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="레시피 추천"
                >
                  <MaterialCommunityIcons name="chef-hat" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => router.push('/stats')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="소진·폐기 통계"
              >
                <MaterialCommunityIcons name="chart-box-outline" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/calendar')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="캘린더"
              >
                <MaterialCommunityIcons name="calendar-month-outline" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/settings')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="설정"
              >
                <MaterialCommunityIcons name="cog-outline" size={22} color="#888888" />
              </Pressable>
            </View>
          ),
        }}
      />

      {/* 검색 */}
      <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3">
        <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
        <TextInput
          className="text-ink ml-2 flex-1 py-2.5 text-base"
          placeholder="상품명, 바코드, 메모 검색"
          placeholderTextColor="#BBBBBB"
          value={query}
          onChangeText={setQuery}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
          >
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push('/scan?mode=search')}
          hitSlop={8}
          className="ml-2"
          accessibilityRole="button"
          accessibilityLabel="바코드로 검색"
        >
          <MaterialCommunityIcons name="barcode-scan" size={20} color="#888888" />
        </Pressable>
      </View>

      {/* 카테고리 필터 */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2.5 max-h-10"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          <Chip
            label="전체"
            active={selectedCategories.size === 0}
            onPress={() => setSelectedCategories(new Set())}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategories.has(c)}
              onPress={() => toggleCategory(c)}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* 바코드 조회 배너 (로컬 미등록 + 스캔으로 들어온 바코드) */}
      {lookingUp || lookupResult?.name ? (
        <Pressable
          disabled={lookingUp}
          onPress={() => {
            if (!lookupResult?.name || !scannedBarcode) return;
            router.push({
              pathname: '/product-form',
              params: {
                barcode: scannedBarcode,
                prefillName: lookupResult.name,
                prefillImage: lookupResult.imageUrl ?? '',
              },
            });
          }}
          className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3 py-2.5 active:opacity-70"
        >
          {lookingUp ? (
            <>
              <ActivityIndicator size="small" color="#CC2222" />
              <Text className="text-muted ml-2 text-sm">바코드 조회 중...</Text>
            </>
          ) : (
            <>
              <MaterialCommunityIcons name="barcode-scan" size={18} color="#CC2222" />
              <Text className="text-ink ml-2 flex-1 text-sm" numberOfLines={1}>
                바코드 조회: {lookupResult!.name}
              </Text>
              <Text className="text-primary text-sm font-bold">등록하기</Text>
            </>
          )}
        </Pressable>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <SummaryHeader
            products={products}
            activeSignal={signalFilter}
            onSelectSignal={setSignalFilter}
          />
        }
        renderSectionHeader={({ section }) => (
          <View className="mx-4 mb-2 mt-3 flex-row items-center">
            <View className={`${SIGNAL_BG[section.key as SignalKey]} h-2 w-2 rounded-full`} />
            <Text className="text-ink ml-2 text-sm font-bold">{section.title}</Text>
            <Text className="text-muted ml-1.5 text-sm">{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ProductCard product={item} onPress={handleOpenProduct} onLongPress={showActions} />
        )}
        ListEmptyComponent={
          <View className="mt-24 items-center">
            <MaterialCommunityIcons name="barcode-scan" size={48} color="#CCCCCC" />
            <Text className="text-muted mt-4 text-base">등록된 상품이 없습니다</Text>
            <Text className="text-muted mt-1 text-sm">
              오른쪽 아래 버튼을 눌러 바코드를 스캔해 보세요
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        stickySectionHeadersEnabled={false}
      />

      <Fab onPress={() => router.push(mode === 'home' ? '/product-form' : '/scan')} />
    </View>
  );
}
