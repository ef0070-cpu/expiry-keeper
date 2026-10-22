import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Modal, Platform, Pressable, ScrollView, Text, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Thumbnail from '@/components/Thumbnail';
import {
  FridgeBackground,
  FridgeColumns,
  TileSpan,
  dropIndexAt,
  layoutRects,
  moveItem,
  newSpacerId,
  packRows,
  spanWidth,
} from '@/lib/fridge-layout';
import type { OrderCart, OrderProduct } from '@/lib/order-types';
import { splitTileName, tileColor } from '@/lib/tile-color';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/** 빠른발주 한 칸: 상품, 또는 진열대 빈 자리(product null) */
export type FridgeGridItem = { id: string; product: OrderProduct | null; span: TileSpan };

const GAP = 10;
const PEEK_MS = 300; // 길게 누르면 사진 보기
const EDIT_MS = 1000; // 계속 누르고 있으면 배치 편집 시작(명세 2026-10-22)

/** 줄 사이 간격과 선반 모양(배경별). 위치 계산(layoutRects)과 그리기가 같은 값을 쓴다 */
function railStyle(bg: FridgeBackground, divider: boolean) {
  if (bg === 'chest') return { gap: 22, bar: divider ? 9 : 5, color: '#C9A85A', edge: '#F3E2A8' };
  if (bg === 'case') return { gap: 22, bar: divider ? 12 : 8, color: '#FFFFFF', edge: '#AAC8E1' };
  return { gap: divider ? 20 : GAP, bar: divider ? 4 : 0, color: '#888888', edge: '#888888' };
}

/** 상품 분류 → 카드 위쪽 작은 아이콘(분류 값 끝에 줄바꿈이 섞인 데이터가 있어 trim) */
function categoryIcon(category: string): keyof typeof MaterialCommunityIcons.glyphMap {
  const c = (category ?? '').trim();
  if (c === '콘') return 'ice-cream';
  if (c === '홈/컵') return 'cup';
  if (c === '튜브' || c === '쭈쭈바') return 'bottle-tonic-outline';
  if (c === '치어팩') return 'bottle-soda-outline';
  if (c === '샌드/기타') return 'cookie-outline';
  if (c === '얼음류') return 'cube-outline';
  if (c === '상자류') return 'package-variant-closed';
  if (c.includes('바')) return 'ice-pop';
  return 'food-variant';
}

const SPAN_OPTIONS: { key: TileSpan; label: string }[] = [
  { key: 1, label: '1칸' },
  { key: 2, label: '2칸' },
  { key: 'full', label: '줄' },
];

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  dark,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  dark?: boolean;
}) {
  return (
    <View className="flex-row rounded-xl bg-bg p-0.5" style={{ gap: 2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={String(o.key)}
            onPress={() => onChange(o.key)}
            className="items-center justify-center rounded-lg px-2.5 py-1.5"
            style={on ? { backgroundColor: dark ? '#1A1A1A' : '#CC2222' } : null}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: on ? '#FFFFFF' : '#555555' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type TileProps = {
  item: FridgeGridItem;
  width: number;
  height: number;
  cols: number;
  qty: number;
  editing: boolean;
  dragging: boolean;
  pendingMove: boolean;
  tileColorOverride?: string;
  fontFamily?: string;
  onTap: () => void;
  onLongEdit: () => void;
  onOpenSettings: () => void;
  onRemove: () => void;
  onOpenQty: () => void;
  onSpan: (s: TileSpan) => void;
  onToggleMove: () => void;
  onDragStart: (absX: number, absY: number) => void;
  onDragMove: (absX: number, absY: number) => void;
  onDragEnd: () => void;
};

const GridTile = memo(function GridTile(p: TileProps) {
  const { item, width, height, editing } = p;
  const [peek, setPeek] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const longFired = useRef(false);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPeek(false);
  };
  useEffect(() => clear, []);

  // 편집 중에만: 0.2초 누르고 있으면 끌기 시작(다른 버튼 탭과 안 겹치게)
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(editing)
        .activateAfterLongPress(200)
        .runOnJS(true)
        .onStart((e) => p.onDragStart(e.absoluteX, e.absoluteY))
        .onUpdate((e) => p.onDragMove(e.absoluteX, e.absoluteY))
        .onFinalize(() => p.onDragEnd()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, p.onDragStart, p.onDragMove, p.onDragEnd],
  );

  const spanRow = editing ? (
    <View className="absolute flex-row" style={{ left: 5, right: 5, bottom: 5, gap: 3 }}>
      {SPAN_OPTIONS.filter((o) => o.key !== 2 || p.cols > 2).map((o) => {
        const on = spanWidth(item.span, p.cols) === spanWidth(o.key, p.cols);
        return (
          <Pressable
            key={String(o.key)}
            onPress={() => p.onSpan(o.key)}
            className="flex-1 items-center rounded-md py-1"
            style={{ backgroundColor: on ? '#1A1A1A' : 'rgba(255,255,255,0.88)' }}
            accessibilityRole="button"
            accessibilityLabel={`칸 크기 ${o.label}`}
            accessibilityState={{ selected: on }}
          >
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: on ? '#FFFFFF' : '#1A1A1A' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  // ── 빈칸 ──
  if (!item.product) {
    if (!editing) return <View style={{ width, height }} />; // 발주 중엔 자리만 차지(누를 수 없음)
    return (
      <GestureDetector gesture={pan}>
        <Pressable
          onPress={p.onTap}
          style={{
            width,
            height,
            borderRadius: 14,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: p.pendingMove ? '#CC2222' : '#888888',
            backgroundColor: 'rgba(255,255,255,0.45)',
            opacity: p.dragging ? 0.25 : 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityLabel="빈칸"
        >
          <Text style={{ color: '#555555', fontWeight: 'bold', fontSize: 14, marginBottom: 22 }}>빈칸</Text>
          <Pressable
            onPress={p.onRemove}
            hitSlop={10}
            className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-paper"
            accessibilityRole="button"
            accessibilityLabel="빈칸 지우기"
          >
            <MaterialCommunityIcons name="close" size={14} color="#555555" />
          </Pressable>
          <Pressable
            onPress={p.onToggleMove}
            hitSlop={10}
            className="absolute left-1 top-1 h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: p.pendingMove ? '#CC2222' : '#FFFFFF' }}
            accessibilityRole="button"
            accessibilityLabel="빈칸 옮기기"
          >
            <MaterialCommunityIcons name="arrow-all" size={13} color={p.pendingMove ? '#FFFFFF' : '#1A1A1A'} />
          </Pressable>
          {spanRow}
        </Pressable>
      </GestureDetector>
    );
  }

  // ── 상품 카드(사진 대신 색 카드, 2026-10-22 승인 A안) ──
  const product = item.product;
  const color = tileColor(product.name, p.tileColorOverride);
  const [head, sub] = splitTileName(product.name);
  const w = spanWidth(item.span, p.cols);
  const headSize = Math.max(14, Math.min(w > 1 ? 40 : p.cols >= 4 ? 21 : p.cols === 2 ? 32 : 28, Math.floor((width / Math.max(head.length, 2)) * 0.95)));
  const iconBg = color.fg === '#FFFFFF' ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.7)';

  return (
    <GestureDetector gesture={pan}>
      <Pressable
        onPressIn={() => {
          if (editing) return;
          longFired.current = false;
          timers.current.push(setTimeout(() => setPeek(true), PEEK_MS));
          timers.current.push(
            setTimeout(() => {
              longFired.current = true;
              clear();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              p.onLongEdit();
            }, EDIT_MS),
          );
        }}
        onPressOut={() => {
          if (!editing) {
            timers.current.forEach(clearTimeout);
            timers.current = [];
            if (peek) longFired.current = true; // 사진만 보고 손 뗀 건 담기가 아니다
            setPeek(false);
          }
        }}
        onPress={() => {
          if (longFired.current) return;
          p.onTap();
        }}
        accessibilityRole="button"
        accessibilityLabel={editing ? `${product.name}, 길게 눌러 옮기기` : `${product.name}, 누르면 1박스 담기`}
        style={{
          width,
          height,
          borderRadius: 14,
          backgroundColor: color.bg,
          alignItems: 'center',
          paddingHorizontal: 6,
          opacity: p.dragging ? 0.25 : 1,
          borderWidth: editing ? 2 : 0,
          borderStyle: 'dashed',
          borderColor: p.pendingMove ? '#CC2222' : 'rgba(255,255,255,0.95)',
          elevation: 3,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <Modal visible={peek} transparent animationType="fade">
          <View pointerEvents="none" className="flex-1 items-center justify-center bg-ink/50">
            <View className="items-center rounded-2xl bg-paper p-4">
              <Thumbnail uri={product.imageUri} size={220} radius={12} iconSize={64} />
              <Text className="text-ink mt-2 text-center text-base font-bold">{product.name}</Text>
              <Text className="text-muted mt-1 text-center text-xs">계속 누르고 있으면 배치 편집</Text>
            </View>
          </View>
        </Modal>

        <Pressable
          onPress={p.onOpenSettings}
          hitSlop={10}
          className="absolute left-1 top-1 z-10 h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: iconBg }}
          accessibilityRole="button"
          accessibilityLabel={`${product.name} 설정`}
        >
          <MaterialCommunityIcons name="cog-outline" size={13} color="#555555" />
        </Pressable>
        {editing ? (
          <Pressable
            onPress={p.onToggleMove}
            hitSlop={10}
            className="absolute right-1 top-1 z-10 h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: p.pendingMove ? '#CC2222' : iconBg }}
            accessibilityRole="button"
            accessibilityLabel={p.pendingMove ? `${product.name} 옮기기 취소` : `${product.name} 옮기기(다음에 누른 카드 앞으로)`}
          >
            <MaterialCommunityIcons name="arrow-all" size={13} color={p.pendingMove ? '#FFFFFF' : '#1A1A1A'} />
          </Pressable>
        ) : (
          <Pressable
            onPress={p.onRemove}
            hitSlop={10}
            className="absolute right-1 top-1 z-10 h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: iconBg }}
            accessibilityRole="button"
            accessibilityLabel={`${product.name} 이 구역에서 빼기`}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={13} color="#555555" />
          </Pressable>
        )}

        <MaterialCommunityIcons name={categoryIcon(product.category)} size={15} color={color.fg} style={{ marginTop: 9, opacity: 0.75 }} />
        <View className="w-full flex-1 items-center justify-center" style={{ paddingBottom: editing ? 26 : 22 }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ color: color.fg, fontSize: headSize, textAlign: 'center', ...(p.fontFamily ? { fontFamily: p.fontFamily } : { fontWeight: 'bold' }) }}
          >
            {head}
          </Text>
          {sub ? (
            <Text
              numberOfLines={editing ? 1 : 2}
              style={{
                color: color.fg,
                fontSize: w > 1 ? 13 : 11,
                fontWeight: 'bold',
                textAlign: 'center',
                marginTop: 4,
                paddingHorizontal: 7,
                paddingVertical: 1,
                borderRadius: 999,
                overflow: 'hidden',
                backgroundColor: color.fg === '#FFFFFF' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.6)',
              }}
            >
              {sub}
            </Text>
          ) : null}
        </View>

        {!editing && p.qty > 0 ? (
          <Pressable
            onPress={p.onOpenQty}
            hitSlop={10}
            className="bg-primary absolute bottom-1 left-1 flex-row items-center justify-center rounded-full active:opacity-70"
            style={{ minWidth: 34, height: 28, paddingHorizontal: 7, borderWidth: 2, borderColor: '#FFFFFF' }}
            accessibilityRole="button"
            accessibilityLabel={`${product.name} ${p.qty}박스, 눌러서 수량 조절`}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' }}>{p.qty}</Text>
            <MaterialCommunityIcons name="chevron-down" size={12} color="#FFFFFF" />
          </Pressable>
        ) : null}
        {spanRow}
      </Pressable>
    </GestureDetector>
  );
});

/**
 * 빠른발주 냉동고 화면(2026-10-22): 매장별 배경·선반, 구역별 열 수, 상품별 칸 크기, 빈칸,
 * 배치 편집(길게 눌러 끌어서 끼워 넣기 · ⤧로 옮기기) — [완료]를 누르면 onSave로 통째로 저장(팀원 기기로도 동기화).
 */
export default function FridgeGrid(props: {
  items: FridgeGridItem[];
  cols: FridgeColumns;
  background: FridgeBackground;
  /** 구분선을 넣은 줄의 마지막 항목 id(그 줄 아래 선반을 두껍게) */
  dividerIds: Set<string>;
  label: string;
  cart: OrderCart;
  tileColors: Record<string, string>;
  fontFamily?: string;
  header: ReactNode;
  empty: ReactNode;
  bottomPadding: number;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: (items: FridgeGridItem[]) => void;
  onChangeColumns: (cols: FridgeColumns) => void;
  onChangeBackground: (bg: FridgeBackground) => void;
  onTap: (p: OrderProduct) => void;
  onOpenSettings: (p: OrderProduct) => void;
  onRemove: (p: OrderProduct) => void;
  onOpenQty: (p: OrderProduct) => void;
}) {
  const { cols, background, editing } = props;
  const [draft, setDraft] = useState<FridgeGridItem[]>(props.items);
  const [gridWidth, setGridWidth] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);

  // 편집을 시작할 때만 지금 배치를 복사해 둔다(편집 중 동기화로 목록이 바뀌어도 손대던 배치를 지킨다)
  useEffect(() => {
    if (editing) setDraft(props.items);
    else setPendingMoveId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const list = editing ? draft : props.items;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const cell = gridWidth > 0 ? (gridWidth - GAP * (cols - 1)) / cols : 0;
  const tileH = Math.min(cell / 0.82, 170);
  const rows = useMemo(() => packRows(list.map((i) => i.span), cols), [list, cols]);
  const rowDivider = useCallback(
    (r: number) => {
      const row = rows[r];
      return !!row && props.dividerIds.has(list[row[row.length - 1].index].id);
    },
    [rows, list, props.dividerIds],
  );
  const rects = useMemo(
    () => layoutRects(rows, { cols, width: gridWidth, gap: GAP, tileHeight: tileH, rowGap: (r) => railStyle(background, rowDivider(r)).gap }),
    [rows, cols, gridWidth, tileH, background, rowDivider],
  );
  const rectsRef = useRef(rects);
  rectsRef.current = rects;

  // ── 끌기 ──
  const rootRef = useRef<View>(null);
  const gridRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const ghost = useRef(new Animated.ValueXY()).current;
  const drag = useRef<{
    id: string;
    offX: number;
    offY: number;
    rootX: number;
    rootY: number;
    gridX: number;
    gridY: number;
    scroll0: number;
    viewTop: number;
    viewBottom: number;
    lastMoveAt: number;
    lastAbs: [number, number];
  } | null>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyMove = useCallback(
    (absX: number, absY: number) => {
      const d = drag.current;
      if (!d) return;
      d.lastAbs = [absX, absY];
      ghost.setValue({ x: absX - d.rootX - d.offX, y: absY - d.rootY - d.offY });
      const gx = absX - d.gridX;
      const gy = absY - d.gridY + (scrollY.current - d.scroll0);
      const cur = draftRef.current;
      const from = cur.findIndex((i) => i.id === d.id);
      const hit = rectsRef.current.find((r) => gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h);
      if (hit && cur[hit.index]?.id === d.id) return; // 자기 자리 위
      const to = dropIndexAt(rectsRef.current, gx, gy);
      const now = Date.now();
      // 자리가 바뀌는 순간 배치가 움직여 손가락 아래 카드가 바뀌므로, 너무 잦은 재배치(떨림)를 막는다
      if (to === null || to === from || to === from + 1 || now - d.lastMoveAt < 140) return;
      d.lastMoveAt = now;
      LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
      setDraft(moveItem(cur, from, to));
    },
    [ghost],
  );

  const onDragStart = useCallback(
    (id: string) => (absX: number, absY: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setPendingMoveId(null);
      rootRef.current?.measureInWindow((rootX, rootY, _rw, rootH) => {
        gridRef.current?.measureInWindow((gridX, gridY) => {
          const idx = draftRef.current.findIndex((i) => i.id === id);
          const r = rectsRef.current.find((x) => x.index === idx);
          if (!r) return;
          drag.current = {
            id,
            offX: absX - (gridX + r.x),
            offY: absY - (gridY + r.y),
            rootX,
            rootY,
            gridX,
            gridY,
            scroll0: scrollY.current,
            viewTop: rootY,
            viewBottom: rootY + rootH,
            lastMoveAt: 0,
            lastAbs: [absX, absY],
          };
          setDragId(id);
          ghost.setValue({ x: gridX + r.x - rootX, y: gridY + r.y - rootY });
          // 화면 위·아래 끝에 손가락을 대고 있으면 저절로 넘긴다
          autoScroll.current = setInterval(() => {
            const dd = drag.current;
            if (!dd) return;
            const y = dd.lastAbs[1];
            const dir = y > dd.viewBottom - 70 ? 1 : y < dd.viewTop + 70 ? -1 : 0;
            if (!dir) return;
            const next = Math.max(0, scrollY.current + dir * 12);
            scrollRef.current?.scrollTo({ y: next, animated: false });
            scrollY.current = next;
            applyMove(dd.lastAbs[0], dd.lastAbs[1]);
          }, 16);
        });
      });
    },
    [ghost, applyMove],
  );
  const onDragEnd = useCallback(() => {
    if (autoScroll.current) clearInterval(autoScroll.current);
    autoScroll.current = null;
    drag.current = null;
    setDragId(null);
  }, []);

  // 렌더마다 새 함수를 만들지 않게 카드별 끌기 핸들러를 기억
  const handlers = useRef(new Map<string, (x: number, y: number) => void>());
  const startFor = (id: string) => {
    let h = handlers.current.get(id);
    if (!h) {
      h = onDragStart(id);
      handlers.current.set(id, h);
    }
    return h;
  };

  const setSpan = (id: string, span: TileSpan) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
    setDraft((d) => d.map((i) => (i.id === id ? { ...i, span } : i)));
  };
  const tapInEdit = (id: string) => {
    if (!pendingMoveId || pendingMoveId === id) return;
    const from = draft.findIndex((i) => i.id === pendingMoveId);
    const to = draft.findIndex((i) => i.id === id);
    LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
    setDraft(moveItem(draft, from, to)); // ⤧로 고른 카드를 누른 카드 "앞"에 끼워 넣기
    setPendingMoveId(null);
  };
  const addSpacer = () => {
    setDraft((d) => [...d, { id: newSpacerId(), product: null, span: 1 }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const frame =
    background === 'chest'
      ? { outer: '#D5DCE2', inner: '#DCE8F1', border: '#B7C0C8', borderWidth: 8 }
      : background === 'case'
        ? { outer: '#2B3137', inner: '#E3EEF7', border: '#F2F4F6', borderWidth: 7 }
        : null;
  const draggingItem = dragId ? draft.find((i) => i.id === dragId) : undefined;
  const ghostRect = draggingItem ? rects.find((r) => list[r.index]?.id === dragId) : undefined;
  const ghostColor = draggingItem?.product ? tileColor(draggingItem.product.name, props.tileColors[draggingItem.product.id]) : null;

  return (
    <View ref={rootRef} style={{ flex: 1 }} collapsable={false}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={!dragId}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        style={{ backgroundColor: frame?.outer }}
        contentContainerStyle={{ padding: 16, paddingBottom: props.bottomPadding }}
      >
        {props.header}

        {/* 보기 방식(열 수) + 배치 편집 */}
        <View className="mb-3 mt-3 flex-row items-center" style={{ gap: 8 }}>
          <Segmented<FridgeColumns>
            value={cols}
            options={[
              { key: 2, label: '2열' },
              { key: 3, label: '3열' },
              { key: 4, label: '4열' },
            ]}
            onChange={props.onChangeColumns}
            dark
          />
          <View className="flex-1" />
          {editing ? (
            <Pressable
              onPress={() => {
                props.onSave(draft);
                props.onEditingChange(false);
              }}
              className="bg-primary flex-row items-center rounded-full px-4 py-2 active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel="배치 편집 완료"
            >
              <MaterialCommunityIcons name="check" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold', marginLeft: 4 }}>완료</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => props.onEditingChange(true)}
              className="flex-row items-center rounded-full border border-ink bg-paper px-3 py-1.5 active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="배치 편집"
            >
              <MaterialCommunityIcons name="pencil-outline" size={15} color="#1A1A1A" />
              <Text className="text-ink ml-1 text-sm font-bold">배치 편집</Text>
            </Pressable>
          )}
        </View>

        {editing ? (
          <View className="mb-3 rounded-2xl bg-ink px-4 py-3">
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13, textAlign: 'center' }}>
              카드를 길게 눌러 끌어 옮기세요 · ⤧ 누르고 놓을 카드를 눌러도 돼요
            </Text>
            <View className="mt-2.5 flex-row items-center justify-center" style={{ gap: 8 }}>
              <Segmented<FridgeBackground>
                value={background}
                options={[
                  { key: 'chest', label: '평대' },
                  { key: 'case', label: '쇼케이스' },
                  { key: 'none', label: '배경 없음' },
                ]}
                onChange={props.onChangeBackground}
              />
              <Pressable
                onPress={addSpacer}
                className="flex-row items-center rounded-xl bg-paper px-3 py-2 active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel="빈칸 추가"
              >
                <MaterialCommunityIcons name="plus" size={14} color="#1A1A1A" />
                <Text className="text-ink text-xs font-bold">빈칸</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          style={
            frame
              ? { backgroundColor: frame.inner, borderColor: frame.border, borderWidth: frame.borderWidth, borderRadius: 18, padding: 10 }
              : null
          }
        >
          {frame ? (
            <View className="mb-2.5 self-start rounded-lg px-2.5 py-0.5" style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}>
              <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#33414E' }}>{props.label}</Text>
            </View>
          ) : null}
          {background === 'chest' ? (
            // 평대 가운데 유리 미닫이 이음새(카드 뒤)
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 4, marginLeft: -2, backgroundColor: '#AAB4BE', opacity: 0.6 }}
            />
          ) : null}
          <View ref={gridRef} collapsable={false} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
            {list.length === 0 ? props.empty : null}
            {gridWidth > 0
              ? rows.map((row, r) => {
                  const rail = r > 0 ? railStyle(background, rowDivider(r - 1)) : null;
                  return (
                    <View key={list[row[0].index].id}>
                      {rail ? (
                        <View style={{ height: rail.gap, justifyContent: 'center' }}>
                          {rail.bar ? (
                            <View
                              style={{
                                height: rail.bar,
                                marginHorizontal: frame ? -4 : 0,
                                borderRadius: 3,
                                backgroundColor: rail.color,
                                borderTopWidth: background === 'none' ? 0 : 1,
                                borderTopColor: rail.edge,
                                borderBottomWidth: background === 'case' ? 2 : 0,
                                borderBottomColor: rail.edge,
                              }}
                            />
                          ) : null}
                        </View>
                      ) : null}
                      <View className="flex-row" style={{ gap: GAP }}>
                        {row.map(({ index, width }) => {
                          const it = list[index];
                          return (
                            <GridTile
                              key={it.id}
                              item={it}
                              width={cell * width + GAP * (width - 1)}
                              height={tileH}
                              cols={cols}
                              qty={it.product ? props.cart[it.product.id] ?? 0 : 0}
                              editing={editing}
                              dragging={dragId === it.id}
                              pendingMove={pendingMoveId === it.id}
                              tileColorOverride={it.product ? props.tileColors[it.product.id] : undefined}
                              fontFamily={props.fontFamily}
                              onTap={() => (editing ? tapInEdit(it.id) : it.product && props.onTap(it.product))}
                              onLongEdit={() => props.onEditingChange(true)}
                              onOpenSettings={() => it.product && props.onOpenSettings(it.product)}
                              onRemove={() =>
                                it.product ? props.onRemove(it.product) : setDraft((d) => d.filter((x) => x.id !== it.id))
                              }
                              onOpenQty={() => it.product && props.onOpenQty(it.product)}
                              onSpan={(s) => setSpan(it.id, s)}
                              onToggleMove={() => setPendingMoveId((cur) => (cur === it.id ? null : it.id))}
                              onDragStart={startFor(it.id)}
                              onDragMove={applyMove}
                              onDragEnd={onDragEnd}
                            />
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              : null}
          </View>
        </View>
      </ScrollView>

      {/* 끌고 있는 카드(손가락을 따라다님) */}
      {draggingItem && ghostRect ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: ghostRect.w,
            height: ghostRect.h,
            transform: [...ghost.getTranslateTransform(), { scale: 1.06 }, { rotate: '2deg' }],
            borderRadius: 14,
            elevation: 12,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 8 },
            backgroundColor: ghostColor?.bg ?? 'rgba(255,255,255,0.8)',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.95,
          }}
        >
          <Text
            numberOfLines={1}
            style={{ fontSize: 22, color: ghostColor?.fg ?? '#555555', ...(props.fontFamily ? { fontFamily: props.fontFamily } : { fontWeight: 'bold' }) }}
          >
            {draggingItem.product ? splitTileName(draggingItem.product.name)[0] : '빈칸'}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
