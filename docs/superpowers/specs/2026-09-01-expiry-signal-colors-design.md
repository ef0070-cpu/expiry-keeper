# 유통기한 임박 신호등(빨강/노랑/초록) — 설계

## 배경

홈 화면(재고 관리)에는 이미 유통기한 임박 정도를 색으로 구분하는 여러 장치가 있지만 기준이 서로 다르다:

- 목록 섹션 구분(`유통기한 만료`/`오늘까지`/`3일 이내`/`7일 이내`/`여유 있음`, 5단계) — `SECTION_KEY`/`sectionOf`
- 상품 카드 우측 D-day 뱃지 색(만료=검정, 1일 이내=빨강, 7일 이내=노랑, 그 외=초록, 4단계) — `DdayBadge.tsx`

사용자가 원하는 건 "7일 이하=빨강, 30일 이하=노랑, 30일 초과=초록" 3단계 신호 기준 하나로 위 두 곳을 통일하고, 이 신호색으로 상품 목록을 필터링하는 탭을 추가하는 것. 발주(order) 화면·캘린더 화면·통계 요약(`SummaryHeader`)은 각자 독립된 로직이라 이번 변경 대상이 아님(사용자 확인함).

## 범위

- `src/lib/dates.ts`: 기존 5단계 `sectionOf`/`SECTION_TITLES`/`SECTION_ORDER`/`SectionKey`를 제거하고 3단계 `signalOf`/`SIGNAL_TITLES`/`SIGNAL_ORDER`/`SIGNAL_COLOR`/`SignalKey`로 교체
- `src/components/DdayBadge.tsx`: 배경색 로직을 새 3단계 기준으로 교체(만료 포함 7일 이하=빨강)
- `src/app/index.tsx`:
  - 목록 섹션 헤더를 새 3단계 기준으로 재구성
  - 카테고리 필터 칩 줄 바로 위에 신호색 필터 탭 추가(전체/빨강/노랑/초록, 라디오 버튼처럼 하나만 선택)

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
  red: '임박 (7일 이내)',
  yellow: '30일 이내',
  green: '여유 있음',
};

export const SIGNAL_ORDER: SignalKey[] = ['red', 'yellow', 'green'];

// Tailwind 클래스 — 배지/점/탭에서 공통으로 사용
export const SIGNAL_BG: Record<SignalKey, string> = {
  red: 'bg-primary',
  yellow: 'bg-warn',
  green: 'bg-ok',
};
```

`SIGNAL_TITLES`의 문구는 사용자에게 초안으로 제시했고 이견 없어 이대로 확정.

## `src/components/DdayBadge.tsx` 변경

```ts
import { signalOf, SIGNAL_BG } from '@/lib/dates';
// ...
const bg = SIGNAL_BG[signalOf(days)];
```

기존 4단계 if/else(검정/빨강/노랑/초록)를 제거. 만료 상품의 "N일 지남" 텍스트 라벨(`ddayLabel`)은 그대로 두고 배경색만 바뀐다.

## `src/app/index.tsx` 변경

### 섹션 그룹핑

- `import { SECTION_ORDER, SECTION_TITLES, SectionKey, daysUntil, sectionOf }` → `import { SIGNAL_ORDER, SIGNAL_TITLES, SIGNAL_BG, SignalKey, daysUntil, signalOf }`
- 로컬 `SECTION_DOT` 상수 제거하고 import한 `SIGNAL_BG` 그대로 사용
- `sections` useMemo 안 `sectionOf(daysUntil(...))` → `signalOf(daysUntil(...))`, `SECTION_ORDER`/`SECTION_TITLES` → `SIGNAL_ORDER`/`SIGNAL_TITLES`

### 신호 필터 탭 (신규)

- state 추가: `const [signalFilter, setSignalFilter] = useState<SignalKey | null>(null);`
- `sections` useMemo의 `filtered` 조건에 추가:
  ```ts
  if (signalFilter && signalOf(daysUntil(p.expiryDate)) !== signalFilter) return false;
  ```
  (의존성 배열에 `signalFilter` 추가)
- UI: 카테고리 필터 칩 `ScrollView` 바로 위에 새 `View` 줄 추가
  - 기존 `Chip` 컴포넌트로 "전체" 탭 (`active={signalFilter === null}`, `onPress={() => setSignalFilter(null)}`)
  - `SIGNAL_ORDER`를 매핑해 신호색 탭 3개: 색 점 + 라벨(`SIGNAL_TITLES`보다 짧게 "빨강"/"노랑"/"초록"으로 표시), 활성화 시 해당 `SIGNAL_BG` 색으로 배경 채움, 다시 누르면 `null`로 해제
  - `accessibilityRole="button"`, `accessibilityLabel="{색} 신호 필터"`

## 영향 없음 (확인됨)

- `src/app/calendar.tsx`, `src/app/recipes.tsx`, `src/components/SummaryHeader.tsx`는 각자 자체 day 임계값 로직을 갖고 있고 `dates.ts`의 `SectionKey`/`sectionOf`를 import하지 않음 — 이번 변경과 무관, 손대지 않는다.
- 발주(order) 화면 관련 파일 전부 무관.

## 테스트

이 저장소엔 테스트 프레임워크가 없다. 기존 관례대로 실기기/에뮬레이터 수동 QA로 검증한다:

1. 유통기한 7일 이내(오늘/만료 포함) 상품 → 카드 뱃지 빨강, "임박 (7일 이내)" 섹션에 표시
2. 8~30일 상품 → 뱃지 노랑, "30일 이내" 섹션
3. 31일 이상 상품 → 뱃지 초록, "여유 있음" 섹션
4. "빨강" 탭 터치 → 위 1번 상품만 목록에 남고 나머지 섹션 사라짐. 같은 탭 다시 터치 → 전체로 복귀
5. "빨강" 탭 활성 상태에서 카테고리 칩도 하나 선택 → 두 조건 AND로 겹쳐 필터링됨
6. 검색어 입력 상태에서 신호 탭 전환 → 검색 결과 안에서 다시 필터링됨(기존 검색-카테고리 조합과 동일 동작)
