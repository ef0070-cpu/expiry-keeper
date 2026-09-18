import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ParsedOrderProductRow, parseOrderProductCsv } from '@/lib/order-csv-import';
import { addOrderCategory, listOrderCategories, newId, saveOrderProduct } from '@/lib/order-repo';
import { OrderProduct } from '@/lib/order-types';

const TEMPLATE_CSV =
  '﻿상품명,브랜드,가격,카테고리,바코드,별칭\n' +
  '메로나,빙그레,1000,바,8801234567890,메론바;멜론바\n';

type ImportState =
  | { step: 'idle' }
  | { step: 'parsed'; rows: ParsedOrderProductRow[]; errors: { line: number; reason: string }[] }
  | { step: 'importing'; total: number; done: number }
  | { step: 'done'; success: number; failed: number; firstError?: string };

export default function OrderCsvImportScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ImportState>({ step: 'idle' });

  const shareTemplate = async () => {
    try {
      // Android는 expo-sharing이 다른 앱으로 "보내기"만 할 뿐이라, 고른 앱이 저장을 지원
      // 안 하면 공유 시트는 뜨는데 실제로는 아무 파일도 안 남는다(csv-import.tsx의 템플릿
      // 받기와 같은 이유로 같은 방식을 씀) — SAF로 사용자가 고른 폴더에 직접 써서 확실히 남긴다.
      if (Platform.OS === 'android') {
        const downloadsHint = StorageAccessFramework.getUriForDirectoryInRoot('Download');
        const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(downloadsHint);
        if (!perm.granted) return;
        const fileUri = await StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          'order-product-template',
          'text/csv',
        );
        await StorageAccessFramework.writeAsStringAsync(fileUri, TEMPLATE_CSV);
        Alert.alert('저장 완료', '선택한 폴더에 템플릿 파일을 저장했어요.');
        return;
      }

      const file = new File(Paths.cache, 'order-product-template.csv');
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
      const { rows, errors } = parseOrderProductCsv(text);
      setState({ step: 'parsed', rows, errors });
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '파일을 읽지 못했어요.');
    }
  };

  const runImport = async (rows: ParsedOrderProductRow[]) => {
    setState({ step: 'importing', total: rows.length, done: 0 });
    // CSV에만 있고 기존 카테고리 목록에 없는 카테고리는 상품 등록 화면에서 수동으로 "+"로
    // 추가하는 것과 동일하게 미리 등록해둔다 — 그래야 가져온 상품이 바로 필터 칩에 보인다.
    const existingCategories = new Set(await listOrderCategories());
    const newCategories = [
      ...new Set(rows.map((r) => r.category).filter((c) => c && !existingCategories.has(c))),
    ];
    for (const c of newCategories) {
      await addOrderCategory(c).catch(() => {});
    }

    let success = 0;
    let failed = 0;
    let firstError: string | undefined;
    for (const row of rows) {
      try {
        const product: OrderProduct = {
          id: newId(),
          name: row.name,
          brand: row.brand,
          price: row.price,
          category: row.category,
          barcode: row.barcode,
          imageUri: null,
          status: 'active',
          aliases: row.aliases,
        };
        await saveOrderProduct(product);
        success++;
      } catch (e) {
        failed++;
        firstError ??= e instanceof Error ? e.message : String(e);
      }
      setState((prev) => (prev.step === 'importing' ? { ...prev, done: prev.done + 1 } : prev));
    }
    setState({ step: 'done', success, failed, firstError });
  };

  const confirmImport = (rows: ParsedOrderProductRow[]) => {
    Alert.alert('가져오기', `${rows.length}개 발주 상품을 등록할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '가져오기', onPress: () => runImport(rows) },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      <Text className="text-ink text-2xl font-bold">발주 상품 CSV로 가져오기</Text>
      <Text className="text-muted mt-2 text-sm leading-5">
        엑셀 등에서 저장한 CSV 파일로 발주 상품을 한 번에 등록해요.{'\n'}
        템플릿의 예시 행은 지우고 실제 상품으로 바꿔서 사용하세요.
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
              {err.line === 0 ? err.reason : `${err.line}행: ${err.reason}`}
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
            <Text
              className={`text-base font-bold ${
                state.rows.length === 0 ? 'text-muted' : 'text-paper'
              }`}
            >
              {state.rows.length}개 가져오기
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
