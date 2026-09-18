# 발주 상품 CSV 가져오기 (유통기한 CSV와 완전 분리)

## 배경

현재 "CSV로 가져오기"는 설정 화면에 하나만 있고, 유통기한(재고) 상품(`Product`/`saveProduct`)
전용이다. 발주 상품(`OrderProduct`/`saveOrderProduct`)을 CSV로 한 번에 등록하는 기능은
아직 없다. 이번 작업은 발주 상품 전용 CSV 가져오기를 새로 만들되, 화면·파서·저장 로직·
진입점을 유통기한 쪽과 완전히 분리한다(서로 import/재사용하는 부분은 순수 범용 CSV
토크나이저 하나뿐).

## 범위

- **새로 만드는 것**: 발주 상품 CSV 가져오기 화면 + 파서 + 발주관리 화면의 진입점.
- **손대지 않는 것**: 기존 유통기한 CSV 가져오기(`csv-import.tsx`, `csv-import.ts`, 설정
  화면 진입점), "기본 상품 불러오기(아이스크림 388종)" 시드 데이터(`order-seed-data.ts`) —
  이미 발주 전용이라 그대로 둠.

## 데이터 계층

`src/lib/order-csv-import.ts` (신규):

- `parseCsvLines`(`@/lib/csv-import`에서 재사용 — 따옴표/CRLF/BOM 처리하는 순수 CSV
  토크나이저, 도메인 지식 없음)로 줄 단위 필드 배열을 얻는다.
- `parseOrderProductCsv(text): { rows: ParsedOrderProductRow[]; errors: RowError[] }` 추가.
  컬럼(헤더 이름으로 위치 탐색, 순서 무관): `상품명`(필수) · `브랜드` · `가격` · `카테고리` ·
  `바코드` · `별칭`(세미콜론 구분 — 발주 화면의 카테고리/별칭 표기 관례와 동일).
  - `상품명` 없으면 그 행 오류.
  - `가격`은 비어 있으면 0, 있으면 음수가 아닌 숫자여야 함(아니면 오류).
  - 나머지는 전부 선택 — 비어 있으면 빈 문자열/`null`/빈 배열.

## UI

`src/app/order-csv-import.tsx` (신규, 기존 `csv-import.tsx`와 같은 화면 구조를 따름):

1. "템플릿 받기" — 지난 세션에서 고친 Android SAF 다운로드 방식(선택한 폴더에 직접 저장)을
   그대로 재사용. 템플릿 헤더: `상품명,브랜드,가격,카테고리,바코드,별칭`.
2. "CSV 파일 선택" → `parseOrderProductCsv`로 파싱 → 정상/오류 건수와 오류 목록(최대 5개) 미리보기.
3. "N개 가져오기" 확인 → 진행 중(진행률 표시) → 각 행마다:
   - `saveOrderProduct()`(기존 발주 상품 저장 — 바코드 중복이면 병합, 클라우드 동기화 등
     기존 등록 로직 그대로 재사용)로 저장.
   - CSV에만 있고 기존 카테고리 목록에 없는 카테고리 문자열은 `addOrderCategory()`로 자동
     등록(수동으로 상품 등록할 때와 동일하게 필터 칩에 바로 보이도록).
4. 완료 화면: 성공/실패 건수, 실패 시 첫 실패 사유.

## 진입점

`order.tsx` 헤더에 CSV 아이콘(`file-delimited-outline`, 설정 화면과 동일 아이콘) 추가 →
`/order-csv-import`로 이동. `_layout.tsx`에 라우트 등록.

## 에러 처리

기존 유통기한 CSV 가져오기와 동일한 관례: 파일 읽기/파싱 실패는 `Alert.alert`, 행별 저장
실패는 계속 진행하며 개수만 집계(첫 실패 사유만 보존) — 한 행 실패로 전체를 막지 않는다.

## 테스트

`order-csv-import.selfcheck.ts`(신규, 기존 `csv-import.selfcheck.ts`와 같은 패턴) —
정상 파싱, 상품명 누락 오류, 가격 음수/비숫자 오류, 별칭 세미콜론 분리, 빈 파일 처리를
assert로 확인.
