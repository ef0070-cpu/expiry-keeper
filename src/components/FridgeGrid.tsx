import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ReactNode, Ref, RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, Modal, Platform, Pressable, ScrollView, Text, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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
import { tileArt } from '@/lib/tile-art';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

/** 빠른발주 한 칸: 상품, 또는 진열대 빈 자리(product null) */
export type FridgeGridItem = { id: string; product: OrderProduct | null; span: TileSpan };

const GAP = 10;
const MIN_ONE_LINE_SIZE = 18; // 한 줄 이름 글자가 이보다 작아지면 2줄로 나눈다
const PEEK_MS = 300; // 길게 누르면 사진 보기
const EDIT_MS = 1000; // 계속 누르고 있으면 배치 편집 시작(명세 2026-10-22)

/** 줄 사이 간격과 선반 모양(배경별). 위치 계산(layoutRects)과 그리기가 같은 값을 쓴다 */
function railStyle(bg: FridgeBackground, divider: boolean) {
  if (bg === 'chest') return { gap: 22, bar: divider ? 9 : 5, color: '#C9A85A', edge: '#F3E2A8' };
  if (bg === 'case') return { gap: 22, bar: divider ? 12 : 8, color: '#FFFFFF', edge: '#AAC8E1' };
  return { gap: divider ? 20 : GAP, bar: divider ? 4 : 0, color: '#888888', edge: '#888888' };
}

const SPAN_OPTIONS: { key: TileSpan; label: string; short: string }[] = [
  { key: 1, label: '1칸', short: '1' },
  { key: 2, label: '2칸', short: '2' },
  { key: 'full', label: '줄', short: '줄' },
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
  tileColorOverride?: string;
  tileArtOverride?: string;
  fontFamily?: string;
  onTap: () => void;
  onLongEdit: () => void;
  onOpenSettings: () => void;
  onRemove: () => void;
  onOpenQty: () => void;
  onSpan: (s: TileSpan) => void;
  onDragStart: (absX: number, absY: number) => void;
  onDragMove: (absX: number, absY: number) => void;
  onDragEnd: () => void;
  /** 끌고 있는 손가락 위치(UI 스레드에서 갱신 — 끌리는 카드가 JS 지연과 상관없이 따라온다) */
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  cardRef?: Ref<View>;
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
  // 손가락 위치는 UI 스레드에서 바로 반영하고, 자리 판정(JS)은 0.05초에 한 번만 넘긴다
  const pan = useMemo(() => {
    const { fingerX, fingerY, onDragStart, onDragMove, onDragEnd } = p;
    let lastSent = 0;
    return Gesture.Pan()
      .enabled(editing)
      .activateAfterLongPress(200)
      .onStart((e) => {
        'worklet';
        fingerX.value = e.absoluteX;
        fingerY.value = e.absoluteY;
        lastSent = Date.now();
        scheduleOnRN(onDragStart, e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        'worklet';
        fingerX.value = e.absoluteX;
        fingerY.value = e.absoluteY;
        const now = Date.now();
        if (now - lastSent < 50) return;
        lastSent = now;
        scheduleOnRN(onDragMove, e.absoluteX, e.absoluteY);
      })
      .onFinalize(() => {
        'worklet';
        scheduleOnRN(onDragEnd);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, p.onDragStart, p.onDragMove, p.onDragEnd, p.fingerX, p.fingerY]);

  const spanRow = editing ? (
    <View className="absolute flex-row" style={{ left: 5, right: 5, bottom: 5, gap: 3 }}>
      {SPAN_OPTIONS.filter((o) => o.key !== 2 || p.cols > 2).map((o) => {
        const on = spanWidth(item.span, p.cols) === spanWidth(o.key, p.cols);
        return (
          <Pressable
            key={String(o.key)}
            onPress={() => p.onSpan(o.key)}
            className="flex-1 items-center justify-center rounded-md"
            style={{ height: 24, backgroundColor: on ? '#1A1A1A' : 'rgba(255,255,255,0.88)' }}
            accessibilityRole="button"
            accessibilityLabel={`칸 크기 ${o.label}`}
            accessibilityState={{ selected: on }}
          >
            {/* 좁은 4열에서도 한 줄로 — 글자가 꺾여 상품명을 덮지 않게 짧은 글자·1줄 고정 */}
            <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: 'bold', color: on ? '#FFFFFF' : '#1A1A1A' }}>
              {p.cols >= 4 ? o.short : o.label}
            </Text>
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
            borderColor: '#888888',
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
  const baseSize = w > 1 ? 40 : p.cols >= 4 ? 21 : p.cols === 2 ? 32 : 28;
  // 한 줄로 쓰면 글자가 너무 작아지는 긴 이름(4글자 이상)은 반으로 나눠 2줄로, 글자 크기를 키운다
  const headChars = [...head];
  const availW = width - 12;
  const twoLine = headChars.length >= 4 && Math.floor((availW / headChars.length) * 0.95) < MIN_ONE_LINE_SIZE;
  const half = Math.ceil(headChars.length / 2);
  const headText = twoLine ? `${headChars.slice(0, half).join('')}\n${headChars.slice(half).join('')}` : head;
  const headSize = twoLine
    ? Math.max(14, Math.min(sub ? 17 : baseSize, Math.floor((availW / half) * 0.95)))
    : Math.max(14, Math.min(baseSize, Math.floor((width / Math.max(head.length, 2)) * 0.95)));
  const iconBg = color.fg === '#FFFFFF' ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.7)';
  const art = tileArt(product.name, p.tileArtOverride);
  // 어두운 카드엔 어두운 그림자, 밝은 카드엔 흰 그림자로 글자 윤곽을 살린다
  const textShadow =
    color.fg === '#FFFFFF'
      ? { textShadowColor: 'rgba(0,0,0,0.28)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }
      : { textShadowColor: 'rgba(255,255,255,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 };

  return (
    <GestureDetector gesture={pan}>
      <Pressable
        ref={p.cardRef}
        collapsable={false}
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
          borderRadius: 16,
          backgroundColor: color.bg,
          alignItems: 'center',
          paddingHorizontal: 6,
          opacity: p.dragging ? 0.25 : 1,
          borderWidth: editing ? 2 : 0,
          borderStyle: 'dashed',
          borderColor: 'rgba(255,255,255,0.95)',
          elevation: 3,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
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

        {/* 편집 중엔 끌기·칸 크기가 목적이라 설정 버튼을 숨겨 상품명을 가리지 않게 한다 */}
        {!editing ? (
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
        ) : null}
        {!editing ? (
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
        ) : null}

        <View className="w-full flex-1 items-center justify-center" style={{ paddingTop: editing ? 6 : 26, paddingBottom: editing ? 34 : 22 }}>
          <Text
            numberOfLines={twoLine ? 2 : 1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ color: color.fg, fontSize: headSize, textAlign: 'center', ...textShadow, ...(p.fontFamily ? { fontFamily: p.fontFamily } : { fontWeight: 'bold' }) }}
          >
            {headText}
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

        {art ? (
          <Text
            pointerEvents="none"
            style={{ position: 'absolute', bottom: 2, right: 4, fontSize: w > 1 ? 34 : 28, opacity: 0.95, transform: [{ rotate: '-8deg' }] }}
          >
            {art}
          </Text>
        ) : null}

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
 * 배치 편집(길게 눌러 끌어서 끼워 넣기) — [완료]를 누르면 onSave로 통째로 저장(팀원 기기로도 동기화).
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
  tileArts: Record<string, string>;
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
  /** 따라하기 안내가 가리킬 첫 상품 카드·배치 편집 버튼 */
  firstCardRef?: RefObject<View | null>;
  editButtonRef?: RefObject<View | null>;
}) {
  const { cols, background, editing } = props;
  const [draft, setDraft] = useState<FridgeGridItem[]>(props.items);
  const [gridWidth, setGridWidth] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  // 편집을 시작할 때만 지금 배치를 복사해 둔다(편집 중 동기화로 목록이 바뀌어도 손대던 배치를 지킨다)
  useEffect(() => {
    if (editing) setDraft(props.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const list = editing ? draft : props.items;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // 카드별 핸들러가 늘 최신 값을 보게 하는 참조(핸들러는 카드마다 한 번만 만든다)
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const propsRef = useRef(props);
  propsRef.current = props;
  const listRef = useRef(list);
  listRef.current = list;

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
  // 끌리는 카드 위치 = 손가락 위치 − 기준점. 둘 다 UI 스레드 값이라 JS가 바빠도 카드가 손가락을 놓치지 않는다
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const ghostBaseX = useSharedValue(0);
  const ghostBaseY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: fingerX.value - ghostBaseX.value },
      { translateY: fingerY.value - ghostBaseY.value },
      { scale: 1.06 },
      { rotate: '2deg' },
    ],
  }));
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
      const gx = absX - d.gridX;
      const gy = absY - d.gridY + (scrollY.current - d.scroll0);
      const cur = draftRef.current;
      const from = cur.findIndex((i) => i.id === d.id);
      const rects = rectsRef.current;
      // 놓을 자리는 손가락이 아니라 "끌리는 카드의 중심"이 들어간 카드로 정한다(어디를 잡았든, 카드 폭이 얼마든 기준이 같다)
      const mine = rects[from];
      const cx = mine ? gx - d.offX + mine.w / 2 : gx;
      const cy = mine ? gy - d.offY + mine.h / 2 : gy;
      const hit = rects.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
      let to: number | null;
      if (hit) {
        if (hit.index === from) return; // 자기 자리 위
        to = hit.index > from ? hit.index + 1 : hit.index; // 앞으로 가면 그 카드 앞, 뒤로 가면 그 카드 뒤
      } else {
        const rowTiles = rects.filter((r) => cy >= r.y && cy <= r.y + r.h);
        if (rowTiles.length) {
          // 카드 없는 빈 칸(줄 끝 오른쪽·카드 사이 틈)에 놓으면: 줄 끝이면 그 줄 마지막 카드 뒤, 틈이면 가까운 카드 앞/뒤
          const last = rowTiles.reduce((a, b) => (b.x > a.x ? b : a));
          if (cx > last.x + last.w) {
            to = last.index + 1;
          } else {
            const near = rowTiles.reduce((a, b) => (Math.abs(cx - (b.x + b.w / 2)) < Math.abs(cx - (a.x + a.w / 2)) ? b : a));
            to = cx > near.x + near.w / 2 ? near.index + 1 : near.index;
          }
        } else {
          to = dropIndexAt(rects, cx, cy); // 마지막 줄 아래면 맨 뒤
        }
      }
      const now = Date.now();
      // 자리가 바뀌는 순간 배치가 움직여 카드 아래가 바뀌므로, 너무 잦은 재배치(떨림)를 막는다
      if (to === null || to === from || to === from + 1 || now - d.lastMoveAt < 140) return;
      d.lastMoveAt = now;
      LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
      setDraft(moveItem(cur, from, to));
    },
    [],
  );

  const onDragStart = useCallback(
    (id: string) => (absX: number, absY: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
          // 처음 위치 = 눌린 카드 자리: 카드 왼쪽 위 = 손가락 − 눌린 지점의 카드 안 오프셋
          ghostBaseX.value = rootX + (absX - (gridX + r.x));
          ghostBaseY.value = rootY + (absY - (gridY + r.y));
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
    [ghostBaseX, ghostBaseY, applyMove],
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
  // 카드마다 같은 함수 모양을 유지해 GridTile의 memo가 통하게 한다(옮기는 중 모든 카드가 다시 그려져 끊기던 원인)
  const tileCbs = useRef(
    new Map<string, Pick<TileProps, 'onTap' | 'onLongEdit' | 'onOpenSettings' | 'onRemove' | 'onOpenQty' | 'onSpan'>>(),
  );
  const cbsFor = (id: string) => {
    let c = tileCbs.current.get(id);
    if (!c) {
      const productOf = () => listRef.current.find((x) => x.id === id)?.product ?? null;
      c = {
        onTap: () => {
          if (editingRef.current) return; // 편집 중엔 누르기가 아니라 길게 눌러 끌어서 옮긴다
          const p = productOf();
          if (p) propsRef.current.onTap(p);
        },
        onLongEdit: () => propsRef.current.onEditingChange(true),
        onOpenSettings: () => {
          const p = productOf();
          if (p) propsRef.current.onOpenSettings(p);
        },
        onRemove: () => {
          const p = productOf();
          if (p) propsRef.current.onRemove(p);
          else setDraft((d) => d.filter((x) => x.id !== id));
        },
        onOpenQty: () => {
          const p = productOf();
          if (p) propsRef.current.onOpenQty(p);
        },
        onSpan: (s) => setSpan(id, s),
      };
      tileCbs.current.set(id, c);
    }
    return c;
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
  const firstProductId = list.find((i) => i.product)?.id;
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
              ref={props.editButtonRef}
              collapsable={false}
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
              카드 이름 부분을 길게 눌러 끌어서 옮기세요
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
            {gridWidth > 0 ? (
              // 카드를 줄 안에 넣지 않고 계산된 자리(rects)에 절대 좌표로 놓는다 — 자리가 바뀌어도 카드가 새로 만들어지지 않고 위치만 움직인다
              <View style={{ height: rects.reduce((m, r) => Math.max(m, r.y + r.h), 0) }}>
                {rows.map((row, r) => {
                  if (r === 0) return null;
                  const rail = railStyle(background, rowDivider(r - 1));
                  const top = (rects[row[0].index]?.y ?? 0) - rail.gap;
                  return (
                    <View key={`rail-${r}`} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height: rail.gap, justifyContent: 'center' }}>
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
                  );
                })}
                {list.map((it, index) => {
                  const rc = rects[index];
                  if (!rc) return null;
                  return (
                    <View key={it.id} style={{ position: 'absolute', left: rc.x, top: rc.y }}>
                      <GridTile
                        item={it}
                        width={rc.w}
                        height={tileH}
                        cols={cols}
                        qty={it.product ? props.cart[it.product.id] ?? 0 : 0}
                        editing={editing}
                        dragging={dragId === it.id}
                        tileColorOverride={it.product ? props.tileColors[it.product.id] : undefined}
                        tileArtOverride={it.product ? props.tileArts[it.product.id] : undefined}
                        fontFamily={props.fontFamily}
                        {...cbsFor(it.id)}
                        onDragStart={startFor(it.id)}
                        onDragMove={applyMove}
                        onDragEnd={onDragEnd}
                        fingerX={fingerX}
                        fingerY={fingerY}
                        cardRef={it.id === firstProductId ? props.firstCardRef : undefined}
                      />
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* 끌고 있는 카드(손가락을 따라다님) */}
      {draggingItem && ghostRect ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              top: 0,
              width: ghostRect.w,
              height: ghostRect.h,
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
            },
            ghostStyle,
          ]}
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
