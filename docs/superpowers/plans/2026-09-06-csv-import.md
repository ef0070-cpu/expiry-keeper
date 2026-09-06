# CSV 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엑셀 등에서 저장한 CSV 파일로 상품을 한 번에 여러 개 등록할 수 있는 "CSV 가져오기" 화면을 추가한다.

**Architecture:** 순수 로직(`src/lib/csv-import.ts` — CSV 파싱 + 행 검증 + `Product` 매핑)과 화면(`src/app/csv-import.tsx` — 파일 선택/미리보기/저장 실행)을 분리한다. 저장은 기존 `repo.ts`의 `saveProduct()`와 `notifications.ts`의 `scheduleExpiryAlerts()`를 그대로 재사용해 로컬/클라우드 모드 자동 전환, 알림 예약을 별도 구현 없이 따른다.

**Tech Stack:** React Native + Expo Router, NativeWind. 신규 의존성: `expo-document-picker`(파일 선택), `expo-sharing`(템플릿 파일 공유). `expo-file-system`은 이미 설치돼 있음(v19, `File`/`Directory`/`Paths` 클래스 기반 신규 API).

## Global Constraints

- 이 프로젝트는 자동화 테스트 스위트가 없는 수동 QA 앱 — 순수 로직만 `*.selfcheck.ts`(`console.assert` 기반, `npx tsx`로 실행)로 검증하고, 나머지는 `npx tsc --noEmit` + 수동 시나리오로 검증한다(기존 관례, 예: `korean-search.selfcheck.ts`).
- CSV 인코딩은 UTF-8(BOM 포함) — Windows 엑셀 호환을 위해 템플릿 생성 시 BOM을 붙이고, 파싱 시 선행 BOM은 제거한다.
- 카테고리 여러 개는 세미콜론(`;`)으로 구분한다(콤마는 CSV 구분자라 못 씀).
- 바코드 중복 검사 없음 — 항상 새 상품으로 추가한다(사용자 확인 사항).
- 오류가 있는 행은 건너뛰고 정상 행만 가져온다 — 파일 전체를 거부하지 않는다(사용자 확인 사항).
- 사진(`imageUri`)은 CSV로 옮길 수 없다 — 가져온 상품은 항상 사진 없이 등록된다.
- AGENTS.md 지침: Expo API가 최근 크게 바뀌었으므로, 새 패키지(`expo-document-picker`) 설치 직후 실제 설치된 타입 정의를 확인하고 코드를 맞춘다(아래 Task 3에 확인 단계 포함).
- 참고 스펙 문서: `docs/superpowers/specs/2026-09-06-csv-import-design.md`

---

### Task 1: CSV 줄 단위 파서 (`parseCsvLines`)

**Files:**
- Create: `src/lib/csv-import.ts`
- Create: `src/lib/csv-import.selfcheck.ts`

**Interfaces:**
- Consumes: 없음 (순수 문자열 처리)
- Produces: `parseCsvLines(text: string): string[][]` — BOM 제거, CRLF/CR 정규화, 빈 줄 제거, 큰따옴표로 감싼 필드 안의 콤마/이스케이프된 큰따옴표(`""`)를 올바르게 처리하는 최소 RFC4180 파서. 따옴표 안 줄바꿈은 지원하지 않음.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`src/lib/csv-import.selfcheck.ts`:

```ts
import { parseCsvLines } from './csv-import';

console.assert(
  JSON.stringify(parseCsvLines('a,b,c\n1,2,3')) === JSON.stringify([['a', 'b', 'c'], ['1', '2', '3']]),
  '기본 콤마 분리 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('상품명,메모\n딸기,"콤마, 포함 메모"')) ===
    JSON.stringify([['상품명', '메모'], ['딸기', '콤마, 포함 메모']]),
  '따옴표 안 콤마 보존 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('a,b\n"이스케이프""따옴표""",c')) ===
    JSON.stringify([['a', 'b'], ['이스케이프"따옴표"', 'c']]),
  '이스케이프된 따옴표 처리 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('﻿a,b\n1,2')) === JSON.stringify([['a', 'b'], ['1', '2']]),
  'BOM 제거 실패',
);
console.assert(
  JSON.stringify(parseCsvLines('a,b\r\n1,2\r\n')) === JSON.stringify([['a', 'b'], ['1', '2']]),
  'CRLF 처리 및 끝 빈 줄 제거 실패',
);

console.log('csv-import selfcheck OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx tsx src/lib/csv-import.selfcheck.ts`
Expected: `Cannot find module './csv-import'` 류의 에러 (아직 `csv-import.ts`가 없음)

- [ ] **Step 3: 최소 구현 작성**

`src/lib/csv-import.ts`:

```ts
export function parseCsvLines(text: string): string[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return clean
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseCsvLine);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx tsx src/lib/csv-import.selfcheck.ts`
Expected: 마지막 줄에 `csv-import selfcheck OK`, 어떤 `Assertion failed` 라인도 없음(Node의 `console.assert`는 실패해도 프로세스를 종료시키지 않으므로 출력을 직접 눈으로 확인할 것)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/csv-import.ts src/lib/csv-import.selfcheck.ts
git commit -m "feat: CSV 줄 단위 파서 추가"
```

---

### Task 2: 상품 CSV 검증/매핑 (`parseProductCsv`)

**Files:**
- Modify: `src/lib/csv-import.ts`
- Modify: `src/lib/csv-import.selfcheck.ts`

**Interfaces:**
- Consumes: `parseCsvLines(text: string): string[][]` (Task 1), `isValidDateStr(s: string): boolean` (기존 `src/lib/dates.ts`)
- Produces:
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
  export function parseProductCsv(text: string): ParsedCsvResult;
  ```

- [ ] **Step 1: 실패하는 테스트부터 추가**

`src/lib/csv-import.selfcheck.ts`의 `console.log('csv-import selfcheck OK');` 줄 **바로 앞**에 아래 블록을 추가:

```ts
import { parseProductCsv } from './csv-import'; // 위 import 줄에 합쳐서 추가

// parseProductCsv - 정상 케이스
{
  const csv =
    '상품명,유통기한,바코드,수량,카테고리,메모\n딸기우유,2026-12-31,8801234567890,3,편의점;마트,메모입니다';
  const result = parseProductCsv(csv);
  console.assert(result.errors.length === 0, '정상 행에서 오류 발생하면 안 됨');
  console.assert(result.rows.length === 1, '정상 행 1개 파싱돼야 함');
  const row = result.rows[0];
  console.assert(row.name === '딸기우유', '상품명 파싱 실패');
  console.assert(row.expiryDate === '2026-12-31', '유통기한 파싱 실패');
  console.assert(row.barcode === '8801234567890', '바코드 파싱 실패');
  console.assert(row.quantity === 3, '수량 파싱 실패');
  console.assert(
    JSON.stringify(row.categories) === JSON.stringify(['편의점', '마트']),
    '카테고리 세미콜론 분리 실패',
  );
  console.assert(row.memo === '메모입니다', '메모 파싱 실패');
}

// 상품명 빈 문자열 -> 오류
{
  const result = parseProductCsv('상품명,유통기한\n,2026-12-31');
  console.assert(result.rows.length === 0, '빈 상품명 행은 저장되면 안 됨');
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('상품명'),
    '상품명 빈 오류 메시지 확인 실패',
  );
}

// 유통기한 형식 오류
{
  const result = parseProductCsv('상품명,유통기한\n딸기우유,2026/12/31');
  console.assert(result.rows.length === 0, '잘못된 날짜 행은 저장되면 안 됨');
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('유통기한'),
    '유통기한 형식 오류 메시지 확인 실패',
  );
}

// 수량 비움 -> 기본값 1
{
  const result = parseProductCsv('상품명,유통기한,수량\n딸기우유,2026-12-31,');
  console.assert(result.rows.length === 1 && result.rows[0].quantity === 1, '수량 비면 기본값 1이어야 함');
}

// 수량 오류 케이스
for (const bad of ['0', '-1', 'abc']) {
  const result = parseProductCsv(`상품명,유통기한,수량\n딸기우유,2026-12-31,${bad}`);
  console.assert(result.rows.length === 0, `수량 ${bad}은 오류여야 함`);
  console.assert(
    result.errors.length === 1 && result.errors[0].reason.includes('수량'),
    `수량 ${bad} 오류 메시지 확인 실패`,
  );
}

// 필수 헤더 없음
{
  const result = parseProductCsv('이름,날짜\n딸기우유,2026-12-31');
  console.assert(result.rows.length === 0 && result.errors.length === 1, '필수 컬럼 없으면 오류 1건만 반환');
  console.assert(result.errors[0].line === 0, '헤더 오류는 line 0');
}

// 여러 행 중 일부만 오류 -> 나머지는 정상 처리
{
  const csv = ['상품명,유통기한', '딸기우유,2026-12-31', ',2026-12-31', '초코파이,2026-11-01'].join('\n');
  const result = parseProductCsv(csv);
  console.assert(result.rows.length === 2, '오류 행 제외하고 정상 행 2개 파싱돼야 함');
  console.assert(result.errors.length === 1 && result.errors[0].line === 2, '2번째 데이터 행이 오류로 잡혀야 함');
}
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx tsx src/lib/csv-import.selfcheck.ts`
Expected: `parseProductCsv`가 아직 없어 타입/런타임 에러 발생

- [ ] **Step 3: 최소 구현 작성**

`src/lib/csv-import.ts` 맨 아래에 추가(`parseCsvLines`/`parseCsvLine`는 그대로 둠):

```ts
import { isValidDateStr } from './dates';

export interface ParsedProductRow {
  name: string;
  expiryDate: string;
  barcode: string | null;
  quantity: number;
  categories: string[];
  memo: string | null;
}

export interface RowError {
  line: number;
  reason: string;
}

export interface ParsedCsvResult {
  rows: ParsedProductRow[];
  errors: RowError[];
}

export function parseProductCsv(text: string): ParsedCsvResult {
  const lines = parseCsvLines(text);
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, reason: '파일이 비어있습니다' }] };
  }

  const header = lines[0].map((h) => h.trim());
  const nameIdx = header.indexOf('상품명');
  const expiryIdx = header.indexOf('유통기한');
  if (nameIdx === -1 || expiryIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 0, reason: '필수 컬럼(상품명/유통기한)을 찾을 수 없습니다' }],
    };
  }
  const barcodeIdx = header.indexOf('바코드');
  const quantityIdx = header.indexOf('수량');
  const categoriesIdx = header.indexOf('카테고리');
  const memoIdx = header.indexOf('메모');

  const rows: ParsedProductRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i];
    const line = i;
    const name = (cols[nameIdx] ?? '').trim();
    if (!name) {
      errors.push({ line, reason: '상품명이 비어있습니다' });
      continue;
    }
    const expiryDate = (cols[expiryIdx] ?? '').trim();
    if (!isValidDateStr(expiryDate)) {
      errors.push({ line, reason: '유통기한 형식이 올바르지 않습니다' });
      continue;
    }
    const quantityRaw = (quantityIdx === -1 ? '' : (cols[quantityIdx] ?? '')).trim();
    let quantity = 1;
    if (quantityRaw !== '') {
      const parsed = Number(quantityRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        errors.push({ line, reason: '수량은 1 이상 숫자여야 합니다' });
        continue;
      }
      quantity = parsed;
    }
    const barcodeRaw = (barcodeIdx === -1 ? '' : (cols[barcodeIdx] ?? '')).trim();
    const categoriesRaw = (categoriesIdx === -1 ? '' : (cols[categoriesIdx] ?? '')).trim();
    const memoRaw = (memoIdx === -1 ? '' : (cols[memoIdx] ?? '')).trim();

    rows.push({
      name,
      expiryDate,
      barcode: barcodeRaw || null,
      quantity,
      categories: categoriesRaw
        ? categoriesRaw.split(';').map((c) => c.trim()).filter((c) => c.length > 0)
        : [],
      memo: memoRaw || null,
    });
  }

  return { rows, errors };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx tsx src/lib/csv-import.selfcheck.ts`
Expected: 마지막 줄에 `csv-import selfcheck OK`, assertion 실패 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/csv-import.ts src/lib/csv-import.selfcheck.ts
git commit -m "feat: 상품 CSV 검증/매핑 로직 추가"
```

---

### Task 3: CSV 가져오기 화면

**Files:**
- Modify: `package.json` (의존성 추가)
- Create: `src/app/csv-import.tsx`

**Interfaces:**
- Consumes: `parseProductCsv`, `ParsedProductRow` (Task 2, `@/lib/csv-import`); `newId`, `saveProduct` (기존 `@/lib/repo`); `scheduleExpiryAlerts` (기존 `@/lib/notifications`); `getCachedAppMode` (기존 `@/lib/settings`); `Product` (기존 `@/lib/types`)
- Produces: 라우트 `/csv-import` (Task 4가 이 경로로 링크를 건다)

- [ ] **Step 1: 의존성 설치**

```bash
npx expo install expo-document-picker expo-sharing
```

- [ ] **Step 2: 설치된 타입 확인** (AGENTS.md 지침 — Expo API 변경이 잦으므로 실제 설치본 기준으로 확인)

```bash
cat node_modules/expo-document-picker/build/DocumentPicker.types.d.ts
```

`getDocumentAsync` 결과가 `{ canceled: boolean; assets: DocumentPickerAsset[] | null }` 형태이고 `DocumentPickerAsset`에 `uri`/`name`/`mimeType` 필드가 있는지 확인한다. 만약 실제 타입이 이와 다르면(예: 필드명이 다르거나 구버전 `{ type: 'success' | 'cancel' }` 형태라면) 아래 Step 3 코드의 `pickFile` 함수만 그 타입에 맞게 조정한다 — 나머지 로직은 동일하다.

- [ ] **Step 3: 화면 작성**

`src/app/csv-import.tsx`:

```tsx
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ParsedProductRow, parseProductCsv } from '@/lib/csv-import';
import { scheduleExpiryAlerts } from '@/lib/notifications';
import { newId, saveProduct } from '@/lib/repo';
import { getCachedAppMode } from '@/lib/settings';
import { Product } from '@/lib/types';

const TEMPLATE_CSV =
  '﻿상품명,유통기한,바코드,수량,카테고리,메모\n' +
  '딸기우유,2026-12-31,8801234567890,3,냉장;유제품,예시 행입니다. 지우고 사용하세요\n';

type ImportState =
  | { step: 'idle' }
  | { step: 'parsed'; rows: ParsedProductRow[]; errors: { line: number; reason: string }[] }
  | { step: 'importing'; total: number; done: number }
  | { step: 'done'; success: number; failed: number };

export default function CsvImportScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ImportState>({ step: 'idle' });

  const shareTemplate = async () => {
    try {
      const file = new File(Paths.cache, 'expiry-keeper-template.csv');
      if (file.exists) file.delete();
      file.create();
      file.write(TEMPLATE_CSV);
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('공유 불가', '이 기기에서는 파일 공유를 지원하지 않아요.');
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '템플릿을 만들지 못했어요.');
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const picked = new File(result.assets[0].uri);
      const text = await picked.text();
      const { rows, errors } = parseProductCsv(text);
      setState({ step: 'parsed', rows, errors });
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '파일을 읽지 못했어요.');
    }
  };

  const runImport = async (rows: ParsedProductRow[]) => {
    setState({ step: 'importing', total: rows.length, done: 0 });
    let success = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const product: Product = {
          id: newId(),
          barcode: row.barcode,
          name: row.name,
          imageUri: null,
          expiryDate: row.expiryDate,
          categories: row.categories,
          memo: row.memo,
          quantity: row.quantity,
          status: 'active',
          resolvedAt: null,
          createdAt: new Date().toISOString(),
          mode: getCachedAppMode() ?? 'retail',
        };
        await saveProduct(product);
        await scheduleExpiryAlerts(product);
        success++;
      } catch {
        failed++;
      }
      setState((prev) => (prev.step === 'importing' ? { ...prev, done: prev.done + 1 } : prev));
    }
    setState({ step: 'done', success, failed });
  };

  const confirmImport = (rows: ParsedProductRow[]) => {
    Alert.alert('가져오기', `${rows.length}개 상품을 등록할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '가져오기', onPress: () => runImport(rows) },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      <Text className="text-ink text-2xl font-bold">CSV로 가져오기</Text>
      <Text className="text-muted mt-2 text-sm leading-5">
        엑셀 등에서 저장한 CSV 파일로 상품을 한 번에 등록해요.{'\n'}
        사진은 CSV로 옮길 수 없어 등록 후 사진 없이 저장돼요.
      </Text>

      <Pressable
        onPress={shareTemplate}
        className="mt-6 items-center rounded-xl border border-line bg-paper p-4 active:opacity-70"
      >
        <Text className="text-ink text-base font-bold">템플릿 받기</Text>
      </Pressable>

      <Pressable
        onPress={pickFile}
        disabled={state.step === 'importing'}
        className="mt-3 items-center rounded-xl bg-primary p-4 active:opacity-80"
      >
        <Text className="text-paper text-base font-bold">CSV 파일 선택</Text>
      </Pressable>

      {state.step === 'parsed' ? (
        <View className="mt-6 rounded-xl border border-line bg-paper p-4">
          <Text className="text-ink text-base font-bold">
            정상 {state.rows.length}개 / 오류 {state.errors.length}개
          </Text>
          {state.errors.slice(0, 5).map((err, i) => (
            <Text key={i} className="text-muted mt-2 text-xs">
              {err.line}행: {err.reason}
            </Text>
          ))}
          {state.errors.length > 5 ? (
            <Text className="text-muted mt-2 text-xs">외 {state.errors.length - 5}건</Text>
          ) : null}

          <Pressable
            onPress={() => confirmImport(state.rows)}
            disabled={state.rows.length === 0}
            className={`mt-4 items-center rounded-xl p-4 ${
              state.rows.length === 0 ? 'bg-line' : 'bg-primary active:opacity-80'
            }`}
          >
            <Text className="text-paper text-base font-bold">{state.rows.length}개 가져오기</Text>
          </Pressable>
        </View>
      ) : null}

      {state.step === 'importing' ? (
        <View className="mt-6 items-center rounded-xl border border-line bg-paper p-4">
          <ActivityIndicator color="#CC2222" />
          <Text className="text-muted mt-2 text-sm">
            {state.done} / {state.total}개 등록 중...
          </Text>
        </View>
      ) : null}

      {state.step === 'done' ? (
        <View className="mt-6 rounded-xl border border-line bg-paper p-4">
          <Text className="text-ink text-base font-bold">
            {state.success}개 등록 완료{state.failed > 0 ? `, ${state.failed}개 저장 실패` : ''}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 items-center rounded-xl bg-primary p-4 active:opacity-80"
          >
            <Text className="text-paper text-base font-bold">확인</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
```

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`
Expected: `src/app/csv-import.tsx` 관련 에러 없음 (`login.tsx:115`의 기존 무관 에러는 그대로 남아있어도 됨)

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json src/app/csv-import.tsx
git commit -m "feat: CSV 가져오기 화면 추가"
```

---

### Task 4: 설정 화면에 링크 추가

**Files:**
- Modify: `src/app/settings.tsx`

**Interfaces:**
- Consumes: 라우트 `/csv-import` (Task 3)
- Produces: 없음 (진입점만 추가)

- [ ] **Step 1: "기능" 섹션에 링크 추가**

`src/app/settings.tsx`의 아래 기존 블록:

```tsx
        {mode === 'retail' ? (
          <>
            <View className="h-px bg-line" />
            <LinkRow
              icon="calculator-variant-outline"
              label="계산기"
              onPress={() => router.push('/margin-calculator')}
            />
          </>
        ) : null}
        {isCloudMode ? (
```

를 아래처럼 바꾼다(계산기 블록과 클라우드 팀 링크 블록 사이에 CSV 링크를 끼워 넣음, `mode`/`isCloudMode` 조건 없이 항상 표시):

```tsx
        {mode === 'retail' ? (
          <>
            <View className="h-px bg-line" />
            <LinkRow
              icon="calculator-variant-outline"
              label="계산기"
              onPress={() => router.push('/margin-calculator')}
            />
          </>
        ) : null}
        <View className="h-px bg-line" />
        <LinkRow
          icon="file-delimited-outline"
          label="CSV로 가져오기"
          onPress={() => router.push('/csv-import')}
        />
        {isCloudMode ? (
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/settings.tsx
git commit -m "feat: 설정 화면에 CSV 가져오기 링크 추가"
```

---

### Task 5: 전체 통합 수동 QA

**Files:** 없음 (코드 변경 없음, 문제 발견 시에만 수정 후 별도 커밋)

**Interfaces:**
- Consumes: Task 1~4 전체
- Produces: 없음

- [ ] **Step 1: 템플릿 받기 확인**

설정 → CSV로 가져오기 → 템플릿 받기 → 공유 시트에서 파일로 저장 → 엑셀 또는 메모장으로 열어 한글이 깨지지 않는지 확인(BOM)

- [ ] **Step 2: 정상 가져오기 확인**

템플릿에 행 2~3개 추가 → 선택 → 미리보기에 "정상 N개 / 오류 0개" 표시 확인 → 가져오기 → 대시보드에 등록되는지, 알림도 예약되는지(설정에서 알림 켜져 있는 상태로) 확인

- [ ] **Step 3: 오류 섞인 CSV 확인**

빈 상품명 1행 + 잘못된 날짜 1행을 일부러 섞은 CSV로 시도 → 미리보기에 오류 요약이 뜨고 나머지 정상 행만 가져와지는지 확인

- [ ] **Step 4: 빈 CSV 확인**

헤더만 있는 CSV → "가져오기" 버튼이 비활성 상태인지 확인

- [ ] **Step 5: 로컬/클라우드 모드 각각 확인**

`.env` 없는 로컬 빌드와 Supabase 연결된 클라우드 빌드 양쪽에서 가져오기가 정상 동작하는지 확인(클라우드는 Supabase `products` 테이블에 실제 반영되는지도 확인)

- [ ] **Step 6: 안드로이드 실기기에서 파일 선택기 확인**

`.csv` 파일이 문서 선택기 목록에 정상적으로 보이는지 확인 — 안 보이면 Task 3 Step 3의 `type` 배열에 안드로이드가 실제로 붙이는 MIME 타입을 추가해야 함(예: `application/vnd.ms-excel`)

문제를 발견하면 해당 파일을 수정하고 아래처럼 별도 커밋:

```bash
git add <수정한 파일>
git commit -m "fix: CSV 가져오기 QA 중 발견한 문제 수정"
```
