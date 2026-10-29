import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearOrderCart,
  getActiveStoreId,
  getOrderCart,
  listOrderProducts,
  listStores,
  setOrderCartQuantity,
  writeOrderCart,
} from '@/lib/order-repo';
import { bumpMonthlyUsage, withinMonthlyLimit } from '@/lib/entitlement';
import { buildOrderShareText } from '@/lib/order-share';
import OrderConfirmSheet from '@/components/OrderConfirmSheet';
import { addOrderHistory } from '@/lib/order-history';
import { OrderCart, OrderProduct } from '@/lib/order-types';

export default function OrderCartScreen() {
  const insets = useSafeAreaInsets();
  const [cart, setCart] = useState<OrderCart>({});
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [cartData, productList, activeStoreId, stores] = await Promise.all([
      getOrderCart(),
      listOrderProducts(),
      getActiveStoreId(),
      listStores(),
    ]);
    setCart(cartData);
    setProducts(productList);
    setActiveStoreId(activeStoreId ?? null);
    setStoreName(stores.find((s) => s.id === activeStoreId)?.name ?? null);
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

  const buildMessage = useCallback(
    (extra: { deliveryDate: string; memo: string }) => buildOrderShareText(cart, products, storeName, new Date(), extra),
    [cart, products, storeName],
  );

  const openConfirm = async () => {
    if (!(await withinMonthlyLimit('order'))) {
      router.push('/premium?reason=order');
      return;
    }
    setConfirmOpen(true);
  };

  // 이력·장바구니 비움·월 사용량은 "실제로 보냈다"고 사용자가 확인했을 때만 처리한다.
  // (안드로이드는 공유 창을 띄운 순간 곧바로 '공유됨'으로 돌아와, 카톡·문자에서 보냈는지 앱이 알 수 없다.)
  const finishSent = async ({ deliveryDate, memo }: { deliveryDate: string; memo: string }) => {
    await bumpMonthlyUsage('order');
    try {
      await addOrderHistory({
        storeId: activeStoreId,
        storeName: storeName ?? '',
        items: items.map((i) => ({ productId: i.product.id, name: i.product.name, qty: i.qty })),
        deliveryDate,
        memo,
      });
    } catch {
      // 이력 저장 실패가 발주 흐름을 막지 않는다.
    }
    await clearOrderCart();
    setCart({});
    setConfirmOpen(false);
  };

  const share = async (opts: { deliveryDate: string; memo: string }) => {
    if (sending) return;
    setSending(true);
    try {
      const result = await Share.share({ message: buildOrderShareText(cart, products, storeName, new Date(), opts) });
      // iOS는 사용자가 공유를 취소하면 dismissedAction이 와서 여기서 끝난다(아무것도 저장하지 않음).
      if (result.action === Share.sharedAction) {
        Alert.alert('발주서를 보내셨나요?', '보냈다고 확인하면 발주 이력에 저장하고 장바구니를 비워요.', [
          { text: '아직 안 보냈어요', style: 'cancel' }, // 장바구니·이력 그대로 — 다시 보낼 수 있다
          { text: '보냈어요', onPress: () => finishSent(opts) },
        ]);
      }
    } catch (e) {
      Alert.alert('공유 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="items-center bg-paper pb-2 pt-2.5">
        <View style={{ width: 48, height: 6, borderRadius: 3, backgroundColor: '#9A9A9A' }} />
      </View>
      <View className="flex-row items-center justify-between bg-paper px-4 pb-2">
        <Text className="text-ink text-lg font-bold">발주서 확인</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={11}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        >
          <MaterialCommunityIcons name="close" size={22} color="#1A1A1A" />
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.product.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View className="mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3">
            <View className="mr-2 flex-1">
              <Text className="text-ink text-base font-bold" numberOfLines={1}>
                {item.product.name}
              </Text>
              <Text className="text-muted mt-0.5 text-sm">{item.product.brand}</Text>
            </View>
            <Pressable
              onPress={() => changeQty(item.product.id, -1)}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="수량 감소"
            >
              <MaterialCommunityIcons name="minus" size={18} color="#1A1A1A" />
            </Pressable>
            <Text
              className="text-primary mx-2 w-14 text-center text-sm font-bold"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {item.qty}박스
            </Text>
            <Pressable
              onPress={() => changeQty(item.product.id, 1)}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="수량 증가"
            >
              <MaterialCommunityIcons name="plus" size={18} color="#1A1A1A" />
            </Pressable>
            <Pressable
              onPress={() => removeItem(item.product.id)}
              hitSlop={12}
              className="ml-2"
              accessibilityRole="button"
              accessibilityLabel="상품 삭제"
            >
              <MaterialCommunityIcons name="close" size={20} color="#888888" />
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
          onPress={openConfirm}
          disabled={items.length === 0}
          className={`items-center rounded-xl py-3.5 ${
            items.length === 0 ? 'bg-line' : 'bg-primary active:opacity-80'
          }`}
        >
          <Text className="text-paper text-base font-bold">공유하기</Text>
        </Pressable>
      </View>
      <OrderConfirmSheet
        visible={confirmOpen}
        storeName={storeName}
        buildMessage={buildMessage}
        onClose={() => setConfirmOpen(false)}
        onSend={share}
        sending={sending}
      />
    </View>
  );
}
