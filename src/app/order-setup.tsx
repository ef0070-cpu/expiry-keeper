import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import { errorMessage } from '@/lib/errors';
import {
  DEFAULT_FRIDGE_SECTIONS,
  addStore,
  listOrderCategories,
  markOrderSetupDone,
  setActiveStoreId,
  setFridgeSections,
  setOrderCategories,
} from '@/lib/order-repo';

/**
 * 발주 관리 처음 시작 안내(3단계): 매장 이름 → 쓸 카테고리 → 냉동고 구역. 매장이 하나도 없는 사용자가
 * 발주 관리에 처음 들어오면 한 번만 뜬다(order.tsx). 언제든 건너뛸 수 있고, 여기서 정한 건 전부
 * 발주 관리 화면(매장 관리·카테고리 편집·구역 관리)에서 다시 바꿀 수 있다.
 */
export default function OrderSetup() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [storeName, setStoreName] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [pickedCategories, setPickedCategories] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<string[]>(DEFAULT_FRIDGE_SECTIONS);
  const [pickedSections, setPickedSections] = useState<Set<string>>(new Set(DEFAULT_FRIDGE_SECTIONS));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 뒤로 가기로 나가도 다시 뜨지 않게 — 한 번 보여 준 것으로 친다
    markOrderSetupDone();
    listOrderCategories().then((list) => {
      setCategories(list);
      setPickedCategories(new Set(list));
    });
  }, []);

  const finish = async () => {
    setBusy(true);
    try {
      const cats = categories.filter((c) => pickedCategories.has(c));
      if (cats.length > 0) await setOrderCategories(cats);
      const name = storeName.trim();
      if (name) {
        const stores = await addStore(name);
        const store = stores[stores.length - 1];
        await setActiveStoreId(store.id);
        const secs = sections.filter((s) => pickedSections.has(s));
        if (secs.length > 0) await setFridgeSections(store.id, secs);
      }
      router.back();
    } catch (e) {
      Alert.alert('저장 실패', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 0 && !storeName.trim()) {
      Alert.alert('매장 이름', '매장 이름을 입력해 주세요. 매장 없이 쓰려면 "건너뛰기"를 누르세요.');
      return;
    }
    if (step < 2) setStep(step + 1);
    else finish();
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title: '발주 관리 시작하기',
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
              <Text className="text-muted text-sm">건너뛰기</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text className="text-primary text-sm font-bold">{step + 1} / 3</Text>

        {step === 0 ? (
          <>
            <Text className="text-ink mt-2 text-xl font-bold">매장 이름을 알려 주세요</Text>
            <Text className="text-muted mt-2 text-sm leading-5">
              매장마다 장바구니와 냉동고 구역을 따로 관리해요. 매장이 여러 곳이면 나중에 발주 관리 맨 위
              &quot;매장 관리&quot;에서 더 추가할 수 있어요.
            </Text>
            <TextInput
              className="text-ink mt-5 rounded-xl border border-line bg-paper px-4 py-3 text-base"
              placeholder="예: 행복마트 본점"
              placeholderTextColor="#BBBBBB"
              value={storeName}
              onChangeText={setStoreName}
              autoFocus
            />
          </>
        ) : step === 1 ? (
          <>
            <Text className="text-ink mt-2 text-xl font-bold">쓸 카테고리를 골라 주세요</Text>
            <Text className="text-muted mt-2 text-sm leading-5">
              발주 상품을 나눠 보는 분류예요. 안 쓰는 건 눌러서 빼고, 필요한 건 직접 추가하세요. 나중에
              발주 관리의 &quot;편집&quot;에서 바꿀 수 있어요.
            </Text>
            <PickList
              options={categories}
              picked={pickedCategories}
              onChange={(options, picked) => {
                setCategories(options);
                setPickedCategories(picked);
              }}
              placeholder="새 카테고리 (예: 컵)"
            />
          </>
        ) : (
          <>
            <Text className="text-ink mt-2 text-xl font-bold">냉동고 구역을 정해 주세요</Text>
            <Text className="text-muted mt-2 text-sm leading-5">
              &quot;빠른발주&quot; 탭에서 실제 냉동고 칸처럼 구역별로 상품을 진열해 두고, 비어 가는 상품을
              바로 담을 수 있어요. 매장 냉동고에 맞게 고르고 이름을 추가하세요. 나중에 빠른발주의 &quot;구역
              관리&quot;에서 바꿀 수 있어요.
            </Text>
            <PickList
              options={sections}
              picked={pickedSections}
              onChange={(options, picked) => {
                setSections(options);
                setPickedSections(picked);
              }}
              placeholder="새 구역 (예: 1번 냉동고)"
            />
          </>
        )}
      </ScrollView>

      <View className="flex-row px-5 pt-3" style={{ gap: 8, paddingBottom: 12 + insets.bottom }}>
        {step > 0 ? (
          <Pressable
            onPress={() => setStep(step - 1)}
            className="flex-1 items-center rounded-xl border border-line bg-paper py-3.5 active:opacity-70"
          >
            <Text className="text-ink text-base font-medium">이전</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={next}
          disabled={busy}
          className="flex-[2] items-center rounded-xl bg-primary py-3.5 active:opacity-80"
        >
          <Text className="text-paper text-base font-bold">{step < 2 ? '다음' : busy ? '저장 중...' : '시작하기'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 칩을 눌러 넣고 빼고, 입력란으로 새 항목을 추가하는 목록(카테고리·구역 공용). */
function PickList({
  options,
  picked,
  onChange,
  placeholder,
}: {
  options: string[];
  picked: Set<string>;
  onChange: (options: string[], picked: Set<string>) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');
  const toggle = (o: string) => {
    const next = new Set(picked);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange(options, next);
  };
  const add = () => {
    const v = input.trim();
    if (!v) return;
    onChange(options.includes(v) ? options : [...options, v], new Set(picked).add(v));
    setInput('');
  };
  return (
    <>
      <View className="mt-5 flex-row flex-wrap" style={{ gap: 8 }}>
        {options.map((o) => (
          <Chip key={o} label={picked.has(o) ? `✓ ${o}` : o} active={picked.has(o)} onPress={() => toggle(o)} />
        ))}
      </View>
      <View className="mt-4 flex-row" style={{ gap: 8 }}>
        <TextInput
          className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm"
          placeholder={placeholder}
          placeholderTextColor="#BBBBBB"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={add}
        />
        <Pressable
          onPress={add}
          className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
        >
          <Text className="text-ink text-sm font-medium">추가</Text>
        </Pressable>
      </View>
    </>
  );
}
