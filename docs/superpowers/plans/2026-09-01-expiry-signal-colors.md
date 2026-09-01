# 유통기한 임박 신호등(빨강/노랑/초록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면의 유통기한 임박 표시를 "7일 이하(만료 포함)=빨강 / 30일 이하=노랑 / 30일 초과=초록" 3단계 신호 기준 하나로 통일하고, 상단 통계 카드를 터치하면 해당 신호의 상품만 필터링되도록 만든다.

**Architecture:** `src/lib/dates.ts`에 단일 판정 함수 `signalOf(days)`와 색상/제목 매핑 상수를 새로 두고, 목록 섹션 그룹핑(`index.tsx`)·카드 D-day 뱃지(`DdayBadge.tsx`)·상단 통계 카드(`SummaryHeader.tsx`) 세 곳이 전부 이 하나의 소스만 참조하도록 교체한다. `SummaryHeader`는 순수 표시 컴포넌트에서 `(activeSignal, onSelectSignal)` 콜백을 받는 필터 컨트롤로 바뀐다.

**Tech Stack:** React Native + Expo Router, TypeScript, NativeWind(Tailwind 클래스). 새 의존성 없음.

## Global Constraints

- 이 저장소엔 테스트 프레임워크가 없다(jest/vitest 미설정) — 이 기능만을 위해 새로 도입하지 않는다. 완료 확인은 `npx tsc --noEmit` 타입체크 + 실기기/에뮬레이터 수동 QA로 한다.
- `dates.ts`의 기존 5단계(`SectionKey`/`sectionOf`/`SECTION_TITLES`/`SECTION_ORDER`)는 완전히 제거한다 — `src/app/calendar.tsx`, `src/app/recipes.tsx`, `src/components/SummaryHeader.tsx`(변경 전 버전)는 이 exports를 import하지 않으므로 제거해도 다른 화면은 깨지지 않는다(스펙에서 확인됨).
- 신호 판정 기준은 정확히: `days <= 7` → red(만료·음수 포함), `days <= 30` → yellow, 그 외 → green.
- 발주(order) 화면, 캘린더 화면, 통계(stats) 화면은 이번 변경 대상이 아니다 — 손대지 않는다.
- 통계 카드 3개는 항상 전체 상품 기준 개수를 보여준다(검색어/카테고리/신호 필터가 걸려 있어도 카드 숫자 자체는 변하지 않는다).

---

### Task 1: 신호 판정 기준 통일 (`dates.ts` → `DdayBadge` → `SummaryHeader` → `index.tsx`)

**Files:**
- Modify: `src/lib/dates.ts:36-54` (5단계 exports를 3단계로 교체)
- Modify: `src/components/DdayBadge.tsx` (전체 교체)
- Modify: `src/components/SummaryHeader.tsx` (전체 교체)
- Modify: `src/app/index.tsx:20,27-33,78-101,340-347` (import, 로컬 상수 제거, 필터/그룹핑, 섹션 헤더, `ListHeaderComponent`)

**Interfaces:**
- Consumes: 없음 (신규 기반 작업)
- Produces:
  - `src/lib/dates.ts`에 `SignalKey = 'red' | 'yellow' | 'green'`, `signalOf(days: number): SignalKey`, `SIGNAL_TITLES: Record<SignalKey, string>`, `SIGNAL_ORDER: SignalKey[]`, `SIGNAL_BG: Record<SignalKey, string>`, `SIGNAL_TEXT: Record<SignalKey, string>` — 이후 다른 화면에서 재사용 가능
  - `SummaryHeader` 컴포넌트 props: `{ products: Product[]; activeSignal: SignalKey | null; onSelectSignal: (key: SignalKey | null) => void }`

이 네 파일은 서로 강하게 묶여 있어(`dates.ts`의 기존 exports를 지우는 순간 다른 세 파일이 컴파일 에러가 남) 하나의 태스크로 묶는다. 타입체크는 전부 수정한 뒤 한 번만 실행한다.

- [ ] **Step 1: `dates.ts` — 5단계를 3단계로 교체**

기존 (36~54번째 줄):

```ts
export type SectionKey = 'expired' | 'today' | 'soon' | 'week' | 'later';

export function sectionOf(days: number): SectionKey {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  expired: '유통기한 만료',
  today: '오늘까지',
  soon: '3일 이내',
  week: '7일 이내',
  later: '여유 있음',
};

export const SECTION_ORDER: SectionKey[] = ['expired', 'today', 'soon', 'week', 'later'];
```

다음으로 교체:

```ts
export type SignalKey = 'red' | 'yellow' | 'green';

export function signalOf(days: number): SignalKey {
  if (days <= 7) return 'red';
  if (days <= 30) return 'yellow';
  return 'green';
}

export const SIGNAL_TITLES: Record<SignalKey, string> = {
  red: '만료·7일 이내',
  yellow: '임박(한달 이내)',
  green: '여유 있음(한달 이상)',
};

export const SIGNAL_ORDER: SignalKey[] = ['red', 'yellow', 'green'];

// 배지/섹션 점/통계 카드에서 공통으로 사용하는 배경색
export const SIGNAL_BG: Record<SignalKey, string> = {
  red: 'bg-primary',
  yellow: 'bg-warn',
  green: 'bg-ok',
};

// 통계 카드 비활성 상태의 숫자 색
export const SIGNAL_TEXT: Record<SignalKey, string> = {
  red: 'text-primary',
  yellow: 'text-warn',
  green: 'text-ok',
};
```

- [ ] **Step 2: `DdayBadge.tsx` — 신호 기준으로 교체**

파일 전체를 다음으로 교체:

```tsx
import { Text, View } from 'react-native';
import { ddayLabel, signalOf, SIGNAL_BG } from '@/lib/dates';

export default function DdayBadge({ days }: { days: number }) {
  const bg = SIGNAL_BG[signalOf(days)];

  return (
    <View className={`${bg} rounded-md px-2.5 py-1`}>
      <Text className="text-paper text-xs font-bold">{ddayLabel(days)}</Text>
    </View>
  );
}
```

- [ ] **Step 3: `SummaryHeader.tsx` — 터치 가능한 신호 통계 카드로 교체**

파일 전체를 다음으로 교체:

```tsx
import { memo, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  daysUntil,
  signalOf,
  SIGNAL_BG,
  SIGNAL_ORDER,
  SIGNAL_TEXT,
  SIGNAL_TITLES,
  SignalKey,
} from '@/lib/dates';
import { Product } from '@/lib/types';

interface Props {
  products: Product[];
  activeSignal: SignalKey | null;
  onSelectSignal: (key: SignalKey | null) => void;
}

function SummaryHeader({ products, activeSignal, onSelectSignal }: Props) {
  // 검색어/카테고리/신호 필터와 무관하게 항상 전체 상품 기준으로 센다
  const counts = useMemo(() => {
    const c: Record<SignalKey, number> = { red: 0, yellow: 0, green: 0 };
    products.forEach((p) => {
      c[signalOf(daysUntil(p.expiryDate))]++;
    });
    return c;
  }, [products]);

  return (
    <View className="mx-4 mb-3 mt-2 flex-row gap-2">
      {SIGNAL_ORDER.map((key) => (
        <SignalStat
          key={key}
          signalKey={key}
          label={SIGNAL_TITLES[key]}
          value={counts[key]}
          active={activeSignal === key}
          onPress={() => onSelectSignal(activeSignal === key ? null : key)}
        />
      ))}
    </View>
  );
}

export default memo(SummaryHeader);

function SignalStat({
  signalKey,
  label,
  value,
  active,
  onPress,
}: {
  signalKey: SignalKey;
  label: string;
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${active ? '필터 해제' : '필터'}`}
      className={`flex-1 items-center rounded-xl border py-3 ${
        active ? `${SIGNAL_BG[signalKey]} border-transparent` : 'border-line bg-paper'
      }`}
    >
      <Text className={`text-xl font-bold ${active ? 'text-paper' : SIGNAL_TEXT[signalKey]}`}>
        {value}
      </Text>
      <Text className={`mt-0.5 text-xs ${active ? 'text-paper' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: `index.tsx` — import 교체**

기존 (20번째 줄):

```tsx
import { SECTION_ORDER, SECTION_TITLES, SectionKey, daysUntil, sectionOf } from '@/lib/dates';
```

다음으로 교체:

```tsx
import { SIGNAL_ORDER, SIGNAL_TITLES, SIGNAL_BG, SignalKey, daysUntil, signalOf } from '@/lib/dates';
```

- [ ] **Step 5: `index.tsx` — 로컬 `SECTION_DOT` 상수 삭제**

기존 (27~33번째 줄)을 통째로 삭제:

```tsx
const SECTION_DOT: Record<SectionKey, string> = {
  expired: 'bg-ink',
  today: 'bg-primary',
  soon: 'bg-warn',
  week: 'bg-warn',
  later: 'bg-ok',
};
```

(이후 코드에서는 import한 `SIGNAL_BG`를 직접 쓴다.)

- [ ] **Step 6: `index.tsx` — 신호 필터 state 추가**

기존:

```tsx
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
```

다음으로 교체:

```tsx
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [signalFilter, setSignalFilter] = useState<SignalKey | null>(null);
  const [refreshing, setRefreshing] = useState(false);
```

- [ ] **Step 7: `index.tsx` — `sections` useMemo를 신호 기준 필터/그룹핑으로 교체**

기존:

```tsx
  const sections = useMemo(() => {
    const filtered = products.filter((p) => {
      if (selectedCategories.size > 0 && !p.categories.some((c) => selectedCategories.has(c)))
        return false;
      if (!deferredQuery.trim()) return true;
      return (
        matchesSearch(p.name, deferredQuery) ||
        (p.barcode ?? '').includes(deferredQuery.trim()) ||
        matchesSearch(p.memo ?? '', deferredQuery)
      );
    });
    const grouped = new Map<SectionKey, Product[]>();
    filtered.forEach((p) => {
      const key = sectionOf(daysUntil(p.expiryDate));
      const arr = grouped.get(key) ?? [];
      arr.push(p);
      grouped.set(key, arr);
    });
    return SECTION_ORDER.filter((k) => grouped.has(k)).map((k) => ({
      key: k,
      title: SECTION_TITLES[k],
      data: grouped.get(k)!.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    }));
  }, [products, deferredQuery, selectedCategories]);
```

다음으로 교체:

```tsx
  const sections = useMemo(() => {
    const filtered = products.filter((p) => {
      if (selectedCategories.size > 0 && !p.categories.some((c) => selectedCategories.has(c)))
        return false;
      if (signalFilter && signalOf(daysUntil(p.expiryDate)) !== signalFilter) return false;
      if (!deferredQuery.trim()) return true;
      return (
        matchesSearch(p.name, deferredQuery) ||
        (p.barcode ?? '').includes(deferredQuery.trim()) ||
        matchesSearch(p.memo ?? '', deferredQuery)
      );
    });
    const grouped = new Map<SignalKey, Product[]>();
    filtered.forEach((p) => {
      const key = signalOf(daysUntil(p.expiryDate));
      const arr = grouped.get(key) ?? [];
      arr.push(p);
      grouped.set(key, arr);
    });
    return SIGNAL_ORDER.filter((k) => grouped.has(k)).map((k) => ({
      key: k,
      title: SIGNAL_TITLES[k],
      data: grouped.get(k)!.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    }));
  }, [products, deferredQuery, selectedCategories, signalFilter]);
```

- [ ] **Step 8: `index.tsx` — 섹션 헤더 점 색상 + `ListHeaderComponent` 교체**

기존:

```tsx
        ListHeaderComponent={<SummaryHeader products={products} />}
        renderSectionHeader={({ section }) => (
          <View className="mx-4 mb-2 mt-3 flex-row items-center">
            <View className={`${SECTION_DOT[section.key as SectionKey]} h-2 w-2 rounded-full`} />
            <Text className="text-ink ml-2 text-sm font-bold">{section.title}</Text>
            <Text className="text-muted ml-1.5 text-sm">{section.data.length}</Text>
          </View>
        )}
```

다음으로 교체:

```tsx
        ListHeaderComponent={
          <SummaryHeader
            products={products}
            activeSignal={signalFilter}
            onSelectSignal={setSignalFilter}
          />
        }
        renderSectionHeader={({ section }) => (
          <View className="mx-4 mb-2 mt-3 flex-row items-center">
            <View className={`${SIGNAL_BG[section.key as SignalKey]} h-2 w-2 rounded-full`} />
            <Text className="text-ink ml-2 text-sm font-bold">{section.title}</Text>
            <Text className="text-muted ml-1.5 text-sm">{section.data.length}</Text>
          </View>
        )}
```

- [ ] **Step 9: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: `src/app/login.tsx(110,45)`의 기존 무관 에러(`'supabase' is possibly 'null'`) 1건 외에 새 에러 없음. 이 login.tsx 에러는 이번 작업 이전부터 있던 것이므로 무시한다.

- [ ] **Step 10: 수동 QA (스펙 7가지 시나리오)**

`npx expo start`로 앱 실행 후 홈 화면에서:

1. 유통기한 7일 이내(오늘/만료 포함) 상품 → 카드 뱃지 빨강, "만료·7일 이내" 섹션과 통계 카드 첫 번째 칸에 표시되는지 확인
2. 8~30일 상품 → 뱃지 노랑, "임박(한달 이내)" 섹션/카드
3. 31일 이상 상품 → 뱃지 초록, "여유 있음(한달 이상)" 섹션/카드
4. "만료·7일 이내" 통계 카드 터치 → 카드 배경이 빨강으로 채워지고, 목록엔 1번 상품만 남고 나머지 섹션이 사라지는지 확인. 같은 카드를 다시 터치 → 전체로 복귀하고 카드 배경도 흰색으로 돌아오는지 확인
5. 신호 필터가 걸린 상태에서 카테고리 칩도 하나 선택 → 두 조건이 AND로 겹쳐 필터링되는지 확인
6. 검색어를 입력한 상태에서 통계 카드를 전환 → 검색 결과 안에서 다시 필터링되는지 확인
7. 신호 필터를 걸어도 통계 카드 3개의 숫자 자체는 변하지 않는지 확인(전체 상품 기준 카운트 유지)

- [ ] **Step 11: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/lib/dates.ts src/components/DdayBadge.tsx src/components/SummaryHeader.tsx src/app/index.tsx
git commit -m "feat: 유통기한 임박 신호(빨강/노랑/초록) 통일 및 통계 카드 필터화"
```

---

## Self-Review Notes

- **스펙 커버리지**: `signalOf`/`SIGNAL_TITLES`/`SIGNAL_ORDER`/`SIGNAL_BG`/`SIGNAL_TEXT` 도입(Step 1), D-day 뱃지 색 통일(Step 2), 통계 카드 3단계 교체 + 터치 필터(Step 3), 섹션 그룹핑 3단계 전환(Step 7~8), 신호 필터 상태·필터링 로직(Step 6~7), `ListHeaderComponent` 연결(Step 8) — 스펙의 모든 절이 커버됨. "영향 없음" 절(calendar/recipes/발주 화면)은 애초에 손대지 않으므로 별도 태스크 불필요.
- **타입 일관성**: `SignalKey`는 `dates.ts`(Step 1)에서 정의한 뒤 `DdayBadge`(Step 2), `SummaryHeader`(Step 3), `index.tsx`(Step 4~8) 전부 동일한 이름·유니온 값(`'red' | 'yellow' | 'green'`)으로 참조. `signalOf(days: number): SignalKey` 시그니처가 모든 호출부에서 일치.
- **플레이스홀더 없음**: 모든 스텝이 실제 전체 코드/diff로 작성됨.
- **테스트 프레임워크 부재**: Global Constraints에 명시, Step 9~10이 이 저장소의 기존 관례(타입체크 + 수동 QA)를 그대로 따름.
