import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { LIFETIME, MONTHLY, buy, getPrice, restorePurchases } from '@/lib/billing';
import { refreshEntitlement, useEntitlement, usePlanConfig } from '@/lib/entitlement';
import { scheduleTrialEndingAlert } from '@/lib/notifications';
import { useAppMode } from '@/lib/settings';
import { supabase } from '@/lib/supabase';

// 유료 안내·이벤트 코드 입력. 결제 문구는 docs/monetization.md 3-1·3-2(법무 점검 대상) 그대로.
// 가격은 플레이 콘솔에 등록한 값을 결제 모듈에서 받아 보여 준다(앱에 금액을 박지 않음 — 못 받으면 "준비 중").
const PACKAGE = 'com.shlab.expirykeeper';

const REASON_TEXT: Record<string, string> = {
  products: '무료로 관리할 수 있는 상품 개수를 모두 썼어요.',
  order: '이번 달 무료 발주서 공유 횟수를 모두 썼어요.',
  priceTag: '이번 달 무료 가격표 저장·공유 횟수를 모두 썼어요.',
  team: '무료로는 혼자 사용할 수 있어요. 팀원과 함께 쓰려면 매장용 구독이 필요해요.',
  alerts: '무료로 받을 수 있는 상품별 알림 횟수를 모두 설정했어요.',
};

const formatKoreanDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export default function Premium() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const mode = useAppMode();
  const ent = useEntitlement();
  const cfg = usePlanConfig();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<string | null>(null); // 플레이 콘솔에 등록된 현지 가격
  const [restoring, setRestoring] = useState(false);
  const productKey = mode === 'home' ? LIFETIME : MONTHLY;

  useEffect(() => {
    getPrice(productKey).then(setPrice);
  }, [productKey]);

  const purchase = async () => {
    try {
      await buy(productKey);
    } catch (e) {
      // 사용자가 결제창을 닫은 경우도 여기로 온다 — 그때는 조용히
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel/i.test(msg)) Alert.alert('결제', msg || '결제를 진행하지 못했어요.');
    }
  };

  const restore = async () => {
    setRestoring(true);
    const n = await restorePurchases();
    setRestoring(false);
    Alert.alert('구매 복원', n > 0 ? '구매 내역을 다시 적용했어요.' : '복원할 구매 내역이 없어요.');
  };

  const redeem = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('redeem_promo_code', { code: code.trim() });
      if (error) throw new Error(error.message);
      if (!data) {
        Alert.alert('코드 확인', '코드가 올바르지 않거나 이미 사용되었어요.');
        return;
      }
      setCode('');
      const next = await refreshEntitlement();
      await scheduleTrialEndingAlert(next.retailSource === 'promo' ? next.retailUntil : null);
      Alert.alert('이벤트 적용 완료', `${formatKoreanDate(data as string)}까지 매장용 유료 기능을 무료로 쓸 수 있어요.`);
    } catch (e) {
      Alert.alert('코드 사용 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setBusy(false);
    }
  };

  const status =
    mode === 'home'
      ? ent.adFree
        ? '광고 제거가 적용되어 있어요.'
        : null
      : ent.retailPremium
        ? ent.retailUntil
          ? `${formatKoreanDate(ent.retailUntil)}까지 매장용 유료 기능을 쓸 수 있어요.`
          : '매장용 유료 기능을 평생 쓸 수 있어요.'
        : !cfg.paywallEnabled
          ? '지금은 출시 기념으로 매장용 기능을 모두 무료로 쓸 수 있어요.'
          : null;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="p-4 pb-12">
      <Stack.Screen options={{ title: mode === 'home' ? '광고 제거' : '매장용 유료 이용' }} />

      {reason && REASON_TEXT[reason] ? (
        <View className="mb-3 rounded-xl border border-line bg-paper p-4">
          <Text className="text-ink text-sm">{REASON_TEXT[reason]}</Text>
        </View>
      ) : null}

      {status ? (
        <View className="mb-3 flex-row items-center rounded-xl border border-line bg-paper p-4">
          <MaterialCommunityIcons name="check-circle-outline" size={22} color="#CC2222" />
          <Text className="text-ink ml-2 flex-1 text-sm font-medium">{status}</Text>
        </View>
      ) : null}

      {mode === 'home' ? (
        <PlanCard
          title="광고 없이 평생 쓰기"
          price={price ? `${price} · 한 번 결제` : '준비 중'}
          notes={[
            `${price ?? '정해진 금액'}(부가세 포함), 한 번 결제로 광고가 영구 제거됩니다.`,
            '같은 구글 계정이면 휴대폰을 바꿔도 [구매 복원]으로 다시 적용됩니다.',
            '결제 즉시 광고 제거가 적용되어, 구매 후 7일 이내라도 이용을 시작한 경우 청약철회가 제한될 수 있습니다. 결제 후 48시간 이내에는 구글 플레이에서 직접 환불 요청할 수 있습니다.',
          ]}
          buttonLabel={ent.adFree ? (ent.retailPremium ? '매장 이용권에 포함' : '구매 완료') : '구매하기'}
          disabled={!price || ent.adFree}
          onPress={purchase}
        />
      ) : (
        <PlanCard
          title="매장용 구독"
          price={price ? `월 ${price}` : '준비 중'}
          notes={[
            `월 ${price ?? '정해진 금액'}(부가세 포함), 매월 같은 날 자동 결제됩니다.`,
            '해지: 구글 플레이 → 결제 및 정기 결제 → 정기 결제 → 유통기한 매니저 → 정기 결제 취소. 아래 [구독 관리]에서도 바로 갈 수 있어요.',
            '해지해도 이미 결제한 기간이 끝날 때까지 유료 기능을 쓸 수 있습니다.',
            '가격이 오르면 결제일 30일 전까지 알리고 동의를 받습니다. 동의하지 않으면 자동 결제되지 않습니다.',
            '구독이 끝나도 등록한 상품·발주서·가격표는 지워지지 않습니다(새로 추가만 무료 한도 적용).',
          ]}
          buttonLabel={ent.retailSource === 'subscription' && ent.retailPremium ? '구독 중' : '구독하기'}
          disabled={!price || (ent.retailSource === 'subscription' && ent.retailPremium)}
          onPress={purchase}
        />
      )}

      <View className="mt-3 overflow-hidden rounded-xl border border-line bg-paper">
        <Pressable className="flex-row items-center px-4 py-3.5" disabled={restoring} onPress={restore}>
          <Text className="text-ink flex-1 text-sm">구매 복원</Text>
          {restoring ? <ActivityIndicator size="small" /> : null}
        </Pressable>
        {mode === 'retail' ? (
          <>
            <View className="h-px bg-line" />
            <Pressable
              className="px-4 py-3.5"
              onPress={() =>
                Linking.openURL(
                  `https://play.google.com/store/account/subscriptions?sku=retail_monthly&package=${PACKAGE}`,
                )
              }
            >
              <Text className="text-ink text-sm">구독 관리 (구글 플레이)</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {mode === 'retail' ? (
        <View className="mt-5 rounded-xl border border-line bg-paper p-4">
          <Text className="text-ink text-base font-bold">이벤트 코드</Text>
          <Text className="text-muted mt-1 text-xs">
            받은 코드를 입력하면 매장용 유료 기능을 무료로 쓸 수 있어요. 계정당 한 번만 쓸 수 있어요.
          </Text>
          <TextInput
            className="text-ink mt-3 rounded-lg border border-line px-3 py-2.5 text-base"
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor="#AAAAAA"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            maxLength={20}
          />
          <Pressable
            className={`mt-3 items-center rounded-lg py-3 ${code.trim().length >= 12 && !busy ? 'bg-primary' : 'bg-line'}`}
            disabled={code.trim().length < 12 || busy}
            onPress={redeem}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-sm font-bold text-white">코드 사용하기</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function PlanCard({
  title,
  price,
  notes,
  buttonLabel,
  disabled,
  onPress,
}: {
  title: string;
  price: string;
  notes: string[];
  buttonLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View className="rounded-xl border border-line bg-paper p-4">
      <Text className="text-ink text-lg font-bold">{title}</Text>
      <Text className="text-primary mt-1 text-xl font-bold">{price}</Text>
      <View className="mt-3">
        {notes.map((n) => (
          <Text key={n} className="text-muted mb-1.5 text-xs leading-5">
            · {n}
          </Text>
        ))}
      </View>
      <Pressable
        className={`mt-2 items-center rounded-lg py-3 ${disabled ? 'bg-line' : 'bg-primary'}`}
        disabled={disabled}
        onPress={onPress}
      >
        <Text className="text-sm font-bold text-white">{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}
