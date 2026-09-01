# 사진 일괄 재검색 (설정 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 화면에 "사진 일괄 재검색" 항목을 추가해, 바코드가 있고 사진이 없거나 예전 방식(상품명)으로 찾은 상품들을 새 바코드 우선 로직으로 다시 검색해 반영한다.

**Architecture:** `src/app/settings.tsx`에 상태 2개(`rescanning`, `rescanProgress`)와 함수 `rescanImages()`를 추가한다. 대상 판정은 `imageUri`가 `http`로 시작하는지로 사진 출처(웹검색 vs 로컬 촬영)를 구분한다. 순차 처리 + 딜레이로 외부 API 과부하를 피한다.

**Tech Stack:** React Native, TypeScript. 새 의존성 없음 — 기존 `listProducts`/`saveProduct`(`@/lib/repo`), `lookupBarcode`(`@/lib/barcode-lookup`) 재사용.

## Global Constraints

- 이 저장소엔 테스트 프레임워크가 없다 — 완료 확인은 `npx tsc --noEmit` + 실기기 수동 QA.
- 대상 = `barcode`가 있고(공백 아님) **AND** (`imageUri`가 없음 **OR** `imageUri`가 `http`로 시작). 로컬 파일 경로 사진은 절대 덮어쓰지 않는다.
- 순차 처리, 상품 간 250ms 대기.
- 클라우드 모드(`isCloudMode`)일 때만 이 항목을 노출한다.

---

### Task 1: `src/app/settings.tsx` — 일괄 재검색 기능

**Files:**
- Modify: `src/app/settings.tsx` (import 추가, state/함수 추가, "기능" 섹션 JSX 추가)

**Interfaces:**
- Consumes: `listProducts(): Promise<Product[]>`, `saveProduct(p: Product): Promise<Product>` (`@/lib/repo`), `lookupBarcode(barcode: string): Promise<BarcodeInfo>` (`@/lib/barcode-lookup`)
- Produces: 없음 (최종 사용자 대면 UI)

- [ ] **Step 1: import 추가**

기존 (파일 상단 import 블록):

```tsx
import { ddayLabel } from '@/lib/dates';
import { rescheduleAllExpiryAlerts } from '@/lib/notifications';
```

다음으로 교체:

```tsx
import { lookupBarcode } from '@/lib/barcode-lookup';
import { ddayLabel } from '@/lib/dates';
import { rescheduleAllExpiryAlerts } from '@/lib/notifications';
import { listProducts, saveProduct } from '@/lib/repo';
```

- [ ] **Step 2: state + 함수 추가**

`Settings` 컴포넌트 안, `const [deleting, setDeleting] = useState(false);` 바로 다음 줄에 추가:

```tsx
  const [rescanning, setRescanning] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
```

`deleteAccount` 함수 다음(그 함수가 끝나는 `};` 다음 줄)에 추가:

```tsx
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const rescanImages = async () => {
    const products = await listProducts();
    const targets = products.filter(
      (p) => p.barcode?.trim() && (!p.imageUri || p.imageUri.startsWith('http')),
    );
    if (targets.length === 0) {
      Alert.alert('재검색할 상품 없음', '조건에 맞는 상품이 없습니다.');
      return;
    }
    Alert.alert(
      '사진 일괄 재검색',
      `${targets.length}개 상품을 대상으로 새 로직으로 사진을 다시 찾습니다. 직접 등록한 사진은 바뀌지 않습니다. 진행할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '진행',
          onPress: async () => {
            setRescanning(true);
            setRescanProgress({ done: 0, total: targets.length });
            try {
              let updated = 0;
              for (let i = 0; i < targets.length; i++) {
                const p = targets[i];
                const info = await lookupBarcode(p.barcode!.trim());
                if (info.imageUrl && info.imageUrl !== p.imageUri) {
                  await saveProduct({ ...p, imageUri: info.imageUrl });
                  updated++;
                }
                setRescanProgress({ done: i + 1, total: targets.length });
                await sleep(250);
              }
              Alert.alert('완료', `${targets.length}개 중 ${updated}개 사진이 업데이트됐습니다.`);
            } catch (e) {
              Alert.alert('재검색 실패', e instanceof Error ? e.message : '알 수 없는 오류');
            } finally {
              setRescanning(false);
              setRescanProgress(null);
            }
          },
        },
      ],
    );
  };
```

- [ ] **Step 3: "기능" 섹션에 항목 추가**

기존:

```tsx
      <SectionTitle text="기능" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        <LinkRow
          icon="chart-box-outline"
          label="소진·폐기 통계"
          onPress={() => router.push('/stats')}
        />
        {isCloudMode ? (
          <>
            <View className="h-px bg-line" />
            <LinkRow
              icon="account-group-outline"
              label={mode === 'home' ? '가족 공유 (팀 설정)' : '팀 설정'}
              onPress={() => router.push('/team')}
            />
          </>
        ) : null}
      </View>
```

다음으로 교체:

```tsx
      <SectionTitle text="기능" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        <LinkRow
          icon="chart-box-outline"
          label="소진·폐기 통계"
          onPress={() => router.push('/stats')}
        />
        {isCloudMode ? (
          <>
            <View className="h-px bg-line" />
            <LinkRow
              icon="account-group-outline"
              label={mode === 'home' ? '가족 공유 (팀 설정)' : '팀 설정'}
              onPress={() => router.push('/team')}
            />
            <View className="h-px bg-line" />
            {rescanning ? (
              <View className="flex-row items-center justify-center p-4">
                <ActivityIndicator color="#CC2222" size="small" />
                <Text className="text-muted ml-2 text-sm">
                  사진 재검색 중... {rescanProgress ? `${rescanProgress.done}/${rescanProgress.total}` : ''}
                </Text>
              </View>
            ) : (
              <LinkRow icon="image-search-outline" label="사진 일괄 재검색" onPress={rescanImages} />
            )}
          </>
        ) : null}
      </View>
```

- [ ] **Step 4: 타입체크**

Run: `cd C:\Users\USER\expiry-keeper && npx tsc --noEmit`
Expected: `src/app/login.tsx(110,45)`의 기존 무관 에러 1건 외에 새 에러 없음.

- [ ] **Step 5: 수동 QA (스펙 6가지 시나리오)**

`npx expo start` 연결된 상태에서:

1. 바코드 있고 사진 없는 상품 → 재검색 후 사진이 채워지는지
2. 바코드 있고 `http` 이미지가 이미 있는 상품 → 재검색 후 이미지가 갱신/유지되는지
3. 카메라로 직접 찍은 사진(로컬 경로) 상품 → 재검색 후에도 사진이 그대로인지
4. 바코드 없는 상품 → 대상에서 제외되는지
5. 대상 0개 상태에서 버튼 탭 → "재검색할 상품이 없습니다" 안내만 뜨는지
6. 진행 중 "N/M" 카운트, 완료 후 요약 팝업 숫자가 맞는지

- [ ] **Step 6: Commit**

```bash
cd C:\Users\USER\expiry-keeper
git add src/app/settings.tsx
git commit -m "feat: 설정 화면에 사진 일괄 재검색 기능 추가"
```

---

## Self-Review Notes

- **스펙 커버리지**: 대상 판정 규칙(Step 2), 확인 팝업 + 0개 예외(Step 2), 순차 처리 + 250ms 딜레이(Step 2), 진행 표시(Step 3), 완료 요약(Step 2), 클라우드 모드 조건부 노출(Step 3) — 스펙 전체 커버됨.
- **타입 일관성**: `Product`/`BarcodeInfo` 타입은 기존 정의 그대로 사용, 새 타입 정의 없음.
- **플레이스홀더 없음**: 모든 스텝이 실제 전체 코드로 작성됨.
