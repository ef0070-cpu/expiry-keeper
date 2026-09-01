# 유통기한 임박 신호등(빨강/노랑/초록) — 설계

## 배경

홈 화면(재고 관리)에는 이미 유통기한 임박 정도를 색으로 구분하는 여러 장치가 있지만 기준이 서로 다르다:

- 목록 섹션 구분(`유통기한 만료`/`오늘까지`/`3일 이내`/`7일 이내`/`여유 있음`, 5단계) — `SECTION_KEY`/`sectionOf`
- 상품 카드 우측 D-day 뱃지 색(만료=검정, 1일 이내=빨강, 7일 이내=노랑, 그 외=초록, 4단계) — `DdayBadge.tsx`
- 상단 통계 카드(만료/3일 이내/전체 개수) — `SummaryHeader.tsx`

사용자가 원하는 건 "7일 이하(만료 포함)=빨강, 30일 이하=노랑, 30일 초과=초록" 3단계 신호 기준 하나로 위 세 곳을 통일하고, **통계 카드 자체를 터치하면 그 신호에 해당하는 상품만 목록에 필터링**되게 만드는 것. 발주(order) 화면·캘린더 화면은 각자 독립된 로직이라 이번 변경 대상이 아님(사용자 확인함).

카테고리 필터 칩 위에 별도 신호 탭 줄을 추가하는 안을 먼저 검토했으나, 통계 카드가 같은 역할을 겸하는 게 더 간단해 그 안은 폐기하고 통계 카드를 필터 컨트롤로 승격시키는 쪽으로 확정했다.

## 범위

- `src/lib/dates.ts`: 기존 5단계 `sectionOf`/`SECTION_TITLES`/`SECTION_ORDER`/`SectionKey`를 제거하고 3단계 `signalOf`/`SIGNAL_TITLES`/`SIGNAL_ORDER`/`SIGNAL_BG`/`SIGNAL_TEXT`/`SignalKey`로 교체
- `src/components/DdayBadge.tsx`: 배경색 로직을 새 3단계 기준으로 교체(만료 포함 7일 이하=빨강)
- `src/components/SummaryHeader.tsx`: 통계 카드 3개(만료·7일 이내 / 임박·한달 이내 / 여유 있음·한달 이상)로 교체하고, 터치 시 필터로 동작하도록 변경
- `src/app/index.tsx`:
  - 목록 섹션 헤더를 새 3단계 기준으로 재구성
  - `signalFilter` 상태를 만들어 `SummaryHeader`에 내려주고, 목록 필터링에 반영

## 신호 판정 기준 (`signalOf`)

```
days = daysUntil(expiryDate)   // 지났으면 음수
days <= 7   → 'red'    (이미 만료된 것 포함)
days <= 30  → 'yellow'
그 외        → 'green'
```

## `src/lib/dates.ts` 변경

제거: `SectionKey`, `sectionOf`, `SECTION_TITLES`, `SECTION_ORDER`

추가:

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

// 배지/섹션 점/통계 카드에서 공통으로 사용
export const SIGNAL_BG: Record<SignalKey, string> = {
  red: 'bg-primary',
  yellow: 'bg-warn',
  green: 'bg-ok',
};

// 통계 카드 비활성 상태의 숫자 색(기존 Stat 컴포넌트 색상 규칙과 동일)
export const SIGNAL_TEXT: Record<SignalKey, string> = {
  red: 'text-primary',
  yellow: 'text-warn',
  green: 'text-ok',
};
```

`SIGNAL_TITLES` 문구는 사용자가 지정한 그대로("만료,7일이내" / "임박(한달이내)" / "여유 있음(한달이상)")를 다듬어 확정.

## `src/components/DdayBadge.tsx` 변경

```ts
import { signalOf, SIGNAL_BG } from '@/lib/dates';
// ...
const bg = SIGNAL_BG[signalOf(days)];
```

기존 4단계 if/else(검정/빨강/노랑/초록)를 제거. 만료 상품의 "N일 지남" 텍스트 라벨(`ddayLabel`)은 그대로 두고 배경색만 바뀐다.

## `src/components/SummaryHeader.tsx` 변경

- props를 `{ products, activeSignal, onSelectSignal }`로 확장
  - `activeSignal: SignalKey | null`
  - `onSelectSignal: (key: SignalKey | null) => void`
- 기존 `expired`/`urgent`(3일 이내) reduce를 신호별 카운트로 교체:
  ```ts
  const counts = useMemo(() => {
    const c: Record<SignalKey, number> = { red: 0, yellow: 0, green: 0 };
    products.forEach((p) => { c[signalOf(daysUntil(p.expiryDate))]++; });
    return c;
  }, [products]);
  ```
  (카운트는 지금처럼 검색/카테고리/신호 필터와 무관하게 전체 상품 기준 — 필터를 걸어도 다른 신호 카드 숫자가 사라지지 않도록 기존 동작 유지)
- `Stat` 하위 컴포넌트를 `Pressable`로 바꾸고 `active` prop 추가:
  - `active`면 배경을 `SIGNAL_BG[key]`로 채우고 텍스트를 `text-paper`(흰색)로
  - 아니면 기존처럼 `bg-paper` + `SIGNAL_TEXT[key]` 색 숫자
  - `onPress`: `onSelectSignal(activeSignal === key ? null : key)` — 같은 카드 다시 누르면 필터 해제
  - `accessibilityRole="button"`, `accessibilityLabel="{라벨} 필터"`
- `SIGNAL_ORDER`를 매핑해 카드 3개 렌더(기존처럼 `flex-row gap-2`), "전체" 카드는 없음 — 아무 것도 선택 안 된 상태 자체가 "전체"

## `src/app/index.tsx` 변경

### 섹션 그룹핑

- `import { SECTION_ORDER, SECTION_TITLES, SectionKey, daysUntil, sectionOf }` → `import { SIGNAL_ORDER, SIGNAL_TITLES, SIGNAL_BG, SignalKey, daysUntil, signalOf }`
- 로컬 `SECTION_DOT` 상수 제거하고 import한 `SIGNAL_BG` 그대로 사용
- `sections` useMemo 안 `sectionOf(daysUntil(...))` → `signalOf(daysUntil(...))`, `SECTION_ORDER`/`SECTION_TITLES` → `SIGNAL_ORDER`/`SIGNAL_TITLES`

### 필터 상태 (신규)

- state 추가: `const [signalFilter, setSignalFilter] = useState<SignalKey | null>(null);`
- `sections` useMemo의 `filtered` 조건에 추가:
  ```ts
  if (signalFilter && signalOf(daysUntil(p.expiryDate)) !== signalFilter) return false;
  ```
  (의존성 배열에 `signalFilter` 추가)
- `ListHeaderComponent`: `<SummaryHeader products={products} activeSignal={signalFilter} onSelectSignal={setSignalFilter} />`

카테고리 필터 칩 줄이나 검색창은 그대로 두고 손대지 않는다(별도 신호 탭 줄은 추가하지 않음).

## 영향 없음 (확인됨)

- `src/app/calendar.tsx`, `src/app/recipes.tsx`는 각자 자체 day 임계값 로직을 갖고 있고 `dates.ts`의 `SectionKey`/`sectionOf`를 import하지 않음 — 이번 변경과 무관, 손대지 않는다.
- 발주(order) 화면 관련 파일 전부 무관.

## 테스트

이 저장소엔 테스트 프레임워크가 없다. 기존 관례대로 실기기/에뮬레이터 수동 QA로 검증한다:

1. 유통기한 7일 이내(오늘/만료 포함) 상품 → 카드 뱃지 빨강, "만료·7일 이내" 섹션과 통계 카드에 표시
2. 8~30일 상품 → 뱃지 노랑, "임박(한달 이내)" 섹션/카드
3. 31일 이상 상품 → 뱃지 초록, "여유 있음(한달 이상)" 섹션/카드
4. "만료·7일 이내" 통계 카드 터치 → 카드 배경이 빨강으로 채워지고, 목록엔 위 1번 상품만 남고 나머지 섹션 사라짐. 같은 카드 다시 터치 → 전체로 복귀, 카드 배경도 원래대로
5. 신호 필터 활성 상태에서 카테고리 칩도 하나 선택 → 두 조건 AND로 겹쳐 필터링됨
6. 검색어 입력 상태에서 통계 카드 전환 → 검색 결과 안에서 다시 필터링됨(기존 검색-카테고리 조합과 동일 동작)
7. 신호 필터를 걸어도 통계 카드 3개의 숫자 자체는 변하지 않음(전체 상품 기준 카운트 유지 확인)
