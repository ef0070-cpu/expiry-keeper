import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeMissing, MarginField, MarginInputs } from '@/lib/margin';
import {
  calculate as generalCalculate,
  clearAll as generalClearAll,
  formatDisplayValue,
  GeneralCalcOperator,
  GeneralCalcState,
  initialGeneralCalcState,
  inputDigit as generalInputDigit,
  inputDot as generalInputDot,
  percent as generalPercent,
  setOperator as generalSetOperator,
  toggleSign as generalToggleSign,
} from '@/lib/general-calculator';

type CalculatorMode = 'cost' | 'general';

const FIELDS: { key: MarginField; label: string; suffix: string }[] = [
  { key: 'cost', label: '원가', suffix: '원' },
  { key: 'margin', label: '마진율', suffix: '%' },
  { key: 'price', label: '판매가', suffix: '원' },
];

const COST_KEYPAD_ROWS: string[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['C', '0', '⌫'],
];

const GENERAL_KEYPAD_ROWS: string[][] = [
  ['AC', '+/-', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

const GENERAL_OPERATOR_KEYS: Record<string, GeneralCalcOperator> = {
  '÷': '/',
  '×': '*',
  '−': '-',
  '+': '+',
};

function parseNum(text: string): number {
  return Number(text.replace(/,/g, ''));
}

function formatValue(key: MarginField, n: number): string {
  if (key === 'margin') return n.toFixed(1);
  return Math.round(n).toLocaleString('ko-KR');
}

export default function MarginCalculator() {
  const [mode, setMode] = useState<CalculatorMode>('cost');
  const insets = useSafeAreaInsets();

  // --- 원가 계산기 상태 (기존 로직 그대로) ---
  const [values, setValues] = useState<Record<MarginField, string>>({
    cost: '',
    margin: '',
    price: '',
  });
  const [editedOrder, setEditedOrder] = useState<MarginField[]>([]);
  const [marginError, setMarginError] = useState(false);
  const [activeField, setActiveField] = useState<MarginField>('cost');

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

  const onCostKeyPress = (key: string) => {
    const current = values[activeField];
    if (key === 'C') {
      onChangeField(activeField, '');
    } else if (key === '⌫') {
      onChangeField(activeField, current.slice(0, -1));
    } else {
      onChangeField(activeField, current + key);
    }
  };

  // --- 일반 계산기 상태 ---
  const [generalState, setGeneralState] = useState<GeneralCalcState>(initialGeneralCalcState);

  const onGeneralKeyPress = (key: string) => {
    if (key === 'AC') {
      setGeneralState(generalClearAll());
      return;
    }
    if (key === '+/-') {
      setGeneralState((s) => generalToggleSign(s));
      return;
    }
    if (key === '%') {
      setGeneralState((s) => generalPercent(s));
      return;
    }
    if (key === '=') {
      setGeneralState((s) => generalCalculate(s));
      return;
    }
    if (key === '.') {
      setGeneralState((s) => generalInputDot(s));
      return;
    }
    if (key in GENERAL_OPERATOR_KEYS) {
      setGeneralState((s) => generalSetOperator(s, GENERAL_OPERATOR_KEYS[key]));
      return;
    }
    setGeneralState((s) => generalInputDigit(s, key));
  };

  return (
    <>
      <Stack.Screen options={{ title: '계산기' }} />
      <View className="flex-1 bg-bg">
        <View className="flex-row gap-2 p-4 pb-0">
          <Pressable
            onPress={() => setMode('cost')}
            accessibilityRole="button"
            accessibilityLabel="원가 계산기 탭"
            className={`flex-1 items-center rounded-xl border py-3 ${
              mode === 'cost' ? 'border-primary' : 'border-line'
            }`}
          >
            <Text className={`text-base font-bold ${mode === 'cost' ? 'text-primary' : 'text-ink'}`}>
              원가 계산기
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('general')}
            accessibilityRole="button"
            accessibilityLabel="일반 계산기 탭"
            className={`flex-1 items-center rounded-xl border py-3 ${
              mode === 'general' ? 'border-primary' : 'border-line'
            }`}
          >
            <Text className={`text-base font-bold ${mode === 'general' ? 'text-primary' : 'text-ink'}`}>
              일반 계산기
            </Text>
          </Pressable>
        </View>

        {mode === 'cost' ? (
          <>
            <ScrollView
              contentContainerStyle={{ padding: 16, flexGrow: 1, justifyContent: 'center' }}
              keyboardShouldPersistTaps="handled"
            >
              {FIELDS.map((f) => (
                <View key={f.key} className="mb-6">
                  <Text className="text-ink mb-2 text-base font-bold">
                    {f.label} ({f.suffix})
                  </Text>
                  <TextInput
                    className={`text-ink rounded-xl border bg-paper px-4 py-4 text-xl ${
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

            <View className="gap-2 p-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
              {COST_KEYPAD_ROWS.map((row, i) => (
                <View key={i} className="flex-row gap-2">
                  {row.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => onCostKeyPress(key)}
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
          </>
        ) : (
          <>
            <View className="p-4">
              <View className="rounded-xl border border-line bg-paper px-4 py-4">
                <Text className="text-muted mb-1 text-right text-sm" numberOfLines={1}>
                  {generalState.expression}
                </Text>
                <Text className="text-ink text-right text-3xl font-bold" numberOfLines={1}>
                  {formatDisplayValue(generalState.current)}
                </Text>
              </View>
            </View>

            <View className="gap-2 p-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
              {GENERAL_KEYPAD_ROWS.map((row, i) => (
                <View key={i} className="flex-row gap-2">
                  {row.map((key) => {
                    const isOperator = key in GENERAL_OPERATOR_KEYS;
                    const isEquals = key === '=';
                    const isZero = key === '0';
                    const accessibilityLabel =
                      key === 'AC'
                        ? '전체 지우기'
                        : key === '+/-'
                          ? '부호 변환'
                          : key === '%'
                            ? '퍼센트'
                            : key === '='
                              ? '계산'
                              : `${key}`;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => onGeneralKeyPress(key)}
                        accessibilityRole="button"
                        accessibilityLabel={accessibilityLabel}
                        style={{ flex: isZero ? 2 : 1 }}
                        className={`items-center justify-center rounded-xl border py-4 active:opacity-70 ${
                          isEquals
                            ? 'border-primary bg-primary'
                            : isOperator
                              ? 'border-primary bg-paper'
                              : 'border-line bg-paper'
                        }`}
                      >
                        <Text
                          className={`text-xl font-bold ${
                            isEquals ? 'text-paper' : isOperator ? 'text-primary' : 'text-ink'
                          }`}
                        >
                          {key}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </>
  );
}
