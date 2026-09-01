import { Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { computeMissing, MarginField, MarginInputs } from '@/lib/margin';

const FIELDS: {
  key: MarginField;
  label: string;
  suffix: string;
  keyboardType: 'number-pad' | 'decimal-pad';
}[] = [
  { key: 'cost', label: '원가', suffix: '원', keyboardType: 'number-pad' },
  { key: 'margin', label: '마진율', suffix: '%', keyboardType: 'decimal-pad' },
  { key: 'price', label: '판매가', suffix: '원', keyboardType: 'number-pad' },
];

function parseNum(text: string): number {
  return Number(text.replace(/,/g, ''));
}

function formatValue(key: MarginField, n: number): string {
  if (key === 'margin') return n.toFixed(1);
  return Math.round(n).toLocaleString('ko-KR');
}

export default function MarginCalculator() {
  const [values, setValues] = useState<Record<MarginField, string>>({
    cost: '',
    margin: '',
    price: '',
  });
  const [editedOrder, setEditedOrder] = useState<MarginField[]>([]);
  const [marginError, setMarginError] = useState(false);

  const onChangeField = (key: MarginField, text: string) => {
    const nextOrder = [key, ...editedOrder.filter((k) => k !== key)].slice(0, 2);
    const nextValues = { ...values, [key]: text };
    let nextMarginError = false;

    if (nextOrder.length === 2) {
      const [a, b] = nextOrder;
      const outputKey = FIELDS.map((f) => f.key).find((k) => k !== a && k !== b)!;
      const numA = parseNum(nextValues[a]);
      const numB = parseNum(nextValues[b]);
      const bothValid =
        nextValues[a].trim() !== '' &&
        nextValues[b].trim() !== '' &&
        !Number.isNaN(numA) &&
        !Number.isNaN(numB);

      if (bothValid) {
        const inputs: MarginInputs = {};
        inputs[a] = numA;
        inputs[b] = numB;
        const result = computeMissing({ a, b }, inputs);
        if (result === null) {
          nextValues[outputKey] = '';
          if (a === 'margin' || b === 'margin') nextMarginError = true;
        } else {
          nextValues[outputKey] = formatValue(outputKey, result);
        }
      } else {
        nextValues[outputKey] = '';
      }
    }

    setEditedOrder(nextOrder);
    setValues(nextValues);
    setMarginError(nextMarginError);
  };

  return (
    <>
      <Stack.Screen options={{ title: '원가 계산기' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="flex-1 bg-bg"
          contentContainerStyle={{ padding: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {FIELDS.map((f) => (
            <View key={f.key} className="mb-4">
              <Text className="text-ink mb-1.5 text-sm font-bold">
                {f.label} ({f.suffix})
              </Text>
              <TextInput
                className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
                placeholder="0"
                placeholderTextColor="#BBBBBB"
                keyboardType={f.keyboardType}
                value={values[f.key]}
                onChangeText={(t) => onChangeField(f.key, t)}
              />
              {f.key === 'margin' && marginError ? (
                <Text className="text-primary mt-1 text-xs">마진율은 100% 미만이어야 합니다</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
