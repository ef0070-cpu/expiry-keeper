import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import {
  clearOrderCart,
  getOrderCart,
  listOrderProducts,
  setOrderCartQuantity,
} from '@/lib/order-repo';
import { buildOrderShareText } from '@/lib/order-share';
import { OrderCart, OrderProduct } from '@/lib/order-types';
import { listProductCategories } from '@/lib/repo';

export default function OrderCartScreen() {
  const insets = useSafeAreaInsets();
  const [cart, setCart] = useState<OrderCart>({});
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cartData, productList, branchList] = await Promise.all([
      getOrderCart(),
      listOrderProducts(),
      listProductCategories(),
    ]);
    setCart(cartData);
    setProducts(productList);
    setBranches(branchList);
    setSelectedBranch((prev) => prev ?? branchList[0] ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const items = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
        .filter((x): x is { product: OrderProduct; qty: number } => !!x.product && x.qty > 0),
    [cart, products],
  );

  const total = items.reduce((sum, item) => sum + item.qty, 0);

  const removeItem = async (id: string) => {
    const next = await setOrderCartQuantity(id, 0);
    setCart(next);
  };

  const clearAll = () => {
    Alert.alert('발주 내역 초기화', '담은 품목을 모두 비울까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화',
        style: 'destructive',
        onPress: async () => {
          await clearOrderCart();
          setCart({});
        },
      },
    ]);
  };

  const share = async () => {
    if (!selectedBranch) {
      Alert.alert('매장 없음', '재고관리 화면에서 매장(카테고리)을 먼저 등록해 주세요.');
      return;
    }
    const text = buildOrderShareText(cart, products, selectedBranch, new Date());
    try {
      await Share.share({ message: text });
    } catch (e) {
      Alert.alert('공유 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="border-b border-line bg-paper px-4 pb-3 pt-4">
        <Text className="text-ink mb-2 text-sm font-bold">매장</Text>
        {branches.length > 0 ? (
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {branches.map((b) => (
              <Chip
                key={b}
                label={b}
                active={selectedBranch === b}
                onPress={() => setSelectedBranch(b)}
              />
            ))}
          </View>
        ) : (
          <Text className="text-muted text-sm">
            재고관리 화면에서 매장(카테고리)을 먼저 등록해 주세요.
          </Text>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.product.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View className="mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3">
            <View className="flex-1">
              <Text className="text-ink text-base font-bold">{item.product.name}</Text>
              <Text className="text-muted mt-0.5 text-sm">{item.product.brand}</Text>
            </View>
            <Text className="text-primary mr-3 text-lg font-black">{item.qty}박스</Text>
            <Pressable onPress={() => removeItem(item.product.id)} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color="#BBBBBB" />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View className="mt-16 items-center">
            <Text className="text-muted text-base">담은 상품이 없습니다</Text>
          </View>
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <Pressable onPress={clearAll} className="mb-3 self-end">
              <Text className="text-muted text-xs underline">전체 초기화</Text>
            </Pressable>
          ) : null
        }
      />

      <View
        className="border-t border-line bg-paper px-4 pt-4"
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
      >
        <Text className="text-muted mb-3 text-sm">총 합계: {total}박스</Text>
        <Pressable
          onPress={share}
          disabled={items.length === 0}
          className={`items-center rounded-xl py-3.5 ${
            items.length === 0 ? 'bg-line' : 'bg-primary active:opacity-80'
          }`}
        >
          <Text className="text-paper text-base font-bold">공유하기</Text>
        </Pressable>
      </View>
    </View>
  );
}
