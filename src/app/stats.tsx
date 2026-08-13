import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { listProducts, restoreProduct } from '@/lib/repo';
import { Product, STATUS_LABELS } from '@/lib/types';

export default function Stats() {
  const [items, setItems] = useState<Product[]>([]);

  const load = useCallback(async () => {
    try {
      setItems(await listProducts('resolved'));
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const consumed = items.filter((p) => p.status === 'consumed');
  const discarded = items.filter((p) => p.status === 'discarded');
  const total = consumed.length + discarded.length;
  const discardRate = total > 0 ? Math.round((discarded.length / total) * 100) : null;

  // 월별(YYYY-MM) 소진/폐기 건수 — 최근 순
  const monthly = useMemo(() => {
    const map = new Map<string, { consumed: number; discarded: number }>();
    items.forEach((p) => {
      if (!p.resolvedAt) return;
      const month = p.resolvedAt.slice(0, 7);
      const entry = map.get(month) ?? { consumed: 0, discarded: 0 };
      entry[p.status === 'consumed' ? 'consumed' : 'discarded'] += 1;
      map.set(month, entry);
    });
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const recent = useMemo(
    () => [...items].sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')),
    [items],
  );

  const confirmRestore = (p: Product) => {
    Alert.alert('되돌리기', `'${p.name}' 을(를) 다시 보관 중으로 되돌릴까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '되돌리기',
        onPress: async () => {
          try {
            await restoreProduct(p.id);
            load();
          } catch (e) {
            Alert.alert('처리 실패', e instanceof Error ? e.message : '알 수 없는 오류');
          }
        },
      },
    ]);
  };

  return (
    <FlatList
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={recent}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={
        <>
          {/* 요약 카드 */}
          <View className="flex-row gap-2">
            <Stat label="소진" value={consumed.length} color="text-ok" />
            <Stat label="폐기" value={discarded.length} color="text-primary" />
            <Stat
              label="폐기율"
              value={discardRate === null ? '-' : `${discardRate}%`}
              color="text-ink"
            />
          </View>

          {/* 월별 기록 */}
          {monthly.length > 0 ? (
            <View className="mt-4 rounded-xl border border-line bg-paper p-4">
              <Text className="text-ink text-sm font-bold">월별 기록</Text>
              {monthly.map(([month, counts]) => {
                const sum = counts.consumed + counts.discarded;
                return (
                  <View key={month} className="mt-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-ink text-sm">{month}</Text>
                      <Text className="text-muted text-xs">
                        소진 {counts.consumed} · 폐기 {counts.discarded}
                      </Text>
                    </View>
                    <View className="mt-1.5 h-2 flex-row overflow-hidden rounded-full bg-bg">
                      {sum > 0 ? (
                        <>
                          <View className="bg-ok" style={{ flex: counts.consumed }} />
                          <View className="bg-primary" style={{ flex: counts.discarded }} />
                        </>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              <View className="mt-3 flex-row items-center gap-4">
                <LegendDot className="bg-ok" label="소진" />
                <LegendDot className="bg-primary" label="폐기" />
              </View>
            </View>
          ) : null}

          {recent.length > 0 ? (
            <Text className="text-ink mb-2 mt-5 text-sm font-bold">처리 내역</Text>
          ) : null}
        </>
      }
      renderItem={({ item }) => <ResolvedRow product={item} onRestore={() => confirmRestore(item)} />}
      ListEmptyComponent={
        <View className="mt-20 items-center">
          <MaterialCommunityIcons name="chart-box-outline" size={48} color="#CCCCCC" />
          <Text className="text-muted mt-4 text-base">아직 소진·폐기 기록이 없습니다</Text>
          <Text className="text-muted mt-1 px-8 text-center text-sm">
            대시보드에서 상품을 길게 누르면 소진 완료 또는 폐기로 기록할 수 있어요
          </Text>
        </View>
      }
    />
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View className="flex-1 items-center rounded-xl border border-line bg-paper py-3">
      <Text className={`${color} text-xl font-bold`}>{value}</Text>
      <Text className="text-muted mt-0.5 text-xs">{label}</Text>
    </View>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <View className="flex-row items-center">
      <View className={`${className} h-2 w-2 rounded-full`} />
      <Text className="text-muted ml-1.5 text-xs">{label}</Text>
    </View>
  );
}

function ResolvedRow({ product, onRestore }: { product: Product; onRestore: () => void }) {
  const isConsumed = product.status === 'consumed';
  return (
    <View className="mb-2 flex-row items-center rounded-xl border border-line bg-paper p-3">
      <View
        className={`rounded px-1.5 py-0.5 ${isConsumed ? 'bg-ok' : 'bg-primary'}`}
      >
        <Text className="text-paper text-xs font-bold">{STATUS_LABELS[product.status]}</Text>
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-medium" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-xs">
          {product.resolvedAt ? product.resolvedAt.slice(0, 10) : ''} 처리 · 유통기한{' '}
          {product.expiryDate}
        </Text>
      </View>
      <Pressable
        onPress={onRestore}
        hitSlop={8}
        className="rounded-lg border border-line px-2.5 py-1.5 active:opacity-70"
      >
        <Text className="text-muted text-xs font-medium">되돌리기</Text>
      </Pressable>
    </View>
  );
}
