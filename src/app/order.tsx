import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import Thumbnail from '@/components/Thumbnail';
import {
  addOrderCategory,
  deleteOrderCategory,
  deleteOrderProduct,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  saveOrderProduct,
  seedDefaultOrderProducts,
  syncOrderCatalog,
  writeOrderCart,
} from '@/lib/order-repo';
import { OrderCart, OrderProduct, OrderStatus } from '@/lib/order-types';
import { matchesSearch } from '@/lib/korean-search';

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  active: { label: '시판중', color: '#2E7D32' },
  discontinued: { label: '단종', color: '#C62828' },
  paused: { label: '생산중단', color: '#F9A825' },
};

export default function Order() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cart, setCart] = useState<OrderCart>({});
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();

  const loadCatalog = useCallback(async () => {
    const [productList, categoryList, cartData] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setCart(cartData);
  }, []);

  const load = useCallback(async () => {
    await syncOrderCatalog();
    await loadCatalog();
  }, [loadCatalog]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (scanParams.scannedBarcode) setQuery(scanParams.scannedBarcode);
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  // 검색어를 낮은 우선순위로 반영 — 388종 카탈로그에서 매 키 입력마다 즉시 전체
  // 재필터링하면 저사양 기기에서 입력이 밀릴 수 있어, React가 재계산을 뒤로 미루게 한다.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== '전체' && p.category !== selectedCategory) return false;
      if (!deferredQuery.trim()) return true;
      return (
        matchesSearch(p.name, deferredQuery) ||
        matchesSearch(p.brand, deferredQuery) ||
        (p.barcode ?? '').includes(deferredQuery.trim())
      );
    });
  }, [products, deferredQuery, selectedCategory]);

  // 카테고리 탭과 무관하게 전체 상품에서 찾는 자동완성 제안 — 검색창 바로 아래 드롭다운으로
  // 뜨는 용도라 5개로 제한한다 (스크롤 없는 빠른 담기 목적, 전체 목록은 아래에 그대로 있음).
  const suggestions = useMemo(() => {
    const q = deferredQuery.trim();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          matchesSearch(p.name, deferredQuery) ||
          matchesSearch(p.brand, deferredQuery) ||
          (p.barcode ?? '').includes(q),
      )
      .slice(0, 5);
  }, [products, deferredQuery]);

  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  // 낙관적 업데이트: 로컬 state 기준으로 즉시 반영하고 저장은 fire-and-forget —
  // 이전에는 탭할 때마다 AsyncStorage를 재조회해서 빠르게 연타하면 이전 쓰기가
  // 끝나기 전에 다음 읽기가 시작돼 증가분이 유실될 수 있었다.
  const changeQty = useCallback((productId: string, delta: number) => {
    setCart((prev) => {
      const nextQty = Math.max(0, (prev[productId] ?? 0) + delta);
      const next = { ...prev };
      if (nextQty <= 0) delete next[productId];
      else next[productId] = nextQty;
      writeOrderCart(next).catch(() => {});
      return next;
    });
  }, []);

  // 자동완성 드롭다운의 장바구니 아이콘 전용: 1개 담고 검색어를 지워 드롭다운도 함께 닫는다.
  // 2개 이상 담고 싶으면 드롭다운 안의 -/+ 스테퍼(changeQty)로 닫지 않고 조절한다.
  const quickAdd = useCallback(
    (productId: string) => {
      changeQty(productId, 1);
      setQuery('');
    },
    [changeQty],
  );

  const submitCategory = async () => {
    const v = categoryInput.trim();
    if (!v) return;
    if (editingCategory) {
      if (v !== editingCategory) {
        await renameOrderCategory(editingCategory, v);
        if (selectedCategory === editingCategory) setSelectedCategory(v);
      }
      setEditingCategory(null);
    } else {
      await addOrderCategory(v);
      setShowCategoryInput(false);
    }
    setCategoryInput('');
    load();
  };

  const cancelCategoryEdit = () => {
    setEditingCategory(null);
    setCategoryInput('');
  };

  const closeCategoryInput = () => {
    setShowCategoryInput(false);
    setCategoryInput('');
  };

  const onLongPressCategory = (cat: string) => {
    Alert.alert(cat, '카테고리를 어떻게 할까요?', [
      {
        text: '이름 수정',
        onPress: () => {
          setEditingCategory(cat);
          setCategoryInput(cat);
        },
      },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            '카테고리 삭제',
            `'${cat}' 카테고리를 삭제할까요?\n이 카테고리를 쓰던 상품은 삭제되지 않습니다.`,
            [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: async () => {
                  await deleteOrderCategory(cat);
                  if (selectedCategory === cat) setSelectedCategory('전체');
                  load();
                },
              },
            ],
          );
        },
      },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const handleOpenProduct = useCallback((id: string) => {
    router.push({ pathname: '/order-product-form', params: { id } });
  }, []);

  // Android의 Alert.alert는 버튼을 최대 3개까지만 보여준다(4개째부터 잘림) — 그래서
  // 이 메뉴는 '취소' 버튼 없이 3개(수정/상태 변경/삭제)만 둔다. 뒤로가기·바깥 탭으로도
  // 닫히니 기능적으로 취소는 여전히 가능하다.
  const onChangeStatus = useCallback(
    (p: OrderProduct) => {
      Alert.alert(
        '상태 변경',
        `'${p.name}'의 납품 상태를 선택하세요.`,
        (Object.keys(STATUS_META) as OrderStatus[]).map((s) => ({
          text: STATUS_META[s].label,
          onPress: async () => {
            await saveOrderProduct({ ...p, status: s });
            load();
          },
        })),
      );
    },
    [load],
  );

  const onLongPressProduct = useCallback(
    (p: OrderProduct) => {
      Alert.alert(p.name, '어떻게 처리할까요?', [
        {
          text: '수정',
          onPress: () => router.push({ pathname: '/order-product-form', params: { id: p.id } }),
        },
        {
          text: '상태 변경',
          onPress: () => onChangeStatus(p),
        },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            Alert.alert('상품 삭제', `'${p.name}' 을(를) 카탈로그에서 삭제할까요?`, [
              { text: '취소', style: 'cancel' },
              {
                text: '삭제',
                style: 'destructive',
                onPress: async () => {
                  await deleteOrderProduct(p.id);
                  load();
                },
              },
            ]);
          },
        },
      ]);
    },
    [load, onChangeStatus],
  );

  const onSeedDefaults = async () => {
    setSeeding(true);
    try {
      const count = await seedDefaultOrderProducts();
      await load();
      Alert.alert(
        count > 0 ? '불러오기 완료' : '알림',
        count > 0 ? `기본 상품 ${count}건을 불러왔습니다.` : '이미 등록된 상품이 있어 건너뛰었습니다.',
      );
    } finally {
      setSeeding(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 16 }}>
              <Pressable
                onPress={() => router.push('/scan?mode=order')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="바코드 스캔"
              >
                <MaterialCommunityIcons name="barcode-scan" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/order-product-form')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="발주 상품 등록"
              >
                <MaterialCommunityIcons name="plus" size={22} color="#1A1A1A" />
              </Pressable>
            </View>
          ),
        }}
      />

      <View className="relative mx-4 mt-3" style={{ zIndex: 10 }}>
        <View className="flex-row items-center rounded-xl border border-line bg-paper px-3">
          <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
          <TextInput
            className="text-ink ml-2 flex-1 py-2.5 text-base"
            placeholder="상품명, 브랜드, 바코드 검색"
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
        </View>
        {suggestions.length > 0 ? (
          <View
            className="absolute left-0 right-0 top-full mt-1 overflow-hidden rounded-xl border border-line bg-paper"
            style={{ elevation: 6 }}
          >
            {suggestions.map((p) => (
              <SuggestionRow
                key={p.id}
                product={p}
                qty={cart[p.id] ?? 0}
                onChangeQty={changeQty}
                onQuickAdd={quickAdd}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View className="mt-2.5 px-4" style={{ gap: 8 }}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Chip
            label="전체"
            active={selectedCategory === '전체'}
            onPress={() => setSelectedCategory('전체')}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={selectedCategory === c}
              onPress={() => setSelectedCategory(c)}
              onLongPress={() => onLongPressCategory(c)}
            />
          ))}
          <Chip label="+" active={false} onPress={() => setShowCategoryInput(true)} />
        </View>
        {showCategoryInput || editingCategory ? (
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              placeholder="새 카테고리 입력 (예: 컵)"
              placeholderTextColor="#BBBBBB"
              value={categoryInput}
              onChangeText={setCategoryInput}
              autoFocus
            />
            <Pressable
              onPress={submitCategory}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">
                {editingCategory ? '수정' : '추가'}
              </Text>
            </Pressable>
            <Pressable
              onPress={editingCategory ? cancelCategoryEdit : closeCategoryInput}
              className="items-center justify-center px-2"
            >
              <Text className="text-muted text-sm">취소</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 + insets.bottom }}
        renderItem={({ item }) => (
          <CatalogRow
            product={item}
            qty={cart[item.id] ?? 0}
            onChangeQty={changeQty}
            onPress={handleOpenProduct}
            onLongPress={onLongPressProduct}
          />
        )}
        ListEmptyComponent={
          <View className="mt-24 items-center">
            <MaterialCommunityIcons name="cart-outline" size={48} color="#CCCCCC" />
            <Text className="text-muted mt-4 text-base">등록된 발주 상품이 없습니다</Text>
            <Text className="text-muted mt-1 text-sm">
              오른쪽 위 + 버튼을 눌러 상품을 등록해 보세요
            </Text>
            <Pressable
              onPress={onSeedDefaults}
              disabled={seeding}
              className="mt-4 rounded-xl border border-line bg-paper px-4 py-2.5 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">
                {seeding ? '불러오는 중...' : '기본 상품 불러오기 (아이스크림 388종)'}
              </Text>
            </Pressable>
          </View>
        }
      />

      {totalCount > 0 ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        >
          <Pressable
            onPress={() => router.push('/order-cart')}
            className="flex-row items-center justify-between rounded-2xl bg-ink px-5 py-4 active:opacity-80"
            style={{ elevation: 6 }}
          >
            <Text className="text-paper text-base font-bold">발주 내역 확인</Text>
            <Text className="text-paper text-base font-bold">{totalCount}박스</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const CatalogRow = memo(function CatalogRow({
  product,
  qty,
  onChangeQty,
  onPress,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  onChangeQty: (id: string, delta: number) => void;
  onPress: (id: string) => void;
  onLongPress: (product: OrderProduct) => void;
}) {
  const statusMeta = STATUS_META[product.status ?? 'active'];
  return (
    <Pressable
      onPress={() => onPress(product.id)}
      onLongPress={() => onLongPress(product)}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      <Thumbnail uri={product.imageUri} size={56} radius={8} iconSize={22} />
      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold">{product.name}</Text>
        <Text className="text-muted mt-0.5 text-sm">
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
        {product.barcode ? (
          <Text className="text-muted mt-0.5 text-xs">{product.barcode}</Text>
        ) : null}
        <View
          className="mt-1 flex-row items-center self-start rounded px-1.5 py-0.5"
          style={{ backgroundColor: statusMeta.color, gap: 2 }}
        >
          <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
            {statusMeta.label}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={12} color="#FFFFFF" />
        </View>
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(product.id, -1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="minus" size={20} color="#1A1A1A" />
        </Pressable>
        <Text
          className="text-ink mx-3 w-7 text-center text-lg font-bold"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {qty}
        </Text>
        <Pressable
          onPress={() => onChangeQty(product.id, 1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="plus" size={20} color="#1A1A1A" />
        </Pressable>
      </View>
    </Pressable>
  );
});

const SuggestionRow = memo(function SuggestionRow({
  product,
  qty,
  onChangeQty,
  onQuickAdd,
}: {
  product: OrderProduct;
  qty: number;
  onChangeQty: (id: string, delta: number) => void;
  onQuickAdd: (id: string) => void;
}) {
  return (
    <View className="flex-row items-center border-b border-line px-3 py-2">
      <View className="flex-1 pr-2">
        <Text className="text-ink text-sm font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(product.id, -1)}
          className="h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="수량 감소"
        >
          <MaterialCommunityIcons name="minus" size={16} color="#1A1A1A" />
        </Pressable>
        <Text
          className="text-ink mx-2 w-5 text-center text-sm font-bold"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {qty}
        </Text>
        <Pressable
          onPress={() => onChangeQty(product.id, 1)}
          className="h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="수량 증가"
        >
          <MaterialCommunityIcons name="plus" size={16} color="#1A1A1A" />
        </Pressable>
      </View>
      <Pressable
        onPress={() => onQuickAdd(product.id)}
        className="ml-2 h-8 w-8 items-center justify-center rounded-lg bg-primary active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel="1개 담고 검색 닫기"
      >
        <MaterialCommunityIcons name="cart-plus" size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
});
