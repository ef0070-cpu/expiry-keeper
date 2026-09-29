import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readPickedRows, saveXlsxTemplate } from '@/lib/spreadsheet-file';
import {
  ORDER_SHEET_HEADER,
  orderProductsToSheetRows,
  ParsedOrderProductRow,
  parseOrderProductRows,
  planOrderImport,
} from '@/lib/order-csv-import';
import {
  addOrderCategory,
  listOrderCategories,
  listOrderProducts,
  newId,
  saveOrderProduct,
} from '@/lib/order-repo';

type ImportState =
  | { step: 'idle' }
  | {
      step: 'parsed';
      rows: ParsedOrderProductRow[];
      errors: { line: number; reason: string }[];
      newCount: number;
      updateCount: number;
    }
  | { step: 'importing'; total: number; done: number }
  | { step: 'done'; success: number; failed: number; firstError?: string };

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export default function OrderCsvImportScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ImportState>({ step: 'idle' });

  // 내려받기 하나로 통합: 등록된 상품이 있으면 전체 목록(고쳐서 다시 올리면 수정됨), 없으면 예시
  // 1줄짜리 템플릿. 바코드·ID 칸은 텍스트 형식이라 엑셀이 숫자를 망가뜨리지 않는다.
  const downloadSheet = async () => {
    try {
      const products = await listOrderProducts();
      const rows = products.length
        ? orderProductsToSheetRows(products)
        : [['메로나', '빙그레', 1000, '바', '8801234567890', '메론바;멜론바', '']];
      const { buildTemplateXlsx } = await import('@/lib/xlsx-io');
      await saveXlsxTemplate(
        products.length ? `order-products-${todayStamp()}` : 'order-product-template',
        buildTemplateXlsx(ORDER_SHEET_HEADER, rows, ['바코드', 'ID(수정 금지)']),
      );
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '엑셀 파일을 만들지 못했어요.');
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/comma-separated-values',
          'text/plain',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const { rows, errors } = parseOrderProductRows(await readPickedRows(result.assets[0]));
      const plan = planOrderImport(rows, await listOrderProducts(), newId);
      const newCount = plan.filter((x) => x.isNew).length;
      setState({ step: 'parsed', rows, errors, newCount, updateCount: plan.length - newCount });
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '파일을 읽지 못했어요.');
    }
  };

  const runImport = async (rows: ParsedOrderProductRow[]) => {
    setState({ step: 'importing', total: rows.length, done: 0 });
    // 파일에만 있고 기존 카테고리 목록에 없는 카테고리는 상품 등록 화면에서 수동으로 "+"로
    // 추가하는 것과 동일하게 미리 등록해둔다 — 그래야 가져온 상품이 바로 필터 칩에 보인다.
    const existingCategories = new Set(await listOrderCategories());
    const newCategories = [
      ...new Set(
        rows.map((r) => r.category).filter((c): c is string => !!c && !existingCategories.has(c)),
      ),
    ];
    for (const c of newCategories) {
      await addOrderCategory(c).catch(() => {});
    }

    // ID(없으면 바코드)가 같은 기존 상품은 엑셀 칸만 바꿔 수정 — 사진·납품상태는 유지
    const plan = planOrderImport(rows, await listOrderProducts(), newId);
    let success = 0;
    let added = 0;
    let failed = 0;
    let firstError: string | undefined;
    for (const { product, isNew } of plan) {
      try {
        await saveOrderProduct(product);
        success++;
        if (isNew) added++;
      } catch (e) {
        failed++;
        firstError ??= e instanceof Error ? e.message : String(e);
      }
      setState((prev) => (prev.step === 'importing' ? { ...prev, done: prev.done + 1 } : prev));
    }
    setState({ step: 'done', success, failed, firstError });
    // 끝났다는 걸 확실히 알 수 있게 팝업으로도 알린다(결과 카드는 그대로 남음)
    const counts = `새 상품 ${added}개 · 수정 ${success - added}개`;
    Alert.alert(
      failed > 0 ? '등록 결과' : '등록 완료',
      failed > 0
        ? `${success}개 등록 완료 되었습니다(${counts}).\n${failed}개는 저장하지 못했어요.${firstError ? `\n사유: ${firstError}` : ''}`
        : `등록 완료 되었습니다.\n${counts}`,
      [{ text: '확인', onPress: () => router.back() }],
    );
  };

  const confirmImport = (rows: ParsedOrderProductRow[], newCount: number, updateCount: number) => {
    Alert.alert('올리기', `새 상품 ${newCount}개를 추가하고 ${updateCount}개를 수정할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '올리기', onPress: () => runImport(rows) },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      <Text className="text-ink text-2xl font-bold">엑셀로 한 번에 관리</Text>
      <Text className="text-muted mt-2 text-sm leading-5">
        1. 엑셀로 내려받기 — 지금 등록된 상품 전체가 들어 있어요(없으면 예시 1줄).{'\n'}
        2. 엑셀에서 고치거나 맨 아래에 새 상품을 추가해 저장해요.{'\n'}
        3. 파일 올리기 — ID가 있는 줄은 수정, ID가 빈 줄은 새 상품으로 등록돼요.{'\n'}
        ID 칸은 고치지 마세요. 사진과 납품상태는 그대로 유지돼요. CSV 파일도 올릴 수 있어요.
      </Text>

      <Pressable
        onPress={downloadSheet}
        className="mt-6 items-center rounded-xl border border-line bg-paper p-4 active:opacity-70"
      >
        <Text className="text-ink text-base font-bold">엑셀로 내려받기</Text>
      </Pressable>

      <Pressable
        onPress={pickFile}
        disabled={state.step === 'importing'}
        className="mt-3 items-center rounded-xl bg-primary p-4 active:opacity-80"
      >
        <Text className="text-paper text-base font-bold">파일 올리기 (엑셀·CSV)</Text>
      </Pressable>

      {state.step === 'parsed' ? (
        <View className="mt-6 rounded-xl border border-line bg-paper p-4">
          <Text className="text-ink text-base font-bold">
            새 상품 {state.newCount}개 · 수정 {state.updateCount}개 / 오류 {state.errors.length}개
          </Text>
          {state.errors.slice(0, 5).map((err, i) => (
            <Text key={i} className="text-muted mt-2 text-xs">
              {err.line === 0 ? err.reason : `${err.line}행: ${err.reason}`}
            </Text>
          ))}
          {state.errors.length > 5 ? (
            <Text className="text-muted mt-2 text-xs">외 {state.errors.length - 5}건</Text>
          ) : null}

          <Pressable
            onPress={() => confirmImport(state.rows, state.newCount, state.updateCount)}
            disabled={state.rows.length === 0}
            className={`mt-4 items-center rounded-xl p-4 ${
              state.rows.length === 0 ? 'bg-line' : 'bg-primary active:opacity-80'
            }`}
          >
            <Text
              className={`text-base font-bold ${
                state.rows.length === 0 ? 'text-muted' : 'text-paper'
              }`}
            >
              {state.rows.length}개 올리기
            </Text>
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
          {state.failed > 0 && state.firstError ? (
            <Text className="text-muted mt-2 text-xs">첫 실패 사유: {state.firstError}</Text>
          ) : null}
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
