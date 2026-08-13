import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isCloudMode, supabase } from '@/lib/supabase';
import {
  createTeam,
  getMyTeam,
  joinTeam,
  leaveTeam,
  listMembers,
  moveMyProductsToTeam,
} from '@/lib/team';
import { Team, TeamMember } from '@/lib/types';

export default function TeamScreen() {
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isCloudMode) {
      setLoading(false);
      return;
    }
    try {
      const t = await getMyTeam();
      setTeam(t);
      setMembers(t ? await listMembers() : []);
      const { data } = await supabase!.auth.getUser();
      setMyId(data.user?.id ?? null);
    } catch (e) {
      Alert.alert('불러오기 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () =>
    run(async () => {
      const name = teamName.trim();
      if (!name) {
        Alert.alert('입력 확인', '팀(매장) 이름을 입력해 주세요.');
        return;
      }
      const t = await createTeam(name);
      setTeamName('');
      Alert.alert(
        '팀 생성 완료',
        `초대 코드는 [${t.inviteCode}] 입니다.\n직원들에게 이 코드를 알려주세요.`,
      );
      await load();
    });

  const onJoin = () =>
    run(async () => {
      const c = code.trim();
      if (c.length !== 6) {
        Alert.alert('입력 확인', '6자리 초대 코드를 입력해 주세요.');
        return;
      }
      const t = await joinTeam(c);
      setCode('');
      Alert.alert('참여 완료', `'${t.name}' 팀에 합류했습니다.`);
      await load();
    });

  const onMoveProducts = () => {
    if (!team) return;
    Alert.alert(
      '내 상품을 팀으로 옮기기',
      '혼자 쓸 때 등록한 상품들을 팀 전체가 볼 수 있게 전환합니다. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '옮기기',
          onPress: () =>
            run(async () => {
              const n = await moveMyProductsToTeam(team.id);
              Alert.alert('완료', n > 0 ? `${n}개 상품을 팀으로 옮겼습니다.` : '옮길 개인 상품이 없습니다.');
            }),
        },
      ],
    );
  };

  const onLeave = () => {
    Alert.alert(
      '팀 나가기',
      '팀에서 나가면 팀 상품이 더 이상 보이지 않습니다.\n내가 등록한 상품은 개인 상품으로 돌아옵니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await leaveTeam();
              await load();
            }),
        },
      ],
    );
  };

  // ── 로컬 모드: 안내만 표시 ──
  if (!isCloudMode) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <MaterialCommunityIcons name="cloud-off-outline" size={48} color="#CCCCCC" />
        <Text className="text-ink mt-4 text-center text-base font-bold">
          팀 기능은 클라우드 모드에서 사용할 수 있어요
        </Text>
        <Text className="text-muted mt-2 text-center text-sm leading-5">
          지금은 휴대폰에만 저장하는 로컬 모드입니다.{'\n'}
          Supabase 설정(.env)을 마치면 팀을 만들어{'\n'}직원들과 함께 재고를 관리할 수 있어요.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator size="large" color="#CC2222" />
      </View>
    );
  }

  // ── 팀 있음: 팀 정보 + 멤버 목록 ──
  if (team) {
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 16 }}>
        <View className="rounded-xl border border-line bg-paper p-4">
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="storefront-outline" size={20} color="#CC2222" />
            <Text className="text-ink ml-2 text-lg font-bold">{team.name}</Text>
          </View>
          <Text className="text-muted mt-3 text-xs">초대 코드 (직원에게 알려주세요)</Text>
          <Text
            className="text-primary mt-1 text-3xl font-bold"
            style={{ letterSpacing: 6 }}
            selectable
          >
            {team.inviteCode}
          </Text>
        </View>

        <Text className="text-ink mb-2 mt-6 text-sm font-bold">멤버 {members.length}명</Text>
        <View className="rounded-xl border border-line bg-paper">
          {members.map((m, i) => (
            <View
              key={m.userId}
              className={`flex-row items-center px-4 py-3 ${
                i > 0 ? 'border-t border-line' : ''
              }`}
            >
              <MaterialCommunityIcons
                name={m.userId === myId ? 'account-circle' : 'account-circle-outline'}
                size={22}
                color={m.userId === myId ? '#CC2222' : '#888888'}
              />
              <Text className="text-ink ml-2.5 flex-1 text-sm" numberOfLines={1}>
                {m.email ?? '(이메일 없음)'}
              </Text>
              {m.userId === myId ? <Text className="text-muted text-xs">나</Text> : null}
            </View>
          ))}
        </View>

        <Pressable
          onPress={onMoveProducts}
          disabled={busy}
          className="mt-6 flex-row items-center justify-center rounded-xl border border-line bg-paper py-3.5 active:opacity-70"
        >
          <MaterialCommunityIcons name="package-variant" size={18} color="#1A1A1A" />
          <Text className="text-ink ml-2 text-sm font-medium">내 개인 상품을 팀으로 옮기기</Text>
        </Pressable>

        <Pressable
          onPress={onLeave}
          disabled={busy}
          className="mt-3 items-center rounded-xl border border-line py-3.5 active:opacity-70"
        >
          <Text className="text-primary text-sm font-medium">팀 나가기</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── 팀 없음: 만들기 / 참여하기 ──
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 16 }}>
        <View className="rounded-xl border border-line bg-paper p-4">
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="plus-circle-outline" size={18} color="#CC2222" />
            <Text className="text-ink ml-2 text-base font-bold">새 팀 만들기</Text>
          </View>
          <Text className="text-muted mt-1 text-xs">
            매장 이름으로 팀을 만들고, 초대 코드를 직원들에게 알려주세요.
          </Text>
          <TextInput
            className="text-ink mt-3 rounded-xl border border-line bg-bg px-4 py-3 text-base"
            placeholder="팀(매장) 이름 — 예: 00동 1호점"
            placeholderTextColor="#BBBBBB"
            value={teamName}
            onChangeText={setTeamName}
          />
          <Pressable
            onPress={onCreate}
            disabled={busy}
            className="mt-3 items-center rounded-xl bg-primary py-3 active:opacity-80"
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-paper text-sm font-bold">팀 만들기</Text>
            )}
          </Pressable>
        </View>

        <View className="mt-4 rounded-xl border border-line bg-paper p-4">
          <View className="flex-row items-center">
            <MaterialCommunityIcons name="account-plus-outline" size={18} color="#CC2222" />
            <Text className="text-ink ml-2 text-base font-bold">초대 코드로 참여</Text>
          </View>
          <Text className="text-muted mt-1 text-xs">
            팀장에게 받은 6자리 코드를 입력하면 팀 상품을 함께 관리할 수 있어요.
          </Text>
          <TextInput
            className="text-ink mt-3 rounded-xl border border-line bg-bg px-4 py-3 text-base"
            placeholder="초대 코드 6자리"
            placeholderTextColor="#BBBBBB"
            autoCapitalize="characters"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
          />
          <Pressable
            onPress={onJoin}
            disabled={busy}
            className="mt-3 items-center rounded-xl bg-primary py-3 active:opacity-80"
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-paper text-sm font-bold">참여하기</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
