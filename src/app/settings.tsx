import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lookupBarcode } from '@/lib/barcode-lookup';
import { ddayLabel } from '@/lib/dates';
import { rescheduleAllExpiryAlerts } from '@/lib/notifications';
import { listProducts, saveProduct } from '@/lib/repo';
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
  const [rescanning, setRescanning] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const insets = useSafeAreaInsets();

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

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const rescanImages = async () => {
    const products = await listProducts();
    const targets = products.filter(
      (p) => p.barcode?.trim() && (!p.imageUri || p.imageUri.startsWith('http')),
    );
    if (targets.length === 0) {
      Alert.alert('재검색할 상품 없음', '조건에 맞는 상품이 없습니다.');
      return;
    }
    Alert.alert(
      '사진 일괄 재검색',
      `${targets.length}개 상품을 대상으로 새 로직으로 사진을 다시 찾습니다. 직접 등록한 사진은 바뀌지 않습니다. 진행할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '진행',
          onPress: async () => {
            setRescanning(true);
            setRescanProgress({ done: 0, total: targets.length });
            try {
              let updated = 0;
              for (let i = 0; i < targets.length; i++) {
                const p = targets[i];
                const info = await lookupBarcode(p.barcode!.trim());
                if (info.imageUrl && info.imageUrl !== p.imageUri) {
                  await saveProduct({ ...p, imageUri: info.imageUrl });
                  updated++;
                }
                setRescanProgress({ done: i + 1, total: targets.length });
                await sleep(250);
              }
              Alert.alert('완료', `${targets.length}개 중 ${updated}개 사진이 업데이트됐습니다.`);
            } catch (e) {
              Alert.alert('재검색 실패', e instanceof Error ? e.message : '알 수 없는 오류');
            } finally {
              setRescanning(false);
              setRescanProgress(null);
            }
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
            <View className="h-px bg-line" />
            {rescanning ? (
              <View className="flex-row items-center justify-center p-4">
                <ActivityIndicator color="#CC2222" size="small" />
                <Text className="text-muted ml-2 text-sm">
                  사진 재검색 중... {rescanProgress ? `${rescanProgress.done}/${rescanProgress.total}` : ''}
                </Text>
              </View>
            ) : (
              <LinkRow icon="image-search-outline" label="사진 일괄 재검색" onPress={rescanImages} />
            )}
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
