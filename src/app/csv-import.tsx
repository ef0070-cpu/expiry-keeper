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
  | { step: 'done'; success: number; failed: number; firstError?: string };

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
    let firstError: string | undefined;
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
      } catch (e) {
        failed++;
        firstError ??= e instanceof Error ? e.message : String(e);
      }
      setState((prev) => (prev.step === 'importing' ? { ...prev, done: prev.done + 1 } : prev));
    }
    setState({ step: 'done', success, failed, firstError });
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
