import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDaysYmd, kstNow } from '@/lib/order-history';

// 주문 마감 시각(KST, 24시간제). 확정 아님 — 실제 마감 시간 확인 필요.
const ORDER_CUTOFF_HOUR = 18;
const DATE_CHIPS = 5;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

type Props = {
  visible: boolean;
  storeName: string | null;
  /** buildOrderShareText 결과 — 카톡/SMS로 나갈 본문 그대로 */
  message: string;
  onClose(): void;
  onSend(opts: { deliveryDate: string; memo: string }): void;
  sending: boolean;
};

/** 'YYYY-MM-DD' → '10/28(수)'. 시간대와 무관하게 UTC 기준으로 요일 계산. */
function chipLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

export default function OrderConfirmSheet({ visible, storeName, message, onClose, onSend, sending }: Props) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string | null>(null);
  const [memo, setMemo] = useState('');

  // 열릴 때마다 현재 KST 기준으로 다시 계산한다.
  const info = useMemo(() => {
    if (!visible) return null;
    const now = kstNow();
    const passed = now.hour >= ORDER_CUTOFF_HOUR;
    const first = addDaysYmd(now.ymd, passed ? 2 : 1);
    const leftMin = (ORDER_CUTOFF_HOUR - now.hour) * 60 - now.minute;
    return {
      passed,
      leftMin,
      days: Array.from({ length: DATE_CHIPS }, (_, i) => addDaysYmd(first, i)),
    };
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setPicked(null);
      setMemo('');
    }
  }, [visible]);

  if (!info) return null;
  const selected = picked ?? info.days[0];
  const cutoff = `${ORDER_CUTOFF_HOUR}:00`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={sending ? undefined : onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View
          className="max-h-[90%] rounded-t-2xl bg-paper px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <Text className="text-ink mb-3 text-lg font-bold">
            {storeName ? `${storeName} 발주서 확인` : '발주서 확인'}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text className="text-muted mb-2 text-sm">납품 희망일</Text>
            <View className="mb-3 flex-row flex-wrap">
              {info.days.map((d) => {
                const on = d === selected;
                return (
                  <Pressable
                    key={d}
                    onPress={() => setPicked(d)}
                    disabled={sending}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    className={`mb-2 mr-2 min-h-[48px] justify-center rounded-xl border px-3 ${
                      on ? 'border-primary bg-primary' : 'border-line bg-bg'
                    }`}
                  >
                    <Text className={`text-sm font-bold ${on ? 'text-paper' : 'text-ink'}`}>{chipLabel(d)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="mb-3 flex-row items-center justify-between rounded-xl bg-bg px-3 py-3">
              <Text className="text-muted text-sm">주문 마감</Text>
              <Text className="text-ink text-sm font-bold">
                {info.passed
                  ? `오늘 ${cutoff} 지남 → 내일 ${cutoff}`
                  : `오늘 ${cutoff} (${Math.floor(info.leftMin / 60)}시간 ${info.leftMin % 60}분 남음)`}
              </Text>
            </View>

            <Text className="text-muted mb-2 text-sm">카톡/SMS로 보낼 내용 (1박스는 생략)</Text>
            <ScrollView
              nestedScrollEnabled
              className="mb-3 max-h-48 rounded-xl border border-line bg-bg"
              contentContainerStyle={{ padding: 12 }}
            >
              <Text className="text-ink text-sm leading-5">{message}</Text>
            </ScrollView>

            <Text className="text-muted mb-2 text-sm">배송 메모</Text>
            <TextInput
              value={memo}
              onChangeText={setMemo}
              maxLength={80}
              editable={!sending}
              placeholder="예: 냉동고 앞에 두세요"
              placeholderTextColor="#888888"
              className="text-ink mb-4 min-h-[48px] rounded-xl border border-line bg-bg px-3 text-base"
            />
          </ScrollView>

          <View className="flex-row">
            <Pressable
              onPress={onClose}
              disabled={sending}
              accessibilityRole="button"
              className="mr-2 min-h-[48px] items-center justify-center rounded-xl border border-line bg-bg px-5"
              style={{ opacity: sending ? 0.5 : 1 }}
            >
              <Text className="text-ink text-base font-bold">닫기</Text>
            </Pressable>
            <Pressable
              onPress={() => onSend({ deliveryDate: selected, memo: memo.trim() })}
              disabled={sending}
              accessibilityRole="button"
              className={`min-h-[48px] flex-1 items-center justify-center rounded-xl ${
                sending ? 'bg-line' : 'bg-primary active:opacity-80'
              }`}
            >
              <Text className="text-paper text-base font-bold">
                {sending ? '⏳ 전송 중...' : '💬 카톡/SMS 전송하기'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
