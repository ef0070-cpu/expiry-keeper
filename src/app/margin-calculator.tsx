import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeMissing, MarginField, MarginInputs } from '@/lib/margin';

const FIELDS: { key: MarginField; label: string; suffix: string }[] = [
  { key: 'cost', label: '원가', suffix: '원' },
  { key: 'margin', label: '마진율', suffix: '%' },
  { key: 'price', label: '판매가', suffix: '원' },
];

const KEYPAD_ROWS: string[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['C', '0', '⌫'],
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
  const [activeField, setActiveField] = useState<MarginField>('cost');
  const insets = useSafeAreaInsets();

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

  const onKeyPress = (key: string) => {
    const current = values[activeField];
    if (key === 'C') {
      onChangeField(activeField, '');
    } else if (key === '⌫') {
      onChangeField(activeField, current.slice(0, -1));
    } else {
      onChangeField(activeField, current + key);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '원가 계산기' }} />
      <View className="flex-1 bg-bg">
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {FIELDS.map((f) => (
            <View key={f.key} className="mb-4">
              <Text className="text-ink mb-1.5 text-sm font-bold">
                {f.label} ({f.suffix})
              </Text>
              <TextInput
                className={`text-ink rounded-xl border bg-paper px-3 py-2.5 text-base ${
                  activeField === f.key ? 'border-primary' : 'border-line'
                }`}
                placeholder="0"
                placeholderTextColor="#BBBBBB"
                showSoftInputOnFocus={false}
                value={values[f.key]}
                onFocus={() => setActiveField(f.key)}
                onChangeText={(t) => onChangeField(f.key, t)}
              />
              {f.key === 'margin' && marginError ? (
                <Text className="text-primary mt-1 text-xs">마진율은 100% 미만이어야 합니다</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View
          className="gap-2 p-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {KEYPAD_ROWS.map((row, i) => (
            <View key={i} className="flex-row gap-2">
              {row.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => onKeyPress(key)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    key === 'C' ? '지우기' : key === '⌫' ? '한 글자 지우기' : `숫자 ${key}`
                  }
                  className="flex-1 items-center justify-center rounded-xl border border-line bg-paper py-4 active:opacity-70"
                >
                  {key === '⌫' ? (
                    <MaterialCommunityIcons name="backspace-outline" size={20} color="#1A1A1A" />
                  ) : (
                    <Text className="text-ink text-xl font-bold">{key}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </View>
    </>
  );
}
