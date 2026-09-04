# 계산기 탭 전환(원가/일반) 설계

**날짜:** 2026-09-04
**대상 프로젝트:** expiry-keeper

## 배경

현재 앱의 계산기 기능(`src/app/margin-calculator.tsx`)은 원가/마진율/판매가 3개 필드 중
2개를 입력하면 나머지 1개를 자동 계산해주는 "원가 계산기"만 제공한다. 설정 화면에서
"원가 계산기" 메뉴로 진입한다.

사용자는 여기에 사칙연산을 지원하는 "일반 계산기"도 추가해서, 하나의 화면에서 탭으로
둘을 오가며 쓰고 싶어한다. 홈 디렉토리에 이미 만들어둔 독립 웹 계산기
(`calculator/index.html`, Vanilla JS)가 있고, 일반 계산기의 기능 범위와 동작 규칙은
이것과 동일하게 맞추기로 확정했다(사용자 확정 사항).

## 범위

- **대상 화면:** `src/app/margin-calculator.tsx` 하나. 새 라우트를 만들지 않는다 — 파일명,
  경로(`/margin-calculator`) 모두 유지하고 화면 내부에 탭만 추가한다.
- 설정 화면(`src/app/settings.tsx`)의 메뉴 라벨만 "원가 계산기" → "계산기"로 변경한다.
  아이콘(`calculator-variant-outline`)과 이동 경로는 그대로 둔다.
- 일반 계산기의 기능/규칙은 `calculator/index.html`의 로직을 그대로 이식한다(아래 상세).
- 두 계산기 탭의 입력 상태는 화면에 머무는 동안 서로 독립적으로 유지된다(탭 전환 시
  초기화되지 않음). 화면을 벗어났다 다시 들어오면(=컴포넌트 재마운트) 둘 다 초기화된다 —
  기존 원가 계산기와 동일한 기존 동작.

## 아키텍처 / 데이터 흐름

```
src/app/margin-calculator.tsx (수정)
  const [mode, setMode] = useState<'cost' | 'general'>('cost')
  두 계산기의 상태(훅)는 항상 함께 마운트되어 있고, mode에 따라 렌더링만 분기한다
    (기존 원가 계산기 상태/로직은 그대로, 새 일반 계산기 상태만 추가)

  상단: 탭 버튼 [원가 계산기] [일반 계산기] — 이 화면 전용, 재사용 컴포넌트로 뽑지 않음
        (사용처가 여기 하나뿐이라 컴포넌트 분리는 과함 — YAGNI)

  mode === 'cost'  → 기존 원가 계산기 UI 그대로 렌더
  mode === 'general' → 새 일반 계산기 UI 렌더, src/lib/general-calculator.ts 호출

src/lib/general-calculator.ts (신규, 순수 함수)
  calculator/index.html의 current/previous/operator/shouldResetScreen
  상태 전이 로직을 그대로 이식 (아래 "일반 계산기 로직" 참고)

src/lib/general-calculator.selfcheck.ts (신규)
  기존 src/lib/korean-search.selfcheck.ts 패턴과 동일하게 console.assert 기반 검증
```

## 일반 계산기 로직 (`src/lib/general-calculator.ts`)

`calculator/index.html`의 동작을 100% 그대로 옮긴다. 상태는 컴포넌트가 아니라 이 모듈이
정의한 순수 타입/함수로 관리해 UI와 분리한다.

```ts
type GeneralCalcState = {
  current: string;
  previous: string;
  operator: '+' | '-' | '*' | '/' | null;
  shouldResetScreen: boolean;
};

const initialState: GeneralCalcState; // current: '0', 나머지 빈 값/false

function inputDigit(state, digit: string): GeneralCalcState;
function inputDot(state): GeneralCalcState;
function setOperator(state, op): GeneralCalcState; // 연산자 이미 있으면 먼저 calculate(chain:true)
function calculate(state, chain = false): GeneralCalcState;
function clearAll(state): GeneralCalcState;
function toggleSign(state): GeneralCalcState;
function percent(state): GeneralCalcState;
```

규칙(원본과 동일):
- 입력 자릿수 12자 제한 (`current.length > 12`면 자름)
- 결과는 `toFixed(10)` 후 `parseFloat`로 정규화, 그래도 12자 넘으면 `toPrecision(8)`로 축약
- 0으로 나누면 `current = '오류'`, `operator = null`, 연산식 표시 비움
- `toggleSign`/`percent`는 `current === '오류'`일 때 아무 동작 안 함(가드)
- 연산자를 연달아 누르면(`1 + 2 +` 형태) 직전 계산을 `chain:true`로 먼저 수행 후 새 연산자 반영
- 소수점은 `current`에 이미 `.`이 있으면 무시(중복 방지)

컴포넌트(`margin-calculator.tsx`)는 이 함수들만 호출하는 얇은 어댑터로, `useState<GeneralCalcState>`
하나로 상태를 들고 키 입력마다 해당 함수를 호출해 교체한다.

## UI

**탭 버튼** (헤더 아래, 화면 콘텐츠 위)
- 가로 2분할 Pressable 2개, 선택된 탭은 `border-primary` + `text-primary`, 나머지는
  `border-line` + `text-ink` (기존 원가 계산기 입력창의 `activeField === f.key` 강조 패턴과 동일 톤)

**일반 계산기 디스플레이**
- 기존 원가 계산기 입력창과 같은 박스 스타일(`rounded-xl border border-line bg-paper`) 재사용,
  단 읽기 전용 표시 영역:
  - 위: 작은 텍스트(연산식, 예: `12,000 +`) — `text-ink`의 옅은 톤(예: 회색 계열, 기존 앱
    보조텍스트 색상 재사용)
  - 아래: 큰 굵은 텍스트(`current` 값, 숫자는 `toLocaleString('ko-KR')`로 천단위 콤마 표시.
    단 `오류` 상태는 그대로 표시)

**일반 계산기 키패드**
- 5행 4열, 기존 원가 계산기 키패드 버튼 스타일(`rounded-xl border border-line bg-paper py-4`)
  그대로 재사용:
  1. `AC` `+/-` `%` `÷`
  2. `7` `8` `9` `×`
  3. `4` `5` `6` `−`
  4. `1` `2` `3` `+`
  5. `0`(2칸 병합) `.` `=`
- 연산자 키(`÷ × − +`)는 `border-primary` + `text-primary`로 구분
- `=` 키만 `bg-primary` 채움 + 흰 텍스트로 강조
- 숫자/`AC`/`.` 키는 기존과 동일한 중립 스타일
- 백스페이스(⌫) 키는 없음 — 원본 웹 계산기와 동일하게 AC만 제공(원본 범위 그대로 이식,
  추가 요청 없으면 확장 안 함)

## 에러 처리

- 계산 로직 자체에 사용자 입력 검증은 필요 없음(숫자 키패드로만 입력되므로 잘못된 문자
  입력 경로 자체가 없음 — 원본 웹 계산기와 동일 전제).
- 0으로 나누기는 위 "규칙"대로 `'오류'` 표시로 처리(예외 throw 없음, 원본과 동일).

## 테스트

이 앱은 자동화 테스트 스위트가 없는 수동 QA 앱(기존 관례 유지). 순수 로직만
`src/lib/general-calculator.selfcheck.ts`로 검증한다:

- 기본 사칙연산 4종 (예: 7+8, 20-5, 6*7, 20/4)
- 연속 계산 (`1 + 2 + 3 =` → 6)
- 0으로 나누기 → `'오류'`
- 소수점 중복 입력 방지 (`1.5.` 입력 시도 → `1.5` 유지)
- 12자리 초과 입력 시 잘림
- `percent`/`toggleSign`이 `'오류'` 상태에서 무시되는지

구현 후 수동 확인:
1. 설정 → "계산기" 진입 시 기존과 동일하게 원가 계산기 탭이 기본으로 보이는지
2. 탭 전환 후 각 탭에 입력해둔 값이 서로 안 사라지는지
3. 일반 계산기로 `calculator/index.html`과 같은 입력을 넣었을 때 결과가 동일한지
   (특히 연속계산, 0나누기, 퍼센트)
