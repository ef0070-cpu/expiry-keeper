import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProductCard from '@/components/ProductCard';
import { listProductsByBarcode } from '@/lib/repo';
import { Product } from '@/lib/types';

export default function ProductDuplicates() {
  const params = useLocalSearchParams<{
    barcode: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProductsByBarcode(params.barcode).then((matches) => {
      if (cancelled) return;
      if (matches.length === 0) {
        // mount 사이 상태가 바뀐 경합 상황 — 중복 화면 없이 바로 등록 폼으로
        router.replace({
          pathname: '/product-form',
          params: {
            barcode: params.barcode,
            prefillName: params.prefillName ?? '',
            prefillImage: params.prefillImage ?? '',
          },
        });
        return;
      }
      setProducts(matches);
    });
    return () => {
      cancelled = true;
    };
  }, [params.barcode]);

  const goToForm = () => {
    router.replace({
      pathname: '/product-form',
      params: {
        barcode: params.barcode,
        prefillName: params.prefillName ?? '',
        prefillImage: params.prefillImage ?? '',
      },
    });
  };

  if (products === null) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color="#CC2222" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <Text className="text-muted mx-4 mt-4 text-sm leading-5">
        같은 바코드로 이미 등록된 상품이 있어요. 목록을 눌러 확인하거나, 그래도 새로 등록할 수 있어요.
      </Text>

      <ScrollView className="mt-3 flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onPress={() => router.push({ pathname: '/product-form', params: { id: p.id } })}
            onLongPress={() => {}}
          />
        ))}
      </ScrollView>

      <View
        className="flex-row border-t border-line bg-paper px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable
          onPress={() => router.replace('/')}
          className="mr-2 flex-1 items-center rounded-xl border border-line bg-paper py-3 active:opacity-70"
        >
          <Text className="text-ink text-base font-bold">취소</Text>
        </Pressable>
        <Pressable
          onPress={goToForm}
          className="ml-2 flex-1 items-center rounded-xl bg-primary py-3 active:opacity-80"
        >
          <Text className="text-paper text-base font-bold">등록</Text>
        </Pressable>
      </View>
    </View>
  );
}
