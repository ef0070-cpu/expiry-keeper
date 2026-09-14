# 상품명 투표 구현 + 사진/브랜드/상품명 투표 화면 통합

**날짜:** 2026-09-15
**대상 프로젝트:** expiry-keeper
**전제:** `docs/superpowers/specs/2026-09-11-product-name-voting-design.md`(상품명 투표 백엔드 설계, 아직 미실행)를 먼저 읽을 것 — 이 문서는 그 설계의 백엔드 부분을 그대로 실행하고, UI만 이 문서에서 새로 설계한 공용 화면으로 바꾼다.

## 배경

현재 후보/투표 UI는 필드마다 독립된 모달이다:

- `PhotoCandidatesModal.tsx` — 사진 후보 보기/투표 (재고+발주 양쪽 화면)
- `BrandCandidatesModal.tsx` — 브랜드 후보 보기/투표 (발주 화면에만 있음, 재고 화면엔 브랜드 필드 자체가 없음)
- 상품명 투표는 아직 미구현 (09-11 스펙만 있음). 그대로 구현하면 `NameCandidatesModal.tsx`가 하나 더 늘어 모달이 3벌이 된다.

세 모달은 목록 렌더링·좋아요/싫어요 버튼·로딩 처리가 사실상 동일한 구조라(candidate가 `{id, likes, dislikes, myVote}` + 라벨 필드 하나), 상품명 투표를 새로 만드는 시점에 한 번에 공용 컴포넌트로 정리한다.

## 범위

1. **상품명 투표 백엔드**: 09-11 스펙을 변경 없이 그대로 실행한다(마이그레이션 SQL, `name-candidates.ts`, `repo.ts`/`order-repo.ts` 연결, `order-report.ts`의 `listNameCandidates`/`voteOnName`). 이 문서에서 다시 쓰지 않는다 — 09-11 문서가 원본이다.
2. **UI 통합**: `PhotoCandidatesModal.tsx` + `BrandCandidatesModal.tsx`를 삭제하고, 탭(사진/브랜드/상품명)이 달린 공용 `CandidatesModal.tsx` 하나로 대체한다. 09-11 스펙의 "UI (`NameCandidatesModal.tsx` 신규)" 절은 이 문서의 통합 컴포넌트로 대체된 것으로 간주한다.
3. **재고 화면(`product-form.tsx`) 확장**: 브랜드 필드가 없는 화면이지만, 공용 카탈로그의 브랜드를 보고 투표할 수 있도록 "브랜드 후보 보기/투표" 링크만 추가한다(입력칸은 만들지 않음 — 재고 로컬 상품 타입에 `brand` 컬럼을 추가하는 건 이번 범위 밖).
4. **범위 밖**: 득표 현황 상시 배지("두부 · 👍3 👎0")는 09-11 스펙대로 상품명 탭에만 우선 적용한다. 사진/브랜드 탭에 확장하는 건 별도 작업.

## 아키텍처 — 공용 `CandidatesModal`

```
src/components/CandidatesModal.tsx  (신규)
  props: { visible, barcode, initialTab: 'photo'|'brand'|'name', onClose, onPhotoApplied? }
```

- `visible`이 true로 바뀔 때마다 내부 탭 상태를 `initialTab`으로 리셋한다. 어느 필드 링크로 열렸든 그 탭이 먼저 보이지만, 상단 탭바로 자유롭게 다른 탭으로 전환할 수 있다(이게 "통합"의 핵심 — 사진 링크로 들어가도 그 자리에서 브랜드/상품명까지 확인 가능).
- 모달 껍데기(팝업 레이아웃, 탭바, 목록 스크롤, 좋아요/싫어요 버튼, 닫기 버튼)는 하나의 공용 렌더링 로직이다. 탭별 차이는 정적 설정 테이블로만 주입한다:

```ts
type Candidate = { id: string; likes: number; dislikes: number; myVote: 1 | -1 | null };

// 후보 타입은 탭마다 라벨 필드 하나씩만 다르므로(photoUri/brand/name), 공용 Candidate에
// 라벨 필드를 합치지 않는다 — 실제 구현에서는 TAB_CONFIG를 제네릭(TabConfig<C extends
// Candidate>)으로 선언해 탭별 후보 타입을 각각 넘기거나, list() 어댑터가 반환하기 전에
// 원본 필드(photoUri 등)를 유지한 채 렌더링 시점에만 타입을 좁혀 쓴다. 아래는 그 의도를
// 보여주는 의사코드이고, 타입은 계획 단계에서 확정한다.
const TAB_CONFIG: Record<'photo' | 'brand' | 'name', {
  title: string;
  list: (barcode: string) => Promise<Candidate[]>;
  vote: (candidateId: string, value: 1 | -1) => Promise<void>;
  submit: ((barcode: string, value: string) => Promise<void>) | null; // null이면 제안 입력창 숨김
  placeholder?: string;
  emptyText: string;
  renderLabel: (c: any) => ReactNode; // 사진=썸네일 Image(c.photoUri), 브랜드=Text(c.brand), 상품명=Text(c.name)
}> = {
  photo: {
    title: '사진',
    list: listPhotoCandidates,
    vote: voteOnPhoto,
    submit: null,
    emptyText: '등록된 후보 사진이 없습니다.',
    renderLabel: (c) => <Image source={{ uri: c.photoUri }} .../>,
  },
  brand: {
    title: '브랜드',
    list: listBrandCandidates,
    vote: voteOnBrand,
    submit: submitBrandCandidateIfChanged,
    placeholder: '다른 브랜드 제안하기',
    emptyText: '등록된 후보가 없습니다.',
    renderLabel: (c) => <Text>{c.brand}</Text>,
  },
  name: {
    title: '상품명',
    list: listNameCandidates,
    vote: voteOnName,
    submit: submitNameCandidateIfChanged,
    placeholder: '다른 이름 제안하기',
    emptyText: '등록된 후보가 없습니다.',
    renderLabel: (c) => <Text>{c.name}</Text>,
  },
};
```

- **사진 탭의 특수 동작(좋아요 → 내 사진으로 즉시 적용)**: 기존 `PhotoCandidatesModal`의 `vote()` 함수에 있던 "좋아요 상태가 아니었다가 좋아요를 누르면 `applyOrderProductPhoto` 호출 + `onPhotoApplied` 콜백" 로직은 그대로 유지한다. 이 부작용은 `photo` 탭에서만 실행되고, `TAB_CONFIG`의 공용 `vote` 호출 이후 `tab === 'photo'`일 때만 추가로 실행하는 방식으로 컴포넌트 안에 남긴다(설정 테이블에 넣기엔 너무 사진 전용이라 억지로 일반화하지 않는다).
- 후보 목록/좋아요·싫어요 버튼 렌더링, 로딩 스피너, "투표 실패" Alert 처리는 기존 두 모달의 로직을 그대로 옮긴다 — 새 매칭 로직은 없다.

## 화면 연결

**`order-product-form.tsx`**
- `showPhotoCandidates`/`showBrandCandidates` 두 boolean state를 `candidatesTab: 'photo' | 'brand' | 'name' | null` 하나로 교체(`null` = 닫힘).
- 기존 "사진 후보 보기/투표"(상품명 입력창 바로 아래에 이미 있음), "브랜드 후보 보기/투표"(브랜드 입력창 아래) 링크는 위치 그대로 유지하고 각각 `setCandidatesTab('photo')` / `setCandidatesTab('brand')` 호출로만 바뀐다.
- "상품명 후보 보기/투표" 링크를 신규 추가한다 — 기존 사진 링크와 같은 자리(상품명 입력창 아래)에 나란히 놓는다 (`setCandidatesTab('name')`).
- `<PhotoCandidatesModal>` + `<BrandCandidatesModal>` 두 인스턴스 → `<CandidatesModal visible={candidatesTab !== null} initialTab={candidatesTab ?? 'photo'} onClose={() => setCandidatesTab(null)} onPhotoApplied={setImageUri} />` 하나로 교체.

**`product-form.tsx`**
- 기존 "사진 후보 보기/투표" 링크 유지, `candidatesTab` state로 동일하게 교체.
- 상품명 입력창 아래에 "상품명 후보 보기/투표" 링크 신규 추가.
- 상품명 링크 옆(또는 바로 아래 줄)에 "브랜드 후보 보기/투표" 링크만 신규 추가 — 입력칸 없음. 누르면 `CandidatesModal`이 `initialTab='brand'`로 열려 공용 카탈로그의 대표 브랜드를 보고 투표만 할 수 있다.

## 구현 순서

1. `supabase/migration-product-name-voting.sql` 대시보드에서 실행 (09-11 스펙 원문 그대로)
2. `src/lib/name-candidates.ts` 신규, `order-report.ts`에 `listNameCandidates`/`voteOnName` 추가 (09-11 스펙)
3. `repo.ts` / `order-repo.ts`에 `submitNameCandidateIfChanged` 호출 연결 (09-11 스펙)
4. `src/components/CandidatesModal.tsx` 신규 작성 (기존 두 모달의 로직 이식 + 탭 추가) → `PhotoCandidatesModal.tsx`, `BrandCandidatesModal.tsx` 삭제
5. `product-form.tsx` / `order-product-form.tsx` state 및 링크 배선 교체

## 에러 처리

기존 사진/브랜드 패턴을 그대로 따른다 — 후보 제출/투표 실패는 best-effort catch(네트워크 등으로 실패해도 로컬 흐름을 막지 않음), 투표 실패만 사용자에게 `Alert`로 보여준다. 상품명 관련 에러 처리 세부사항은 09-11 스펙의 "에러 처리" 절을 따른다.

## 테스트

자동화 테스트 스위트가 없는 수동 QA 앱(기존 관례 유지). 상품명 투표 자체의 동작 확인은 09-11 스펙의 테스트 시나리오 1~7을 그대로 따른다. 이 문서에서 추가로 확인할 것:

1. 재고 화면에서 "상품명 후보 보기/투표" 링크 → 모달이 상품명 탭으로 열리는지, 탭을 눌러 사진/브랜드 탭으로도 전환되는지 확인
2. 재고 화면에서 "브랜드 후보 보기/투표" 링크 → 브랜드 탭으로 바로 열리는지, 입력칸이 화면(폼)에는 없지만 모달 안에서는 제안 입력창이 정상 동작하는지 확인
3. 발주 화면에서 사진 탭 좋아요 → 기존과 동일하게 내 사진으로 즉시 반영되는지(다른 탭 전환 후에도 이 부작용이 사진 탭에서만 일어나는지) 확인
4. 재고/발주 두 화면 모두에서 모달을 닫았다 다시 다른 필드 링크로 열었을 때, 탭이 매번 그 필드에 맞게 초기화되는지 확인 (이전 탭이 남아있지 않아야 함)
