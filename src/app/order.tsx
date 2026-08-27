import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import { hasImageSearchKeys } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  countApprovedCatalogUpdates,
  deleteOrderCategory,
  deleteOrderProduct,
  getOrderCart,
  listOrderCategories,
  listOrderProducts,
  renameOrderCategory,
  seedDefaultOrderProducts,
  setOrderCartQuantity,
  syncApprovedCatalogUpdates,
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
  const [updating, setUpdating] = useState(false);
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();

  const load = useCallback(async () => {
    const [productList, categoryList, cartData, updateCount] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
      countApprovedCatalogUpdates(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setCart(cartData);
    setPendingUpdateCount(updateCount);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (scanParams.scannedBarcode) setQuery(scanParams.scannedBarcode);
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== '전체' && p.category !== selectedCategory) return false;
      if (!query.trim()) return true;
      return (
        matchesSearch(p.name, query) ||
        matchesSearch(p.brand, query) ||
        (p.barcode ?? '').includes(query.trim())
      );
    });
  }, [products, query, selectedCategory]);

  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  const changeQty = async (productId: string, delta: number) => {
    const current = cart[productId] ?? 0;
    const next = await setOrderCartQuantity(productId, Math.max(0, current + delta));
    setCart(next);
  };

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

  const onLongPressProduct = (p: OrderProduct) => {
    Alert.alert(p.name, '어떻게 처리할까요?', [
      {
        text: '수정',
        onPress: () => router.push({ pathname: '/order-product-form', params: { id: p.id } }),
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
      { text: '취소', style: 'cancel' },
    ]);
  };

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

  const onUpdate = async () => {
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', 'Update를 사용하려면 로그인이 필요합니다.');
      return;
    }
    setUpdating(true);
    try {
      const { added, fixed } = await syncApprovedCatalogUpdates();
      await load();
      const total = added + fixed;
      Alert.alert(
        total > 0 ? '업데이트 완료' : '알림',
        total > 0 ? `${total}건 반영됐습니다 (신규 ${added}, 수정 ${fixed}).` : '새로운 업데이트가 없습니다.',
      );
    } catch (e) {
      Alert.alert('업데이트 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 16 }}>
              <Pressable onPress={() => router.push('/scan?mode=order')} hitSlop={8}>
                <MaterialCommunityIcons name="barcode-scan" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable onPress={() => router.push('/order-product-form')} hitSlop={8}>
                <MaterialCommunityIcons name="plus" size={22} color="#1A1A1A" />
              </Pressable>
            </View>
          ),
        }}
      />

      <View className="mx-4 mt-3 flex-row items-center rounded-xl border border-line bg-paper px-3">
        <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
        <TextInput
          className="text-ink ml-2 flex-1 py-2.5 text-base"
          placeholder="상품명, 브랜드, 바코드 검색"
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

      <Pressable
        onPress={onUpdate}
        disabled={updating || pendingUpdateCount === 0}
        className="mx-4 mt-2.5 items-center rounded-xl py-2.5 active:opacity-70"
        style={{ backgroundColor: pendingUpdateCount > 0 ? '#2E7D32' : '#F0F0F0' }}
      >
        <Text
          className="text-sm font-bold"
          style={{ color: pendingUpdateCount > 0 ? '#FFFFFF' : '#999999' }}
        >
          {updating
            ? '업데이트 중...'
            : pendingUpdateCount > 0
              ? `업데이트된 ${pendingUpdateCount}건이 있습니다`
              : 'Update'}
        </Text>
      </Pressable>

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
            onChangeQty={(delta) => changeQty(item.id, delta)}
            onPress={() =>
              router.push({ pathname: '/order-product-form', params: { id: item.id } })
            }
            onLongPress={() => onLongPressProduct(item)}
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

function CatalogRow({
  product,
  qty,
  onChangeQty,
  onPress,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  onChangeQty: (delta: number) => void;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const statusMeta = STATUS_META[product.status ?? 'active'];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      {product.imageUri ? (
        <Image
          source={{ uri: product.imageUri }}
          style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: '#F0F0F0' }}
          contentFit="cover"
        />
      ) : (
        <View className="h-14 w-14 items-center justify-center rounded-lg bg-bg">
          <MaterialCommunityIcons name="image-off-outline" size={22} color="#BBBBBB" />
        </View>
      )}
      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-sm">
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
        {product.barcode ? (
          <Text className="text-muted mt-0.5 text-xs">{product.barcode}</Text>
        ) : null}
        <View
          className="mt-1 self-start rounded px-1.5 py-0.5"
          style={{ backgroundColor: statusMeta.color }}
        >
          <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
            {statusMeta.label}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(-1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="minus" size={20} color="#1A1A1A" />
        </Pressable>
        <Text className="text-ink mx-3 w-7 text-center text-lg font-bold">{qty}</Text>
        <Pressable
          onPress={() => onChangeQty(1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
        >
          <MaterialCommunityIcons name="plus" size={20} color="#1A1A1A" />
        </Pressable>
      </View>
    </Pressable>
  );
}
