import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import Thumbnail from '@/components/Thumbnail';
import {
  addFridgeSection,
  addOrderCategory,
  addStore,
  assignToFridgeSection,
  CatalogUpdateBadge,
  clearCatalogUpdateBadge,
  deleteFridgeSection,
  deleteOrderCategory,
  deleteOrderProduct,
  deleteStore,
  getActiveStoreId,
  getCatalogUpdateBadges,
  getOrderCart,
  listFridgeAssignments,
  listFridgeSections,
  listOrderCategories,
  listOrderProducts,
  listStores,
  removeFromFridgeSection,
  renameFridgeSection,
  renameOrderCategory,
  renameStore,
  saveOrderProduct,
  seedDefaultOrderProducts,
  setActiveStoreId,
  syncOrderCatalog,
  writeOrderCart,
} from '@/lib/order-repo';
import { FridgeAssignment, FridgeSection, OrderCart, OrderProduct, OrderStatus, Store } from '@/lib/order-types';
import { searchOrderProducts } from '@/lib/order-search';

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  active: { label: '시판중', color: '#2E7D32' },
  discontinued: { label: '단종', color: '#C62828' },
  paused: { label: '생산중단', color: '#F9A825' },
};

const UPDATE_BADGE_META: Record<CatalogUpdateBadge, { label: string; color: string }> = {
  new: { label: '신규', color: '#2962FF' },
  updated: { label: '수정', color: '#F9A825' },
};

export default function Order() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cart, setCart] = useState<OrderCart>({});
  const [updateBadges, setUpdateBadges] = useState<Map<string, CatalogUpdateBadge>>(new Map());
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [mode, setMode] = useState<'search' | 'quick'>('search');
  const [fridgeAssignments, setFridgeAssignments] = useState<FridgeAssignment[]>([]);
  const [fridgeSections, setFridgeSections] = useState<FridgeSection[]>([]);
  const [activeSection, setActiveSection] = useState<FridgeSection>('');
  const [showFridgeSectionModal, setShowFridgeSectionModal] = useState(false);
  const [showAddToFridge, setShowAddToFridge] = useState(false);
  const [movingProduct, setMovingProduct] = useState<OrderProduct | null>(null);
  const [fridgeSearchQuery, setFridgeSearchQuery] = useState('');
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();

  const loadCatalog = useCallback(async () => {
    const [productList, categoryList, cartData, badges, storeList, activeId, sections] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
      getCatalogUpdateBadges(),
      listStores(),
      getActiveStoreId(),
      listFridgeSections(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setCart(cartData);
    setUpdateBadges(badges);
    setStores(storeList);
    setActiveStoreIdState(activeId);
    setFridgeAssignments(activeId ? await listFridgeAssignments(activeId) : []);
    setFridgeSections(sections);
    // 현재 선택된 구역이 삭제/이름변경 등으로 더는 목록에 없으면 첫 구역으로 되돌린다.
    setActiveSection((prev) => (sections.includes(prev) ? prev : (sections[0] ?? '')));
  }, []);

  const switchStore = useCallback(
    async (id: string | null) => {
      await setActiveStoreId(id);
      setActiveStoreIdState(id);
      setShowStoreModal(false);
      await loadCatalog();
    },
    [loadCatalog],
  );

  const onAddStore = useCallback(
    async (name: string) => {
      const next = await addStore(name);
      setStores(next);
      const created = next[next.length - 1];
      if (created) await switchStore(created.id);
    },
    [switchStore],
  );

  const onRenameStore = useCallback(async (id: string, name: string) => {
    setStores(await renameStore(id, name));
  }, []);

  const onDeleteStore = useCallback(
    (id: string, name: string) => {
      Alert.alert('매장 삭제', `'${name}' 매장을 삭제할까요? 이 매장의 장바구니도 함께 삭제됩니다.`, [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            const wasActive = activeStoreId === id;
            const next = await deleteStore(id);
            setStores(next);
            if (wasActive) await loadCatalog();
          },
        },
      ]);
    },
    [activeStoreId, loadCatalog],
  );

  const onAddFridgeSection = useCallback(async (name: string) => {
    setFridgeSections(await addFridgeSection(name));
  }, []);

  const onRenameFridgeSection = useCallback(
    async (from: string, to: string) => {
      setFridgeSections(await renameFridgeSection(from, to));
      // 현재 보고 있는 구역이 방금 바뀐 그 구역이면 표시도 새 이름으로 맞춘다.
      setActiveSection((prev) => (prev === from ? to : prev));
      if (activeStoreId) setFridgeAssignments(await listFridgeAssignments(activeStoreId));
    },
    [activeStoreId],
  );

  const onDeleteFridgeSection = useCallback(
    (name: string) => {
      Alert.alert(
        '구역 삭제',
        `'${name}' 구역을 삭제할까요? 모든 매장에서 이 구역에 배정된 상품 정보도 함께 사라집니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              setFridgeSections(await deleteFridgeSection(name));
              if (activeStoreId) setFridgeAssignments(await listFridgeAssignments(activeStoreId));
            },
          },
        ],
      );
    },
    [activeStoreId],
  );

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

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // 검색어를 지우면(새로 검색 시작) 접었던 드롭다운도 다음 검색부터는 기본적으로 다시 펼쳐지게 초기화.
  useEffect(() => {
    if (!query.trim()) setSuggestionsCollapsed(false);
  }, [query]);

  // 검색어를 낮은 우선순위로 반영 — 388종 카탈로그에서 매 키 입력마다 즉시 전체
  // 재필터링하면 저사양 기기에서 입력이 밀릴 수 있어, React가 재계산을 뒤로 미루게 한다.
  const deferredQuery = useDeferredValue(query);

  // 공용 카탈로그 동기화로 새로 생기거나(신규) 정보가 바뀐(수정) 상품을 최상단에 모아 보여준다.
  const hasBadge = useCallback(
    (p: OrderProduct) => (p.barcode ? updateBadges.has(p.barcode) : false),
    [updateBadges],
  );

  const filtered = useMemo(() => {
    const byCategory = products.filter(
      (p) => selectedCategory === '전체' || p.category === selectedCategory,
    );
    const badgeSorted = [...byCategory].sort((a, b) => Number(hasBadge(b)) - Number(hasBadge(a)));
    const q = deferredQuery.trim();
    if (!q) return badgeSorted;
    // 검색 중엔 관련도(완전일치>시작일치>부분일치>초성/자모>오타허용)가 우선, 같은 등급 안에서는
    // 신규/수정 뱃지가 있는 상품이 위로 온다(searchOrderProducts의 등급 정렬은 안정정렬).
    return searchOrderProducts(badgeSorted, q);
  }, [products, deferredQuery, selectedCategory, hasBadge]);

  // 카테고리 탭과 무관하게 전체 상품에서 찾는 자동완성 제안 — 검색창 바로 아래 드롭다운으로
  // 뜨는 용도라 5개로 제한한다 (스크롤 없는 빠른 담기 목적, 전체 목록은 아래에 그대로 있음).
  const suggestions = useMemo(() => {
    const q = deferredQuery.trim();
    if (!q) return [];
    return searchOrderProducts(products, q).slice(0, 5);
  }, [products, deferredQuery]);

  // 빠른발주: 현재 구역에 배정되고 상태가 시판중인 상품만 그리드에 보여준다(단종/일시중지는
  // 자동 숨김 — 다시 active로 바꾸면 배정 정보가 남아 있어 별도 조작 없이 재노출됨).
  const fridgeProducts = useMemo(() => {
    const idsInSection = new Set(
      fridgeAssignments.filter((a) => a.section === activeSection).map((a) => a.productId),
    );
    return products.filter((p) => idsInSection.has(p.id) && (p.status ?? 'active') === 'active');
  }, [products, fridgeAssignments, activeSection]);

  const fridgeSectionByProductId = useMemo(
    () => new Map(fridgeAssignments.map((a) => [a.productId, a.section])),
    [fridgeAssignments],
  );

  // 빠른발주 전용 검색: 388종 전체가 아니라 이 매장에 진열(배정)된 상품만 대상으로 한다.
  const quickSearchResults = useMemo(() => {
    const q = quickSearchQuery.trim();
    if (!q) return [];
    const assignedProducts = products.filter(
      (p) => fridgeSectionByProductId.has(p.id) && (p.status ?? 'active') === 'active',
    );
    return searchOrderProducts(assignedProducts, q).slice(0, 8);
  }, [products, fridgeSectionByProductId, quickSearchQuery]);

  const onAddToFridge = useCallback(
    async (productId: string) => {
      if (!activeStoreId) return;
      setFridgeAssignments(await assignToFridgeSection(activeStoreId, productId, activeSection));
      setShowAddToFridge(false);
      setFridgeSearchQuery('');
    },
    [activeStoreId, activeSection],
  );

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

  // 자동완성 드롭다운의 상품명 탭 전용: 1개 담고 검색어를 지워 드롭다운도 함께 닫는다.
  // 2개 이상 담고 싶으면 드롭다운 안의 -/+ 스테퍼(changeQty)로 닫지 않고 조절한다.
  // 담긴 뒤 검색어가 바로 지워져 화면이 바뀌므로, 실제로 담겼다는 걸 알려주는 짧은 토스트를 띄운다.
  const quickAdd = useCallback(
    (productId: string, name: string) => {
      changeQty(productId, 1);
      setQuery('');
      setToastMessage(`${name} 담았어요`);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 1500);
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

  const handleOpenProduct = useCallback((id: string, barcode: string | null) => {
    if (barcode && updateBadges.has(barcode)) {
      setUpdateBadges((prev) => {
        const next = new Map(prev);
        next.delete(barcode);
        return next;
      });
      clearCatalogUpdateBadge(barcode).catch(() => {});
    }
    router.push({ pathname: '/order-product-form', params: { id } });
  }, [updateBadges]);

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

  // '이 구역에서 빼기'는 타일의 휴지통 아이콘으로, '상태 변경'은 빠른발주에서 불필요해
  // 제외했다(검색발주 쪽 onLongPressProduct에는 그대로 남아있음).
  const onLongPressFridgeTile = useCallback((p: OrderProduct) => {
    Alert.alert(p.name, '어떻게 처리할까요?', [
      { text: '다른 구역으로 이동', onPress: () => setMovingProduct(p) },
      {
        text: '상품수정',
        onPress: () => router.push({ pathname: '/order-product-form', params: { id: p.id } }),
      },
      { text: '취소', style: 'cancel' },
    ]);
  }, []);

  const onMoveFridgeTile = useCallback(
    async (section: FridgeSection) => {
      if (!activeStoreId || !movingProduct) return;
      setFridgeAssignments(await assignToFridgeSection(activeStoreId, movingProduct.id, section));
      setMovingProduct(null);
    },
    [activeStoreId, movingProduct],
  );

  const onRemoveFridgeTile = useCallback(
    (p: OrderProduct) => {
      Alert.alert('구역에서 빼기', `'${p.name}'을(를) '${activeSection}' 구역에서 뺄까요?`, [
        { text: '취소', style: 'cancel' },
        {
          text: '빼기',
          style: 'destructive',
          onPress: async () => {
            if (!activeStoreId) return;
            setFridgeAssignments(await removeFromFridgeSection(activeStoreId, p.id));
          },
        },
      ]);
    },
    [activeStoreId, activeSection],
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

      <Pressable
        onPress={() => setShowStoreModal(true)}
        className="mx-4 mt-3 flex-row items-center self-start rounded-full border border-line bg-paper px-3 py-1.5 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="매장 선택"
      >
        <MaterialCommunityIcons name="storefront-outline" size={16} color="#1A1A1A" />
        <Text className="text-ink ml-1.5 text-sm font-medium">
          {stores.find((s) => s.id === activeStoreId)?.name ?? '매장 선택 안 함'}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color="#888888" />
      </Pressable>

      <StoreSwitcherModal
        visible={showStoreModal}
        stores={stores}
        activeStoreId={activeStoreId}
        onSelect={switchStore}
        onAdd={onAddStore}
        onRename={onRenameStore}
        onDelete={onDeleteStore}
        onClose={() => setShowStoreModal(false)}
      />

      <View className="mx-4 mt-3 flex-row gap-2">
        <Pressable
          onPress={() => setMode('search')}
          className={`flex-1 items-center rounded-xl border py-2.5 ${
            mode === 'search' ? 'border-primary' : 'border-line'
          }`}
        >
          <Text className={`text-sm font-bold ${mode === 'search' ? 'text-primary' : 'text-ink'}`}>
            검색발주
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('quick')}
          className={`flex-1 items-center rounded-xl border py-2.5 ${
            mode === 'quick' ? 'border-primary' : 'border-line'
          }`}
        >
          <Text className={`text-sm font-bold ${mode === 'quick' ? 'text-primary' : 'text-ink'}`}>
            빠른발주
          </Text>
        </Pressable>
      </View>

      {toastMessage ? (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 z-20 items-center"
          style={{ top: insets.top + 76 }}
        >
          <View className="rounded-full bg-ink/80 px-4 py-2">
            <Text className="text-paper text-sm font-medium">{toastMessage}</Text>
          </View>
        </View>
      ) : null}

      {mode === 'search' ? (
        <>
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
              {suggestions.length > 0 ? (
                <Pressable
                  onPress={() => setSuggestionsCollapsed((v) => !v)}
                  hitSlop={8}
                  className="ml-2"
                  accessibilityRole="button"
                  accessibilityLabel={suggestionsCollapsed ? '추천 목록 펼치기' : '추천 목록 접기'}
                >
                  <MaterialCommunityIcons
                    name={suggestionsCollapsed ? 'chevron-down' : 'chevron-up'}
                    size={20}
                    color="#888888"
                  />
                </Pressable>
              ) : null}
            </View>
            {suggestions.length > 0 && !suggestionsCollapsed ? (
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

          <Text className="text-muted mt-2 px-4 text-xs">
            기본 제공되는 데이터입니다. 카테고리·사진·품명은 편하신 대로 자유롭게 수정하세요.
          </Text>

          <FlatList
            key="search-list"
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 + insets.bottom }}
            renderItem={({ item }) => (
              <CatalogRow
                product={item}
                qty={cart[item.id] ?? 0}
                badge={item.barcode ? updateBadges.get(item.barcode) : undefined}
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
        </>
      ) : !activeStoreId ? (
        <View className="mt-16 items-center px-6">
          <MaterialCommunityIcons name="storefront-outline" size={40} color="#CCCCCC" />
          <Text className="text-muted mt-3 text-center text-sm">
            빠른발주는 매장별 진열 정보가 필요해요.{'\n'}위에서 매장을 먼저 선택하거나 추가해 주세요.
          </Text>
        </View>
      ) : (
        <>
          <Text className="text-muted mx-4 mt-2 text-xs">
            매장 냉동고에 따라 상품 구역을 설정하세요.
          </Text>
          <View className="mx-4 mt-2">
            <View className="flex-row items-center rounded-xl border border-line bg-paper px-3">
              <MaterialCommunityIcons name="magnify" size={18} color="#888888" />
              <TextInput
                className="text-ink ml-2 flex-1 py-2 text-sm"
                placeholder="냉장고 진열 상품 중에서 찾기"
                placeholderTextColor="#BBBBBB"
                value={quickSearchQuery}
                onChangeText={setQuickSearchQuery}
              />
            </View>
            {quickSearchResults.length > 0 ? (
              <View className="mt-1 overflow-hidden rounded-xl border border-line bg-paper">
                {quickSearchResults.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      const section = fridgeSectionByProductId.get(p.id);
                      if (section) setActiveSection(section);
                      setQuickSearchQuery('');
                    }}
                    className="flex-row items-center justify-between border-b border-line px-3 py-2.5"
                  >
                    <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-muted ml-2 text-xs">
                      🧊 {fridgeSectionByProductId.get(p.id)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View className="mt-3 flex-row flex-wrap items-center gap-2 px-4">
            {fridgeSections.map((s) => (
              <Chip key={s} label={s} active={activeSection === s} onPress={() => setActiveSection(s)} />
            ))}
            <Pressable
              onPress={() => setShowFridgeSectionModal(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="구역 관리"
            >
              <MaterialCommunityIcons name="pencil-outline" size={18} color="#888888" />
            </Pressable>
          </View>
          <FridgeSectionModal
            visible={showFridgeSectionModal}
            sections={fridgeSections}
            onAdd={onAddFridgeSection}
            onRename={onRenameFridgeSection}
            onDelete={onDeleteFridgeSection}
            onClose={() => setShowFridgeSectionModal(false)}
          />
          <FlatList
            key="quick-grid"
            data={fridgeProducts}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }}
            columnWrapperStyle={{ gap: 10 }}
            ListHeaderComponent={
              <Pressable
                onPress={() => setShowAddToFridge(true)}
                className="mb-3 flex-row items-center justify-center rounded-xl border border-dashed border-line py-3"
              >
                <MaterialCommunityIcons name="plus" size={18} color="#888888" />
                <Text className="text-muted ml-1.5 text-sm font-medium">
                  '{activeSection}' 구역에 상품 추가
                </Text>
              </Pressable>
            }
            renderItem={({ item }) => (
              <FridgeTile
                product={item}
                qty={cart[item.id] ?? 0}
                onTap={() => changeQty(item.id, 1)}
                onDecrement={() => changeQty(item.id, -1)}
                onLongPress={() => onLongPressFridgeTile(item)}
                onRemove={() => onRemoveFridgeTile(item)}
              />
            )}
            ListEmptyComponent={
              <Text className="text-muted mt-8 text-center text-sm">
                이 구역에 등록된 상품이 없습니다. 위 버튼으로 추가해 보세요.
              </Text>
            }
          />
          <AddToFridgeModal
            visible={showAddToFridge}
            section={activeSection}
            allProducts={products}
            assignedIds={new Set(fridgeAssignments.map((a) => a.productId))}
            query={fridgeSearchQuery}
            onChangeQuery={setFridgeSearchQuery}
            onPick={onAddToFridge}
            onClose={() => {
              setShowAddToFridge(false);
              setFridgeSearchQuery('');
            }}
          />
          <MoveToSectionModal
            visible={movingProduct !== null}
            productName={movingProduct?.name ?? ''}
            currentSection={movingProduct ? fridgeSectionByProductId.get(movingProduct.id) : undefined}
            sections={fridgeSections}
            onPick={onMoveFridgeTile}
            onClose={() => setMovingProduct(null)}
          />
        </>
      )}

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

const FridgeTile = memo(function FridgeTile({
  product,
  qty,
  onTap,
  onDecrement,
  onLongPress,
  onRemove,
}: {
  product: OrderProduct;
  qty: number;
  onTap: () => void;
  onDecrement: () => void;
  onLongPress: () => void;
  onRemove: () => void;
}) {
  return (
    <Pressable
      onPress={onTap}
      onLongPress={onLongPress}
      className="mb-3 flex-1 items-center rounded-xl border border-line bg-paper p-2 active:opacity-70"
      style={{ maxWidth: '31%' }}
    >
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        className="absolute right-1 top-1 z-10 h-6 w-6 items-center justify-center rounded-full bg-paper"
        accessibilityRole="button"
        accessibilityLabel={`${product.name} 이 구역에서 빼기`}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={15} color="#BBBBBB" />
      </Pressable>
      <Thumbnail uri={product.imageUri} size={64} radius={8} iconSize={22} />
      <Text className="text-ink mt-1.5 text-center text-xs font-bold" numberOfLines={2}>
        {product.name}
      </Text>
      {qty > 0 ? (
        <View className="mt-1.5 flex-row items-center gap-2">
          <Pressable
            onPress={onDecrement}
            hitSlop={10}
            className="h-8 w-8 items-center justify-center rounded-full border border-line bg-bg active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel={`${product.name} 수량 감소`}
          >
            <MaterialCommunityIcons name="minus" size={17} color="#1A1A1A" />
          </Pressable>
          <Text
            className="text-ink w-5 text-center text-sm font-bold"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {qty}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

const MoveToSectionModal = memo(function MoveToSectionModal({
  visible,
  productName,
  currentSection,
  sections,
  onPick,
  onClose,
}: {
  visible: boolean;
  productName: string;
  currentSection?: FridgeSection;
  sections: FridgeSection[];
  onPick: (section: FridgeSection) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '70%' }}
        >
          <Text className="text-ink mb-2 text-base font-bold" numberOfLines={1}>
            '{productName}' 어느 구역으로 옮길까요?
          </Text>
          {sections
            .filter((s) => s !== currentSection)
            .map((s) => (
              <Pressable
                key={s}
                onPress={() => onPick(s)}
                className="rounded-xl px-3 py-3 active:bg-bg"
              >
                <Text className="text-ink text-sm font-medium">{s}</Text>
              </Pressable>
            ))}
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const AddToFridgeModal = memo(function AddToFridgeModal({
  visible,
  section,
  allProducts,
  assignedIds,
  query,
  onChangeQuery,
  onPick,
  onClose,
}: {
  visible: boolean;
  section: FridgeSection;
  allProducts: OrderProduct[];
  assignedIds: Set<string>;
  query: string;
  onChangeQuery: (q: string) => void;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const results = useMemo(() => {
    const base = query.trim() ? searchOrderProducts(allProducts, query) : allProducts;
    return base.filter((p) => !assignedIds.has(p.id)).slice(0, 30);
  }, [allProducts, assignedIds, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '75%' }}
        >
          <Text className="text-ink mb-2 text-base font-bold">'{section}' 구역에 상품 추가</Text>
          <TextInput
            className="text-ink mb-2 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
            placeholder="상품명 검색"
            placeholderTextColor="#BBBBBB"
            value={query}
            onChangeText={onChangeQuery}
          />
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item.id)}
                className="flex-row items-center border-b border-line py-2.5"
              >
                <Thumbnail uri={item.imageUri} size={36} radius={6} iconSize={16} />
                <Text className="text-ink ml-2.5 flex-1 text-sm font-medium" numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text className="text-muted py-6 text-center text-sm">검색 결과가 없습니다</Text>
            }
          />
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const CatalogRow = memo(function CatalogRow({
  product,
  qty,
  badge,
  onChangeQty,
  onPress,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  badge?: CatalogUpdateBadge;
  onChangeQty: (id: string, delta: number) => void;
  onPress: (id: string, barcode: string | null) => void;
  onLongPress: (product: OrderProduct) => void;
}) {
  const statusMeta = STATUS_META[product.status ?? 'active'];
  const badgeMeta = badge ? UPDATE_BADGE_META[badge] : null;
  return (
    <Pressable
      onPress={() => onPress(product.id, product.barcode)}
      onLongPress={() => onLongPress(product)}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      <Thumbnail uri={product.imageUri} size={56} radius={8} iconSize={22} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center gap-1.5">
          {badgeMeta ? (
            <View
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: badgeMeta.color }}
            >
              <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
                {badgeMeta.label}
              </Text>
            </View>
          ) : null}
          <Text className="text-ink text-base font-bold" numberOfLines={1}>
            {product.name}
          </Text>
        </View>
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
  onQuickAdd: (id: string, name: string) => void;
}) {
  return (
    <View className="flex-row items-center border-b border-line px-3 py-2">
      <Pressable
        onPress={() => onQuickAdd(product.id, product.name)}
        className="flex-1 pr-2 active:opacity-60"
        accessibilityRole="button"
        accessibilityLabel={`${product.name} 1개 담기`}
      >
        <Text className="text-ink text-sm font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
          {product.brand} · {product.price.toLocaleString()}원
        </Text>
      </Pressable>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChangeQty(product.id, -1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="수량 감소"
        >
          <MaterialCommunityIcons name="minus" size={20} color="#1A1A1A" />
        </Pressable>
        <Text
          className="text-ink mx-2.5 w-6 text-center text-base font-bold"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {qty}
        </Text>
        <Pressable
          onPress={() => onChangeQty(product.id, 1)}
          className="h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="수량 증가"
        >
          <MaterialCommunityIcons name="plus" size={20} color="#1A1A1A" />
        </Pressable>
      </View>
    </View>
  );
});

const FridgeSectionModal = memo(function FridgeSectionModal({
  visible,
  sections,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: {
  visible: boolean;
  sections: string[];
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const submitAdd = () => {
    const v = newName.trim();
    if (!v) return;
    onAdd(v);
    setNewName('');
  };

  const startRename = (name: string) => {
    setEditingName(name);
    setEditingValue(name);
  };

  const submitRename = () => {
    const v = editingValue.trim();
    if (v && editingName && v !== editingName) onRename(editingName, v);
    setEditingName(null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '70%' }}
        >
          <Text className="text-ink mb-2 text-base font-bold">구역 관리</Text>

          {sections.map((s) =>
            editingName === s ? (
              <View key={s} className="flex-row items-center gap-2 px-3 py-2">
                <TextInput
                  className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                  value={editingValue}
                  onChangeText={setEditingValue}
                  onSubmitEditing={submitRename}
                  autoFocus
                />
                <Pressable onPress={submitRename} hitSlop={8}>
                  <Text className="text-primary text-sm font-medium">저장</Text>
                </Pressable>
                <Pressable onPress={() => setEditingName(null)} hitSlop={8}>
                  <Text className="text-muted text-sm">취소</Text>
                </Pressable>
              </View>
            ) : (
              <View key={s} className="flex-row items-center justify-between rounded-xl px-3 py-3">
                <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                  {s}
                </Text>
                <Pressable onPress={() => startRename(s)} hitSlop={8} className="ml-3">
                  <MaterialCommunityIcons name="pencil-outline" size={18} color="#888888" />
                </Pressable>
                <Pressable onPress={() => onDelete(s)} hitSlop={8} className="ml-3">
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#888888" />
                </Pressable>
              </View>
            ),
          )}

          <View className="mt-3 flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="새 구역 이름 (예: 1400콘류)"
              placeholderTextColor="#BBBBBB"
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={submitAdd}
            />
            <Pressable
              onPress={submitAdd}
              className="items-center justify-center rounded-xl border border-line bg-bg px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">추가</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const StoreSwitcherModal = memo(function StoreSwitcherModal({
  visible,
  stores,
  activeStoreId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: {
  visible: boolean;
  stores: Store[];
  activeStoreId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const submitAdd = () => {
    const v = newName.trim();
    if (!v) return;
    onAdd(v);
    setNewName('');
  };

  const startRename = (s: Store) => {
    setEditingId(s.id);
    setEditingName(s.name);
  };

  const submitRename = () => {
    const v = editingName.trim();
    if (v && editingId) onRename(editingId, v);
    setEditingId(null);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 items-center justify-center bg-ink/40 px-6"
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '70%' }}
        >
          <Text className="text-ink mb-2 text-base font-bold">매장 선택</Text>

          <Pressable
            onPress={() => onSelect(null)}
            className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
              activeStoreId === null ? 'bg-bg' : ''
            }`}
          >
            <Text className="text-ink text-sm font-medium">매장 선택 안 함 (공용 장바구니)</Text>
            {activeStoreId === null ? (
              <MaterialCommunityIcons name="check" size={18} color="#CC2222" />
            ) : null}
          </Pressable>

          {stores.map((s) =>
            editingId === s.id ? (
              <View key={s.id} className="flex-row items-center gap-2 px-3 py-2">
                <TextInput
                  className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                  value={editingName}
                  onChangeText={setEditingName}
                  onSubmitEditing={submitRename}
                  autoFocus
                />
                <Pressable onPress={submitRename} hitSlop={8}>
                  <Text className="text-primary text-sm font-medium">저장</Text>
                </Pressable>
                <Pressable onPress={() => setEditingId(null)} hitSlop={8}>
                  <Text className="text-muted text-sm">취소</Text>
                </Pressable>
              </View>
            ) : (
              <View
                key={s.id}
                className={`flex-row items-center justify-between rounded-xl px-3 py-3 ${
                  activeStoreId === s.id ? 'bg-bg' : ''
                }`}
              >
                <Pressable onPress={() => onSelect(s.id)} className="flex-1 flex-row items-center">
                  <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                    {s.name}
                  </Text>
                  {activeStoreId === s.id ? (
                    <MaterialCommunityIcons name="check" size={18} color="#CC2222" />
                  ) : null}
                </Pressable>
                <Pressable onPress={() => startRename(s)} hitSlop={8} className="ml-3">
                  <MaterialCommunityIcons name="pencil-outline" size={18} color="#888888" />
                </Pressable>
                <Pressable onPress={() => onDelete(s.id, s.name)} hitSlop={8} className="ml-3">
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#888888" />
                </Pressable>
              </View>
            ),
          )}

          <View className="mt-3 flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="새 매장 이름 (예: 1호 매장)"
              placeholderTextColor="#BBBBBB"
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={submitAdd}
            />
            <Pressable
              onPress={submitAdd}
              className="items-center justify-center rounded-xl border border-line bg-bg px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">추가</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});
