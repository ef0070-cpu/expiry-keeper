# 홈 검색창 바코드 스캔 검색 — 설계

## 배경

홈 화면 검색창(`상품명, 바코드, 메모 검색`)은 현재 텍스트 입력만 지원하며, 이미 등록된 상품 목록을 클라이언트에서 로컬 필터링한다. 사용자가 매장/집에서 실물 바코드를 보고 있을 때 숫자를 직접 타이핑하기보다 카메라로 스캔해서 검색하고 싶어 한다. 또한 스캔한 바코드가 아직 등록되지 않은 상품일 경우, 외부 조회로 상품명을 찾아 보여주고 바로 등록으로 유도한다.

레퍼런스: `KakaoTalk_20260825_091231006.jpg` — 다른 앱의 검색바(뒤로가기 + 검색 인풋 + 우측 바코드 스캔 아이콘) UI.

## 범위

- 홈 검색창(`src/app/index.tsx`) 우측에 바코드 스캔 아이콘 추가
- 스캔한 바코드로 로컬 등록 상품 검색
- 로컬에 없으면 외부 조회(`lookupBarcode`)로 상품명 찾아 배너로 안내, 등록 화면 연결
- **검색창에 바코드 숫자를 직접 타이핑하는 경우는 외부 조회 트리거 대상이 아님** (스캔 아이콘 경유 시에만 외부 조회)

## 아키텍처 & 데이터 흐름

```
[홈 검색창 우측 바코드 아이콘] 탭
    → router.push('/scan?mode=search')
[scan.tsx] 카메라로 스캔 (기존 카메라/가이드/유효성 검증 로직 재사용)
    → mode=search면 lookupBarcode() 호출 없이 바로
      router.replace('/', { params: { scannedBarcode: data } })
[index.tsx] scannedBarcode 파라미터 수신
    → query state에 세팅 (기존 로컬 필터 그대로 동작: name/barcode/memo 부분일치)
    → 로컬 필터 결과가 0개면 → lookupBarcode(scannedBarcode) 호출
    → 이름을 찾으면 목록 위에 배너 표시: "바코드 조회: OOO — 등록하기"
    → 배너 탭 시 product-form으로 이동 (barcode/prefillName/prefillImage 파라미터,
      기존 scan.tsx → product-form 규격과 동일)
    → 사용자가 검색어를 직접 수정/삭제하면 배너는 사라짐
```

## 컴포넌트 변경 범위

### `src/app/scan.tsx`
- `useLocalSearchParams`에 `mode?: string` 추가
- `onScanned`에서 `mode === 'search'`일 때: `lookupBarcode` 호출 없이 바로
  `router.replace({ pathname: '/', params: { scannedBarcode: data } })`
- 하단 "바코드 없이 직접 입력" 버튼은 `mode !== 'search'`일 때만 렌더 (검색 모드에서는 의미 없음)

### `src/app/index.tsx`
- 검색창(`View` 156~171줄) 우측에 `barcode-scan` 아이콘(MaterialCommunityIcons, 기존 빈 목록 화면과 동일 아이콘) 추가
  - `onPress={() => router.push('/scan?mode=search')}`
- `useLocalSearchParams<{ scannedBarcode?: string }>()`로 파라미터 수신
- `scannedBarcode`가 바뀌면 `setQuery(scannedBarcode)`
- 로컬 필터(`sections`) 결과가 비어 있고 `scannedBarcode`가 세팅되어 있으면 `lookupBarcode(scannedBarcode)` 호출 → 결과를 `lookupResult` state(`{ name, imageUrl } | null`)에 저장
- `lookupResult.name`이 있으면 목록 최상단에 배너 렌더: "바코드 조회: {name} — 등록하기"
  - 탭 시 `router.push({ pathname: '/product-form', params: { barcode: scannedBarcode, prefillName: lookupResult.name, prefillImage: lookupResult.imageUrl ?? '' } })`
- 검색어(`query`)를 사용자가 직접 편집하면 `scannedBarcode`/`lookupResult`를 초기화해 배너 제거

## 에러 처리

`lookupBarcode`는 실패 시(네트워크 오류, 로컬 저장 모드 등) 이미 `{ name: null, imageUrl: null }`을 반환한다. 별도 에러 UI 없이 이름이 없으면 배너를 그냥 표시하지 않는다 — 기존 앱의 조용한 실패 패턴을 그대로 따른다.

## 테스트

이 저장소엔 테스트 프레임워크가 없다(jest/vitest 등 미설정). 이 기능만을 위해 새로 도입하지 않고 기존 관례대로 실기기/에뮬레이터 수동 QA로 검증한다:

1. 등록된 상품의 바코드를 스캔 → 해당 상품이 검색 결과에 나타난다
2. 미등록 바코드를 스캔 → 검색 결과는 비어 있고, 배너에 조회된 상품명이 뜬다 → 배너 탭 → product-form에 이름/사진이 prefill된다
3. 오프라인이거나 로컬 저장 모드(로그인 안 함)에서 미등록 바코드 스캔 → 배너 없이 빈 검색 결과만 보인다 (에러 알럿 없음)
4. 배너가 떠 있는 상태에서 검색어를 수동으로 지우거나 수정 → 배너가 사라진다
