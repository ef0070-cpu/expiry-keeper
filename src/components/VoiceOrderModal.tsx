import { memo, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { matchVoiceItems, parseVoiceOrder } from '@/lib/order-voice';
import type { OrderProduct } from '@/lib/order-types';

const SAMPLES = [
  '메로나 두 박스 하겐다즈 세 개 붕어싸만코',
  '월드콘 5박스, 비비빅 열 개 그리고 투게더',
  '설레임 3 죠스바 두 박스 요맘때',
];

type Result = {
  added: { name: string; qty: number }[];
  failed: { name: string; qty: number }[];
};

const VoiceOrderModal = memo(function VoiceOrderModal({
  visible,
  onClose,
  products,
  onApply,
  onManualSearch,
}: {
  visible: boolean;
  onClose: () => void;
  products: OrderProduct[];
  onApply: (adds: { productId: string; qty: number }[]) => void;
  onManualSearch: (keyword: string) => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setResult(null);
    }
  }, [visible]);

  const analyze = () => {
    const items = parseVoiceOrder(text);
    if (items.length === 0) {
      setResult({ added: [], failed: [] });
      return;
    }
    const { matched, failed } = matchVoiceItems(items, products);
    if (matched.length > 0) onApply(matched.map((m) => ({ productId: m.product.id, qty: m.qty })));
    setResult({ added: matched.map((m) => ({ name: m.product.name, qty: m.qty })), failed });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-ink/40 px-6" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-2xl bg-paper p-4"
          style={{ maxHeight: '85%' }}
        >
          <View className="mb-2 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center" style={{ gap: 6 }}>
              <Text className="text-ink text-base font-bold">음성 발주</Text>
              <View className="bg-primary rounded px-1.5 py-0.5">
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' }}>Beta</Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              className="h-12 w-12 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            >
              <Text className="text-muted text-lg">✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text className="text-muted text-sm">키보드의 마이크 버튼으로 말하거나 직접 적어 보세요</Text>

            <View className="mt-3" style={{ gap: 6 }}>
              {SAMPLES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setText(s)}
                  className="min-h-[48px] justify-center rounded-xl border border-muted/30 px-3"
                  accessibilityRole="button"
                >
                  <Text className="text-ink text-sm">{s}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              placeholder="예: 메로나 두 박스 하겐다즈 세 개"
              className="text-ink mt-3 min-h-[96px] rounded-xl border border-muted/30 p-3 text-base"
              style={{ textAlignVertical: 'top' }}
            />

            <Pressable
              onPress={analyze}
              className="bg-primary mt-3 min-h-[48px] items-center justify-center rounded-xl"
              accessibilityRole="button"
            >
              <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' }}>분석하기</Text>
            </Pressable>

            {result && result.added.length === 0 && result.failed.length === 0 && (
              <Text className="text-muted mt-3 text-center text-sm">인식된 내용이 없어요</Text>
            )}

            {result && result.added.length > 0 && (
              <View className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#E8F5E9' }}>
                <Text className="text-sm font-bold" style={{ color: '#2E7D32' }}>
                  장바구니에 담았어요 ({result.added.length})
                </Text>
                {result.added.map((a) => (
                  <Text key={a.name} className="text-ink mt-1 text-sm">
                    {a.name} +{a.qty}박스
                  </Text>
                ))}
              </View>
            )}

            {result && result.failed.length > 0 && (
              <View className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#FDECEA' }}>
                <Text className="text-sm font-bold" style={{ color: '#CC2222' }}>
                  찾지 못했어요 ({result.failed.length})
                </Text>
                {result.failed.map((f, i) => (
                  <View key={`${f.name}-${i}`} className="min-h-[48px] flex-row items-center justify-between">
                    <Text className="text-ink flex-1 text-sm">
                      {f.name} {f.qty}박스
                    </Text>
                    <Pressable
                      onPress={() => {
                        onManualSearch(f.name);
                        onClose();
                      }}
                      className="min-h-[48px] justify-center px-3"
                      accessibilityRole="button"
                    >
                      <Text className="text-primary text-sm font-bold">수동 검색</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

export default VoiceOrderModal;
