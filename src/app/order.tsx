import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import HeaderIcon from '@/components/HeaderIcon';
import Thumbnail from '@/components/Thumbnail';
import UpdateBadge, { UPDATE_BADGE_META } from '@/components/UpdateBadge';
import {
  addFridgeSection,
  clearFridgeSection,
  addOrderCategory,
  addStore,
  needsOrderSetup,
  assignToFridgeSection,
  CatalogUpdateBadge,
  markCatalogUpdateBadgesSeen,
  clearAllOrderProducts,
  clearCatalogUpdateBadge,
  deleteFridgeSection,
  deleteOrderCategory,
  deleteOrderProduct,
  deleteStore,
  getActiveStoreId,
  getCatalogUpdateBadges,
  getCatalogUpdateBadgeAnimating,
  getOrderCart,
  getOrderCartForStore,
  listFridgeAssignments,
  listFridgeSectionDividers,
  listFridgeSections,
  listOrderCategories,
  listOrderProducts,
  listStores,
  removeFromFridgeSection,
  renameFridgeSection,
  renameOrderCategory,
  renameStore,
  reorderFridgeSections,
  getFridgeLayoutSettings,
  setFridgeColumns,
  setFridgeBackground,
  saveFridgeSectionLayout,
  saveOrderProduct,
  seedDefaultOrderProducts,
  setActiveStoreId,
  syncOrderCatalog,
  syncOrderStores,
  toggleFridgeSectionDivider,
  writeOrderCart,
  getTileColors,
  setTileColor,
  getTileArts,
  setTileArt,
} from '@/lib/order-repo';
import { TILE_COLOR_CHOICES, tileColor } from '@/lib/tile-color';
import { TILE_ART_CHOICES, tileArt } from '@/lib/tile-art';
import { DEFAULT_ORDER_PRODUCTS } from '@/lib/order-seed-data';
import FridgeGrid, { FridgeGridItem } from '@/components/FridgeGrid';
import CoachMarks, { CoachStep } from '@/components/CoachMarks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_COLUMNS, isSpacerId, normalizeSpan, packRows } from '@/lib/fridge-layout';
import { FridgeAssignment, FridgeLayoutSettings, FridgeSection, OrderCart, OrderProduct, OrderStatus, Store } from '@/lib/order-types';
import { buildProductSearchIndex, searchOrderProducts } from '@/lib/order-search';
import HomeBanner from '@/components/HomeBanner';
import VoiceOrderModal from '@/components/VoiceOrderModal';
import OrderHistoryModal from '@/components/OrderHistoryModal';
import { frequentProductIds, listOrderHistory, OrderHistoryEntry } from '@/lib/order-history';

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  active: { label: '시판중', color: '#2E7D32' },
  discontinued: { label: '단종', color: '#C62828' },
  // 흰 글자라 밝은 노랑(#F9A825, 대비 2:1)은 안 보였다 — 앱의 '임박' 주황과 같은 진한 색
  paused: { label: '생산중단', color: '#B45309' },
};


// 따라하기 안내를 마쳤는지(기기별), 1.2.0 새 기능 말풍선을 봤는지(1.1.1 것은 배치 편집·수량 조절 안내 — 본 사람에겐 다시 안 띄움)
const COACH_DONE_KEY = 'orderCoachDone:v1';
const WHATS_NEW_KEY = 'orderWhatsNew:1.2.0';
const WHATS_NEW_LEGACY_KEY = 'orderWhatsNew:1.1.1';

export default function Order() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<OrderProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [cart, setCart] = useState<OrderCart>({});
  const [updateBadges, setUpdateBadges] = useState<Map<string, CatalogUpdateBadge>>(new Map());
  const [animatingBadges, setAnimatingBadges] = useState<Set<string>>(new Set());
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [mode, setMode] = useState<'search' | 'quick'>('search');
  const [fridgeAssignments, setFridgeAssignments] = useState<FridgeAssignment[]>([]);
  const [fridgeSections, setFridgeSections] = useState<FridgeSection[]>([]);
  const [fridgeSectionDividers, setFridgeSectionDividersState] = useState<Record<string, string[]>>({});
  const [activeSection, setActiveSection] = useState<FridgeSection>('');
  const [showFridgeSectionModal, setShowFridgeSectionModal] = useState(false);
  const [showAddToFridge, setShowAddToFridge] = useState(false);
  const [movingProduct, setMovingProduct] = useState<OrderProduct | null>(null);
  const [settingsProduct, setSettingsProduct] = useState<OrderProduct | null>(null);
  // 빠른발주 텍스트 카드: 빨간 숫자를 누르면 여는 수량 조절 창, 사장님이 고른 카드 색, 카드 글꼴(도현체, OFL)
  const [qtyProduct, setQtyProduct] = useState<OrderProduct | null>(null);
  // 매장별 빠른발주 설정(구역 열 수·냉동고 배경)과 배치 편집 모드
  const [layoutSettings, setLayoutSettings] = useState<FridgeLayoutSettings>({ columns: {}, background: 'none' });
  const [layoutEditing, setLayoutEditing] = useState(false);
  // 따라하기 안내(2026-10-22): 처음 쓰는 사람에게 버튼을 하나씩 강조해 순서대로 누르게 한다.
  // 이미 쓰던 사람에겐 새 기능 말풍선만 한 번. [사용법] → "따라하기 다시 보기"로 언제든 다시.
  const coachRefs = {
    store: useRef<View>(null),
    quick: useRef<View>(null),
    zone: useRef<View>(null),
    add: useRef<View>(null),
    card: useRef<View>(null),
    cart: useRef<View>(null),
    edit: useRef<View>(null),
    hist: useRef<View>(null),
    voice: useRef<View>(null),
  };
  const [coachDone, setCoachDone] = useState<boolean | null>(null);
  const [whatsNewDone, setWhatsNewDone] = useState<boolean | null>(null);
  const [coachRunning, setCoachRunning] = useState<'tour' | 'replay' | null>(null);
  const [legacyWhatsNewSeen, setLegacyWhatsNewSeen] = useState(true);
  const [coachAck, setCoachAck] = useState<Set<string>>(new Set());
  useEffect(() => {
    AsyncStorage.multiGet([COACH_DONE_KEY, WHATS_NEW_KEY, WHATS_NEW_LEGACY_KEY])
      .then(([a, b, c]) => {
        setCoachDone(!!a[1]);
        setWhatsNewDone(!!b[1]);
        setLegacyWhatsNewSeen(!!c[1]);
      })
      .catch(() => {
        setCoachDone(true);
        setWhatsNewDone(true);
      });
  }, []);
  const [tileColors, setTileColors] = useState<Record<string, string>>({});
  const [tileFontLoaded] = useFonts({ DoHyeon: require('../../assets/fonts/DoHyeon-Regular.ttf') });
  useEffect(() => {
    getTileColors().then(setTileColors).catch(() => {});
  }, []);
  const [tileArts, setTileArts] = useState<Record<string, string>>({});
  useEffect(() => {
    getTileArts().then(setTileArts).catch(() => {});
  }, []);
  const [fridgeSearchQuery, setFridgeSearchQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('전체');
  // 검색발주: ⭐ 자주 발주 칩(발주 이력에서 자주 쓴 상품만), 🎙️ 음성 발주, 📅 이력 창
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [frequentIds, setFrequentIds] = useState<Set<string> | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryEditMode, setCategoryEditMode] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastAdd, setLastAdd] = useState<{ id: string; name: string } | null>(null);
  const lastAddTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showQuickHelp, setShowQuickHelp] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanParams = useLocalSearchParams<{ scannedBarcode?: string; nonce?: string }>();

  // 수량을 바꿀 때마다 올린다. 목록을 다시 읽는 동안(특히 동기화 뒤) 사용자가 +/-를 누르면, 저장이
  // 끝나기 전에 읽힌 옛 장바구니가 화면을 덮어써 방금 담은 수량이 되돌아갔다 — 그땐 읽은 값을 버린다.
  const cartVersionRef = useRef(0);

  const loadCatalog = useCallback(async () => {
    const cartVersion = cartVersionRef.current;
    // 움직임 대상은 markCatalogUpdateBadgesSeen 보다 먼저 읽어야 방금 처음 본 표시도 움직임으로 잡힌다
    const [productList, categoryList, cartData, badges, animating, storeList, activeId] = await Promise.all([
      listOrderProducts(),
      listOrderCategories(),
      getOrderCart(),
      getCatalogUpdateBadges(),
      getCatalogUpdateBadgeAnimating(),
      listStores(),
      getActiveStoreId(),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    if (cartVersionRef.current === cartVersion) setCart(cartData);
    setUpdateBadges(badges);
    setAnimatingBadges(animating);
    // 처음 보인 때부터 하루 유지 — 나갔다 들어와도 계속 보인다(예전엔 화면을 한 번 열면 바로 지워졌다)
    if (badges.size > 0) markCatalogUpdateBadgesSeen().catch(() => {});
    setStores(storeList);
    setActiveStoreIdState(activeId);
    // 구역 목록/구분선은 매장별이라 매장이 선택 안 됐으면 비워둔다(빠른발주는 매장 선택을 요구함).
    const [assignments, sections, sectionDividers]: [
      FridgeAssignment[],
      FridgeSection[],
      Record<string, string[]>,
    ] = activeId
      ? await Promise.all([
          listFridgeAssignments(activeId),
          listFridgeSections(activeId),
          listFridgeSectionDividers(activeId),
        ])
      : [[], [], {}];
    setFridgeAssignments(assignments);
    setFridgeSections(sections);
    setFridgeSectionDividersState(sectionDividers);
    setLayoutSettings(activeId ? await getFridgeLayoutSettings(activeId) : { columns: {}, background: 'none' });
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

  const onAddFridgeSection = useCallback(
    async (name: string) => {
      if (!activeStoreId) return;
      setFridgeSections(await addFridgeSection(activeStoreId, name));
    },
    [activeStoreId],
  );

  const onRenameFridgeSection = useCallback(
    async (from: string, to: string) => {
      if (!activeStoreId) return;
      setFridgeSections(await renameFridgeSection(activeStoreId, from, to));
      // 현재 보고 있는 구역이 방금 바뀐 그 구역이면 표시도 새 이름으로 맞춘다.
      setActiveSection((prev) => (prev === from ? to : prev));
      setFridgeAssignments(await listFridgeAssignments(activeStoreId));
    },
    [activeStoreId],
  );

  const onClearFridgeSection = useCallback(
    (name: string) => {
      if (!activeStoreId) return;
      Alert.alert(
        '구역 초기화',
        `'${name}' 구역에 진열된 상품을 전부 뺄까요? 구역 자체는 남고, 진열된 상품만 비워집니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '초기화',
            style: 'destructive',
            onPress: async () => {
              setFridgeAssignments(await clearFridgeSection(activeStoreId, name));
            },
          },
        ],
      );
    },
    [activeStoreId],
  );

  const onDeleteFridgeSection = useCallback(
    (name: string) => {
      if (!activeStoreId) return;
      Alert.alert(
        '구역 삭제',
        `'${name}' 구역을 삭제할까요? 이 매장에서 이 구역에 배정된 상품 정보도 함께 사라집니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              setFridgeSections(await deleteFridgeSection(activeStoreId, name));
              setFridgeAssignments(await listFridgeAssignments(activeStoreId));
            },
          },
        ],
      );
    },
    [activeStoreId],
  );

  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    // 로컬 데이터를 먼저 즉시 보여주고, 서버 동기화는 그 뒤에 돌려서 끝나면 조용히 한 번 더
    // 갱신한다 — 동기화가 끝날 때까지 화면을 막으면 이미 로컬에 있는 데이터인데도 열 때마다
    // 서버 왕복 시간만큼 딜레이가 보였다.
    await loadCatalog();
    setSyncing(true);
    try {
      await syncOrderCatalog();
      await syncOrderStores();
      await loadCatalog();
    } finally {
      setSyncing(false);
    }
    // 매장 동기화까지 끝난 뒤에 판단해야 재설치한 기존 사용자(서버에 매장 있음)에게 안 뜬다
    if (await needsOrderSetup()) router.push('/order-setup');
  }, [loadCatalog]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!scanParams.scannedBarcode) return;
    // 빠른발주 탭에서 '신규상품 → 바코드 스캔'으로 이미 있는 상품을 찍으면 검색창이 없는 탭이라
    // 아무 변화가 없어 보였다 — 결과가 보이는 검색발주 탭으로 옮긴다
    setMode('search');
    setQuery(scanParams.scannedBarcode);
  }, [scanParams.scannedBarcode, scanParams.nonce]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (lastAddTimeoutRef.current) clearTimeout(lastAddTimeoutRef.current);
    };
  }, []);

  // 검색어를 낮은 우선순위로 반영 — 388종 카탈로그에서 매 키 입력마다 즉시 전체
  // 재필터링하면 저사양 기기에서 입력이 밀릴 수 있어, React가 재계산을 뒤로 미루게 한다.
  const deferredQuery = useDeferredValue(query);

  // 공용 카탈로그 동기화로 새로 생기거나(신규) 정보가 바뀐(수정) 상품을 최상단에 모아 보여준다.
  const hasBadge = useCallback(
    (p: OrderProduct) => (p.barcode ? updateBadges.has(p.barcode) : false),
    [updateBadges],
  );

  // 오타 허용(fuzzy) 검색용 색인은 상품 목록이 바뀔 때만 다시 만든다 — 매 키 입력마다 새로
  // 만들면(388종 카탈로그 기준 색인 구축 자체가 무거움) 그게 입력 지연의 주된 원인이었다.
  const fuseIndex = useMemo(() => buildProductSearchIndex(products), [products]);

  const badgeSorted = useMemo(
    () => [...products].sort((a, b) => Number(hasBadge(b)) - Number(hasBadge(a))),
    [products, hasBadge],
  );

  // 검색은 카테고리와 무관하게 전체 카탈로그를 대상으로 한 번만 수행하고, 아래 filtered가 이 결과에
  // 카테고리·자주 발주 필터를 적용한다.
  const searched = useMemo(() => {
    const q = deferredQuery.trim();
    if (!q) return null;
    // 검색 중엔 관련도(완전일치>시작일치>부분일치>초성/자모>오타허용)가 우선, 같은 등급 안에서는
    // 신규/수정 뱃지가 있는 상품이 위로 온다(searchOrderProducts의 등급 정렬은 안정정렬).
    return searchOrderProducts(badgeSorted, q, fuseIndex);
  }, [badgeSorted, deferredQuery, fuseIndex]);

  const filtered = useMemo(() => {
    const base = searched ?? badgeSorted;
    const byCategory = selectedCategory === '전체' ? base : base.filter((p) => p.category === selectedCategory);
    return frequentOnly ? byCategory.filter((p) => frequentIds?.has(p.id)) : byCategory;
  }, [searched, badgeSorted, selectedCategory, frequentOnly, frequentIds]);

  // 빠른발주: 현재 구역에 배정되고 상태가 시판중인 상품만 그리드에 보여준다(단종/일시중지는
  // 자동 숨김 — 다시 active로 바꾸면 배정 정보가 남아 있어 별도 조작 없이 재노출됨).
  // fridgeAssignments 배열의 저장 순서를 그대로 표시 순서로 쓴다 — 드래그로 정렬한 순서가
  // 실제로 보이려면 products 배열 순서가 아니라 이 배열 순서를 따라야 한다.
  // 빈칸('spacer:…')은 상품 대신 자리만 차지하는 항목, span은 카드가 차지하는 칸(2026-10-22 배치 편집)
  const fridgeItems = useMemo<FridgeGridItem[]>(() => {
    const productById = new Map(products.map((p) => [p.id, p]));
    const out: FridgeGridItem[] = [];
    for (const a of fridgeAssignments) {
      if (a.section !== activeSection) continue;
      if (isSpacerId(a.productId)) {
        out.push({ id: a.productId, product: null, span: normalizeSpan(a.span) });
        continue;
      }
      const p = productById.get(a.productId);
      if (p && (p.status ?? 'active') === 'active') out.push({ id: p.id, product: p, span: normalizeSpan(a.span) });
    }
    return out;
  }, [products, fridgeAssignments, activeSection]);

  const fridgeSectionByProductId = useMemo(
    () => new Map(fridgeAssignments.map((a) => [a.productId, a.section])),
    [fridgeAssignments],
  );

  const activeColumns = layoutSettings.columns[activeSection] ?? DEFAULT_COLUMNS;

  const activeDividerIds = useMemo(
    () => new Set(fridgeSectionDividers[activeSection] ?? []),
    [fridgeSectionDividers, activeSection],
  );

  // 구분선은 항상 "그 상품이 속한 줄"의 마지막 상품 id에 저장한다 — 줄 안 아무 상품에서 토글해도
  // 항상 줄 전체 너비의 온전한 구분선이 그려지게 하기 위한 스냅. 실제 냉동고 선반 구분처럼 부분
  // 구분선(줄 중간에서 끊김)은 지원하지 않는다(ponytail: 줄 단위 스냅, 필요해지면 상품 단위로 확장).
  const getRowLastProductId = useCallback(
    (productId: string) => {
      // 칸 크기가 섞여도 화면과 같은 줄 나누기(packRows)로 "그 줄의 마지막 항목"을 찾는다
      const idx = fridgeItems.findIndex((i) => i.id === productId);
      if (idx < 0) return productId;
      const row = packRows(fridgeItems.map((i) => i.span), activeColumns).find((r) => r.some((c) => c.index === idx));
      return row ? fridgeItems[row[row.length - 1].index].id : productId;
    },
    [fridgeItems, activeColumns],
  );

  // 연달아 여러 상품을 추가할 수 있도록 추가해도 모달을 닫지 않는다 — 검색어만 비워서
  // 바로 다음 상품을 검색할 수 있게 한다. 닫기는 모달의 X 버튼으로 직접 눌러야 한다.
  const onAddToFridge = useCallback(
    async (productId: string) => {
      if (!activeStoreId) return;
      const existingSection = fridgeSectionByProductId.get(productId);
      if (existingSection && existingSection !== activeSection) {
        const name = products.find((p) => p.id === productId)?.name ?? '이 상품';
        Alert.alert(
          '이미 다른 구역에 있음',
          `'${name}'은(는) '${existingSection}' 구역에 진열되어 있습니다. 중복으로 등록할까요, 그 구역에서 여기로 옮길까요?`,
          [
            { text: '취소', style: 'cancel' },
            {
              text: '이동',
              onPress: async () => {
                setFridgeAssignments(await assignToFridgeSection(activeStoreId, productId, activeSection, 'move'));
                setFridgeSearchQuery('');
              },
            },
            {
              text: '중복 등록',
              onPress: async () => {
                setFridgeAssignments(
                  await assignToFridgeSection(activeStoreId, productId, activeSection, 'duplicate'),
                );
                setFridgeSearchQuery('');
              },
            },
          ],
        );
        return;
      }
      setFridgeAssignments(await assignToFridgeSection(activeStoreId, productId, activeSection));
      setFridgeSearchQuery('');
    },
    [activeStoreId, activeSection, fridgeSectionByProductId, products],
  );

  const onReorderFridgeSections = useCallback(
    (sections: FridgeSection[]) => {
      if (!activeStoreId) return;
      setFridgeSections(sections);
      reorderFridgeSections(activeStoreId, sections).catch(() => {});
    },
    [activeStoreId],
  );

  const totalCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  // 낙관적 업데이트: 로컬 state 기준으로 즉시 반영하고 저장은 fire-and-forget —
  // 이전에는 탭할 때마다 AsyncStorage를 재조회해서 빠르게 연타하면 이전 쓰기가
  // 끝나기 전에 다음 읽기가 시작돼 증가분이 유실될 수 있었다.
  const changeQty = useCallback((productId: string, delta: number) => {
    cartVersionRef.current += 1;
    setCart((prev) => {
      const nextQty = Math.max(0, (prev[productId] ?? 0) + delta);
      const next = { ...prev };
      if (nextQty <= 0) delete next[productId];
      else next[productId] = nextQty;
      writeOrderCart(next).catch(() => {});
      return next;
    });
  }, []);

  const onTileTap = useCallback(
    (product: OrderProduct) => {
      changeQty(product.id, 1);
      Haptics.selectionAsync().catch(() => {});
      // 오터치로 잘못 담았을 때 발주 내역까지 가서 찾지 않고 그 자리에서 바로 취소할 수 있도록,
      // 방금 담은 것 하나만 짧게 기억해둔다.
      setLastAdd({ id: product.id, name: product.name });
      if (lastAddTimeoutRef.current) clearTimeout(lastAddTimeoutRef.current);
      lastAddTimeoutRef.current = setTimeout(() => setLastAdd(null), 2500);
    },
    [changeQty],
  );

  const undoLastAdd = useCallback(() => {
    if (!lastAdd) return;
    changeQty(lastAdd.id, -1);
    setLastAdd(null);
    if (lastAddTimeoutRef.current) clearTimeout(lastAddTimeoutRef.current);
  }, [lastAdd, changeQty]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2500);
  }, []);

  // ⭐ 자주 발주: 켤 때마다 발주 이력을 새로 읽어 자주 쓴 상품 id를 모은다
  const onToggleFrequent = useCallback(() => {
    if (frequentOnly) {
      setFrequentOnly(false);
      return;
    }
    setFrequentOnly(true);
    setFrequentIds(null);
    listOrderHistory()
      .then((entries) => setFrequentIds(new Set(frequentProductIds(entries))))
      .catch(() => setFrequentIds(new Set()));
  }, [frequentOnly]);

  // 🎙️ 음성 발주: 알아들은 상품을 지금 장바구니에 수량으로 더한다(낙관적 업데이트는 changeQty 그대로)
  const onVoiceApply = useCallback(
    (adds: { productId: string; qty: number }[]) => {
      for (const a of adds) if (a.qty > 0) changeQty(a.productId, a.qty);
    },
    [changeQty],
  );
  const onVoiceManualSearch = useCallback((keyword: string) => {
    setShowVoice(false);
    setQuery(keyword);
    setSelectedCategory('전체');
    setFrequentOnly(false);
  }, []);

  // 📅 이력 '이대로 다시 담기': 장바구니를 그 발주 내용으로 바꾼다(그 매장이 지금과 다르면 매장부터 바꿈)
  const onReorderHistory = useCallback(
    async (entry: OrderHistoryEntry) => {
      const known = new Set(products.map((p) => p.id));
      const next: OrderCart = {};
      let skipped = 0;
      for (const it of entry.items) {
        const qty = Math.floor(it.qty);
        if (!known.has(it.productId)) skipped += 1;
        else if (qty > 0) next[it.productId] = (next[it.productId] ?? 0) + qty;
      }
      if (Object.keys(next).length === 0) {
        Alert.alert('다시 담을 수 없어요', '그때 발주한 상품이 지금 목록에 없어요.');
        return;
      }
      const otherStore = !!entry.storeId && entry.storeId !== activeStoreId && stores.some((s) => s.id === entry.storeId);
      // 바뀌는 건 '그 매장'의 장바구니 — 확인 전에는 매장을 바꾸지 않고 그 매장의 장바구니만 읽는다
      const currentBoxes = otherStore
        ? Object.values(await getOrderCartForStore(entry.storeId!)).reduce((sum, q) => sum + q, 0)
        : totalCount;
      const apply = async () => {
        if (otherStore) await switchStore(entry.storeId!);
        cartVersionRef.current += 1;
        setCart(next);
        writeOrderCart(next).catch(() => {});
        setShowHistory(false);
        const boxes = Object.values(next).reduce((sum, q) => sum + q, 0);
        if (skipped > 0) Alert.alert('다시 담았어요', `${boxes}박스를 담았어요.
${skipped}개는 지금 목록에 없어 빠졌어요.`);
        else showToast(`${boxes}박스를 다시 담았어요`);
      };
      if (currentBoxes > 0) {
        Alert.alert('장바구니를 바꿀까요?', `지금 담긴 ${currentBoxes}박스가 이 발주로 바뀌어요.`, [
          { text: '취소', style: 'cancel' },
          { text: '바꾸기', style: 'destructive', onPress: apply },
        ]);
      } else apply();
    },
    [products, activeStoreId, stores, switchStore, totalCount, showToast],
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

  // Android Alert.alert는 버튼 3개까지만 표시되므로(위 onChangeStatus 주석과 동일한 이유)
  // 여기도 '취소' 버튼 없이 3개만 둔다 — 뒤로가기·바깥 탭으로 닫으면 된다.
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

  // 줄 그리는 함수를 고정 — 매번 새로 만들면 목록이 보이는 줄 전부를 다시 그린다
  // 검색어가 있을 때만 사진 대신 글자 카드로 보여 준다(textCard)
  const searching = deferredQuery.trim() !== '';
  const renderCatalogRow = useCallback(
    ({ item }: { item: OrderProduct }) => (
      <CatalogRow
        product={item}
        qty={cart[item.id] ?? 0}
        badge={item.barcode ? updateBadges.get(item.barcode) : undefined}
        badgeAnimate={item.barcode ? animatingBadges.has(item.barcode) : false}
        textCard={searching}
        art={tileArt(item.name, tileArts[item.id])}
        onChangeQty={changeQty}
        onOpenQty={setQtyProduct}
        onPress={handleOpenProduct}
        onLongPress={onLongPressProduct}
      />
    ),
    [cart, updateBadges, animatingBadges, searching, tileArts, changeQty, handleOpenProduct, onLongPressProduct],
  );

  const onEditSettingsProduct = useCallback(() => {
    if (!settingsProduct) return;
    router.push({ pathname: '/order-product-form', params: { id: settingsProduct.id } });
    setSettingsProduct(null);
  }, [settingsProduct]);

  const onMoveSettingsProduct = useCallback(() => {
    if (!settingsProduct) return;
    setMovingProduct(settingsProduct);
    setSettingsProduct(null);
  }, [settingsProduct]);

  const onToggleRowDivider = useCallback(async () => {
    if (!settingsProduct || !activeStoreId) return;
    const rowLastId = getRowLastProductId(settingsProduct.id);
    setFridgeSectionDividersState(
      await toggleFridgeSectionDivider(activeStoreId, activeSection, rowLastId),
    );
    setSettingsProduct(null);
  }, [settingsProduct, getRowLastProductId, activeSection, activeStoreId]);

  const onMoveFridgeTile = useCallback(
    async (section: FridgeSection) => {
      if (!activeStoreId || !movingProduct) return;
      setFridgeAssignments(await assignToFridgeSection(activeStoreId, movingProduct.id, section));
      setMovingProduct(null);
    },
    [activeStoreId, movingProduct],
  );

  // 배치 편집 [완료]: 이 구역의 순서·칸 크기·빈칸을 저장(order_store_layout으로 팀원 기기에도 동기화)
  const onSaveFridgeLayout = useCallback(
    async (items: FridgeGridItem[]) => {
      if (!activeStoreId) return;
      setFridgeAssignments(
        await saveFridgeSectionLayout(activeStoreId, activeSection, items.map((i) => ({ productId: i.id, span: i.span }))),
      );
    },
    [activeStoreId, activeSection],
  );

  // 구역·매장·화면을 바꾸면 저장하지 않은 편집은 닫는다
  useEffect(() => {
    setLayoutEditing(false);
  }, [activeSection, activeStoreId, mode]);

  // ── 따라하기 안내 단계 ──
  const storeProductCount = fridgeAssignments.filter((a) => !isSpacerId(a.productId)).length;
  useEffect(() => {
    if (coachDone !== false || coachRunning || syncing) return;
    // 이미 진열해 둔 매장이 있으면 쓰던 사람 — 처음 안내는 건너뛰고 새 기능 말풍선만
    if (activeStoreId && storeProductCount > 0) {
      setCoachDone(true);
      AsyncStorage.setItem(COACH_DONE_KEY, '1').catch(() => {});
      return;
    }
    setCoachRunning('tour');
  }, [coachDone, coachRunning, syncing, activeStoreId, storeProductCount]);

  const finishCoach = useCallback(() => {
    setCoachRunning(null);
    setCoachAck(new Set());
    setCoachDone(true);
    setWhatsNewDone(true); // 처음 안내를 본 사람에겐 새 기능 말풍선을 또 띄우지 않는다
    AsyncStorage.multiSet([
      [COACH_DONE_KEY, '1'],
      [WHATS_NEW_KEY, '1'],
    ]).catch(() => {});
  }, []);
  const finishWhatsNew = useCallback(() => {
    setCoachAck(new Set());
    setWhatsNewDone(true);
    AsyncStorage.setItem(WHATS_NEW_KEY, '1').catch(() => {});
  }, []);

  const replay = coachRunning === 'replay';
  const tourSteps: (CoachStep & { done: boolean })[] = [
    { key: 'store', target: coachRefs.store, ack: replay, done: replay ? coachAck.has('store') : !!activeStoreId, title: '매장을 먼저 골라 주세요', body: '처음이면 매장 이름을 하나 만들어요 (예: 1호점)' },
    { key: 'quick', target: coachRefs.quick, ack: replay, done: replay ? coachAck.has('quick') : mode === 'quick', title: '빠른발주를 눌러요', body: '냉동고 칸 모양 그대로 보면서 담는 화면이에요' },
    { key: 'zone', target: coachRefs.zone, ack: true, done: coachAck.has('zone'), title: '냉동고 칸(구역)은 여기서 관리해요', body: '예: 600바-1, 콘류 — 실제 칸 이름으로 바꾸거나 더 만들 수 있어요' },
    { key: 'add', target: coachRefs.add, ack: replay, done: replay ? coachAck.has('add') : fridgeItems.some((i) => i.product), title: '이 칸에 있는 상품을 넣어요', body: '실제 진열 순서대로 넣으면 화면도 냉동고처럼 보여요' },
    { key: 'card', target: coachRefs.card, ack: replay, done: replay ? coachAck.has('card') : totalCount > 0, title: '빈 칸 상품을 눌러 담아요', body: '한 번 누를 때마다 1박스 · 빨간 숫자를 누르면 수량 조절' },
    { key: 'cart', target: coachRefs.cart, ack: true, done: coachAck.has('cart'), title: '다 담았으면 발주서를 확인해요', body: "아래 '발주서 확인'에서 납품 희망일·배송 메모를 정하고, 카톡/SMS로 보내요" },
  ];
  // 다시 보기에선 지금 화면에 없는 버튼(예: 담은 게 없으면 발주 내역 바)은 건너뛴다
  const visibleTour = replay ? tourSteps.filter((st) => st.key !== 'cart' || totalCount > 0).filter((st) => st.key !== 'card' || fridgeItems.some((i) => i.product)) : tourSteps;
  // 1.1.1 말풍선(배치 편집·수량·길게 누르기)을 이미 본 사람에겐 빼고, 새 기능(이력·음성)은 검색발주 화면에서 보여 준다
  const whatsNewSteps: (CoachStep & { done: boolean; mode: 'quick' | 'search' })[] = [
    ...(legacyWhatsNewSeen ? [] : [
      { key: 'wn-edit', mode: 'quick' as const, target: coachRefs.edit, ack: true, done: coachAck.has('wn-edit'), title: '새 기능: 배치 편집', body: '열 수·칸 크기(1칸/2칸/줄)·빈칸, 끌어서 옮기기까지 실제 냉동고처럼 맞춰요' },
      { key: 'wn-qty', mode: 'quick' as const, target: coachRefs.card, ack: true, done: coachAck.has('wn-qty'), title: '누르면 1박스, 빨간 숫자는 수량 조절', body: '빨간 숫자를 누르면 여러 박스를 한 번에 넣거나 뺄 수 있어요' },
      { key: 'wn-long', mode: 'quick' as const, target: coachRefs.card, ack: true, done: coachAck.has('wn-long'), title: '길게 누르면 실제 사진', body: '계속 누르고 있으면(1초) 배치 편집이 바로 켜져요' },
    ]),
    { key: 'wn-hist', mode: 'search' as const, target: coachRefs.hist, ack: true, done: coachAck.has('wn-hist'), title: '새 기능: 발주 이력', body: '보낸 발주를 날짜별로 보고, 「이대로 다시 담기」로 한 번에 다시 담을 수 있어요' },
    { key: 'wn-voice', mode: 'search' as const, target: coachRefs.voice, ack: true, done: coachAck.has('wn-voice'), title: '새 기능: 음성 발주 (Beta)', body: '말로 "메로나 두 박스"처럼 하면 알아듣고 담아 줘요' },
  ];
  const showWhatsNew = !coachRunning && coachDone === true && whatsNewDone === false && !layoutEditing && (mode === 'search' || fridgeItems.some((i) => i.product));
  const coachList = coachRunning ? visibleTour : showWhatsNew ? whatsNewSteps.filter((st) => st.mode === mode) : [];
  const coachIndex = coachList.findIndex((st) => !st.done);
  const whatsNewAllDone = whatsNewSteps.every((st) => st.done);
  useEffect(() => {
    if (!coachList.length || coachIndex >= 0) return;
    if (coachRunning) finishCoach();
    else if (whatsNewAllDone) finishWhatsNew(); // 다른 화면에 보여 줄 말풍선이 남았으면 거기서 이어서
  }, [coachList.length, coachIndex, coachRunning, finishCoach, finishWhatsNew, whatsNewAllDone]);
  const coachStep = coachIndex >= 0 ? coachList[coachIndex] : null;

  const onRemoveFridgeTile = useCallback(
    (p: OrderProduct) => {
      Alert.alert('구역에서 빼기', `'${p.name}'을(를) '${activeSection}' 구역에서 뺄까요?`, [
        { text: '취소', style: 'cancel' },
        {
          text: '빼기',
          style: 'destructive',
          onPress: async () => {
            if (!activeStoreId) return;
            setFridgeAssignments(await removeFromFridgeSection(activeStoreId, p.id, activeSection));
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

  const onConfirmResetProducts = useCallback(async () => {
    setResetting(true);
    try {
      await clearAllOrderProducts();
      await load();
      setShowResetConfirm(false);
      setToastMessage('상품을 모두 초기화했어요');
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 1500);
    } finally {
      setResetting(false);
    }
  }, [load]);

  return (
    <View className="flex-1 bg-bg">
    {/* 본문(떠 있는 [발주 내역 확인] 버튼 포함)과 하단 배너를 나눠, 버튼이 배너를 가리지 않고 그 위에 오게 */}
    <View className="flex-1">
      <Stack.Screen
        options={{
          headerRight: () => (
            <View className="flex-row items-center" style={{ gap: 8 }}>
              {products.length > 0 ? (
                <HeaderIcon
                  icon="delete-sweep-outline"
                  label="초기화"
                  onPress={() => setShowResetConfirm(true)}
                />
              ) : null}
              <HeaderIcon
                icon="file-excel-outline"
                label="엑셀"
                onPress={() => router.push('/order-csv-import')}
              />
              {/* 바코드 스캔(없으면 등록 화면, 이미 있으면 목록에서 찾아 줌) 또는 바코드를 몰라도
                  바로 등록 화면으로 — 카메라를 거치지 않게 먼저 고르게 한다 */}
              <HeaderIcon
                icon="plus-box-outline"
                label="신규상품"
                onPress={() =>
                  Alert.alert('신규상품 등록', '어떻게 등록할까요?', [
                    { text: '취소', style: 'cancel' },
                    { text: '직접 입력', onPress: () => router.push('/order-product-form') },
                    { text: '바코드 스캔', onPress: () => router.push('/scan?mode=order') },
                  ])
                }
              />
            </View>
          ),
        }}
      />

      {/* 한 줄: 매장 · 검색발주/빠른발주 전환 · 이력. 전환 탭 줄을 따로 두지 않아 목록 자리를 넓힌다 */}
      <View className="mx-4 mt-3 flex-row items-center" style={{ gap: 8 }}>
        <Pressable
          onPress={() => setShowStoreModal(true)}
          className="flex-row items-center rounded-full border border-line bg-paper px-2.5 py-1.5 active:opacity-70"
          style={{ flexShrink: 1, maxWidth: '34%' }}
          accessibilityRole="button"
          accessibilityLabel="매장 선택·관리"
          ref={coachRefs.store}
          collapsable={false}
        >
          <MaterialCommunityIcons name="storefront-outline" size={16} color="#1A1A1A" />
          <Text numberOfLines={1} className="text-ink ml-1 shrink text-sm font-medium">
            {stores.find((s) => s.id === activeStoreId)?.name ??
              (stores.length > 0 ? '매장 선택' : '매장 추가하기')}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color="#888888" />
        </Pressable>

        {/* 세그먼트 컨트롤: 한 덩어리 안에서 선택된 쪽만 채워진다 */}
        <View
          className="flex-1 flex-row overflow-hidden rounded-full border border-line bg-paper"
          style={{ minWidth: 0 }}
          accessibilityRole="tablist"
        >
          <Pressable
            onPress={() => setMode('search')}
            accessibilityLabel="검색발주"
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'search' }}
            className={`flex-1 items-center justify-center py-2 ${mode === 'search' ? 'bg-primary' : ''}`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-bold ${mode === 'search' ? '' : 'text-ink'}`}
              style={mode === 'search' ? { color: '#FFFFFF' } : undefined}
            >
              검색
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('quick')}
            ref={coachRefs.quick}
            collapsable={false}
            accessibilityLabel="빠른발주"
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === 'quick' }}
            className={`flex-1 items-center justify-center py-2 ${mode === 'quick' ? 'bg-primary' : ''}`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-bold ${mode === 'quick' ? '' : 'text-ink'}`}
              style={mode === 'quick' ? { color: '#FFFFFF' } : undefined}
            >
              빠른
            </Text>
          </Pressable>
        </View>

        {mode === 'search' ? (
          <Pressable
            onPress={() => setShowHistory(true)}
            ref={coachRefs.hist}
            collapsable={false}
            hitSlop={6}
            className="shrink-0 flex-row items-center justify-center rounded-full border border-line bg-paper px-3 py-2 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="발주 이력 보기"
          >
            <MaterialCommunityIcons name="calendar-month-outline" size={16} color="#1A1A1A" />
            <Text className="text-ink ml-1 text-sm font-medium">이력</Text>
          </Pressable>
        ) : null}
      </View>

      {mode === 'quick' && activeStoreId ? (
        <View className="mx-4 mt-2 flex-row items-center justify-end" style={{ gap: 8 }}>
            {fridgeSections.length > 0 ? (
              <Pressable
                onPress={() =>
                  Alert.alert('사용법', '어떻게 볼까요?', [
                    { text: '닫기', style: 'cancel' },
                    { text: '버튼 설명 보기', onPress: () => setShowQuickHelp(true) },
                    {
                      text: '따라하기 다시 보기',
                      onPress: () => {
                        setLayoutEditing(false);
                        setCoachAck(new Set());
                        setCoachRunning('replay');
                      },
                    },
                  ])
                }
                hitSlop={8}
                className="h-9 flex-row items-center justify-center rounded-full border border-line bg-paper px-3 active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel="빠른발주 사용법 보기"
              >
                {/* 아이콘만으론 무슨 버튼인지 모른다는 지적 — 글자를 함께 보여 준다 */}
                <MaterialCommunityIcons name="help-circle-outline" size={18} color="#1A1A1A" />
                <Text className="text-ink ml-1 text-sm font-medium">사용법</Text>
              </Pressable>
            ) : null}
            {activeSection ? (
              <Pressable
                onPress={() => setShowAddToFridge(true)}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1.5 active:opacity-80"
                accessibilityRole="button"
                accessibilityLabel={`${activeSection} 구역에 상품 진열하기`}
                ref={coachRefs.add}
                collapsable={false}
              >
                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                <Text className="text-sm font-bold" style={{ color: '#FFFFFF' }}>
                  상품 진열하기
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setShowFridgeSectionModal(true)}
                className="flex-row items-center gap-1 rounded-full bg-primary px-3 py-1.5 active:opacity-80"
                accessibilityRole="button"
                accessibilityLabel="냉동고 구역 추가하기"
              >
                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                <Text className="text-sm font-bold" style={{ color: '#FFFFFF' }}>
                  구역 추가하기
                </Text>
              </Pressable>
            )}
        </View>
      ) : null}

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

      <ResetProductsModal
        visible={showResetConfirm}
        productCount={products.length}
        resetting={resetting}
        onConfirm={onConfirmResetProducts}
        onClose={() => setShowResetConfirm(false)}
      />

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

      {lastAdd ? (
        <View className="absolute left-0 right-0 z-20 items-center" style={{ top: insets.top + 76 }}>
          <View className="flex-row items-center rounded-full bg-ink px-4 py-2" style={{ gap: 10 }}>
            <Text className="text-paper text-sm font-medium">{lastAdd.name} 담았어요</Text>
            <Pressable onPress={undoLastAdd} hitSlop={8}>
              <Text className="text-sm font-bold" style={{ color: '#FF8A80' }}>
                취소
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {mode === 'search' ? (
        <>
          <View className="relative mx-4 mt-3" style={{ zIndex: 10 }}>
            {/* 오른쪽 버튼(바코드·음성·지우기)은 붙어 있고 터치 영역(hitSlop)이 서로 겹쳐 옆
                버튼이 눌리기 쉬웠다 — 버튼마다 44×44 칸을 따로 주고 칸 사이를 띄운다(hitSlop 없음) */}
            <View
              className="flex-row items-center rounded-xl border border-line bg-paper pl-3 pr-1"
              style={{ gap: 4 }}
            >
              <MaterialCommunityIcons name="magnify" size={20} color="#888888" />
              <SearchInput value={query} onCommit={setQuery} />
              <Pressable
                onPress={() => router.push('/scan?mode=order-search')}
                className="h-11 w-11 items-center justify-center rounded-lg active:bg-bg"
                accessibilityRole="button"
                accessibilityLabel="바코드로 검색"
              >
                <MaterialCommunityIcons name="barcode-scan" size={22} color="#1A1A1A" />
              </Pressable>
              <Pressable
                onPress={() => setShowVoice(true)}
                ref={coachRefs.voice}
                collapsable={false}
                className="h-11 w-11 items-center justify-center rounded-lg active:bg-bg"
                accessibilityRole="button"
                accessibilityLabel="음성으로 발주 (Beta)"
              >
                <Text style={{ fontSize: 20 }}>🎙️</Text>
              </Pressable>
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  className="h-11 w-11 items-center justify-center rounded-lg active:bg-bg"
                  accessibilityRole="button"
                  accessibilityLabel="검색어 지우기"
                >
                  <MaterialCommunityIcons name="close-circle" size={24} color="#888888" />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* 칩이 여러 줄로 줄바꿈되면 상품 목록이 밀려 2개밖에 안 보였다 — 한 줄 가로 스크롤 */}
          <View className="mt-2" style={{ gap: 6 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              <Chip label="⭐ 자주 발주" active={frequentOnly} onPress={onToggleFrequent} />
              <Chip
                label="전체"
                active={selectedCategory === '전체'}
                onPress={() => setSelectedCategory('전체')}
              />
              {categories.map((c) => (
                <Chip
                  key={c}
                  label={categoryEditMode ? `✎ ${c}` : c}
                  active={!categoryEditMode && selectedCategory === c}
                  onPress={() => (categoryEditMode ? onLongPressCategory(c) : setSelectedCategory(c))}
                  onLongPress={() => onLongPressCategory(c)}
                />
              ))}
              {/* "+"만으론 무엇을 추가하는지, 길게 누르기는 있는 줄도 몰랐다 — 글자로 보이는 추가·편집 버튼 */}
              <Chip label="+ 카테고리" active={false} onPress={() => setShowCategoryInput(true)} />
              <Chip
                label={categoryEditMode ? '편집 끝' : '편집'}
                active={categoryEditMode}
                onPress={() => setCategoryEditMode((v) => !v)}
              />
            </ScrollView>
            {categoryEditMode ? (
              <Text className="text-muted mx-4 text-xs">이름을 고치거나 지울 카테고리를 누르세요</Text>
            ) : null}
            {showCategoryInput || editingCategory ? (
              <View className="mx-4 flex-row gap-2">
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
            key="search-list"
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 + insets.bottom }}
            // 폴드 실측(2026-10-10): 검색어로 목록 개수가 크게 바뀔 때(388→208개) 한 번에 316ms 멈췄다.
            // 기본값은 화면 위아래 10화면(약 150줄)을 미리 만들어 두어, 검색할 때마다 그만큼 지우고 새로 만들었다.
            // 위아래 2화면만 미리 만든다. (removeClippedSubviews는 목록이 크게 바뀔 때 줄이 빈칸으로 남는
            // 안드로이드 버그가 있어 쓰지 않는다)
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
            renderItem={renderCatalogRow}
            ListEmptyComponent={
              frequentOnly ? (
                frequentIds === null ? null : (
                  <Text className="text-muted mx-6 mt-16 text-center text-sm">
                    {frequentIds.size === 0
                      ? '아직 발주 이력이 없어요. 발주하면 자주 쓰는 상품이 여기 모여요'
                      : '이 조건에 맞는 자주 발주 상품이 없어요'}
                  </Text>
                )
              ) : (
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
                    {seeding ? '불러오는 중...' : `기본 상품 불러오기 (아이스크림 ${DEFAULT_ORDER_PRODUCTS.length}종)`}
                  </Text>
                </Pressable>
              </View>
              )
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
          <FridgeSectionModal
            visible={showFridgeSectionModal}
            sections={fridgeSections}
            onAdd={onAddFridgeSection}
            onRename={onRenameFridgeSection}
            onDelete={onDeleteFridgeSection}
            onClear={onClearFridgeSection}
            onReorder={onReorderFridgeSections}
            onClose={() => setShowFridgeSectionModal(false)}
          />
          {fridgeSections.length === 0 ? (
            <View className="mx-4 mt-6 items-center rounded-2xl border border-line bg-paper px-6 py-8">
              <MaterialCommunityIcons name="fridge-outline" size={40} color="#CCCCCC" />
              <Text className="text-ink mt-3 text-center text-base font-bold">
                아직 냉동고 구역이 없어요
              </Text>
              <Text className="text-muted mt-2 text-center text-sm">
                구역은 냉동고 진열 순서예요(예: 600바-1, 콘류).{'\n'}구역을 만들어두면 그 순서대로 빠르게
                탭해서 발주할 수 있어요.
              </Text>
              <Pressable
                onPress={() => setShowFridgeSectionModal(true)}
                className="mt-4 rounded-xl bg-primary px-5 py-3 active:opacity-80"
              >
                <Text className="text-sm font-bold" style={{ color: '#FFFFFF' }}>
                  + 구역 추가하기
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <QuickOrderHelpModal visible={showQuickHelp} onClose={() => setShowQuickHelp(false)} />

              <FridgeGrid
                items={fridgeItems}
                cols={activeColumns}
                background={layoutSettings.background}
                dividerIds={activeDividerIds}
                label={`${stores.find((st) => st.id === activeStoreId)?.name ?? '냉동고'} · ${activeSection}`}
                cart={cart}
                tileColors={tileColors}
                tileArts={tileArts}
                fontFamily={tileFontLoaded ? 'DoHyeon' : undefined}
                header={<>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: -4 }}
                      contentContainerStyle={{ alignItems: 'center', gap: 8 }}
                    >
                      {fridgeSections.map((s) => (
                        <Chip
                          key={s}
                          label={s}
                          active={activeSection === s}
                          onPress={() => setActiveSection(s)}
                          onLongPress={() => setShowFridgeSectionModal(true)}
                        />
                      ))}
                      {/* 구역이 있을 때도 꾹 누르지 않고 바로 추가할 수 있게 */}
                      <Pressable
                        onPress={() => setShowFridgeSectionModal(true)}
                        className="flex-row items-center self-start rounded-full border border-dashed border-line bg-paper px-3 py-1.5 active:opacity-70"
                        accessibilityRole="button"
                        accessibilityLabel="냉동고 구역 관리"
                        ref={coachRefs.zone}
                        collapsable={false}
                      >
                        <MaterialCommunityIcons name="plus" size={16} color="#888888" />
                        <Text className="text-muted ml-0.5 text-sm font-medium">구역 관리</Text>
                      </Pressable>
                    </ScrollView>
                  </>
                }
                empty={syncing ? (
                    <ActivityIndicator color="#CC2222" style={{ marginTop: 32 }} />
                  ) : (
                    <Text className="text-muted mt-8 text-center text-sm">
                      이 구역에 등록된 상품이 없습니다. 위쪽 '상품 진열하기' 버튼으로 추가해 보세요.
                    </Text>
                  )
                }
                bottomPadding={120 + insets.bottom}
                editing={layoutEditing}
                onEditingChange={setLayoutEditing}
                onSave={onSaveFridgeLayout}
                onChangeColumns={(c) => {
                  if (!activeStoreId) return;
                  setLayoutSettings((prev) => ({ ...prev, columns: { ...prev.columns, [activeSection]: c } }));
                  setFridgeColumns(activeStoreId, activeSection, c).catch(() => {});
                }}
                onChangeBackground={(bg) => {
                  if (!activeStoreId) return;
                  setLayoutSettings((prev) => ({ ...prev, background: bg }));
                  setFridgeBackground(activeStoreId, bg).catch(() => {});
                }}
                onTap={onTileTap}
                onOpenSettings={setSettingsProduct}
                onRemove={onRemoveFridgeTile}
                onOpenQty={setQtyProduct}
                firstCardRef={coachRefs.card}
                editButtonRef={coachRefs.edit}
              />
              <AddToFridgeModal
                visible={showAddToFridge}
                section={activeSection}
                allProducts={products}
                categories={categories}
                assignedIds={
                  new Set(fridgeAssignments.filter((a) => a.section === activeSection).map((a) => a.productId))
                }
                updateBadges={updateBadges}
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
              <ProductSettingsModal
                visible={settingsProduct !== null}
                productName={settingsProduct?.name ?? ''}
                hasDivider={settingsProduct ? activeDividerIds.has(getRowLastProductId(settingsProduct.id)) : false}
                onEdit={onEditSettingsProduct}
                onMove={onMoveSettingsProduct}
                onToggleDivider={onToggleRowDivider}
                onClose={() => setSettingsProduct(null)}
                autoColor={settingsProduct ? tileColor(settingsProduct.name).bg : undefined}
                pickedColor={settingsProduct ? tileColors[settingsProduct.id] ?? null : null}
                onPickColor={(color) => {
                  if (!settingsProduct) return;
                  setTileColor(settingsProduct.id, color).then(setTileColors).catch(() => {});
                }}
                autoArt={settingsProduct ? tileArt(settingsProduct.name) : null}
                pickedArt={settingsProduct ? tileArts[settingsProduct.id] ?? null : null}
                onPickArt={(art) => {
                  if (!settingsProduct) return;
                  setTileArt(settingsProduct.id, art).then(setTileArts).catch(() => {});
                }}
              />
            </>
          )}
        </>
      )}

      {totalCount > 0 ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
        >
          <Pressable
            onPress={() => {
              setCoachAck((prev) => new Set(prev).add('cart'));
              router.push('/order-cart');
            }}
            ref={coachRefs.cart}
            collapsable={false}
            className="flex-row items-center justify-center rounded-2xl bg-ink px-5 py-4 active:opacity-80"
            style={{ elevation: 6 }}
          >
            <Text className="text-paper text-base font-bold">[ {totalCount}박스 ] 발주서 확인</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 수량 직접 입력 창 — 빠른발주의 빨간 숫자와 검색발주의 숫자 버튼이 함께 쓴다 */}
      <QtySheet
        productName={qtyProduct?.name ?? ''}
        qty={qtyProduct ? cart[qtyProduct.id] ?? 0 : 0}
        visible={qtyProduct !== null}
        onConfirm={(next) => {
          if (qtyProduct) changeQty(qtyProduct.id, next - (cart[qtyProduct.id] ?? 0));
          setQtyProduct(null);
        }}
        onClose={() => setQtyProduct(null)}
      />
      <VoiceOrderModal
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        products={products}
        onApply={onVoiceApply}
        onManualSearch={onVoiceManualSearch}
      />
      <OrderHistoryModal visible={showHistory} onClose={() => setShowHistory(false)} onReorder={onReorderHistory} />
    </View>
      {/* 매장 무료 사용자 하단 배너(구독·이벤트·테스터는 안 보임) */}
      <HomeBanner />
      <CoachMarks
        step={coachStep}
        index={Math.max(0, coachIndex)}
        total={coachList.length}
        onNext={() => coachStep && setCoachAck((prev) => new Set(prev).add(coachStep.key))}
        onSkip={coachRunning ? finishCoach : finishWhatsNew}
      />
    </View>
  );
}

const QuickOrderHelpModal = memo(function QuickOrderHelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  // 처음 쓰는 사람 기준: 무엇을 하는 화면인지 → 시작 순서 → 버튼 설명 순으로 보여 준다
  const steps = [
    '위쪽 매장 버튼을 눌러 내 매장을 고르거나 새로 추가해요',
    "'구역 관리'에서 냉동고 칸을 만들어요 (예: 600바-1, 콘류)",
    "'+ 상품 진열하기'로 그 칸에 있는 상품을 실제 진열 순서대로 넣어요",
    '발주할 상품을 탭해서 담아요 (한 번 탭 = 1박스)',
    "아래 '[ N박스 ] 발주서 확인'을 눌러요. 납품 희망일을 고르고 배송 메모를 적은 뒤, 보낼 내용을 미리 보고 카톡/SMS로 보내요",
    "보낸 발주는 위쪽 '📅 이력'(검색발주 화면)에 저장돼요",
  ];
  const buttons: { icon: keyof typeof MaterialCommunityIcons.glyphMap; color?: string; text: string }[] = [
    { icon: 'gesture-tap', text: '상품 탭 — 1박스 담기' },
    { icon: 'numeric-1-circle', color: '#CC2222', text: '빨간 숫자 탭 — 수량 조절(빼기·여러 박스)' },
    { icon: 'magnify-plus-outline', text: '상품을 꾹 누르고 있기 — 사진 크게 보기' },
    { icon: 'cog-outline', text: '톱니바퀴 — 상품 수정 · 다른 구역으로 이동 · 줄 아래 구분선' },
    { icon: 'arrow-all', text: '화살표 — 누른 뒤 옮길 자리의 상품을 탭하면 서로 자리가 바뀌어요' },
    { icon: 'trash-can-outline', text: '휴지통 — 이 구역에서 빼기 (상품 자체는 지워지지 않아요)' },
    { icon: 'gesture-tap-hold', text: '구역 이름을 꾹 — 이름 변경 · 순서 변경 · 상품 비우기 · 삭제' },
    { icon: 'pencil-ruler', text: '배치 편집 — 칸 크기·빈칸·순서를 냉동고처럼 맞춰요 (같은 팀 기기에도 같이 바뀌어요)' },
    { icon: 'card-text-outline', text: '상품 칸은 사진 대신 색깔 글자 카드로 보여요 (톱니바퀴에서 색을 바꿀 수 있어요)' },
  ];
  // 검색발주 화면 설명
  const searchTips: { icon: keyof typeof MaterialCommunityIcons.glyphMap; text: string }[] = [
    { icon: 'magnify', text: '검색창 — 상품명, 초성(예: ㅁㄹㄴ), 바코드로 찾아요. 검색하는 동안은 사진 대신 글자 카드로 보여요' },
    { icon: 'barcode-scan', text: '바코드 버튼 — 스캔하면 목록에서 찾아 줘요. 없는 새 상품이면 등록 화면으로 가고, 사진을 못 찾으면 사진 찍기 창이 바로 떠요' },
    { icon: 'microphone-outline', text: "🎙️ 음성 발주 (Beta) — 말로 '메로나 두 박스'처럼 하면 알아듣고 담아요. 못 찾은 건 직접 검색으로 이어져요" },
    { icon: 'star-outline', text: '⭐ 자주 발주 — 발주 이력에서 자주 보낸 상품만 모아 봐요. 카테고리 칩과 함께 쓸 수 있어요' },
    { icon: 'plus-circle-outline', text: "'+ 담기' — 담으면 [−] 숫자 [+]로 바뀌어요. 가운데 숫자를 누르면 수량을 직접 적을 수 있어요" },
    { icon: 'calendar-month-outline', text: "📅 이력 — 보낸 발주를 날짜별로 봐요(예: '메로나 외 3건'). 누르면 자세히 보이고, '이대로 다시 담기'로 장바구니를 그 발주로 바꿔요" },
    { icon: 'chat-outline', text: "카톡/SMS 문구 — 1박스는 상품 이름만, 2박스 이상일 때만 'N박스'가 붙어요" },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '85%' }}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center" style={{ gap: 8 }}>
              <MaterialCommunityIcons name="fridge-outline" size={18} color="#1A1A1A" />
              <Text className="text-ink text-base font-bold">빠른발주 사용법</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="ml-2 h-7 w-7 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <MaterialCommunityIcons name="close" size={20} color="#888888" />
            </Pressable>
          </View>
          <ScrollView>
            <Text className="text-ink text-sm">
              냉동고에 진열된 순서 그대로 상품을 보여 줘요. 매장에서 냉동고를 보면서 부족한 상품을
              탭만 하면 발주가 담겨요.
            </Text>

            <Text className="text-ink mb-2 mt-4 text-sm font-bold">처음 쓰는 순서</Text>
            <View className="gap-2">
              {steps.map((s, i) => (
                <View key={s} className="flex-row" style={{ gap: 8 }}>
                  <View className="bg-primary h-5 w-5 items-center justify-center rounded-full">
                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 'bold' }}>{i + 1}</Text>
                  </View>
                  <Text className="text-ink flex-1 text-sm">{s}</Text>
                </View>
              ))}
            </View>

            <Text className="text-ink mb-2 mt-4 text-sm font-bold">버튼 설명</Text>
            <View className="gap-2.5">
              {buttons.map((b) => (
                <View key={b.text} className="flex-row items-center" style={{ gap: 10 }}>
                  <MaterialCommunityIcons name={b.icon} size={18} color={b.color ?? '#1A1A1A'} />
                  <Text className="text-ink flex-1 text-sm">{b.text}</Text>
                </View>
              ))}
            </View>

            <Text className="text-ink mb-2 mt-4 text-sm font-bold">검색발주 화면</Text>
            <View className="gap-2.5">
              {searchTips.map((b) => (
                <View key={b.text} className="flex-row items-center" style={{ gap: 10 }}>
                  <MaterialCommunityIcons name={b.icon} size={18} color="#1A1A1A" />
                  <Text className="text-ink flex-1 text-sm">{b.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const RESET_CONFIRM_WORD = '초기화';

// 파괴적이고 되돌릴 수 없는 동작이라 일반적인 예/아니오 확인창보다 강한 확인을 요구한다 —
// "초기화"를 정확히 입력해야 버튼이 활성화된다(실수로 알림창 버튼을 누르는 것만으로는 안 지워짐).
const ResetProductsModal = memo(function ResetProductsModal({
  visible,
  productCount,
  resetting,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  productCount: number;
  resetting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const canConfirm = text.trim() === RESET_CONFIRM_WORD && !resetting;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} className="w-full rounded-2xl bg-paper p-4">
          <View className="mb-2 flex-row items-center" style={{ gap: 8 }}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#C62828" />
            <Text className="text-ink text-base font-bold">상품 초기화</Text>
          </View>
          <Text className="text-ink text-sm">
            등록된 발주 상품 {productCount}건이 모두 삭제됩니다. 되돌릴 수 없어요.
          </Text>
          <Text className="text-muted mb-2 mt-2 text-xs">
            계속하려면 아래에 '{RESET_CONFIRM_WORD}'를 입력하세요.
          </Text>
          <TextInput
            className="text-ink rounded-xl border border-line bg-paper px-3 py-2 text-sm"
            placeholder={RESET_CONFIRM_WORD}
            placeholderTextColor="#BBBBBB"
            value={text}
            onChangeText={setText}
            autoFocus
          />
          <View className="mt-4 flex-row justify-end" style={{ gap: 12 }}>
            <Pressable onPress={onClose} className="px-2 py-2">
              <Text className="text-muted text-sm">취소</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={!canConfirm}
              className="rounded-xl px-4 py-2 active:opacity-80"
              style={{ backgroundColor: canConfirm ? '#C62828' : '#E0B4B4' }}
            >
              <Text className="text-sm font-bold" style={{ color: '#FFFFFF' }}>
                {resetting ? '초기화 중...' : '초기화'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const ProductSettingsModal = memo(function ProductSettingsModal({
  visible,
  productName,
  hasDivider,
  onEdit,
  onMove,
  onToggleDivider,
  onClose,
  autoColor,
  pickedColor,
  onPickColor,
  autoArt,
  pickedArt,
  onPickArt,
}: {
  visible: boolean;
  productName: string;
  hasDivider: boolean;
  onEdit: () => void;
  onMove: () => void;
  onToggleDivider: () => void;
  onClose: () => void;
  autoColor?: string;
  pickedColor: string | null;
  /** null이면 자동 색으로 되돌림 */
  onPickColor: (color: string | null) => void;
  /** 이름으로 정한 그림(없으면 null), 사장님이 고른 그림(없으면 null) */
  autoArt: string | null;
  pickedArt: string | null;
  /** null이면 자동 그림으로 되돌림 */
  onPickArt: (art: string | null) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} className="w-full rounded-2xl bg-paper p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-ink flex-1 text-base font-bold" numberOfLines={1}>
              {productName}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="ml-2 h-7 w-7 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <MaterialCommunityIcons name="close" size={20} color="#888888" />
            </Pressable>
          </View>
          <Pressable
            onPress={onEdit}
            className="flex-row items-center rounded-xl px-3 py-3 active:bg-bg"
            style={{ gap: 10 }}
          >
            <MaterialCommunityIcons name="pencil-outline" size={18} color="#1A1A1A" />
            <Text className="text-ink text-sm font-medium">상품 수정</Text>
          </Pressable>
          <Pressable
            onPress={onMove}
            className="flex-row items-center rounded-xl px-3 py-3 active:bg-bg"
            style={{ gap: 10 }}
          >
            <MaterialCommunityIcons name="swap-horizontal" size={18} color="#1A1A1A" />
            <Text className="text-ink text-sm font-medium">다른 구역으로 이동</Text>
          </Pressable>
          <Pressable
            onPress={onToggleDivider}
            className="flex-row items-center rounded-xl px-3 py-3 active:bg-bg"
            style={{ gap: 10 }}
          >
            <MaterialCommunityIcons name="minus" size={18} color="#1A1A1A" />
            <Text className="text-ink text-sm font-medium">
              {hasDivider ? '이 줄 아래 구분선 제거' : '이 줄 아래 구분선 추가'}
            </Text>
          </Pressable>
          {/* 카드 색: 색 위치로 냉동고를 기억하니 매장마다 손에 익은 색으로 바꿀 수 있게 */}
          <View className="mt-1 border-t border-line px-3 pt-3">
            <View className="mb-2 flex-row items-center" style={{ gap: 10 }}>
              <MaterialCommunityIcons name="palette-outline" size={18} color="#1A1A1A" />
              <Text className="text-ink text-sm font-medium">카드 색</Text>
            </View>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <Pressable
                onPress={() => onPickColor(null)}
                className="items-center justify-center rounded-full"
                style={{
                  height: 36,
                  paddingHorizontal: 10,
                  backgroundColor: autoColor ?? '#F7F7F7',
                  borderWidth: pickedColor ? 1 : 3,
                  borderColor: pickedColor ? '#E5E5E5' : '#1A1A1A',
                }}
                accessibilityRole="button"
                accessibilityLabel="카드 색 자동"
                accessibilityState={{ selected: !pickedColor }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#1A1A1A', backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 4, borderRadius: 4 }}>
                  자동
                </Text>
              </Pressable>
              {TILE_COLOR_CHOICES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => onPickColor(c)}
                  hitSlop={4}
                  className="items-center justify-center rounded-full"
                  style={{ width: 36, height: 36, backgroundColor: c, borderWidth: pickedColor === c ? 3 : 1, borderColor: pickedColor === c ? '#1A1A1A' : '#E5E5E5' }}
                  accessibilityRole="button"
                  accessibilityLabel={`카드 색 ${c}`}
                  accessibilityState={{ selected: pickedColor === c }}
                >
                  {pickedColor === c ? <MaterialCommunityIcons name="check" size={16} color={tileColor('', c).fg} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
          {/* 제품 그림: 이름에 맛 단어가 없는 상품은 직접 고른다. '자동'은 이름으로 정한 그림(없으면 그림 없음) */}
          <View className="mt-3 border-t border-line px-3 pt-3">
            <View className="mb-2 flex-row items-center" style={{ gap: 10 }}>
              <MaterialCommunityIcons name="emoticon-outline" size={18} color="#1A1A1A" />
              <Text className="text-ink text-sm font-medium">제품 그림</Text>
            </View>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              <Pressable
                onPress={() => onPickArt(null)}
                className="items-center justify-center rounded-full"
                style={{ height: 36, paddingHorizontal: 12, backgroundColor: '#F7F7F7', borderWidth: pickedArt ? 1 : 3, borderColor: pickedArt ? '#E5E5E5' : '#1A1A1A' }}
                accessibilityRole="button"
                accessibilityLabel="제품 그림 자동"
                accessibilityState={{ selected: !pickedArt }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#1A1A1A' }}>자동 {autoArt ?? '없음'}</Text>
              </Pressable>
              {TILE_ART_CHOICES.map((a) => (
                <Pressable
                  key={a}
                  onPress={() => onPickArt(a)}
                  hitSlop={4}
                  className="items-center justify-center rounded-full"
                  style={{ width: 36, height: 36, backgroundColor: '#F7F7F7', borderWidth: pickedArt === a ? 3 : 1, borderColor: pickedArt === a ? '#1A1A1A' : '#E5E5E5' }}
                  accessibilityRole="button"
                  accessibilityLabel={`제품 그림 ${a}`}
                  accessibilityState={{ selected: pickedArt === a }}
                >
                  <Text style={{ fontSize: 18 }}>{a}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

/** 빨간 숫자를 누르면 여는 수량 조절 창 — 수량을 크게 바꾸거나 줄일 때만 쓰고, 평소엔 타일 누르기(+1)로 끝낸다 */
const QtySheet = memo(function QtySheet({
  visible,
  productName,
  qty,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  productName: string;
  qty: number;
  onConfirm: (next: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(String(qty));
  useEffect(() => {
    if (visible) setValue(String(qty));
  }, [visible, qty]);
  const num = Math.max(0, Math.min(999, parseInt(value, 10) || 0));
  const step = (d: number) => setValue(String(Math.max(0, Math.min(999, num + d))));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-ink/40" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-paper px-5 pt-5"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <Text className="text-ink text-center text-lg font-bold" numberOfLines={1}>
            {productName}
          </Text>
          <Text className="text-muted mt-0.5 text-center text-xs">수량을 정하고 확인을 누르세요</Text>
          <View className="my-5 flex-row items-center justify-center" style={{ gap: 16 }}>
            <Pressable onPress={() => step(-1)} className="h-16 w-16 items-center justify-center rounded-2xl bg-bg active:opacity-70" accessibilityRole="button" accessibilityLabel="1박스 빼기">
              <MaterialCommunityIcons name="minus" size={30} color="#1A1A1A" />
            </Pressable>
            <TextInput
              value={value}
              onChangeText={(t) => setValue(t.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              selectTextOnFocus
              className="text-ink h-16 w-24 rounded-2xl border-2 border-line text-center text-3xl font-bold"
              accessibilityLabel="수량"
            />
            <Pressable onPress={() => step(1)} className="h-16 w-16 items-center justify-center rounded-2xl bg-bg active:opacity-70" accessibilityRole="button" accessibilityLabel="1박스 더하기">
              <MaterialCommunityIcons name="plus" size={30} color="#1A1A1A" />
            </Pressable>
          </View>
          <View className="mb-4 flex-row justify-center" style={{ gap: 8 }}>
            {[1, 2, 3, 5, 10].map((n) => (
              <Pressable key={n} onPress={() => setValue(String(n))} className="rounded-full border border-line px-4 py-2 active:bg-bg" accessibilityRole="button" accessibilityLabel={`${n}박스`}>
                <Text className="text-ink text-sm font-bold">{n}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            <Pressable onPress={() => onConfirm(0)} className="items-center justify-center rounded-2xl bg-bg py-4 active:opacity-70" style={{ flex: 0.6 }} accessibilityRole="button" accessibilityLabel="발주에서 빼기">
              <Text style={{ color: '#B00020', fontWeight: 'bold', fontSize: 16 }}>빼기</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(num)} className="bg-primary flex-1 items-center justify-center rounded-2xl py-4 active:opacity-80" accessibilityRole="button" accessibilityLabel="수량 확인">
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 }}>확인</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  categories,
  assignedIds,
  updateBadges,
  query,
  onChangeQuery,
  onPick,
  onClose,
}: {
  visible: boolean;
  section: FridgeSection;
  allProducts: OrderProduct[];
  categories: string[];
  assignedIds: Set<string>;
  updateBadges: Map<string, CatalogUpdateBadge>;
  query: string;
  onChangeQuery: (q: string) => void;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState('전체');
  // 검색발주 화면과 동일한 검색 조건: 저사양 기기 입력 밀림 방지용 지연 반영 + 신규/수정 뱃지
  // 우선 정렬 + 관련도 순위 검색.
  const deferredQuery = useDeferredValue(query);
  // app.json의 softwareKeyboardLayoutMode:"resize" 덕에 키보드가 뜨면 창 높이 자체가 줄어든다.
  // 그 실제 높이 기준으로 카드 높이를 "확정값"으로 줘야 안의 FlatList(flex:1)가 남는 공간을
  // 정확히 계산할 수 있다 — maxHeight 퍼센트만으로는 부모가 불확정 크기라 목록이 찌그러졌었다.
  const { height: windowHeight } = useWindowDimensions();
  const cardHeight = Math.min(windowHeight * 0.75, 560);
  // 수정(updated) 뱃지는 여기서 다루지 않는다 — 신규(new) 상품만 상단에 모아 보여준다.
  const hasBadge = useCallback(
    (p: OrderProduct) => (p.barcode ? updateBadges.get(p.barcode) === 'new' : false),
    [updateBadges],
  );

  const results = useMemo(() => {
    const byCategory = allProducts.filter(
      (p) => selectedCategory === '전체' || p.category === selectedCategory,
    );
    const badgeSorted = [...byCategory].sort((a, b) => Number(hasBadge(b)) - Number(hasBadge(a)));
    const q = deferredQuery.trim();
    const base = q ? searchOrderProducts(badgeSorted, q) : badgeSorted;
    const notAssigned = base.filter((p) => !assignedIds.has(p.id));
    // 공용 카탈로그 동기화 과정에서 같은 상품이 바코드가 달라 별개 레코드로 들어오는 경우가 있어,
    // 검색 목록에는 이름 기준으로 한 번만 보이게 한다(데이터 자체는 건드리지 않음).
    const seenNames = new Set<string>();
    const deduped = notAssigned.filter((p) => {
      if (seenNames.has(p.name)) return false;
      seenNames.add(p.name);
      return true;
    });
    return deduped.slice(0, 30);
  }, [allProducts, assignedIds, hasBadge, deferredQuery, selectedCategory]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ height: cardHeight }}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-ink flex-1 text-base font-bold" numberOfLines={1}>
              '{section}' 구역에 상품 진열하기
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="ml-2 h-7 w-7 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <MaterialCommunityIcons name="close" size={20} color="#888888" />
            </Pressable>
          </View>
          <Text className="text-muted mb-2 text-xs">
            상품을 탭하면 바로 추가되고, 계속 다른 상품을 검색해 추가할 수 있어요.
          </Text>
          <View className="mb-2 flex-row items-center rounded-xl border border-line bg-bg px-3">
            <TextInput
              className="text-ink flex-1 py-2 text-sm"
              placeholder="상품명 검색"
              placeholderTextColor="#BBBBBB"
              value={query}
              onChangeText={onChangeQuery}
            />
            {query ? (
              <Pressable
                onPress={() => onChangeQuery('')}
                hitSlop={13}
                accessibilityRole="button"
                accessibilityLabel="검색어 지우기"
              >
                <MaterialCommunityIcons name="close-circle" size={24} color="#888888" />
              </Pressable>
            ) : null}
          </View>
          <View className="mb-2 flex-row flex-wrap" style={{ gap: 6 }}>
            <Chip label="전체" active={selectedCategory === '전체'} onPress={() => setSelectedCategory('전체')} />
            {categories.map((c) => (
              <Chip key={c} label={c} active={selectedCategory === c} onPress={() => setSelectedCategory(c)} />
            ))}
          </View>
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isNew = item.barcode ? updateBadges.get(item.barcode) === 'new' : false;
              const badgeMeta = isNew ? UPDATE_BADGE_META.new : null;
              return (
                <Pressable
                  onPress={() => onPick(item.id)}
                  className="flex-row items-center border-b border-line py-2.5"
                >
                  <Thumbnail uri={item.imageUri} size={36} radius={6} iconSize={16} />
                  <View className="ml-2.5 flex-1 flex-row items-center gap-1.5">
                    {badgeMeta ? (
                      <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: badgeMeta.color }}>
                        <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
                          {badgeMeta.label}
                        </Text>
                      </View>
                    ) : null}
                    <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View className="items-center py-6">
                <Text className="text-muted mb-3 text-sm">검색된 상품이 없습니다</Text>
                <Pressable
                  onPress={() => {
                    onClose();
                    router.push({ pathname: '/order-product-form', params: { prefillName: query.trim() } });
                  }}
                  className="rounded-xl bg-primary px-4 py-2.5 active:opacity-80"
                >
                  <Text className="text-sm font-bold" style={{ color: '#FFFFFF' }}>
                    제품 등록하기
                  </Text>
                </Pressable>
              </View>
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
});

// 검색창 글자는 이 안에서만 관리하고(타자마다 발주 화면 전체를 다시 그리지 않게), 입력이 잠깐 멈추면
// 그때 검색어로 넘긴다 — 한 글자마다 전체 상품을 검색하느라 입력(특히 한글 조합)이 밀리던 문제.
// 바코드 스캔·지우기처럼 바깥에서 검색어를 바꾸면 그 값으로 맞춘다.
const SearchInput = memo(function SearchInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (q: string) => void;
}) {
  const [text, setText] = useState(value);
  const lastCommittedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === lastCommittedRef.current) return;
    lastCommittedRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    setText(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onChangeText = (t: string) => {
    setText(t);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastCommittedRef.current = t;
      onCommit(t);
    }, 150);
  };

  return (
    <TextInput
      className="text-ink ml-1 flex-1 py-2.5 text-base"
      placeholder="상품명·초성(ㅁㄹㄴ)·바코드"
      placeholderTextColor="#BBBBBB"
      value={text}
      onChangeText={onChangeText}
    />
  );
});

const CatalogRow = memo(function CatalogRow({
  product,
  qty,
  badge,
  badgeAnimate,
  textCard,
  art,
  onChangeQty,
  onOpenQty,
  onPress,
  onLongPress,
}: {
  product: OrderProduct;
  qty: number;
  badge?: CatalogUpdateBadge;
  badgeAnimate?: boolean;
  /** 검색어가 있을 때만 true — 사진 대신 색 카드로 보여 준다 */
  textCard: boolean;
  /** 제품 그림(이모지). 없으면 상품명 앞 2글자 */
  art: string | null;
  onChangeQty: (id: string, delta: number) => void;
  onOpenQty: (product: OrderProduct) => void;
  onPress: (id: string, barcode: string | null) => void;
  onLongPress: (product: OrderProduct) => void;
}) {
  const statusMeta = STATUS_META[product.status ?? 'active'];
  // 글자 카드 색은 브랜드 기준(같은 브랜드는 늘 같은 색)
  const card = textCard ? tileColor(product.brand || product.name) : null;
  return (
    <Pressable
      onPress={() => onPress(product.id, product.barcode)}
      onLongPress={() => onLongPress(product)}
      className="mx-4 mb-2 flex-row items-center rounded-2xl bg-paper px-3 py-2 active:opacity-70"
      style={{ elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
    >
      <View style={{ overflow: 'visible' }}>
        {card ? (
          <View className="items-center justify-center" style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: card.bg }}>
            <Text style={{ color: card.fg, fontSize: art ? 30 : 18, fontWeight: 'bold' }} numberOfLines={1}>
              {art ?? [...product.name.replace(/\s/g, '')].slice(0, 2).join('')}
            </Text>
          </View>
        ) : (
          <Thumbnail uri={product.imageUri} size={56} radius={14} iconSize={22} />
        )}
        {badge ? (
          <View style={{ position: 'absolute', top: -6, left: -6, zIndex: 1, elevation: 2 }}>
            <UpdateBadge kind={badge} animate={!!badgeAnimate} />
          </View>
        ) : null}
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-ink text-[15px] font-bold leading-5">{product.name}</Text>
        {/* 브랜드·가격·바코드 끝자리를 한 줄에 — 상태는 '시판중'(기본값)이 아닐 때만 표시 */}
        <View className="mt-0.5 flex-row flex-wrap items-center" style={{ columnGap: 6 }}>
          <Text className="text-muted text-xs">
            {product.brand} · {product.price > 0 ? `${product.price.toLocaleString()}원` : '가격 미등록'}
            {product.barcode ? ` · …${product.barcode.slice(-4)}` : ''}
          </Text>
          {product.status && product.status !== 'active' ? (
            <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: statusMeta.color }}>
              <Text className="text-xs font-bold" style={{ color: '#FFFFFF' }}>
                {statusMeta.label}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ width: qty <= 0 ? 76 : 120, marginLeft: 8 }}>
        {qty <= 0 ? (
          <Pressable
            onPress={() => onChangeQty(product.id, 1)}
            className="h-12 items-center justify-center rounded-xl active:opacity-80"
            style={{ backgroundColor: '#3A8B40' }}
            accessibilityRole="button"
            accessibilityLabel={`${product.name} 담기`}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }}>+ 담기</Text>
          </Pressable>
        ) : (
          <View className="h-12 flex-row items-center overflow-hidden rounded-xl border border-line bg-paper">
            <Pressable
              onPress={() => onChangeQty(product.id, -1)}
              className="h-12 flex-1 items-center justify-center active:bg-bg"
              accessibilityRole="button"
              accessibilityLabel="하나 빼기"
            >
              <MaterialCommunityIcons name="minus" size={20} color="#1A1A1A" />
            </Pressable>
            <Pressable
              onPress={() => onOpenQty(product)}
              className="h-12 items-center justify-center border-x border-line px-1 active:bg-bg"
              style={{ flex: 1.2 }}
              accessibilityRole="button"
              accessibilityLabel={`${product.name} ${qty}박스, 눌러서 수량 직접 입력`}
            >
              <Text className="text-ink text-lg font-bold" style={{ fontVariant: ['tabular-nums'] }}>
                {qty}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onChangeQty(product.id, 1)}
              className="h-12 flex-1 items-center justify-center active:bg-bg"
              accessibilityRole="button"
              accessibilityLabel="하나 더하기"
            >
              <MaterialCommunityIcons name="plus" size={20} color="#1A1A1A" />
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
});

const FridgeSectionModal = memo(function FridgeSectionModal({
  visible,
  sections,
  onAdd,
  onRename,
  onDelete,
  onClear,
  onReorder,
  onClose,
}: {
  visible: boolean;
  sections: string[];
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onClear: (name: string) => void;
  onReorder: (sections: string[]) => void;
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

  const moveSection = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sections.length) return;
    const next = [...sections];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onReorder(next);
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
          {/* 아이콘에 이름이 없어 무슨 기능인지 알 수 없다는 지적 — 아이콘별 기능을 적어 둔다 */}
          <Text className="text-muted mb-2 text-xs">
            화살표: 순서 변경 · 연필: 이름 변경 · 되돌리기: 진열 상품 비우기 · 휴지통: 구역 삭제
          </Text>

          <FlatList
            data={sections}
            keyExtractor={(s) => s}
            style={{ maxHeight: 320 }}
            renderItem={({ item: s, index }) =>
              editingName === s ? (
                <View className="flex-row items-center gap-2 px-3 py-2">
                  <TextInput
                    className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                    value={editingValue}
                    onChangeText={setEditingValue}
                    onSubmitEditing={submitRename}
                    autoFocus
                  />
                  <Pressable onPress={submitRename} hitSlop={14}>
                    <Text className="text-primary text-sm font-medium">저장</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditingName(null)} hitSlop={14}>
                    <Text className="text-muted text-sm">취소</Text>
                  </Pressable>
                </View>
              ) : (
                <View className="flex-row items-center justify-between rounded-xl px-1 py-1">
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Pressable
                      onPress={() => moveSection(index, -1)}
                      disabled={index === 0}
                      hitSlop={8}
                      className="h-7 w-7 items-center justify-center rounded-full border border-line bg-bg"
                      style={{ opacity: index === 0 ? 0.25 : 1 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${s} 위로 이동`}
                    >
                      <MaterialCommunityIcons name="chevron-up" size={16} color="#1A1A1A" />
                    </Pressable>
                    <Pressable
                      onPress={() => moveSection(index, 1)}
                      disabled={index === sections.length - 1}
                      hitSlop={8}
                      className="h-7 w-7 items-center justify-center rounded-full border border-line bg-bg"
                      style={{ opacity: index === sections.length - 1 ? 0.25 : 1 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${s} 아래로 이동`}
                    >
                      <MaterialCommunityIcons name="chevron-down" size={16} color="#1A1A1A" />
                    </Pressable>
                  </View>
                  <Text className="text-ink flex-1 px-2 py-2 text-sm font-medium" numberOfLines={1}>
                    {s}
                  </Text>
                  <Pressable
                    onPress={() => startRename(s)}
                    hitSlop={13}
                    className="ml-3"
                    accessibilityRole="button"
                    accessibilityLabel={`${s} 이름 변경`}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={18} color="#888888" />
                  </Pressable>
                  <Pressable
                    onPress={() => onClear(s)}
                    hitSlop={13}
                    className="ml-3"
                    accessibilityRole="button"
                    accessibilityLabel={`${s} 진열 상품 비우기`}
                  >
                    <MaterialCommunityIcons name="backup-restore" size={18} color="#888888" />
                  </Pressable>
                  <Pressable
                    onPress={() => onDelete(s)}
                    hitSlop={13}
                    className="ml-3"
                    accessibilityRole="button"
                    accessibilityLabel={`${s} 구역 삭제`}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color="#888888" />
                  </Pressable>
                </View>
              )
            }
          />

          <View className="mt-3 flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="새 구역 이름 (예: 샌드류)"
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
          <Text className="text-ink mb-2 text-base font-bold">매장 관리</Text>

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
                <Pressable onPress={submitRename} hitSlop={14}>
                  <Text className="text-primary text-sm font-medium">저장</Text>
                </Pressable>
                <Pressable onPress={() => setEditingId(null)} hitSlop={14}>
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
                <Pressable onPress={() => startRename(s)} hitSlop={13} className="ml-3">
                  <MaterialCommunityIcons name="pencil-outline" size={18} color="#888888" />
                </Pressable>
                <Pressable onPress={() => onDelete(s.id, s.name)} hitSlop={13} className="ml-3">
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
