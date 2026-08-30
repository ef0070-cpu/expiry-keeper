import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import ProductCard from '@/components/ProductCard';
import { daysUntil, todayStr } from '@/lib/dates';
import { cancelExpiryAlerts } from '@/lib/notifications';
import { deleteOrderHistory, listOrderHistory } from '@/lib/order-repo';
import { OrderHistoryEntry } from '@/lib/order-types';
import { deleteProduct, listProducts } from '@/lib/repo';
import { Product } from '@/lib/types';

type Mode = 'day' | 'month' | 'year';

const MODES: { key: Mode; label: string }[] = [
  { key: 'day', label: '일' },
  { key: 'month', label: '월' },
  { key: 'year', label: '년' },
];

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 남은 일수에 따른 점 색상 (DdayBadge와 동일 기준) */
function dotClass(days: number): string {
  if (days < 0) return 'bg-ink';
  if (days <= 1) return 'bg-primary';
  if (days <= 7) return 'bg-warn';
  return 'bg-ok';
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CalendarScreen() {
  const today = todayStr();
  const [products, setProducts] = useState<Product[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryEntry[]>([]);
  const [mode, setMode] = useState<Mode>('day');
  const [cursorYear, setCursorYear] = useState(Number(today.slice(0, 4)));
  const [cursorMonth, setCursorMonth] = useState(Number(today.slice(5, 7))); // 1~12
  const [selectedDay, setSelectedDay] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [selectedYear, setSelectedYear] = useState(today.slice(0, 4)); // YYYY
  const [detailEntry, setDetailEntry] = useState<OrderHistoryEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const [productList, historyList] = await Promise.all([listProducts(), listOrderHistory()]);
      setProducts(productList);
      setOrderHistory(historyList);
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** 날짜별 상품 묶음 (달력 점 표시용) */
  const byDate = useMemo(() => {
    const map = new Map<string, Product[]>();
    products.forEach((p) => {
      const arr = map.get(p.expiryDate) ?? [];
      arr.push(p);
      map.set(p.expiryDate, arr);
    });
    return map;
  }, [products]);

  /** 월(YYYY-MM)·연도(YYYY)별 상품 수 */
  const countByPrefix = useCallback(
    (prefix: string) => products.filter((p) => p.expiryDate.startsWith(prefix)).length,
    [products],
  );

  /** 발주 내역이 있는 날짜 (일 모드 달력 점 표시용) */
  const orderDatesSet = useMemo(
    () => new Set(orderHistory.map((e) => e.dateKey)),
    [orderHistory],
  );

  /** 선택된 날짜의 발주 내역 */
  const dayHistory = useMemo(
    () => orderHistory.filter((e) => e.dateKey === selectedDay),
    [orderHistory, selectedDay],
  );

  const confirmDeleteHistory = (entry: OrderHistoryEntry) => {
    Alert.alert('발주 내역 삭제', `${entry.branch} 발주 내역을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteOrderHistory(entry.id);
          load();
        },
      },
    ]);
  };

  /** 하단 목록: 선택된 기간에 유통기한이 걸린 상품 */
  const listed = useMemo(() => {
    const prefix =
      mode === 'day' ? selectedDay : mode === 'month' ? selectedMonth : selectedYear;
    return products
      .filter((p) => p.expiryDate.startsWith(prefix))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }, [products, mode, selectedDay, selectedMonth, selectedYear]);

  const listLabel = useMemo(() => {
    if (mode === 'day') {
      const [, m, d] = selectedDay.split('-').map(Number);
      return `${m}월 ${d}일`;
    }
    if (mode === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      return `${y}년 ${m}월`;
    }
    return `${selectedYear}년`;
  }, [mode, selectedDay, selectedMonth, selectedYear]);

  // ── 달력 이동 ──────────────────────────────────────────────
  const yearWindowStart = Math.floor(cursorYear / 12) * 12;

  const moveCursor = (dir: -1 | 1) => {
    if (mode === 'day') {
      const next = new Date(cursorYear, cursorMonth - 1 + dir, 1);
      setCursorYear(next.getFullYear());
      setCursorMonth(next.getMonth() + 1);
    } else if (mode === 'month') {
      setCursorYear((y) => y + dir);
    } else {
      setCursorYear((y) => y + dir * 12);
    }
  };

  const headerTitle =
    mode === 'day'
      ? `${cursorYear}년 ${cursorMonth}월`
      : mode === 'month'
        ? `${cursorYear}년`
        : `${yearWindowStart} – ${yearWindowStart + 11}`;

  // ── 일 모드: 날짜 그리드 ──────────────────────────────────
  const dayWeeks = useMemo(() => {
    const offset = new Date(cursorYear, cursorMonth - 1, 1).getDay();
    const daysInMonth = new Date(cursorYear, cursorMonth, 0).getDate();
    const cells: (number | null)[] = [
      ...Array<null>(offset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [cursorYear, cursorMonth]);

  const confirmDelete = (p: Product) => {
    Alert.alert('상품 삭제', `'${p.name}' 을(를) 삭제할까요?`, [
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

  return (
    <View className="flex-1 bg-bg">
      {/* ── 상단 60%: 달력 ── */}
      <View style={{ flex: 6 }} className="bg-paper">
        {/* 모드 전환 + 이동 */}
        <View className="flex-row items-center justify-between px-4 pt-3">
          <View className="flex-row rounded-lg border border-line bg-bg p-0.5">
            {MODES.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => setMode(m.key)}
                className={`rounded-md px-4 py-1.5 ${mode === m.key ? 'bg-primary' : ''}`}
              >
                <Text
                  className={`text-sm font-bold ${mode === m.key ? 'text-paper' : 'text-muted'}`}
                >
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-row items-center">
            <Pressable
              onPress={() => moveCursor(-1)}
              hitSlop={8}
              className="p-1"
              accessibilityRole="button"
              accessibilityLabel="이전"
            >
              <MaterialCommunityIcons name="chevron-left" size={26} color="#1A1A1A" />
            </Pressable>
            <Text className="text-ink mx-1 min-w-[110px] text-center text-base font-bold">
              {headerTitle}
            </Text>
            <Pressable
              onPress={() => moveCursor(1)}
              hitSlop={8}
              className="p-1"
              accessibilityRole="button"
              accessibilityLabel="다음"
            >
              <MaterialCommunityIcons name="chevron-right" size={26} color="#1A1A1A" />
            </Pressable>
          </View>
        </View>

        {/* 일 모드: 월간 달력 */}
        {mode === 'day' ? (
          <View className="flex-1 px-3 pb-2 pt-2">
            <View className="flex-row">
              {WEEKDAYS.map((w, i) => (
                <View key={w} className="flex-1 items-center py-1">
                  <Text
                    className={`text-xs font-medium ${
                      i === 0 ? 'text-primary' : i === 6 ? 'text-muted' : 'text-muted'
                    }`}
                  >
                    {w}
                  </Text>
                </View>
              ))}
            </View>
            {dayWeeks.map((week, wi) => (
              <View key={wi} className="flex-1 flex-row">
                {week.map((day, di) => {
                  if (day === null) return <View key={di} className="flex-1" />;
                  const dateStr = `${cursorYear}-${pad(cursorMonth)}-${pad(day)}`;
                  const items = byDate.get(dateStr) ?? [];
                  const isSelected = dateStr === selectedDay;
                  const isToday = dateStr === today;
                  return (
                    <Pressable
                      key={di}
                      onPress={() => setSelectedDay(dateStr)}
                      className="flex-1 items-center justify-center"
                    >
                      <View
                        className={`h-8 w-8 items-center justify-center rounded-full ${
                          isSelected ? 'bg-primary' : isToday ? 'border border-primary' : ''
                        }`}
                      >
                        <Text
                          className={`text-sm ${
                            isSelected
                              ? 'text-paper font-bold'
                              : isToday
                                ? 'text-primary font-bold'
                                : di === 0
                                  ? 'text-primary'
                                  : 'text-ink'
                          }`}
                        >
                          {day}
                        </Text>
                      </View>
                      <View className="mt-0.5 h-1.5 flex-row" style={{ gap: 2 }}>
                        {items.slice(0, 3).map((p) => (
                          <View
                            key={p.id}
                            className={`h-1.5 w-1.5 rounded-full ${dotClass(
                              daysUntil(p.expiryDate),
                            )}`}
                          />
                        ))}
                      </View>
                      <View className="mt-0.5 h-1.5 w-1.5">
                        {orderDatesSet.has(dateStr) ? (
                          <View
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: '#8B5CF6' }}
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        {/* 월 모드: 12개월 그리드 */}
        {mode === 'month' ? (
          <View className="flex-1 flex-row flex-wrap px-3 pb-2 pt-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const prefix = `${cursorYear}-${pad(m)}`;
              const count = countByPrefix(prefix);
              const isSelected = prefix === selectedMonth;
              return (
                <Pressable
                  key={m}
                  onPress={() => setSelectedMonth(prefix)}
                  className="items-center justify-center p-1"
                  style={{ width: '25%', height: '33.3%' }}
                >
                  <View
                    className={`w-full flex-1 items-center justify-center rounded-xl border ${
                      isSelected ? 'border-primary bg-primary' : 'border-line bg-bg'
                    }`}
                  >
                    <Text
                      className={`text-base font-bold ${isSelected ? 'text-paper' : 'text-ink'}`}
                    >
                      {m}월
                    </Text>
                    {count > 0 ? (
                      <Text
                        className={`mt-0.5 text-xs ${isSelected ? 'text-paper' : 'text-primary'}`}
                      >
                        {count}개
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* 년 모드: 12개 연도 그리드 */}
        {mode === 'year' ? (
          <View className="flex-1 flex-row flex-wrap px-3 pb-2 pt-2">
            {Array.from({ length: 12 }, (_, i) => yearWindowStart + i).map((y) => {
              const prefix = String(y);
              const count = countByPrefix(prefix);
              const isSelected = prefix === selectedYear;
              return (
                <Pressable
                  key={y}
                  onPress={() => setSelectedYear(prefix)}
                  className="items-center justify-center p-1"
                  style={{ width: '25%', height: '33.3%' }}
                >
                  <View
                    className={`w-full flex-1 items-center justify-center rounded-xl border ${
                      isSelected ? 'border-primary bg-primary' : 'border-line bg-bg'
                    }`}
                  >
                    <Text
                      className={`text-base font-bold ${isSelected ? 'text-paper' : 'text-ink'}`}
                    >
                      {y}
                    </Text>
                    {count > 0 ? (
                      <Text
                        className={`mt-0.5 text-xs ${isSelected ? 'text-paper' : 'text-primary'}`}
                      >
                        {count}개
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* ── 하단 40%: 임박 목록 ── */}
      <View style={{ flex: 4 }} className="border-t border-line">
        {mode === 'day' && dayHistory.length > 0 ? (
          <View className="border-b border-line bg-paper px-4 pb-2 pt-3">
            {dayHistory.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => setDetailEntry(entry)}
                className="mb-2 rounded-lg bg-bg p-2.5 active:opacity-70"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: '#8B5CF6' }}
                    />
                    <Text className="text-ink text-sm font-bold">{entry.branch} 발주 1건</Text>
                  </View>
                  <Text className="text-muted text-xs">{formatTime(entry.sentAt)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center px-4 pb-2 pt-3">
          <MaterialCommunityIcons name="clock-alert-outline" size={18} color="#CC2222" />
          <Text className="text-ink ml-1.5 text-sm font-bold">{listLabel} 유통기한 상품</Text>
          <Text className="text-muted ml-1.5 text-sm">{listed.length}</Text>
        </View>
        <FlatList
          data={listed}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={() => router.push({ pathname: '/product-form', params: { id: item.id } })}
              onLongPress={() => confirmDelete(item)}
            />
          )}
          ListEmptyComponent={
            <View className="mt-6 items-center">
              <MaterialCommunityIcons name="calendar-check-outline" size={32} color="#CCCCCC" />
              <Text className="text-muted mt-2 text-sm">해당 기간에 유통기한 상품이 없습니다</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      </View>

      <Modal
        visible={!!detailEntry}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailEntry(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => setDetailEntry(null)}
        >
          {detailEntry ? (
            <Pressable
              onPress={(e) => e.stopPropagation()}
              className="w-full rounded-2xl bg-paper p-5"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-ink text-lg font-bold">{detailEntry.branch} 발주 내역</Text>
                <Pressable
                  onPress={() => setDetailEntry(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="닫기"
                >
                  <MaterialCommunityIcons name="close" size={22} color="#1A1A1A" />
                </Pressable>
              </View>
              <Text className="text-muted mt-1 text-xs">
                {detailEntry.dateKey} {formatTime(detailEntry.sentAt)} 전송
              </Text>

              <ScrollView className="mt-3" style={{ maxHeight: 320 }}>
                {detailEntry.items.map((it, i) => (
                  <View
                    key={`${it.productId}-${i}`}
                    className="flex-row items-center justify-between border-b border-line py-2"
                  >
                    <Text className="text-ink flex-1 text-sm" numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text className="text-primary ml-2 text-sm font-bold">{it.qty}박스</Text>
                  </View>
                ))}
              </ScrollView>

              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-ink text-sm font-bold">
                  총 {detailEntry.totalBoxes}박스
                </Text>
                <Pressable
                  onPress={() => {
                    const entry = detailEntry;
                    setDetailEntry(null);
                    confirmDeleteHistory(entry);
                  }}
                >
                  <Text className="text-primary text-sm underline">삭제</Text>
                </Pressable>
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}
