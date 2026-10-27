import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  hhmmKst,
  kstNow,
  listOrderHistory,
  ymdKst,
  type OrderHistoryEntry,
} from '@/lib/order-history';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const total = (e: OrderHistoryEntry) => e.items.reduce((a, i) => a + i.qty, 0);
const pad = (n: number) => String(n).padStart(2, '0');

export default function OrderHistoryModal({
  visible,
  onClose,
  onReorder,
}: {
  visible: boolean;
  onClose: () => void;
  onReorder: (entry: OrderHistoryEntry) => void;
}) {
  const insets = useSafeAreaInsets();
  const [hist, setHist] = useState<OrderHistoryEntry[]>([]);
  const [cal, setCal] = useState({ y: 2026, m: 0 }); // m: 0~11
  const [sel, setSel] = useState('');
  const [detail, setDetail] = useState<OrderHistoryEntry | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setDetail(null);
    listOrderHistory().then((list) => {
      if (!alive) return;
      setHist(list);
      const day = list.length ? ymdKst(list[0].ts) : kstNow().ymd;
      setSel(day);
      setCal({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) - 1 });
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  const has = useMemo(() => new Set(hist.map((h) => ymdKst(h.ts))), [hist]);
  const today = kstNow().ymd;
  const { y, m } = cal;
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const list = hist.filter((h) => ymdKst(h.ts) === sel);

  const moveMonth = (d: number) => {
    const t = new Date(Date.UTC(y, m + d, 1));
    setCal({ y: t.getUTCFullYear(), m: t.getUTCMonth() });
  };
  const reorder = (e: OrderHistoryEntry) => {
    onReorder(e);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={detail ? () => setDetail(null) : onClose}>
      <View className="flex-1 bg-ink/40" style={{ paddingTop: insets.top + 24 }}>
        <View className="flex-1 rounded-t-3xl bg-paper px-4 pt-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-ink text-lg font-bold">발주 이력</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="h-12 w-12 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <MaterialCommunityIcons name="close" size={24} color="#888888" />
            </Pressable>
          </View>

          <ScrollView>
            <View className="mb-2 flex-row items-center justify-between">
              <Pressable onPress={() => moveMonth(-1)} className="h-12 w-12 items-center justify-center" accessibilityRole="button" accessibilityLabel="이전 달">
                <Text className="text-ink text-2xl">‹</Text>
              </Pressable>
              <Text className="text-ink text-base font-bold">{y}년 {m + 1}월</Text>
              <Pressable onPress={() => moveMonth(1)} className="h-12 w-12 items-center justify-center" accessibilityRole="button" accessibilityLabel="다음 달">
                <Text className="text-ink text-2xl">›</Text>
              </Pressable>
            </View>

            <View className="flex-row">
              {WEEK.map((w) => (
                <View key={w} className="flex-1 items-center py-1">
                  <Text className="text-muted text-xs">{w}</Text>
                </View>
              ))}
            </View>
            {rows.map((r, ri) => (
              <View key={ri} className="flex-row">
                {r.map((d, ci) => {
                  if (d === null) return <View key={ci} className="flex-1" style={{ height: 48 }} />;
                  const s = `${y}-${pad(m + 1)}-${pad(d)}`;
                  const isSel = s === sel;
                  return (
                    <Pressable
                      key={ci}
                      onPress={() => setSel(s)}
                      className="flex-1 items-center justify-center"
                      style={{ height: 48 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${m + 1}월 ${d}일${has.has(s) ? ' 발주 있음' : ''}`}
                    >
                      <View
                        className={`items-center justify-center rounded-full ${isSel ? 'bg-primary' : ''}`}
                        style={{
                          width: 38,
                          height: 38,
                          borderWidth: s === today ? 2 : 0,
                          borderColor: '#1A1A1A',
                        }}
                      >
                        <Text className={`text-sm ${isSel ? 'font-bold' : 'text-ink'}`} style={isSel ? { color: '#FFFFFF' } : undefined}>
                          {d}
                        </Text>
                        {has.has(s) ? (
                          <View
                            style={{
                              position: 'absolute',
                              bottom: 2,
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: isSel ? '#FFFFFF' : '#2E9E5B',
                            }}
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <Text className="text-muted mb-3 mt-2 text-xs">초록 점은 발주한 날이에요 (한국 시간 기준)</Text>

            {list.length === 0 ? (
              <Text className="text-muted py-4 text-center text-sm">이 날은 발주 기록이 없어요</Text>
            ) : (
              list.map((h) => (
                <View key={h.id} className="mb-3 overflow-hidden rounded-2xl border border-line">
                  <Pressable
                    onPress={() => setDetail(h)}
                    className="px-4 py-3 active:bg-bg"
                    style={{ minHeight: 48 }}
                    accessibilityRole="button"
                    accessibilityLabel="상세 목록 보기"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-ink text-sm font-bold">{h.storeName} · {hhmmKst(h.ts)}</Text>
                      <Text className="text-muted text-sm">총 {total(h)}박스 ›</Text>
                    </View>
                    <Text className="text-ink mt-1 text-sm" numberOfLines={2}>{h.summary}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => reorder(h)}
                    className="items-center justify-center bg-bg active:opacity-70"
                    style={{ minHeight: 48 }}
                    accessibilityRole="button"
                    accessibilityLabel="이대로 다시 담기"
                  >
                    <Text className="text-primary text-sm font-bold">이대로 다시 담기</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>

      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={() => setDetail(null)}>
          {detail ? (
            <Pressable onPress={(e) => e.stopPropagation()} className="w-full rounded-2xl bg-paper p-4" style={{ maxHeight: '85%' }}>
              <Text className="text-ink text-base font-bold">{ymdKst(detail.ts)} · {detail.storeName}</Text>
              <Text className="text-muted mb-2 mt-1 text-xs">
                {hhmmKst(detail.ts)} 발주
                {detail.deliveryDate ? ` · 납품 희망 ${detail.deliveryDate}` : ''}
                {detail.memo ? ` · 메모: ${detail.memo}` : ''}
              </Text>
              <ScrollView style={{ flexGrow: 0 }}>
                {detail.items.map((it, i) => (
                  <View key={`${it.productId}-${i}`} className="flex-row justify-between border-b border-line py-2">
                    <Text className="text-ink flex-1 pr-2 text-sm">{it.name}</Text>
                    <Text className="text-ink text-sm font-bold">{it.qty}박스</Text>
                  </View>
                ))}
              </ScrollView>
              <View className="mt-2 flex-row justify-between">
                <Text className="text-ink text-sm">총 합계 ({detail.items.length}품목)</Text>
                <Text className="text-ink text-sm font-bold">{total(detail)}박스</Text>
              </View>
              <View className="mt-3 flex-row" style={{ gap: 10 }}>
                <Pressable onPress={() => setDetail(null)} className="items-center justify-center rounded-2xl bg-bg active:opacity-70" style={{ flex: 0.6, minHeight: 48 }} accessibilityRole="button">
                  <Text className="text-ink text-sm font-bold">‹ 달력</Text>
                </Pressable>
                <Pressable onPress={() => reorder(detail)} className="bg-primary flex-1 items-center justify-center rounded-2xl active:opacity-80" style={{ minHeight: 48 }} accessibilityRole="button">
                  <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 }}>이대로 다시 담기</Text>
                </Pressable>
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </Modal>
  );
}
