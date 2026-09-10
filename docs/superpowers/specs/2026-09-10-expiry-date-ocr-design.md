# 유통기한 사진 인식(OCR) 자동 입력 — 설계

## 배경

`product-form.tsx`에서 유통기한을 수기(텍스트 입력 또는 날짜 피커)로만 입력하고 있음. 포장지에 인쇄된 유통기한을 카메라로 찍으면 자동으로 읽어 채워주는 기능을 추가하되, **기존 수기 입력 방식은 그대로 두고** 사용자가 원할 때만 선택해서 쓰는 추가 옵션으로 붙이기로 함(사용자 확인).

이 앱은 이미 `expo-dev-client` 커스텀 빌드를 쓰고 있어 네이티브 OCR 모듈을 붙일 수 있고, `product-form.tsx`에 상품 사진 촬영용 `ImagePicker.launchCameraAsync` 코드가 이미 있어 같은 패턴을 재사용할 수 있음. 클라우드 OCR API(신규 키 발급·과금 필요)보다 온디바이스 ML Kit이 비용·운영 부담이 없고, 인식 대상이 숫자+구분자뿐인 단순한 케이스라 정확도 면에서도 충분함(사용자 확인).

## 유통기한 표기 경우의 수

실제 포장지에 찍히는 유통기한 표기는 아래 5가지로 정리됨(사용자 확인). 이 설계는 이 5가지를 모두 다룬다.

| 표기 예 | 처리 방식 |
|---|---|
| `2026.09.10` (년/월/일) | **기준값** — 자동 인식 기본 해석 |
| `10.09.2026` (일/월/년) | 설정에서 선택 가능 |
| `09.10.2026` (월/일/년) | 설정에서 선택 가능 |
| `2026.09` (년/월만, 일 없음) | 해당 월의 마지막 날로 자동 채움(사용자 확인) |
| 제조일자 `2026.03.10` + "제조일로부터 6개월" 표기 | 자동 인식하지 않음 — 사용자가 제조일+개월수를 직접 입력하는 별도 팝업 제공(사용자 확인: 한글 키워드 자동 인식은 정확도가 들쭉날쭉해서 제외, 수동 입력이 항상 정확함) |

## 범위

- 신규 의존성: `@infinitered/react-native-mlkit-text-recognition` (Expo용 config plugin 포함된 ML Kit 텍스트 인식 래퍼)
- `app.json`: 위 패키지의 config plugin 등록
- 신규 로직 `src/lib/date-ocr.ts` (순수 함수, UI 없음)
- `src/lib/dates.ts`: `addMonths` 함수 추가 (제조일+개월수 계산용)
- `src/lib/settings.ts`: 날짜 순서 설정값(3가지) 추가
- `src/app/settings.tsx`: 위 설정을 바꾸는 화면 UI 추가
- `src/app/product-form.tsx`: "유통기한 *" 라벨 옆에 사진 인식 버튼 + "제조일+기간으로 계산" 링크 추가

이 기능을 추가하면 네이티브 모듈이 새로 들어가므로 **다음 EAS 개발 빌드부터 반영**됨(Expo Go로는 테스트 불가, 기존에도 dev-client 빌드를 쓰고 있어 동일한 흐름).

## `src/lib/date-ocr.ts`

```ts
/** ML Kit이 인식한 원문 텍스트에서 유통기한으로 보이는 날짜를 찾아 YYYY-MM-DD로 반환.
 * 못 찾으면 null. dateOcrOrder는 순서가 애매할 때 기준으로 쓰는 사용자 설정값
 * ('ymd' | 'dmy' | 'mdy' — src/lib/settings.ts 참고). */
export function extractExpiryDateFromText(
  text: string,
  dateOcrOrder: DateOcrOrder,
): string | null
```

### 동작

**1. 3묶음(년+월+일) 패턴** — 정규식 `/(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g`로 `(a, b, c)` 후보를 모두 찾는다.

각 후보는 다음 두 가지를 독립적으로 판단해서 해석한다:

- **연도 위치**: `a`와 `c` 중 하나가 4자리면 그게 연도(위치가 구조적으로 명확 — 설정과 무관). 둘 다 2자리면(진짜 애매한 경우) 설정값 `dateOcrOrder`로 정한다 — `'ymd'`면 `a`가 연도, `'dmy'`/`'mdy'`면 `c`가 연도.
- **나머지 두 묶음의 월/일 순서**: 연도를 제외한 나머지 두 묶음(원래 순서 유지)을 `dateOcrOrder`가 `'dmy'`면 **일-월** 순서로, `'ymd'`/`'mdy'`면 **월-일** 순서로 해석한다. (`년-월-일`과 `월-일-년`은 둘 다 "월이 일보다 앞"이라 이 부분은 같고, 연도 위치만 다르다.)

예: 설정이 `'mdy'`이고 후보가 `(09, 10, 2026)`이면 → `c`(2026, 4자리)가 연도, 나머지 `(09, 10)`은 월-일 순서 → 월=09, 일=10, 연도=2026 → `2026-09-10`.

2자리 연도는 `2000 + 숫자`로 확장한다. 해석 결과가 유효한 날짜(`isValidDateStr` 통과)가 아니면 후보를 버린다.

**2. 2묶음(년+월만, 일 없음) 패턴** — 3묶음 매칭에 실패한 자리에서 `/(\d{2,4})\s*[.\-/]\s*(\d{1,2})(?!\s*[.\-/]\s*\d)/g`로 `(a, b)` 후보를 찾는다. 연도 위치는 위와 같은 규칙(4자리 쪽이 연도, 둘 다 2자리면 설정값 기준 — `'ymd'`는 `a`가 연도, 그 외는 `b`가 연도)으로 정하고, 나머지 하나가 월이 된다. **일(day)은 해당 연/월의 마지막 날로 채운다**(사용자 확인) — 예: `2026.09` → `2026-09-30`.

**3. 여러 후보가 있을 때** — 제조일자+유통기한이 함께 찍히는 경우가 흔하므로, 오늘(`todayStr()`)보다 미래인 후보만 남기고 그중 가장 늦은 날짜를 채택한다. 미래 후보가 하나도 없으면(사진에 유효기간이 안 보이는 경우) `null`.

기존 `src/lib/dates.ts`의 `isValidDateStr`, `todayStr`, `pad` 로직을 그대로 재사용한다(새로 만들지 않음).

## `src/lib/dates.ts` 추가

```ts
/** dateStr에 개월 수를 더한다. 말일 초과 시 그 달의 마지막 날로 클램프한다
 * (예: 2026-01-31 + 1개월 → 2026-02-28, JS Date의 3월 넘어가는 기본 동작 방지). */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return formatDate(new Date(targetYear, targetMonth, Math.min(d, lastDay)));
}
```

## `src/lib/settings.ts` 추가

`dateInputMethod`(112~154행)와 완전히 같은 패턴(모듈 캐시 + 리스너 + `AsyncStorage`)으로 추가:

```ts
export type DateOcrOrder = 'ymd' | 'dmy' | 'mdy';

export const DATE_OCR_ORDER_META: Record<DateOcrOrder, { label: string; description: string }> = {
  ymd: { label: '년/월/일 (기본)', description: '국내 제품 표준. 예: 26.09.10 → 2026-09-10' },
  dmy: { label: '일/월/년', description: '유럽 등 해외 표준. 예: 10.09.26 → 2026-09-10' },
  mdy: { label: '월/일/년', description: '미국 표준. 예: 09.10.26 → 2026-09-10' },
};

const DATE_OCR_ORDER_KEY = 'dateOcrOrder:v1';
const DEFAULT_DATE_OCR_ORDER: DateOcrOrder = 'ymd';

// setDateOcrOrder(), useDateOcrOrder() — dateInputMethod와 동일한 구조로 구현
```

이 설정은 **연도가 2자리뿐이라 위치가 애매한 경우**와 **월/일 중 어느 게 먼저인지 애매한 경우**에만 영향을 준다. 연도가 4자리로 찍혀 있고 월/일 중 하나가 13 이상이라 구조적으로 판단 가능하면 이 설정과 무관하게 항상 정확히 해석됨.

## `src/app/settings.tsx` 추가

"유통기한 입력 방법" 섹션 바로 아래에 새 섹션 추가(같은 `SectionTitle` + 테두리 박스 + Row 패턴, `DateMethodRow`를 본떠 `DateOcrOrderRow` 작성):

```tsx
<SectionTitle text="사진 인식 날짜 순서" />
<Text className="text-muted mb-2 text-xs">
  유통기한 사진 인식에서 순서가 애매할 때만 사용돼요.
</Text>
<View className="overflow-hidden rounded-xl border border-line bg-paper">
  {(['ymd', 'dmy', 'mdy'] as const).map((order, i) => (
    <View key={order}>
      {i > 0 ? <View className="h-px bg-line" /> : null}
      <DateOcrOrderRow target={order} current={dateOcrOrder} />
    </View>
  ))}
</View>
```

평소엔 기본값(년/월/일) 그대로 두고, 해외 직구 상품 사진 인식이 자꾸 틀리게 나올 때만 사용자가 여기 들어와서 "일/월/년" 또는 "월/일/년"으로 바꾸는 용도 — 자동 판별 대신 사용자가 직접 스위치를 켜는 방식.

## `src/app/product-form.tsx` 변경

### 상태 추가

```ts
const [ocrBusy, setOcrBusy] = useState(false);
const [manufactureCalcVisible, setManufactureCalcVisible] = useState(false);
const [manufactureDate, setManufactureDate] = useState('');
const [manufactureMonths, setManufactureMonths] = useState('6'); // 가장 흔한 값(6개월)을 기본값으로
```

### 3-1. 사진 인식 버튼

핸들러:

```ts
const scanExpiryDatePhoto = async () => {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    // 기존 launchPicker의 카메라 권한 거부 처리와 동일한 Alert 재사용
    ...
    return;
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return;

  setOcrBusy(true);
  try {
    const { text } = await recognizeText(result.assets[0].uri);
    const found = extractExpiryDateFromText(text, dateOcrOrder); // dateOcrOrder = useDateOcrOrder()
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

`recognizeText`는 `@infinitered/react-native-mlkit-text-recognition`이 제공하는 함수(이미지 경로 문자열을 받아 `{ text, blocks }` 반환)를 그대로 사용.

### UI 배치

"유통기한 *" `Label` 옆에 작은 버튼 추가 (기존 "웹에서 이미지 찾기" 버튼과 같은 스타일 — 아이콘 + 텍스트, 로딩 중엔 `ActivityIndicator`로 교체):

```tsx
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
```

기존 `TextInput`/날짜 피커 UI는 그대로 두고, 이 버튼이 하는 일은 `setExpiryDate`로 상태값을 채우는 것뿐 — 채워진 뒤에도 사용자가 텍스트 입력이든 날짜 피커든 이어서 수정 가능(기존 `expiryDate` 상태 하나를 공유하므로 자연스럽게 이어짐).

### 3-2. "제조일+기간으로 계산" 팝업

한글 키워드("제조일로부터 N개월") 자동 인식은 하지 않고, 사용자가 직접 제조일자와 개월 수를 입력하면 앱이 `addMonths`로 계산하는 수동 모달을 별도로 제공한다(사용자 확인).

기존 "사진 후보 보기 / 투표" 링크(342~346행)와 같은 스타일로, 유통기한 필드 아래에 작은 밑줄 텍스트 링크 추가:

```tsx
<Pressable onPress={() => setManufactureCalcVisible(true)} className="mt-1.5">
  <Text className="text-muted text-xs underline">제조일+기간으로 계산</Text>
</Pressable>
```

누르면 뜨는 모달(기존 "바코드 직접 입력" 모달과 같은 레이아웃 — `scan.tsx`의 `manualEntryVisible` 모달 참고):

- 제조일자 입력: `TextInput`(`autoFormatDate` 재사용, `YYYY-MM-DD`)
- 개월 수 입력: `TextInput`(`keyboardType="number-pad"`, 기본값 `6`)
- "계산" 버튼: 제조일자가 유효하면(`isValidDateStr`) `setExpiryDate(addMonths(manufactureDate, Number(manufactureMonths)))` 후 모달 닫기. 유효하지 않으면 `Alert`로 안내.
- "취소" 버튼: 입력값 리셋 후 모달 닫기.

계산된 날짜도 다른 경로와 마찬가지로 `expiryDate` 필드에 채워지기만 하고, 사용자가 이어서 직접 수정 가능.

## 영향 없음

- 바코드 스캔(`scan.tsx`), 발주 관련 파일과 독립적 — 겹치는 파일 없음.
- 기존 수기 입력(텍스트/날짜 피커) 로직은 한 줄도 바뀌지 않음. 이 기능을 한 번도 안 누르면 지금과 완전히 동일하게 동작.
- 인식/계산된 날짜는 자동으로 저장되지 않고 폼 필드에 채워지기만 함 — 기존 저장 시 유효성 검사(`isValidDateStr`)를 그대로 통과해야 저장 가능.
- `addMonths`는 `dates.ts`에 새로 추가되는 함수일 뿐, 기존 `addDays` 등 다른 함수는 그대로 둠.

## 테스트

테스트 프레임워크 없음 — `date-ocr.ts`/`dates.ts`는 순수 함수라 `dates.selfcheck.ts`와 같은 패턴으로 추가:

`date-ocr.selfcheck.ts`:
1. `"유통기한 2026.09.10까지"` (연도 4자리, 앞) → `"2026-09-10"` (설정값 무관)
2. `"EXP 10.09.2026"` (연도 4자리, 뒤, 일-월 순) → `"2026-09-10"` (설정값 무관)
3. `"09.10.2026"` (연도 4자리, 뒤, 월-일 순) + `dateOcrOrder: 'mdy'` → `"2026-09-10"`
4. 제조일자+유통기한이 함께 찍힌 텍스트(예: `"제조 2026.06.01 유통기한 2026.09.10"`) → 더 늦은 날짜인 `"2026-09-10"` 채택
5. `"26.09.10"` (2자리 연도, 애매한 경우) + `dateOcrOrder: 'ymd'` → `"2026-09-10"`
6. `"10.09.26"` (2자리 연도, 애매한 경우) + `dateOcrOrder: 'dmy'` → `"2026-09-10"`
7. `"2026.09"` (년/월만, 일 없음) → `"2026-09-30"` (해당 월 마지막 날)
8. 날짜로 해석 불가능한 텍스트(예: 상품명만 있는 경우) → `null`

`dates.selfcheck.ts`에 `addMonths` 케이스 추가:
1. `addMonths('2026-01-31', 1)` → `"2026-02-28"` (말일 클램프, 3월로 안 넘어감)
2. `addMonths('2026-03-10', 6)` → `"2026-09-10"` (일반 케이스)
3. `addMonths('2026-11-30', 3)` → `"2027-02-28"` (연도 경계 + 말일 클램프)

수동 QA:
1. 실제 우유팩 등 유통기한이 인쇄된 포장지를 촬영 → 필드에 날짜가 채워지는지 확인
2. 인식 버튼을 누르지 않고 기존처럼 수기 입력만으로 등록 → 기존과 동일하게 동작하는지 확인
3. 인식 실패 시(흐릿한 사진 등) 안내 문구가 뜨고 수기 입력으로 이어지는지 확인
4. 자동 인식된 날짜를 사용자가 다시 수정할 수 있는지 확인
5. 설정 화면에서 "사진 인식 날짜 순서"를 "일/월/년" 또는 "월/일/년"으로 바꾼 뒤, 2자리 연도만 있는 해외 상품 사진을 인식시켜 순서가 바뀌어 반영되는지 확인
6. "제조일+기간으로 계산" 링크 → 모달에서 제조일자와 개월 수 입력 → 계산 버튼 → 유통기한 필드에 정확히 반영되는지 확인
7. 제조일자를 비워두거나 잘못된 형식으로 두고 계산 시도 → 안내 문구가 뜨고 필드가 바뀌지 않는지 확인
