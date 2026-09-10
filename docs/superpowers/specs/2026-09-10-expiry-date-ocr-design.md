# 유통기한 사진 인식(OCR) 자동 입력 — 설계

## 배경

`product-form.tsx`에서 유통기한을 수기(텍스트 입력 또는 날짜 피커)로만 입력하고 있음. 포장지에 인쇄된 유통기한을 카메라로 찍으면 자동으로 읽어 채워주는 기능을 추가하되, **기존 수기 입력 방식은 그대로 두고** 사용자가 원할 때만 선택해서 쓰는 추가 옵션으로 붙이기로 함(사용자 확인).

이 앱은 이미 `expo-dev-client` 커스텀 빌드를 쓰고 있어 네이티브 OCR 모듈을 붙일 수 있고, `product-form.tsx`에 상품 사진 촬영용 `ImagePicker.launchCameraAsync` 코드가 이미 있어 같은 패턴을 재사용할 수 있음. 클라우드 OCR API(신규 키 발급·과금 필요)보다 온디바이스 ML Kit이 비용·운영 부담이 없고, 인식 대상이 숫자+구분자뿐인 단순한 케이스라 정확도 면에서도 충분함(사용자 확인).

## 범위

- 신규 의존성: `@infinitered/react-native-mlkit-text-recognition` (Expo용 config plugin 포함된 ML Kit 텍스트 인식 래퍼)
- `app.json`: 위 패키지의 config plugin 등록
- 신규 로직 `src/lib/date-ocr.ts` (순수 함수, UI 없음)
- `src/lib/settings.ts`: 날짜 순서 애매할 때 쓸 설정값 하나 추가
- `src/app/settings.tsx`: 위 설정을 바꾸는 화면 UI 추가
- `src/app/product-form.tsx`: "유통기한 *" 라벨 옆에 인식 버튼 추가

이 기능을 추가하면 네이티브 모듈이 새로 들어가므로 **다음 EAS 개발 빌드부터 반영**됨(Expo Go로는 테스트 불가, 기존에도 dev-client 빌드를 쓰고 있어 동일한 흐름).

## `src/lib/date-ocr.ts`

```ts
/** ML Kit이 인식한 원문 텍스트에서 유통기한으로 보이는 날짜를 찾아 YYYY-MM-DD로 반환.
 * 못 찾으면 null. ambiguousOrder는 순서가 진짜 애매할 때만 쓰는 사용자 설정값. */
export function extractExpiryDateFromText(
  text: string,
  ambiguousOrder: DateOcrOrder, // 'ymd' | 'dmy' — src/lib/settings.ts 참고
): string | null
```

### 동작

1. 원문에서 숫자 3묶음 패턴을 구분자(`.`, `-`, `/`, 공백)로 찾는다. 정규식 예: `/(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g`
2. 한 화면에 날짜가 여러 개 찍힐 수 있으므로(제조일자+유통기한 동시 인쇄 등) **가장 나중(미래) 날짜**를 채택한다 — 유통기한은 항상 오늘보다 뒤이고, 제조일자는 항상 오늘보다 앞이므로 후보 중 오늘 이후 날짜만 남기고, 여러 개면 가장 늦은 날짜를 쓴다.
3. 각 후보 묶음 `(a, b, c)`를 다음 순서로 해석한다:
   - `a`가 4자리이거나, 2자리인데 값이 커서 월(1~12)이 될 수 없으면 → **연도 위치가 명확함**(맨 앞): `년-월-일` = `(a, b, c)`
   - 그게 아니고 `c`가 4자리면 → **연도 위치가 명확함**(맨 뒤): `일-월-년` = `(c, b, a)`
   - 셋 다 2자리라 연도 위치를 구조적으로 판단할 수 없는 경우에만 → **애매한 경우**로 보고, 자동으로 추측하지 않고 사용자 설정값 `ambiguousOrder`를 그대로 따른다: `'ymd'`면 `(a, b, c)`, `'dmy'`면 `(c, b, a)`.
   - 위 해석 결과가 유효한 날짜(`isValidDateStr` 통과)가 아니면 이 후보는 버린다.
4. 유효한 후보가 하나도 없으면 `null` 반환.

기존 `src/lib/dates.ts`의 `isValidDateStr`, `pad` 로직을 그대로 재사용한다(새로 만들지 않음).

연도 위치가 4자리로 명확한 경우(대부분의 인쇄된 유통기한)는 국내/해외를 구조적으로 바로 알 수 있어 설정값을 보지 않는다. 설정값은 **2자리 연도끼리라 정말 순서를 알 수 없는 극소수 케이스**에만 관여한다 — "여러 순서를 자동으로 시도해서 그럴듯한 걸 고르는" 방식(추측)보다, 사용자가 설정에서 미리 정해둔 순서를 그대로 쓰는 쪽이 더 예측 가능하고 설명하기 쉽다(사용자 확인).

## `src/lib/settings.ts` 추가

`dateInputMethod`(112~154행)와 완전히 같은 패턴(모듈 캐시 + 리스너 + `AsyncStorage`)으로 추가:

```ts
export type DateOcrOrder = 'ymd' | 'dmy';

export const DATE_OCR_ORDER_META: Record<DateOcrOrder, { label: string; description: string }> = {
  ymd: { label: '년/월/일 (기본)', description: '국내 제품 표준. 예: 26.09.10 → 2026-09-10' },
  dmy: { label: '일/월/년', description: '해외 제품 표준. 예: 10.09.26 → 2026-09-10' },
};

const DATE_OCR_ORDER_KEY = 'dateOcrOrder:v1';
const DEFAULT_DATE_OCR_ORDER: DateOcrOrder = 'ymd';

// setDateOcrOrder(), useDateOcrOrder() — dateInputMethod와 동일한 구조로 구현
```

이 설정은 **2자리 연도만 있어 순서가 애매한 사진에만** 영향을 준다(위 알고리즘 3번 참고). 연도가 4자리로 찍혀 있으면 이 설정과 무관하게 항상 정확히 해석됨 — 즉 해외 상품이라도 유통기한에 4자리 연도가 찍혀 있으면 기본값(년/월/일)인 채로 둬도 문제없다.

## `src/app/settings.tsx` 추가

"유통기한 입력 방법" 섹션 바로 아래에 새 섹션 추가(같은 `SectionTitle` + 테두리 박스 + Row 패턴, `DateMethodRow`를 본떠 `DateOcrOrderRow` 작성):

```tsx
<SectionTitle text="사진 인식 날짜 순서" />
<Text className="text-muted mb-2 text-xs">
  유통기한 사진 인식에서 연도가 2자리라 순서가 애매할 때만 사용돼요.
</Text>
<View className="overflow-hidden rounded-xl border border-line bg-paper">
  {(['ymd', 'dmy'] as const).map((order, i) => (
    <View key={order}>
      {i > 0 ? <View className="h-px bg-line" /> : null}
      <DateOcrOrderRow target={order} current={dateOcrOrder} />
    </View>
  ))}
</View>
```

평소엔 기본값(년/월/일) 그대로 두고, 해외 직구 상품 사진 인식이 자꾸 틀리게 나올 때만 사용자가 여기 들어와서 "일/월/년"으로 바꾸는 용도 — 자동 판별 대신 사용자가 직접 스위치를 켜는 방식.

## `src/app/product-form.tsx` 변경

### 상태 추가

```ts
const [ocrBusy, setOcrBusy] = useState(false);
```

### 핸들러 추가

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

## 영향 없음

- 바코드 스캔(`scan.tsx`), 발주 관련 파일과 독립적 — 겹치는 파일 없음.
- 기존 수기 입력(텍스트/날짜 피커) 로직은 한 줄도 바뀌지 않음. 이 기능을 한 번도 안 누르면 지금과 완전히 동일하게 동작.
- 인식된 날짜는 자동으로 저장되지 않고 폼 필드에 채워지기만 함 — 기존 저장 시 유효성 검사(`isValidDateStr`)를 그대로 통과해야 저장 가능.

## 테스트

테스트 프레임워크 없음 — `date-ocr.ts`는 순수 함수라 `dates.selfcheck.ts`와 같은 패턴으로 `date-ocr.selfcheck.ts`를 추가:

1. `"유통기한 2026.09.10까지"` (연도 4자리, 앞) → `"2026-09-10"` (설정값 무관)
2. `"EXP 10.09.2026"` (연도 4자리, 뒤 — 해외식) → `"2026-09-10"` (설정값 무관)
3. 제조일자+유통기한이 함께 찍힌 텍스트(예: `"제조 2026.06.01 유통기한 2026.09.10"`) → 더 늦은 날짜인 `"2026-09-10"` 채택
4. `"26.09.10"` (2자리 연도, 애매한 경우) + `ambiguousOrder: 'ymd'` → `"2026-09-10"`
5. `"10.09.26"` (2자리 연도, 애매한 경우) + `ambiguousOrder: 'dmy'` → `"2026-09-10"`
6. 날짜로 해석 불가능한 텍스트(예: 상품명만 있는 경우) → `null`

수동 QA:
1. 실제 우유팩 등 유통기한이 인쇄된 포장지를 촬영 → 필드에 날짜가 채워지는지 확인
2. 인식 버튼을 누르지 않고 기존처럼 수기 입력만으로 등록 → 기존과 동일하게 동작하는지 확인
3. 인식 실패 시(흐릿한 사진 등) 안내 문구가 뜨고 수기 입력으로 이어지는지 확인
4. 자동 인식된 날짜를 사용자가 다시 수정할 수 있는지 확인
5. 설정 화면에서 "사진 인식 날짜 순서"를 일/월/년으로 바꾼 뒤, 2자리 연도만 있는 해외 상품 사진을 인식시켜 순서가 바뀌어 반영되는지 확인
