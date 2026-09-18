import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ddayLabel } from '@/lib/dates';
import { rescheduleAllExpiryAlerts } from '@/lib/notifications';
import {
  ALERT_OFFSETS,
  AppMode,
  DATE_INPUT_METHOD_META,
  DATE_INPUT_METHODS,
  DATE_OCR_ORDER_META,
  DATE_OCR_ORDERS,
  DateInputMethod,
  DateOcrOrder,
  MODE_LABELS,
  setAlertSettings,
  setAppMode,
  setDateInputMethod,
  setDateOcrOrder,
  setScanHapticEnabled,
  unlockLabs,
  lockLabs,
  useAlertSettings,
  useAppMode,
  useDateInputMethod,
  useDateOcrOrder,
  useLabsUnlocked,
  useScanHapticEnabled,
} from '@/lib/settings';
import { isCloudMode, supabase } from '@/lib/supabase';

export default function Settings() {
  const mode = useAppMode();
  const { count, hour, minute } = useAlertSettings();
  const dateInputMethod = useDateInputMethod();
  const dateOcrOrder = useDateOcrOrder();
  const scanHapticEnabled = useScanHapticEnabled();
  const [deleting, setDeleting] = useState(false);
  const [notifDenied, setNotifDenied] = useState(false);
  const labsUnlocked = useLabsUnlocked();
  const [labsModalVisible, setLabsModalVisible] = useState(false);
  const [labsPasswordInput, setLabsPasswordInput] = useState('');
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      Notifications.getPermissionsAsync().then((p) => setNotifDenied(!p.granted));
    }, []),
  );

  const deleteAccount = () => {
    Alert.alert(
      '회원 탈퇴',
      '계정과 등록된 모든 상품 데이터가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴하기',
          style: 'destructive',
          onPress: async () => {
            if (!supabase) return;
            setDeleting(true);
            const { error } = await supabase.functions.invoke('delete-account');
            setDeleting(false);
            if (error) {
              const body = await error.context?.json?.().catch(() => null);
              Alert.alert('탈퇴 실패', body?.error ?? '잠시 후 다시 시도해 주세요.');
              return;
            }
            await supabase.auth.signOut();
          },
        },
      ],
    );
  };

  const changeCount = (delta: number) => {
    const next = Math.min(7, Math.max(1, count + delta));
    if (next === count) return;
    setAlertSettings({ count: next });
    rescheduleAllExpiryAlerts();
  };
  const changeHour = (delta: number) => {
    setAlertSettings({ hour: (hour + delta + 24) % 24 });
    rescheduleAllExpiryAlerts();
  };
  const changeMinute = (delta: number) => {
    setAlertSettings({ minute: (minute + delta + 60) % 60 });
    rescheduleAllExpiryAlerts();
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 16 }}
    >
      <SectionTitle text="사용 모드" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        <ModeRow
          target="home"
          current={mode ?? null}
          icon="home-variant-outline"
          description="식재료 관리 + 레시피 추천"
        />
        <View className="h-px bg-line" />
        <ModeRow
          target="retail"
          current={mode ?? null}
          icon="storefront-outline"
          description="매장 상품 관리 + 폐기 통계"
        />
      </View>

      <SectionTitle text="유통기한 입력 방법" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        {DATE_INPUT_METHODS.map((method, i) => (
          <View key={method}>
            {i > 0 ? <View className="h-px bg-line" /> : null}
            <DateMethodRow target={method} current={dateInputMethod} />
          </View>
        ))}
      </View>

      <SectionTitle text="사진 인식 날짜 순서" />
      <Text className="text-muted mb-2 text-xs">
        유통기한 사진 인식에서 순서가 애매할 때만 사용돼요.
      </Text>
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        {DATE_OCR_ORDERS.map((order, i) => (
          <View key={order}>
            {i > 0 ? <View className="h-px bg-line" /> : null}
            <DateOcrOrderRow target={order} current={dateOcrOrder} />
          </View>
        ))}
      </View>

      <SectionTitle text="알림" />
      <Text className="text-muted mb-2 text-xs">
        선택한 횟수만큼, 유통기한이 가까워질 때 알려드려요.
      </Text>
      {notifDenied ? (
        <Pressable
          onPress={() => Linking.openSettings()}
          className="mb-3 flex-row items-center rounded-xl border border-primary bg-paper p-3 active:opacity-70"
        >
          <MaterialCommunityIcons name="bell-off-outline" size={20} color="#CC2222" />
          <Text className="text-primary ml-2 flex-1 text-sm font-bold">
            알림 권한이 꺼져 있어 유통기한 알림이 오지 않아요. 눌러서 설정에서 켜주세요.
          </Text>
        </Pressable>
      ) : null}
      <View className="rounded-xl border border-line bg-paper p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-ink text-base font-bold">알림 횟수</Text>
            <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
              {ALERT_OFFSETS[count - 1].map(ddayLabel).join(', ')}
            </Text>
          </View>
          <View className="flex-row items-center">
            <TinyStepper icon="minus" label="알림 횟수 감소" onPress={() => changeCount(-1)} />
            <Text
              className="text-ink mx-3 text-lg font-bold"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {count}회
            </Text>
            <TinyStepper icon="plus" label="알림 횟수 증가" onPress={() => changeCount(1)} />
          </View>
        </View>
        <Pressable
          onPress={() => {
            if (count === 1) return;
            setAlertSettings({ count: 1 });
            rescheduleAllExpiryAlerts();
          }}
          className="mt-2 self-start"
        >
          <Text className={`text-xs ${count === 1 ? 'text-muted' : 'text-primary font-medium'}`}>
            {count === 1 ? '✓ 당일만 알림으로 설정됨' : '당일만 알림으로 바꾸기'}
          </Text>
        </Pressable>

        <View className="my-4 h-px bg-line" />

        <View className="flex-row items-center justify-between">
          <Text className="text-ink text-base font-bold">알림 시간</Text>
          <Text className="text-muted text-sm">{formatAlertTime(hour, minute)}</Text>
        </View>
        <View className="mt-3 flex-row items-center justify-center gap-8">
          <View className="items-center">
            <Text className="text-muted mb-1 text-xs">시</Text>
            <View className="flex-row items-center">
              <TinyStepper icon="minus" label="시 감소" onPress={() => changeHour(-1)} />
              <Text className="text-ink mx-3 w-6 text-center text-base font-bold">{hour}</Text>
              <TinyStepper icon="plus" label="시 증가" onPress={() => changeHour(1)} />
            </View>
          </View>
          <View className="items-center">
            <Text className="text-muted mb-1 text-xs">분</Text>
            <View className="flex-row items-center">
              <TinyStepper icon="minus" label="분 감소" onPress={() => changeMinute(-5)} />
              <Text className="text-ink mx-3 w-6 text-center text-base font-bold">
                {String(minute).padStart(2, '0')}
              </Text>
              <TinyStepper icon="plus" label="분 증가" onPress={() => changeMinute(5)} />
            </View>
          </View>
        </View>
      </View>

      <SectionTitle text="스캔" />
      <View className="flex-row items-center justify-between rounded-xl border border-line bg-paper p-4">
        <View className="flex-1 pr-3">
          <Text className="text-ink text-base font-bold">스캔 진동 피드백</Text>
          <Text className="text-muted mt-0.5 text-xs">바코드 인식 성공 시 짧게 진동해요.</Text>
        </View>
        <Switch value={scanHapticEnabled} onValueChange={setScanHapticEnabled} />
      </View>

      <SectionTitle text="기능" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        <LinkRow
          icon="chart-box-outline"
          label="소진·폐기 통계"
          onPress={() => router.push('/stats')}
        />
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
          <>
            <View className="h-px bg-line" />
            <LinkRow
              icon="account-group-outline"
              label={mode === 'home' ? '가족 공유 (팀 설정)' : '팀 설정'}
              onPress={() => router.push('/team')}
            />
          </>
        ) : null}
        <View className="h-px bg-line" />
        {labsUnlocked ? (
          <LinkRow
            icon="flask-off-outline"
            label="실험실"
            onPress={() =>
              Alert.alert('실험실 잠그기', '실험실을 잠그면 가격표 만들기가 다시 숨겨집니다.', [
                { text: '취소', style: 'cancel' },
                { text: '잠그기', style: 'destructive', onPress: () => lockLabs() },
              ])
            }
          />
        ) : (
          <LinkRow icon="flask-outline" label="실험실" onPress={() => setLabsModalVisible(true)} />
        )}
      </View>

      {isCloudMode ? (
        <>
          <SectionTitle text="계정" />
          <View className="overflow-hidden rounded-xl border border-line bg-paper">
            <LinkRow
              icon="logout"
              label="로그아웃"
              destructive
              onPress={() =>
                Alert.alert('로그아웃', '로그아웃할까요?', [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '로그아웃',
                    style: 'destructive',
                    onPress: () => supabase?.auth.signOut(),
                  },
                ])
              }
            />
            <View className="h-px bg-line" />
            {deleting ? (
              <View className="flex-row items-center justify-center p-4">
                <ActivityIndicator color="#CC2222" size="small" />
                <Text className="text-primary ml-2 text-base">탈퇴 처리 중...</Text>
              </View>
            ) : (
              <LinkRow icon="account-remove-outline" label="회원 탈퇴" destructive onPress={deleteAccount} />
            )}
          </View>
        </>
      ) : null}

      <Text className="text-muted mt-6 text-center text-xs">
        버전 {Constants.expoConfig?.version ?? '?'} ({Constants.platform?.android?.versionCode ?? '?'})
      </Text>

      {/* 아직 실험 중인 기능(가격표 만들기)을 비밀번호를 아는 관리자만 켜서 계속 테스트할 수
       * 있게 하는 진입점 — 일반 사용자 화면에는 아이콘 자체가 안 보이게 숨겨둔다. */}
      <Modal visible={labsModalVisible} transparent animationType="fade" onRequestClose={() => setLabsModalVisible(false)}>
        <Pressable
          className="flex-1 items-center justify-center bg-black/50 px-8"
          onPress={() => setLabsModalVisible(false)}
        >
          <Pressable className="w-full rounded-2xl bg-paper p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-ink mb-3 text-base font-bold">실험실 비밀번호</Text>
            <TextInput
              className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
              placeholder="비밀번호"
              placeholderTextColor="#BBBBBB"
              secureTextEntry
              keyboardType="number-pad"
              value={labsPasswordInput}
              onChangeText={setLabsPasswordInput}
              onSubmitEditing={async () => {
                const ok = await unlockLabs(labsPasswordInput);
                setLabsPasswordInput('');
                setLabsModalVisible(false);
                if (!ok) Alert.alert('실패', '비밀번호가 틀렸습니다.');
              }}
            />
            <Pressable
              className="bg-primary mt-3 items-center rounded-xl py-3"
              onPress={async () => {
                const ok = await unlockLabs(labsPasswordInput);
                setLabsPasswordInput('');
                setLabsModalVisible(false);
                if (!ok) Alert.alert('실패', '비밀번호가 틀렸습니다.');
              }}
            >
              <Text className="text-paper text-base font-bold">확인</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text className="text-muted mb-2 mt-5 text-xs font-bold">{text}</Text>;
}

function formatAlertTime(hour: number, minute: number): string {
  const period = hour < 12 ? '오전' : '오후';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${h12}:${String(minute).padStart(2, '0')}`;
}

function TinyStepper({
  icon,
  label,
  onPress,
}: {
  icon: 'plus' | 'minus';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={16} color="#1A1A1A" />
    </Pressable>
  );
}

function ModeRow({
  target,
  current,
  icon,
  description,
}: {
  target: AppMode;
  current: AppMode | null;
  icon: 'home-variant-outline' | 'storefront-outline';
  description: string;
}) {
  const active = current === target;
  return (
    <Pressable
      onPress={() => setAppMode(target)}
      className="flex-row items-center p-4 active:opacity-70"
    >
      <MaterialCommunityIcons name={icon} size={22} color={active ? '#CC2222' : '#888888'} />
      <View className="ml-3 flex-1">
        <Text className={`text-base font-bold ${active ? 'text-ink' : 'text-muted'}`}>
          {MODE_LABELS[target]}
        </Text>
        <Text className="text-muted mt-0.5 text-xs">{description}</Text>
      </View>
      <MaterialCommunityIcons
        name={active ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={active ? '#CC2222' : '#CCCCCC'}
      />
    </Pressable>
  );
}

function DateMethodRow({
  target,
  current,
}: {
  target: DateInputMethod;
  current: DateInputMethod;
}) {
  const active = current === target;
  const { label, description } = DATE_INPUT_METHOD_META[target];
  return (
    <Pressable
      onPress={() => setDateInputMethod(target)}
      className="flex-row items-center p-4 active:opacity-70"
    >
      <View className="flex-1">
        <Text className={`text-base font-bold ${active ? 'text-ink' : 'text-muted'}`}>
          {label}
        </Text>
        <Text className="text-muted mt-0.5 text-xs">{description}</Text>
      </View>
      <MaterialCommunityIcons
        name={active ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={active ? '#CC2222' : '#CCCCCC'}
      />
    </Pressable>
  );
}

function DateOcrOrderRow({
  target,
  current,
}: {
  target: DateOcrOrder;
  current: DateOcrOrder;
}) {
  const active = current === target;
  const { label, description } = DATE_OCR_ORDER_META[target];
  return (
    <Pressable
      onPress={() => setDateOcrOrder(target)}
      className="flex-row items-center p-4 active:opacity-70"
    >
      <View className="flex-1">
        <Text className={`text-base font-bold ${active ? 'text-ink' : 'text-muted'}`}>
          {label}
        </Text>
        <Text className="text-muted mt-0.5 text-xs">{description}</Text>
      </View>
      <MaterialCommunityIcons
        name={active ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={active ? '#CC2222' : '#CCCCCC'}
      />
    </Pressable>
  );
}

function LinkRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center p-4 active:opacity-70">
      <MaterialCommunityIcons name={icon} size={22} color={destructive ? '#CC2222' : '#888888'} />
      <Text className={`ml-3 flex-1 text-base ${destructive ? 'text-primary' : 'text-ink'}`}>
        {label}
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
    </Pressable>
  );
}
