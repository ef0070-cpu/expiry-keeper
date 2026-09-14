# 브랜드 좋아요/싫어요 투표 + 가격 참고정보 표시

**날짜:** 2026-09-14
**대상 프로젝트:** expiry-keeper
**전제:** `docs/superpowers/specs/2026-09-11-product-name-voting-design.md`(상품명 투표 설계, 아직 미실행)를 먼저 읽을 것 — 이 문서는 그 설계를 브랜드에 그대로 미러링하고, 가격은 다른 방식(참고정보)으로 처리한다.

## 배경 / 결정 사항

이전 세션에서 "가격/브랜드/카테고리 수정이 관리자 승인 전까지 동기화로 되돌아가는 문제"를 로컬 오버라이드 + `order_product_reports` 자동 신고로 임시 해결했다. 이후 "사진처럼 투표제로 통일하자"는 방향이 정해졌는데(안 A), 검토 결과 **가격은 상품명/브랜드와 성격이 다르다는 결론**에 도달했다:

- **상품명·브랜드**: 정답이 하나뿐인 정보 → 사진과 동일한 "후보+투표, 득표 1위가 대표값" 방식이 적합.
- **가격**: 매장마다 실제로 다를 수 있는 값(가맹점별 판매가 차이) → 득표로 하나의 "전체 대표 가격"을 강제하면 다른 매장의 정당한 가격을 밀어내는 부작용이 생긴다. 따라서 가격은 공용 대표값으로 만들지 않고, **참고정보로만 보여준다.**

## 범위

1. **브랜드 투표**: `product_name_candidates`/`product_name_votes`와 동일한 구조로 `product_brand_candidates`/`product_brand_votes` 테이블을 신설한다(이름과 필드가 다를 뿐 스키마·트리거·RLS·클라이언트 구조는 상품명 설계를 그대로 복사). `order_catalog.brand`/`barcode_catalog.brand` 양쪽에 대표값을 반영한다.
2. **가격 참고정보**: 새 테이블 없이, 이미 동기화되는 `order_catalog.price`(공용 카탈로그 값)를 로컬 상품 레코드와 별도로 노출한다. 발주 상품 수정 화면에 "참고: 공용 카탈로그 가격 1,200원" 같은 읽기 전용 텍스트를 추가한다 — **내 가격 입력값에는 절대 자동 반영하지 않는다.**
3. 카테고리는 이번 범위에 포함하지 않는다(기존 로컬 오버라이드 방식 유지 — 매장마다 진열 카테고리가 다를 수 있어 브랜드처럼 강제 통일하면 안 됨. 상품명 설계 문서의 "범위" 절과 동일한 판단).

## 브랜드 투표 — 상품명 설계와의 차이점만 기술

전부 상품명 설계 문서의 구조를 그대로 따르되, 아래만 치환한다:

| 상품명 설계 | 브랜드 버전 |
|---|---|
| `product_name_candidates` / `product_name_votes` | `product_brand_candidates` / `product_brand_votes` |
| `recalc_product_name_representative` | `recalc_product_brand_representative` |
| `barcode_catalog.name` / `order_catalog.name` 갱신 | `barcode_catalog.brand` / `order_catalog.brand` 갱신 |
| `src/lib/name-candidates.ts` | `src/lib/brand-candidates.ts` |
| `submitNameCandidateIfChanged` | `submitBrandCandidateIfChanged` |
| `NameCandidatesModal.tsx` | `BrandCandidatesModal.tsx` |
| `submittedNameCandidates:v1` | `submittedBrandCandidates:v1` |

**주의사항 (상품명과 동일하게 적용):**
- `apply_approved_order_report` 트리거에서 이번엔 `brand`도 제외해야 한다 — 상품명 설계의 마이그레이션이 이미 `name`을 뺀 버전으로 트리거를 교체했으므로, 이번엔 그 위에 `brand`까지 뺀 버전으로 한 번 더 교체한다(최종적으로 이 트리거는 `price`/`category`만 갱신).
- 백필 로직도 동일: `order_catalog`/`barcode_catalog`의 기존 brand를 0표 후보로 먼저 채운다.
- brand가 빈 문자열/null인 기존 행은 백필에서 제외한다(빈 후보를 만들지 않음).
- 발주(`order-repo.ts`)의 기존 `recordBrandOverride`/`getBrandOverrides`(이번 세션 초반에 추가한 로컬 오버라이드)는 **이 기능이 배포되면 제거 대상**이다 — 투표 결과가 대표값이 되므로 "로컬에서만 우기는" 오버라이드가 더는 필요 없다. 단, 기존 `order_product_reports` 자동 신고(가격 전용으로 축소)는 유지한다.

## 가격 참고정보 — 상세 설계

### 데이터 소스
새 테이블·마이그레이션 불필요. `syncOrderCatalog()`가 이미 매번 `order_catalog`에서 `price`를 읽어온다 — 지금은 이 값을 로컬 오버라이드로 덮어써서 화면에 안 보이게 됐지만(이번 세션 초반 수정), **덮어쓰기 전 원본 값을 별도로 보관**하면 된다.

### 저장
`order-repo.ts`에 `CATALOG_REFERENCE_PRICE_KEY = 'orderCatalogReferencePrice:v1'` (barcode → price, Record) 신설. `syncOrderCatalog()`가 override 적용 *전* 원본 `row.price`를 이 저장소에 기록한다.

```ts
// syncOrderCatalog 내부, rows 계산 직후
const referencePrices: Record<string, number> = {};
for (const row of data as OrderCatalogRow[]) {
  if (row.price != null) referencePrices[row.barcode] = row.price;
}
await AsyncStorage.setItem(CATALOG_REFERENCE_PRICE_KEY, JSON.stringify(referencePrices));
```

`getCatalogReferencePrice(barcode): Promise<number | null>` export.

### UI
`order-product-form.tsx`의 가격 입력 필드 아래에, 바코드가 있고 참고가가 내 입력값과 다를 때만:
```
참고: 공용 카탈로그 가격 1,200원 (내 매장 가격과 다를 수 있어요)
```
버튼이 아니라 순수 텍스트 — 탭해도 아무 일도 안 일어난다(자동 반영 절대 금지가 이 기능의 핵심이므로, 실수로 눌러서 덮어써지는 상호작용 자체를 안 만든다).

## 참여도

상품명 설계 문서의 "참여도를 높이는 방법" 절(득표 현황 상시 노출, 내 제안 채택 알림, 내 기여 요약)을 브랜드에도 동일 적용한다. 별도 설계 불필요.

## 테스트

상품명 설계의 테스트 시나리오 1~7을 브랜드로 치환해 동일하게 수행. 추가로:
8. 가격 참고정보 — 다른 매장이 다른 가격으로 카탈로그를 갱신해도 내 로컬 가격 입력값이 바뀌지 않고, 참고 텍스트만 갱신되는지 확인.
