import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import Fab from '@/components/Fab';
import ProductCard from '@/components/ProductCard';
import SummaryHeader from '@/components/SummaryHeader';
import { SECTION_ORDER, SECTION_TITLES, SectionKey, daysUntil, sectionOf } from '@/lib/dates';
import { cancelExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, listProducts, resolveProduct } from '@/lib/repo';
import { useAppMode } from '@/lib/settings';
import { Product } from '@/lib/types';

const SECTION_DOT: Record<SectionKey, string> = {
  expired: 'bg-ink',
  today: 'bg-primary',
  soon: 'bg-warn',
  week: 'bg-warn',
  later: 'bg-ok',
};

export default function Dashboard() {
  const mode = useAppMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category && set.add(p.category));
    return [...set].sort();
  }, [products]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q) ||
        (p.memo ?? '').toLowerCase().includes(q)
      );
    });
    const grouped = new Map<SectionKey, Product[]>();
    filtered.forEach((p) => {
      const key = sectionOf(daysUntil(p.expiryDate));
      const arr = grouped.get(key) ?? [];
      arr.push(p);
      grouped.set(key, arr);
    });
    return SECTION_ORDER.filter((k) => grouped.has(k)).map((k) => ({
      key: k,
      title: SECTION_TITLES[k],
      data: grouped.get(k)!.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    }));
  }, [products, query, category]);

  const confirmDelete = (p: Product) => {
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
  };

  const resolve = async (p: Product, status: 'consumed' | 'discarded') => {
    try {
      await resolveProduct(p.id, status);
      await cancelExpiryAlerts(p.id);
      load();
    } catch (e) {
      Alert.alert('처리 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  };

  const showActions = (p: Product) => {
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
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 16 }}>
              {mode === 'home' ? (
                <Pressable onPress={() => router.push('/recipes')} hitSlop={8}>
                  <MaterialCommunityIcons name="chef-hat" size={22} color="#1A1A1A" />
                </Pressable>
              ) : null}
              <Pressable onPress={() => router.push('/stats')} hitSlop={8}>
                <MaterialCommunityIcons name="chart-box-outline" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable onPress={() => router.push('/calendar')} hitSlop={8}>
                <MaterialCommunityIcons name="calendar-month-outline" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
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
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#BBBBBB" />
          </Pressable>
        ) : null}
      </View>

      {/* 카테고리 필터 */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2.5 max-h-10"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          <Chip label="전체" active={category === null} onPress={() => setCategory(null)} />
          {categories.map((c) => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={<SummaryHeader products={products} />}
        renderSectionHeader={({ section }) => (
          <View className="mx-4 mb-2 mt-3 flex-row items-center">
            <View className={`${SECTION_DOT[section.key as SectionKey]} h-2 w-2 rounded-full`} />
            <Text className="text-ink ml-2 text-sm font-bold">{section.title}</Text>
            <Text className="text-muted ml-1.5 text-sm">{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            onPress={() =>
              router.push({ pathname: '/product-form', params: { id: item.id } })
            }
            onLongPress={() => showActions(item)}
          />
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

      <Fab onPress={() => router.push('/scan')} />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`justify-center rounded-full border px-3.5 py-1.5 ${
        active ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-sm font-medium ${active ? 'text-paper' : 'text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
