# CSV 가져오기 — 설계

## 배경

출시 전 경쟁앱 조사에서, 국내 유통기한 관리 앱 중 하나(Scanoid)가 엑셀 가져오기/내보내기를 지원한다는 점이 확인됨. 기존에 엑셀 스프레드시트로 재고를 관리하던 소상공인이 앱으로 넘어올 때 처음부터 상품을 하나씩 수동 등록해야 하는 게 온보딩 장벽이라 판단, CSV 가져오기 기능을 추가하기로 함.

사용자 확인 사항(브레인스토밍 과정에서 결정):
- **가져오기 중심** — 전체 상품 백업/내보내기는 이번 스코프 아님(필요해지면 나중에)
- 진입점은 **설정 화면에 상시 링크** (대시보드 빈 상태 연동은 안 함)
- 바코드가 이미 등록된 상품과 겹쳐도 **항상 새 상품으로 추가** (중복 검사/병합 없음 — 유통기한만 다르게 여러 개 들어오는 게 소매점에선 정상 케이스)
- 일부 행에 오류가 있어도 **정상 행만 가져오고 오류 행은 요약 보고** (전체 중단 안 함)

## 범위

- 신규 로직 `src/lib/csv-import.ts` — CSV 파싱 + 행 검증 + `Product` 매핑 (순수 함수, UI 없음)
- 신규 자체 테스트 `src/lib/csv-import.selfcheck.ts` — 기존 `korean-search.selfcheck.ts`와 동일한 `console.assert` 패턴
- 신규 화면 `src/app/csv-import.tsx` — 템플릿 안내, 파일 선택, 미리보기, 가져오기 실행
- `src/app/settings.tsx` — "기능" 섹션에 링크 한 줄 추가
- 신규 의존성: `expo-document-picker`(파일 선택), `expo-sharing`(템플릿 파일 공유). 둘 다 Expo 공식 모듈. 설치 시 `npx expo install`로 SDK 호환 버전 확인(AGENTS.md 지침대로 구현 시점에 최신 Expo 문서 확인 필요).

사진(`imageUri`)은 CSV로 옮길 수 없으므로 가져온 상품은 항상 사진 없이 등록된다 — 화면에 안내 문구로 명시.

## CSV 포맷

| 컬럼 | 필수 | 규칙 |
|---|---|---|
| `상품명` | 필수 | 비어있으면 오류 행 |
| `유통기한` | 필수 | `YYYY-MM-DD`, 형식 안 맞으면 오류 행 |
| `바코드` | 선택 | 그대로 문자열 저장, 비어있으면 `null` |
| `수량` | 선택 | 비어있으면 `1`, 값이 있는데 1 이상 정수가 아니면 오류 행 |
| `카테고리` | 선택 | 여러 개면 세미콜론(`;`)으로 구분 (콤마는 CSV 구분자라 못 씀), 각 항목 trim 후 빈 문자열 제거 |
| `메모` | 선택 | 자유 텍스트, 콤마/줄바꿈 포함 시 CSV 표준대로 큰따옴표로 감싸면 됨 |

첫 줄은 헤더(위 컬럼명 그대로)로 고정 — 헤더 이름으로 컬럼 위치를 찾으므로 순서가 바뀌어도 동작한다. 인코딩은 **UTF-8(BOM 포함)** — Windows 엑셀에서 "CSV UTF-8로 저장"했을 때 한글이 깨지지 않도록. 파싱 시 선행 BOM은 무시하고 읽는다.

## `src/lib/csv-import.ts`

```ts
export interface ParsedProductRow {
  name: string;
  expiryDate: string; // YYYY-MM-DD
  barcode: string | null;
  quantity: number;
  categories: string[];
  memo: string | null;
}

export interface RowError {
  line: number; // 1-based, 헤더 제외한 데이터 행 기준
  reason: string;
}

export interface ParsedCsvResult {
  rows: ParsedProductRow[];
  errors: RowError[];
}

/** RFC4180 최소 구현: 큰따옴표로 감싼 필드 안의 콤마/이스케이프된 큰따옴표("")만 지원.
 *  따옴표 안 줄바꿈은 지원하지 않음(템플릿이 안내하는 단순 포맷 기준). */
export function parseCsvLines(text: string): string[][];

/** parseCsvLines 결과를 헤더 기준으로 매핑하고 행별 검증까지 수행한다. */
export function parseProductCsv(text: string): ParsedCsvResult;
```

`parseProductCsv`는 헤더 행에서 필요한 6개 컬럼의 인덱스를 이름으로 찾는다. 헤더에 `상품명`이나 `유통기한` 컬럼 자체가 없으면 즉시 `{ rows: [], errors: [{ line: 0, reason: '필수 컬럼(상품명/유통기한)을 찾을 수 없습니다' }] }`를 반환하고 행 파싱을 하지 않는다.

행별 검증 순서: 상품명 trim 후 빈 문자열 → 오류("상품명이 비어있습니다"). 유통기한이 `isValidDateStr`(기존 `dates.ts` 재사용) 실패 → 오류("유통기한 형식이 올바르지 않습니다"). 수량은 빈 문자열이면 1, 값이 있으면 `Number()` 파싱 후 1 이상 정수인지 확인, 아니면 오류("수량은 1 이상 숫자여야 합니다").

## `src/app/csv-import.tsx`

화면 흐름:
1. 안내 텍스트: CSV 포맷 설명 + "사진은 가져올 수 없어요" 고지
2. **템플릿 받기** 버튼 — 하드코딩된 헤더+예시 1행 문자열을 `FileSystem.cacheDirectory`에 `.csv`로 쓰고 `Sharing.shareAsync()`로 공유(공유 시트에서 저장/전송 선택)
3. **CSV 파일 선택** 버튼 — `DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'] })`. 안드로이드는 `.csv`의 MIME 타입 인식이 기기마다 달라 `*/*`도 후보에 포함(구현 시 실기기 확인 필요 — AGENTS.md 지침대로 SDK 문서 재확인).
4. 파일 선택되면 `FileSystem.readAsStringAsync`로 읽고 `parseProductCsv` 호출 → 결과를 상태로 저장, 미리보기 표시:
   - "정상 N개 / 오류 M개" 요약
   - 오류가 있으면 최대 5개까지 "N행: 사유" 목록 + 나머지는 "외 N건"
   - 정상 행이 0개면 "가져오기" 버튼 비활성화
5. **가져오기** 버튼(정상 행 1개 이상일 때만 활성) — 확인 Alert 후 실행. `ParsedProductRow[]`를 순회하며 각각 `Product` 객체로 변환(`id: newId()`, `imageUri: null`, `status: 'active'`, `resolvedAt: null`, `createdAt: new Date().toISOString()`, `mode: getCachedAppMode() ?? 'retail'`) 후 `saveProduct()` 호출, 성공 시 `scheduleExpiryAlerts()`도 호출(둘 다 `product-form.tsx`의 저장 흐름과 동일 패턴). 한 행 저장 실패해도 `catch`로 잡고 계속 진행, 성공/실패 카운트 집계.
6. 완료 후 Alert: "118개 등록 완료, 2개 저장 실패" → 확인 누르면 대시보드로 돌아감(`router.back()`)

진행 중에는 버튼 비활성화 + `ActivityIndicator`로 저장 개수 진행 표시(기존 다른 화면의 `busy` 상태 패턴 재사용).

## `src/app/settings.tsx` 변경

"기능" 섹션의 `LinkRow` 목록에 한 줄 추가 (통계/계산기 링크와 같은 자리):

```tsx
<View className="h-px bg-line" />
<LinkRow
  icon="file-delimited-outline"
  label="CSV로 가져오기"
  onPress={() => router.push('/csv-import')}
/>
```

## 영향 없음

- 다른 화면과 독립적 — `repo.ts`, `notifications.ts`는 기존 함수를 그대로 호출만 함(수정 없음)
- 상품 내보내기(전체 백업), 사진 포함 가져오기는 이번 스코프 아님 — 다음 버전 후보
- 팀 공유/발주/캘린더 등 다른 기능과 겹치는 파일 없음

## 테스트

`csv-import.selfcheck.ts`에 케이스 작성:
- 정상 행 파싱(전체 컬럼 채움)
- 상품명 빈 문자열 → 오류
- 유통기한 형식 틀림(`2026/09/06`, `09-06-2026` 등) → 오류
- 수량 비움 → 기본값 1
- 수량이 `0`, `-1`, `abc` → 오류
- 카테고리 `"편의점;마트"` → `['편의점', '마트']`로 분리
- 메모에 콤마 포함 + 큰따옴표로 감싼 필드 → 콤마 그대로 보존돼 파싱
- 필수 컬럼(`상품명` 또는 `유통기한`) 헤더 자체가 없는 파일 → 전체 오류 반환

수동 QA 체크리스트:
1. 템플릿 받기 → 공유 시트에서 파일로 저장 → 엑셀/메모장에서 열어 한글이 안 깨지는지 확인(BOM)
2. 템플릿에 행 몇 개 추가해서 가져오기 → 대시보드에 정상 등록되는지, 유통기한 알림도 예약되는지 확인
3. 일부러 오류 섞은 CSV(빈 상품명 1행, 잘못된 날짜 1행) → 미리보기에 오류 요약이 뜨고, 나머지 정상 행만 가져와지는지 확인
4. 빈 CSV(헤더만) → "가져오기" 버튼 비활성 확인
5. 로컬 모드 / 클라우드 모드 각각에서 가져오기 동작 확인(클라우드 모드는 Supabase에 실제 반영되는지)
6. 안드로이드 실기기에서 문서 선택기가 `.csv` 파일을 정상적으로 보여주는지 확인(MIME 타입 이슈 가능성)
