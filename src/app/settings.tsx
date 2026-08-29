import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ddayLabel } from '@/lib/dates';
import { rescheduleAllExpiryAlerts } from '@/lib/notifications';
import {
  ALERT_OFFSETS,
  AppMode,
  DATE_INPUT_METHOD_META,
  DATE_INPUT_METHODS,
  DateInputMethod,
  MODE_LABELS,
  setAlertSettings,
  setAppMode,
  setDateInputMethod,
  useAlertSettings,
  useAppMode,
  useDateInputMethod,
} from '@/lib/settings';
import { isCloudMode, supabase } from '@/lib/supabase';

export default function Settings() {
  const mode = useAppMode();
  const { count, hour, minute } = useAlertSettings();
  const dateInputMethod = useDateInputMethod();
  const [deleting, setDeleting] = useState(false);

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
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 16 }}>
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

      <SectionTitle text="알림" />
      <View className="rounded-xl border border-line bg-paper p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-ink text-base font-bold">알림 횟수</Text>
            <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
              {ALERT_OFFSETS[count - 1].map(ddayLabel).join(', ')}
            </Text>
          </View>
          <View className="flex-row items-center">
            <TinyStepper icon="minus" onPress={() => changeCount(-1)} />
            <Text className="text-ink mx-3 text-lg font-bold">{count}회</Text>
            <TinyStepper icon="plus" onPress={() => changeCount(1)} />
          </View>
        </View>

        <View className="my-4 h-px bg-line" />

        <View className="flex-row items-center justify-between">
          <Text className="text-ink text-base font-bold">알림 시간</Text>
          <Text className="text-muted text-sm">{formatAlertTime(hour, minute)}</Text>
        </View>
        <View className="mt-3 flex-row items-center justify-center gap-8">
          <View className="items-center">
            <Text className="text-muted mb-1 text-xs">시</Text>
            <View className="flex-row items-center">
              <TinyStepper icon="minus" onPress={() => changeHour(-1)} />
              <Text className="text-ink mx-3 w-6 text-center text-base font-bold">{hour}</Text>
              <TinyStepper icon="plus" onPress={() => changeHour(1)} />
            </View>
          </View>
          <View className="items-center">
            <Text className="text-muted mb-1 text-xs">분</Text>
            <View className="flex-row items-center">
              <TinyStepper icon="minus" onPress={() => changeMinute(-5)} />
              <Text className="text-ink mx-3 w-6 text-center text-base font-bold">
                {String(minute).padStart(2, '0')}
              </Text>
              <TinyStepper icon="plus" onPress={() => changeMinute(5)} />
            </View>
          </View>
        </View>
      </View>

      <SectionTitle text="기능" />
      <View className="overflow-hidden rounded-xl border border-line bg-paper">
        <LinkRow
          icon="chart-box-outline"
          label="소진·폐기 통계"
          onPress={() => router.push('/stats')}
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

function TinyStepper({ icon, onPress }: { icon: 'plus' | 'minus'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg active:opacity-70"
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
