# 유통기한 사진 인식(OCR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품 등록/수정 화면(`product-form.tsx`)에서 유통기한을 카메라로 찍으면 자동으로 읽어 채워주는 기능을, 기존 수기 입력(텍스트/날짜 피커)은 그대로 둔 채 추가 옵션으로 붙인다.

**Architecture:** 순수 로직(`src/lib/date-ocr.ts` — OCR 원문 텍스트에서 날짜 후보를 찾아 해석)과 설정(`src/lib/settings.ts` — 날짜 순서가 애매할 때 쓸 사용자 선택값)을 화면(`product-form.tsx`)에서 조합한다. 사진 촬영은 기존 `ImagePicker.launchCameraAsync` 패턴을 재사용하고, 텍스트 인식은 온디바이스 ML Kit 래퍼(`@infinitered/react-native-mlkit-text-recognition`)를 새로 추가한다. "제조일+기간" 케이스는 자동 인식 대신 `addMonths`(신규, `dates.ts`)로 계산하는 수동 팝업으로 처리한다.

**Tech Stack:** React Native + Expo Router, NativeWind. 신규 의존성: `@infinitered/react-native-mlkit-text-recognition` + `@infinitered/react-native-mlkit-core`(필수 의존, GitHub 소스로 API 확인 완료 — Expo Modules API 기반 네이티브 모듈, config plugin/앱 설정 변경 불필요).

## Global Constraints

- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱 — 순수 로직만 `*.selfcheck.ts`(`console.assert` 기반, `npx tsx`로 실행)로 검증하고, 나머지는 `npx tsc --noEmit` + 수동 시나리오로 검증한다(기존 관례, 예: `csv-import.selfcheck.ts`).
- `date-ocr.selfcheck.ts`는 `todayStr()`(실제 오늘 날짜)에 결과가 좌우되면 안 되므로, `extractExpiryDateFromText`의 세 번째 인자(`referenceDate`)에 고정값 `'2026-01-01'`을 넘겨서 테스트한다.
- 기존 수기 입력(텍스트/날짜 피커) 로직은 한 줄도 건드리지 않는다 — 이 기능을 한 번도 안 누르면 지금과 완전히 동일하게 동작해야 한다.
- 인식/계산된 날짜는 자동 저장되지 않고 `expiryDate` 상태값에 채워지기만 한다 — 저장 시 기존 유효성 검사(`isValidDateStr`)를 그대로 통과해야 한다.
- 한글 키워드("제조일로부터 N개월") 자동 인식은 하지 않는다 — 제조일+개월수는 사용자가 직접 입력하는 수동 팝업으로만 제공한다(사용자 확인 사항).
- 네이티브 모듈이 새로 들어가므로 이 기능은 **다음 EAS 개발 빌드부터** 기기에서 테스트 가능하다(Expo Go 불가). `npx tsc --noEmit`과 `*.selfcheck.ts`는 빌드 없이도 바로 검증 가능하다.
- AGENTS.md 지침: Expo API가 자주 바뀌므로, 새 패키지 설치 직후 실제 설치된 타입 정의를 확인하고 그 기준으로 코드를 맞춘다(Task 5 Step 2에 확인 단계 포함 — 이미 GitHub 소스(`@infinitered/react-native-mlkit-text-recognition@6.0.0`)로 1차 확인함: `import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition'`, `recognizeText(imagePath: string): Promise<{ text: string; blocks: Block[] }>`. 로컬 설치본에서 버전이 다르면 이 시그니처가 다를 수 있으니 재확인 필요).
- 참고 스펙 문서: `docs/superpowers/specs/2026-09-10-expiry-date-ocr-design.md`

---

### Task 1: `dates.ts`에 `addMonths` 추가

**Files:**
- Modify: `src/lib/dates.ts`
- Create: `src/lib/dates.selfcheck.ts`

**Interfaces:**
- Consumes: 없음 (순수 날짜 계산)
- Produces: `addMonths(dateStr: string, months: number): string` — `YYYY-MM-DD` 문자열에 개월 수를 더한 결과를 같은 형식으로 반환. 말일을 넘기면 그 달의 마지막 날로 클램프한다(예: 1월 31일 + 1개월 → 2월 28일, JS Date가 3월로 넘어가는 기본 동작을 막음). Task 6(제조일+기간 계산)이 이 함수를 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`src/lib/dates.selfcheck.ts`:

```ts
import { addMonths } from './dates';

console.assert(addMonths('2026-01-31', 1) === '2026-02-28', '말일 초과 클램프 실패');
console.assert(addMonths('2026-03-10', 6) === '2026-09-10', '일반 케이스 실패');
console.assert(addMonths('2026-11-30', 3) === '2027-02-28', '연도 경계 + 말일 클램프 실패');
console.assert(addMonths('2028-01-31', 1) === '2028-02-29', '윤년 2월 클램프 실패');

console.log('dates selfcheck OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx tsx src/lib/dates.selfcheck.ts`
Expected: `addMonths`가 없다는 타입/런타임 에러

- [ ] **Step 3: 구현 추가**

`src/lib/dates.ts` 맨 끝에 추가:

```ts
/** dateStr에 개월 수를 더한다. 말일을 초과하면 그 달의 마지막 날로 클램프한다. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = m - 1 + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return formatDate(new Date(targetYear, targetMonth, Math.min(d, lastDay)));
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx tsx src/lib/dates.selfcheck.ts`
Expected: 마지막 줄에 `dates selfcheck OK`, `Assertion failed` 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/dates.ts src/lib/dates.selfcheck.ts
git commit -m "feat: 개월 수 더하기 addMonths 추가 (말일 클램프)"
```

---

### Task 2: `settings.ts`에 사진 인식 날짜 순서 설정 추가

**Files:**
- Modify: `src/lib/settings.ts`

**Interfaces:**
- Consumes: 없음 (기존 `AsyncStorage` 패턴 재사용)
- Produces: `DateOcrOrder = 'ymd' | 'dmy' | 'mdy'` 타입, `DATE_OCR_ORDERS`(배열), `DATE_OCR_ORDER_META`(라벨/설명), `setDateOcrOrder(order)`, `useDateOcrOrder(): DateOcrOrder`(기본값 `'ymd'`). Task 3(`date-ocr.ts`)이 `DateOcrOrder` 타입을, Task 4(`settings.tsx`)와 Task 5(`product-form.tsx`)가 나머지를 사용한다.

이 파일은 순수 로직이 아니라 `AsyncStorage`/React 훅이 섞여 있어 `*.selfcheck.ts` 대상이 아니다(기존 `dateInputMethod`도 테스트 없음 — 기존 관례를 따름). `npx tsc --noEmit` + Task 4의 화면에서 수동 확인한다.

- [ ] **Step 1: 기존 `dateInputMethod` 패턴을 그대로 본떠 추가**

`src/lib/settings.ts`의 `useDateInputMethod` 함수(112~157행) 바로 뒤에 추가:

```ts
// ---------- 사진 인식 날짜 순서 ----------

export type DateOcrOrder = 'ymd' | 'dmy' | 'mdy';

export const DATE_OCR_ORDERS: readonly DateOcrOrder[] = ['ymd', 'dmy', 'mdy'];

export const DATE_OCR_ORDER_META: Record<DateOcrOrder, { label: string; description: string }> = {
  ymd: { label: '년/월/일 (기본)', description: '국내 제품 표준. 예: 26.09.10 → 2026-09-10' },
  dmy: { label: '일/월/년', description: '유럽 등 해외 표준. 예: 10.09.26 → 2026-09-10' },
  mdy: { label: '월/일/년', description: '미국 표준. 예: 09.10.26 → 2026-09-10' },
};

const DATE_OCR_ORDER_KEY = 'dateOcrOrder:v1';
const DEFAULT_DATE_OCR_ORDER: DateOcrOrder = 'ymd';

let dateOcrOrderCache: DateOcrOrder | undefined;
const dateOcrOrderListeners = new Set<() => void>();

async function loadDateOcrOrder(): Promise<void> {
  if (dateOcrOrderCache !== undefined) return;
  const raw = await AsyncStorage.getItem(DATE_OCR_ORDER_KEY);
  dateOcrOrderCache = (DATE_OCR_ORDERS as string[]).includes(raw ?? '')
    ? (raw as DateOcrOrder)
    : DEFAULT_DATE_OCR_ORDER;
}

export async function setDateOcrOrder(order: DateOcrOrder): Promise<void> {
  dateOcrOrderCache = order;
  dateOcrOrderListeners.forEach((fn) => fn());
  await AsyncStorage.setItem(DATE_OCR_ORDER_KEY, order);
}

/** 로딩 중에도 기본값(년/월/일)을 즉시 돌려준다. */
export function useDateOcrOrder(): DateOcrOrder {
  const [order, setOrder] = useState<DateOcrOrder>(dateOcrOrderCache ?? DEFAULT_DATE_OCR_ORDER);
  useEffect(() => {
    const update = () => setOrder(dateOcrOrderCache ?? DEFAULT_DATE_OCR_ORDER);
    dateOcrOrderListeners.add(update);
    if (dateOcrOrderCache === undefined) loadDateOcrOrder().then(update);
    else update();
    return () => {
      dateOcrOrderListeners.delete(update);
    };
  }, []);
  return order;
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/settings.ts
git commit -m "feat: 사진 인식 날짜 순서 설정(년/월/일, 일/월/년, 월/일/년) 추가"
```

---

### Task 3: `date-ocr.ts` — OCR 텍스트에서 유통기한 추출

**Files:**
- Create: `src/lib/date-ocr.ts`
- Create: `src/lib/date-ocr.selfcheck.ts`

**Interfaces:**
- Consumes: `isValidDateStr`, `todayStr` (기존 `@/lib/dates`), `DateOcrOrder` (Task 2, `@/lib/settings`)
- Produces: `extractExpiryDateFromText(text: string, dateOcrOrder: DateOcrOrder, referenceDate?: string): string | null`. Task 5(`product-form.tsx`)가 OCR 인식 버튼 핸들러에서 사용한다.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`src/lib/date-ocr.selfcheck.ts`:

```ts
import { extractExpiryDateFromText } from './date-ocr';

const REF = '2026-01-01'; // 오늘 날짜에 결과가 좌우되지 않도록 고정한 기준일

console.assert(
  extractExpiryDateFromText('유통기한 2026.09.10까지', 'ymd', REF) === '2026-09-10',
  '연도 4자리 앞(년-월-일) 실패',
);
console.assert(
  extractExpiryDateFromText('EXP 25.09.2026', 'ymd', REF) === '2026-09-25',
  '연도 4자리 뒤 + 25는 월이 될 수 없어 구조적으로 일-월 확정되는 케이스 실패',
);
console.assert(
  extractExpiryDateFromText('09.10.2026', 'mdy', REF) === '2026-09-10',
  '연도 4자리 뒤 + 09·10 둘 다 월/일 가능해 설정값(mdy)으로 판단하는 케이스 실패',
);
console.assert(
  extractExpiryDateFromText('제조 2025.06.01 유통기한 2026.09.10', 'ymd', REF) === '2026-09-10',
  '여러 후보 중 기준일 이후 가장 늦은 날짜 채택 실패',
);
console.assert(
  extractExpiryDateFromText('26.09.10', 'ymd', REF) === '2026-09-10',
  '2자리 연도끼리 애매한 경우 + ymd 설정 실패',
);
console.assert(
  extractExpiryDateFromText('10.09.26', 'dmy', REF) === '2026-09-10',
  '2자리 연도끼리 애매한 경우 + dmy 설정 실패',
);
console.assert(
  extractExpiryDateFromText('2026.09', 'ymd', REF) === '2026-09-30',
  '년/월만 있는 경우 해당 월 마지막 날 채택 실패',
);
console.assert(
  extractExpiryDateFromText('맛있는 초코과자 120g', 'ymd', REF) === null,
  '날짜 없는 텍스트에서 null 반환 실패',
);

console.log('date-ocr selfcheck OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx tsx src/lib/date-ocr.selfcheck.ts`
Expected: `Cannot find module './date-ocr'` 류의 에러

- [ ] **Step 3: 구현 작성**

`src/lib/date-ocr.ts`:

```ts
import { isValidDateStr, todayStr } from './dates';
import { DateOcrOrder } from './settings';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toYear(raw: string): number {
  return raw.length === 4 ? Number(raw) : 2000 + Number(raw);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const TRIPLE_RE = /(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g;
const PAIR_RE = /(\d{2,4})\s*[.\-/]\s*(\d{1,2})(?!\s*[.\-/]\s*\d)/g;

/** 3묶음(년+월+일) 후보 하나를 dateOcrOrder 기준으로 해석한다. */
function resolveTriple(a: string, b: string, c: string, order: DateOcrOrder): string | null {
  const aIsYear = a.length === 4;
  const cIsYear = c.length === 4;
  let yearRaw: string;
  let rest: [string, string];
  let yearFirst: boolean;
  if (aIsYear && !cIsYear) {
    yearRaw = a;
    rest = [b, c];
    yearFirst = true;
  } else if (cIsYear && !aIsYear) {
    yearRaw = c;
    rest = [a, b];
    yearFirst = false;
  } else if (aIsYear && cIsYear) {
    return null;
  } else if (order === 'ymd') {
    yearRaw = a;
    rest = [b, c];
    yearFirst = true;
  } else {
    yearRaw = c;
    rest = [a, b];
    yearFirst = false;
  }

  const r0 = Number(rest[0]);
  const r1 = Number(rest[1]);
  let month: number;
  let day: number;
  if (yearFirst) {
    // 국내 표준(년-월-일) — 연도가 앞이면 항상 월-일 순서, 설정과 무관
    month = r0;
    day = r1;
  } else if (r0 > 12 && r1 <= 12) {
    // r0는 월이 될 수 없으므로 구조적으로 일-월 확정, 설정과 무관
    day = r0;
    month = r1;
  } else if (r1 > 12 && r0 <= 12) {
    day = r1;
    month = r0;
  } else if (order === 'dmy') {
    day = r0;
    month = r1;
  } else {
    month = r0;
    day = r1;
  }

  const year = toYear(yearRaw);
  const result = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateStr(result) ? result : null;
}

/** 2묶음(년+월만, 일 없음) 후보 하나를 dateOcrOrder 기준으로 해석한다. 일은 해당 월의 마지막 날로 채운다. */
function resolvePair(a: string, b: string, order: DateOcrOrder): string | null {
  const aIsYear = a.length === 4;
  const bIsYear = b.length === 4;
  let yearRaw: string;
  let monthRaw: string;
  if (aIsYear && !bIsYear) {
    yearRaw = a;
    monthRaw = b;
  } else if (bIsYear && !aIsYear) {
    yearRaw = b;
    monthRaw = a;
  } else if (aIsYear && bIsYear) {
    return null;
  } else if (order === 'ymd') {
    yearRaw = a;
    monthRaw = b;
  } else {
    yearRaw = b;
    monthRaw = a;
  }

  const year = toYear(yearRaw);
  const month = Number(monthRaw);
  if (month < 1 || month > 12) return null;
  const day = lastDayOfMonth(year, month);
  const result = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidDateStr(result) ? result : null;
}

/** ML Kit이 인식한 원문 텍스트에서 유통기한으로 보이는 날짜를 찾아 YYYY-MM-DD로 반환한다.
 * 못 찾으면 null. referenceDate는 "미래(또는 오늘) 날짜만 채택" 판단 기준일(기본값: 오늘) —
 * 제조일자와 유통기한이 함께 찍힌 경우 기준일 이전 후보를 제외하기 위함. */
export function extractExpiryDateFromText(
  text: string,
  dateOcrOrder: DateOcrOrder,
  referenceDate: string = todayStr(),
): string | null {
  const candidates: string[] = [];

  for (const m of text.matchAll(TRIPLE_RE)) {
    const resolved = resolveTriple(m[1], m[2], m[3], dateOcrOrder);
    if (resolved) candidates.push(resolved);
  }

  if (candidates.length === 0) {
    for (const m of text.matchAll(PAIR_RE)) {
      const resolved = resolvePair(m[1], m[2], dateOcrOrder);
      if (resolved) candidates.push(resolved);
    }
  }

  const future = candidates.filter((d) => d >= referenceDate);
  if (future.length === 0) return null;
  future.sort();
  return future[future.length - 1];
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx tsx src/lib/date-ocr.selfcheck.ts`
Expected: 마지막 줄에 `date-ocr selfcheck OK`, `Assertion failed` 없음

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/date-ocr.ts src/lib/date-ocr.selfcheck.ts
git commit -m "feat: OCR 원문 텍스트에서 유통기한 날짜 추출 로직 추가"
```

---

### Task 4: `settings.tsx`에 "사진 인식 날짜 순서" 설정 화면 추가

**Files:**
- Modify: `src/app/settings.tsx`

**Interfaces:**
- Consumes: `DATE_OCR_ORDERS`, `DATE_OCR_ORDER_META`, `DateOcrOrder`, `setDateOcrOrder`, `useDateOcrOrder` (Task 2, `@/lib/settings`)
- Produces: 없음 (설정 화면 UI만 추가)

- [ ] **Step 1: import 추가**

`src/app/settings.tsx`의 아래 기존 블록:

```tsx
import {
  ALERT_OFFSETS,
  AppMode,
  DATE_INPUT_METHOD_META,
  DATE_INPUT_METHODS,
  DateInputMethod,
  MODE_LABELS,
  setAlertSettings,
  setAppMode,
  setDateInputMethod,
  useAlertSettings,
  useAppMode,
  useDateInputMethod,
} from '@/lib/settings';
```

를 아래처럼 바꾼다:

```tsx
import {
  ALERT_OFFSETS,
  AppMode,
  DATE_INPUT_METHOD_META,
  DATE_INPUT_METHODS,
  DATE_OCR_ORDER_META,
  DATE_OCR_ORDERS,
  DateInputMethod,
  DateOcrOrder,
  MODE_LABELS,
  setAlertSettings,
  setAppMode,
  setDateInputMethod,
  setDateOcrOrder,
  useAlertSettings,
  useAppMode,
  useDateInputMethod,
  useDateOcrOrder,
} from '@/lib/settings';
```

- [ ] **Step 2: 훅 호출 추가**

아래 기존 블록:

```tsx
  const mode = useAppMode();
  const { count, hour, minute } = useAlertSettings();
  const dateInputMethod = useDateInputMethod();
```

를 아래처럼 바꾼다:

```tsx
  const mode = useAppMode();
  const { count, hour, minute } = useAlertSettings();
  const dateInputMethod = useDateInputMethod();
  const dateOcrOrder = useDateOcrOrder();
```

- [ ] **Step 3: 섹션 UI 추가**

아래 기존 블록("유통기한 입력 방법" 섹션 바로 뒤, "알림" 섹션 바로 앞):

```tsx
      <SectionTitle text="유통기한 입력 방법" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        {DATE_INPUT_METHODS.map((method, i) => (
          <View key={method}>
            {i > 0 ? <View className="h-px bg-line" /> : null}
            <DateMethodRow target={method} current={dateInputMethod} />
          </View>
        ))}
      </View>

      <SectionTitle text="알림" />
```

를 아래처럼 바꾼다:

```tsx
      <SectionTitle text="유통기한 입력 방법" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        {DATE_INPUT_METHODS.map((method, i) => (
          <View key={method}>
            {i > 0 ? <View className="h-px bg-line" /> : null}
            <DateMethodRow target={method} current={dateInputMethod} />
          </View>
        ))}
      </View>

      <SectionTitle text="사진 인식 날짜 순서" />
      <Text className="text-muted mb-2 text-xs">
        유통기한 사진 인식에서 순서가 애매할 때만 사용돼요.
      </Text>
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        {DATE_OCR_ORDERS.map((order, i) => (
          <View key={order}>
            {i > 0 ? <View className="h-px bg-line" /> : null}
            <DateOcrOrderRow target={order} current={dateOcrOrder} />
          </View>
        ))}
      </View>

      <SectionTitle text="알림" />
```

- [ ] **Step 4: `DateOcrOrderRow` 컴포넌트 추가**

기존 `DateMethodRow` 함수(308~335행) 바로 뒤에 추가:

```tsx
function DateOcrOrderRow({
  target,
  current,
}: {
  target: DateOcrOrder;
  current: DateOcrOrder;
}) {
  const active = current === target;
  const { label, description } = DATE_OCR_ORDER_META[target];
  return (
    <Pressable
      onPress={() => setDateOcrOrder(target)}
      className="flex-row items-center p-4 active:opacity-70"
    >
      <View className="flex-1">
        <Text className={`text-base font-bold ${active ? 'text-ink' : 'text-muted'}`}>
          {label}
        </Text>
        <Text className="text-muted mt-0.5 text-xs">{description}</Text>
      </View>
      <MaterialCommunityIcons
        name={active ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={active ? '#CC2222' : '#CCCCCC'}
      />
    </Pressable>
  );
}
```

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 수동 확인**

`npx expo start`로 앱 실행 → 설정 화면 → "사진 인식 날짜 순서" 섹션이 "유통기한 입력 방법"과 "알림" 사이에 보이는지, 3개 옵션 중 하나를 누르면 선택 표시(라디오 아이콘)가 바뀌는지, 앱을 재시작해도 선택이 유지되는지(`AsyncStorage`) 확인

- [ ] **Step 7: 커밋**

```bash
git add src/app/settings.tsx
git commit -m "feat: 설정 화면에 사진 인식 날짜 순서 선택 UI 추가"
```

---

### Task 5: OCR 라이브러리 설치 + `product-form.tsx` 사진 인식 버튼

**Files:**
- Modify: `package.json`, `package-lock.json` (의존성 추가)
- Modify: `src/app/product-form.tsx`

**Interfaces:**
- Consumes: `extractExpiryDateFromText` (Task 3, `@/lib/date-ocr`), `useDateOcrOrder` (Task 2, `@/lib/settings`), `recognizeText` (신규 의존성 `@infinitered/react-native-mlkit-text-recognition`)
- Produces: 없음 (화면 기능 추가)

- [ ] **Step 1: 의존성 설치**

```bash
npm install @infinitered/react-native-mlkit-text-recognition @infinitered/react-native-mlkit-core
```

- [ ] **Step 2: 설치된 타입 확인** (AGENTS.md 지침 — Expo API 변경이 잦으므로 실제 설치본 기준으로 확인)

```bash
cat node_modules/@infinitered/react-native-mlkit-text-recognition/build/index.d.ts
```

`recognizeText`가 `(imagePath: string) => Promise<{ text: string; blocks: ... }>` 형태로 export되는지 확인한다. 만약 실제 타입이 다르면(함수명·파라미터·반환 필드명이 다르면) 아래 Step 4의 `scanExpiryDatePhoto` 함수에서 `recognizeText` 호출부와 `text` 구조분해만 그 타입에 맞게 조정한다 — 나머지 로직(날짜 추출·상태 반영)은 동일하다.

- [ ] **Step 3: 카메라 권한 요청을 공용 함수로 분리** (기존 `launchPicker`와 새 OCR 버튼이 같은 권한 확인 로직을 쓰게 되어 중복 제거)

`src/app/product-form.tsx`의 아래 기존 블록:

```tsx
  const launchPicker = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        if (perm.canAskAgain) {
          Alert.alert('권한 필요', '카메라 접근 권한을 허용해 주세요.');
        } else {
          Alert.alert(
            '권한 필요',
            '카메라 접근 권한이 거부되어 있어요. 설정에서 권한을 허용해 주세요.',
            [
              { text: '취소', style: 'cancel' },
              { text: '설정 열기', onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      deleteLocalPhotoIfOwned(imageUri);
      setImageUri(persistLocalPhoto(result.assets[0].uri));
    }
  };
```

를 아래처럼 바꾼다:

```tsx
  const ensureCameraPermission = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) return true;
    if (perm.canAskAgain) {
      Alert.alert('권한 필요', '카메라 접근 권한을 허용해 주세요.');
    } else {
      Alert.alert(
        '권한 필요',
        '카메라 접근 권한이 거부되어 있어요. 설정에서 권한을 허용해 주세요.',
        [
          { text: '취소', style: 'cancel' },
          { text: '설정 열기', onPress: () => Linking.openSettings() },
        ],
      );
    }
    return false;
  };

  const launchPicker = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      if (!(await ensureCameraPermission())) return;
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      deleteLocalPhotoIfOwned(imageUri);
      setImageUri(persistLocalPhoto(result.assets[0].uri));
    }
  };

  const scanExpiryDatePhoto = async () => {
    if (!(await ensureCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;

    setOcrBusy(true);
    try {
      const { text } = await recognizeText(result.assets[0].uri);
      const found = extractExpiryDateFromText(text, dateOcrOrder);
      if (found) {
        setExpiryDate(found);
      } else {
        Alert.alert('인식 실패', '유통기한을 찾지 못했어요. 직접 입력해 주세요.');
      }
    } catch {
      Alert.alert('인식 실패', '사진 인식 중 문제가 발생했어요. 직접 입력해 주세요.');
    } finally {
      setOcrBusy(false);
    }
  };
```

- [ ] **Step 4: import·상태·훅 추가**

아래 기존 블록:

```tsx
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import { deleteLocalPhotoIfOwned, persistLocalPhoto } from '@/lib/local-photo';
import { uploadPhotoToBucket } from '@/lib/storage';
import { autoFormatDate, formatDate, isValidDateStr } from '@/lib/dates';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, getProduct, listProducts, newId, saveProduct } from '@/lib/repo';
import { AppMode, useAppMode, useDateInputMethod } from '@/lib/settings';
import { Product, ProductStatus } from '@/lib/types';
```

를 아래처럼 바꾼다(외부 패키지 import는 상단 그룹에 추가):

```tsx
import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import { extractExpiryDateFromText } from '@/lib/date-ocr';
import { deleteLocalPhotoIfOwned, persistLocalPhoto } from '@/lib/local-photo';
import { uploadPhotoToBucket } from '@/lib/storage';
import { autoFormatDate, formatDate, isValidDateStr } from '@/lib/dates';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, getProduct, listProducts, newId, saveProduct } from '@/lib/repo';
import { AppMode, useAppMode, useDateInputMethod, useDateOcrOrder } from '@/lib/settings';
import { Product, ProductStatus } from '@/lib/types';
```

아래 기존 블록:

```tsx
  const isEdit = !!params.id;
  const mode = useAppMode();
  const dateInputMethod = useDateInputMethod();
```

를 아래처럼 바꾼다:

```tsx
  const isEdit = !!params.id;
  const mode = useAppMode();
  const dateInputMethod = useDateInputMethod();
  const dateOcrOrder = useDateOcrOrder();
```

아래 기존 블록:

```tsx
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
```

를 아래처럼 바꾼다:

```tsx
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
```

- [ ] **Step 5: 유통기한 라벨 옆에 인식 버튼 추가**

아래 기존 블록:

```tsx
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="유통기한 *" />
            {dateInputMethod === 'text' ? (
```

를 아래처럼 바꾼다:

```tsx
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <View className="flex-row items-center justify-between">
              <Label text="유통기한 *" />
              <Pressable
                onPress={scanExpiryDatePhoto}
                disabled={ocrBusy}
                className="flex-row items-center"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="사진으로 유통기한 인식"
              >
                {ocrBusy ? (
                  <ActivityIndicator size="small" color="#CC2222" />
                ) : (
                  <MaterialCommunityIcons name="text-recognition" size={15} color="#CC2222" />
                )}
                <Text className="text-primary ml-1 text-xs font-medium">사진으로 인식</Text>
              </Pressable>
            </View>
            {dateInputMethod === 'text' ? (
```

- [ ] **Step 6: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (에러가 나면 Step 2에서 확인한 실제 타입에 맞게 Step 3의 `recognizeText` 호출부를 조정)

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json src/app/product-form.tsx
git commit -m "feat: 유통기한 사진 인식(OCR) 버튼 추가"
```

---

### Task 6: `product-form.tsx` — "제조일+기간으로 계산" 팝업

**Files:**
- Modify: `src/app/product-form.tsx`

**Interfaces:**
- Consumes: `addMonths`, `isValidDateStr`, `autoFormatDate` (Task 1 / 기존 `@/lib/dates`)
- Produces: 없음 (화면 기능 추가)

- [ ] **Step 1: import에 `addMonths`, `Modal` 추가**

아래 기존 블록:

```tsx
import { autoFormatDate, formatDate, isValidDateStr } from '@/lib/dates';
```

를 아래처럼 바꾼다:

```tsx
import { addMonths, autoFormatDate, formatDate, isValidDateStr } from '@/lib/dates';
```

아래 기존 블록(react-native import):

```tsx
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
```

를 아래처럼 바꾼다:

```tsx
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
```

- [ ] **Step 2: 상태 추가**

아래 기존 블록(Task 5에서 추가한 줄 바로 뒤):

```tsx
  const [ocrBusy, setOcrBusy] = useState(false);
```

를 아래처럼 바꾼다:

```tsx
  const [ocrBusy, setOcrBusy] = useState(false);
  const [manufactureCalcVisible, setManufactureCalcVisible] = useState(false);
  const [manufactureDate, setManufactureDate] = useState('');
  const [manufactureMonths, setManufactureMonths] = useState('6');
```

- [ ] **Step 3: 유통기한 필드 아래에 링크 추가**

아래 기존 블록:

```tsx
            {showDatePicker && dateInputMethod !== 'text' ? (
              <View className="mt-2 overflow-hidden rounded-xl border border-line bg-paper">
                <DateTimePicker
                  value={datePickerValue}
                  mode="date"
                  display={datePickerDisplay}
                  onChange={onPickDate}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={() => setShowDatePicker(false)}
                    className="items-center border-t border-line py-2.5"
                  >
                    <Text className="text-primary text-sm font-bold">완료</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
          <View>
            <Label text="수량" />
```

를 아래처럼 바꾼다:

```tsx
            {showDatePicker && dateInputMethod !== 'text' ? (
              <View className="mt-2 overflow-hidden rounded-xl border border-line bg-paper">
                <DateTimePicker
                  value={datePickerValue}
                  mode="date"
                  display={datePickerDisplay}
                  onChange={onPickDate}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={() => setShowDatePicker(false)}
                    className="items-center border-t border-line py-2.5"
                  >
                    <Text className="text-primary text-sm font-bold">완료</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Pressable onPress={() => setManufactureCalcVisible(true)} className="mt-1.5">
              <Text className="text-muted text-xs underline">제조일+기간으로 계산</Text>
            </Pressable>
          </View>
          <View>
            <Label text="수량" />
```

- [ ] **Step 4: 계산 모달 추가**

아래 기존 블록(`PhotoCandidatesModal` 바로 뒤, `<ScrollView>` 시작 바로 앞):

```tsx
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode ?? ''}
        onClose={() => setShowPhotoCandidates(false)}
      />
      <ScrollView
```

를 아래처럼 바꾼다:

```tsx
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode ?? ''}
        onClose={() => setShowPhotoCandidates(false)}
      />
      <Modal
        visible={manufactureCalcVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManufactureCalcVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full rounded-2xl bg-paper p-4">
            <Text className="text-ink mb-3 text-base font-bold">제조일+기간으로 계산</Text>
            <Label text="제조일자" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              maxLength={10}
              value={manufactureDate}
              onChangeText={(t) => setManufactureDate(autoFormatDate(t))}
            />
            <View className="mt-3">
              <Label text="개월 수" />
              <TextInput
                className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
                placeholder="6"
                placeholderTextColor="#BBBBBB"
                keyboardType="number-pad"
                value={manufactureMonths}
                onChangeText={setManufactureMonths}
              />
            </View>
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => {
                  setManufactureCalcVisible(false);
                  setManufactureDate('');
                  setManufactureMonths('6');
                }}
                className="flex-1 items-center rounded-xl border border-line bg-paper py-2.5 active:opacity-70"
              >
                <Text className="text-ink text-sm font-medium">취소</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const months = Number(manufactureMonths);
                  if (!isValidDateStr(manufactureDate) || !Number.isFinite(months) || months <= 0) {
                    Alert.alert('입력 확인', '제조일자(YYYY-MM-DD)와 개월 수를 올바르게 입력해 주세요.');
                    return;
                  }
                  setExpiryDate(addMonths(manufactureDate, months));
                  setManufactureCalcVisible(false);
                }}
                className="flex-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80"
              >
                <Text className="text-paper text-sm font-bold">계산</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ScrollView
```

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/product-form.tsx
git commit -m "feat: 제조일+기간으로 유통기한 계산하는 팝업 추가"
```

---

### Task 7: EAS 개발 빌드 + 전체 통합 수동 QA

**Files:** 없음 (코드 변경 없음, 문제 발견 시에만 수정 후 별도 커밋)

**Interfaces:**
- Consumes: Task 1~6 전체
- Produces: 없음

Task 5에서 네이티브 모듈을 추가했으므로, 기존에 쓰던 dev-client 빌드로는 새 네이티브 코드가 없어 `recognizeText` 호출 시 오류가 난다. 새 빌드부터 시작한다.

- [ ] **Step 1: 새 개발 빌드 생성**

```bash
eas build --profile development --platform android
```

빌드가 끝나면 기기/에뮬레이터에 설치하고 `npx expo start --dev-client`로 접속

- [ ] **Step 2: 사진 인식 정상 케이스 확인**

실제 유통기한이 인쇄된 포장지(가능하면 년/월/일이 뚜렷하게 찍힌 것)를 상품 등록 화면에서 "사진으로 인식" → 유통기한 필드에 날짜가 채워지는지 확인

- [ ] **Step 3: 기존 수기 입력 회귀 확인**

"사진으로 인식" 버튼을 한 번도 안 누르고 텍스트 입력/날짜 피커만으로 상품을 등록 → 이번 작업 전과 동일하게 동작하는지 확인 (설정 → 유통기한 입력 방법을 텍스트/달력/스피너 각각으로 바꿔가며 확인)

- [ ] **Step 4: 인식 실패 케이스 확인**

날짜가 안 보이는 부분(포장지 뒷면 성분표 등)을 촬영 → "인식 실패, 직접 입력해 주세요" 안내가 뜨고 필드는 그대로 유지되는지 확인

- [ ] **Step 5: 인식된 날짜 수정 확인**

사진 인식으로 채워진 날짜를 사용자가 텍스트 입력/날짜 피커로 바로 이어서 수정할 수 있는지 확인

- [ ] **Step 6: 날짜 순서 설정 확인**

설정 → "사진 인식 날짜 순서"를 "일/월/년"으로 바꾼 뒤, 2자리 연도만 있는 해외 상품 사진(또는 손으로 쓴 종이에 `10.09.26`처럼 적어서 촬영)을 인식시켜 순서가 바뀌어 반영되는지 확인. "월/일/년"으로도 동일하게 확인

- [ ] **Step 7: 제조일+기간 계산 확인**

"제조일+기간으로 계산" 링크 → 제조일자 `2026-03-10`, 개월 수 `6` 입력 → 계산 → 유통기한 필드가 `2026-09-10`으로 채워지는지 확인. 제조일자를 비우거나 잘못된 형식으로 두고 계산 시도 → 안내 문구가 뜨고 필드가 바뀌지 않는지 확인

- [ ] **Step 8: iOS 확인 (계정/기기가 있는 경우)**

`eas build --profile development --platform ios`로도 빌드해 Step 2~7을 동일하게 확인 — ML Kit 텍스트 인식은 Android/iOS 양쪽 네이티브 구현이 다르므로 한쪽만 확인하고 끝내지 않는다

문제를 발견하면 해당 파일을 수정하고 아래처럼 별도 커밋:

```bash
git add <수정한 파일>
git commit -m "fix: 유통기한 OCR QA 중 발견한 문제 수정"
```
