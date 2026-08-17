import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { getMyTeam } from '@/lib/team';
import { Team } from '@/lib/types';

function buildInviteMessage(team: Team): string {
  const link = Linking.createURL('team', { queryParams: { code: team.inviteCode } });
  return `[유통기한 지킴이] '${team.name}' 팀에 초대합니다.\n초대 코드: ${team.inviteCode}\n아래 링크로 바로 참여하세요.\n${link}`;
}

function InviteRow({
  icon,
  color,
  title,
  desc,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  title: string;
  desc: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="mt-3 flex-row items-center rounded-xl border border-line bg-paper p-4 active:opacity-70"
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: color }}
      >
        <MaterialCommunityIcons name={icon} size={22} color="#FFFFFF" />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold">{title}</Text>
        <Text className="text-muted mt-0.5 text-xs leading-4">{desc}</Text>
      </View>
    </Pressable>
  );
}

export default function TeamInviteScreen() {
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getMyTeam()
        .then(setTeam)
        .catch((e) => Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류'))
        .finally(() => setLoading(false));
    }, []),
  );

  const onShareLink = async () => {
    if (!team) return;
    try {
      await Share.share({ message: buildInviteMessage(team) });
    } catch (e) {
      Alert.alert('공유 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    }
  };

  const onInviteContact = async () => {
    if (!team) return;
    setBusy(true);
    try {
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return; // 사용자가 취소함
      const phone = contact.phoneNumbers?.[0]?.number;
      if (!phone) {
        Alert.alert('안내', '선택한 연락처에 전화번호가 없어요.');
        return;
      }
      const body = encodeURIComponent(buildInviteMessage(team));
      const smsUrl = `sms:${phone}${Platform.OS === 'ios' ? '&' : '?'}body=${body}`;
      const supported = await Linking.canOpenURL(smsUrl);
      if (!supported) {
        Alert.alert('오류', '문자 메시지 앱을 열 수 없어요.');
        return;
      }
      await Linking.openURL(smsUrl);
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '연락처를 불러오지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color="#CC2222" />
      </View>
    );
  }

  if (!team) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <Text className="text-ink text-center text-base font-bold">참여 중인 팀이 없어요</Text>
        <Text className="text-muted mt-2 text-center text-sm">팀을 먼저 만들거나 참여해 주세요.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 16 }}>
      <Text className="text-ink text-2xl font-bold">멤버 초대</Text>
      <Text className="text-muted mt-2 text-sm leading-5">
        멤버들과 함께 유통기한 상품을 공유해 보세요.
      </Text>

      <InviteRow
        icon="email-fast-outline"
        color="#F5A623"
        title="초대 링크 공유"
        desc="메신저, 이메일, 문자 등으로 공유하세요."
        onPress={onShareLink}
        disabled={busy}
      />
      <InviteRow
        icon="card-account-phone-outline"
        color="#2FB380"
        title="연락처 친구 초대"
        desc="주소록에 있는 친구에게 초대 메시지를 보내세요."
        onPress={onInviteContact}
        disabled={busy}
      />
    </ScrollView>
  );
}
