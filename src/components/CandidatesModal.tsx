import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Chip from '@/components/Chip';
import { submitBrandCandidateIfChanged } from '@/lib/brand-candidates';
import { submitNameCandidateIfChanged } from '@/lib/name-candidates';
import { applyOrderProductPhoto } from '@/lib/order-repo';
import {
  listPhotoCandidates,
  voteOnPhoto,
  listBrandCandidates,
  voteOnBrand,
  listNameCandidates,
  voteOnName,
  type PhotoCandidate,
  type BrandCandidate,
  type NameCandidate,
} from '@/lib/order-report';

type Tab = 'photo' | 'brand' | 'name';
type AnyCandidate = PhotoCandidate | BrandCandidate | NameCandidate;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

function candidateLabel(tab: Tab, c: AnyCandidate): string {
  if (tab === 'brand') return (c as BrandCandidate).brand;
  if (tab === 'name') return (c as NameCandidate).name;
  return '';
}

const TAB_CONFIG: Record<
  Tab,
  {
    title: string;
    list: (barcode: string) => Promise<AnyCandidate[]>;
    vote: (candidateId: string, value: 1 | -1) => Promise<void>;
    submit: ((barcode: string, value: string) => Promise<void>) | null;
    placeholder?: string;
    emptyText: string;
  }
> = {
  photo: {
    title: '사진',
    list: listPhotoCandidates,
    vote: voteOnPhoto,
    submit: null,
    emptyText: '등록된 후보 사진이 없습니다.',
  },
  brand: {
    title: '브랜드',
    list: listBrandCandidates,
    vote: voteOnBrand,
    submit: submitBrandCandidateIfChanged,
    placeholder: '다른 브랜드 제안하기',
    emptyText: '등록된 후보가 없습니다.',
  },
  name: {
    title: '상품명',
    list: listNameCandidates,
    vote: voteOnName,
    submit: submitNameCandidateIfChanged,
    placeholder: '다른 이름 제안하기',
    emptyText: '등록된 후보가 없습니다.',
  },
};

/**
 * 이 바코드의 사진/브랜드/상품명 후보를 탭으로 전환하며 보여주고 좋아요/싫어요 투표를 받는다.
 * initialTab으로 열리지만 상단 탭으로 자유롭게 다른 탭으로 전환할 수 있다. 대표값은 DB 트리거가
 * 득표수로 자동 결정하므로, 여기서 직접 "이걸로 확정" 선택은 없다(사진 탭의 좋아요만 예외 —
 * 아래 vote() 참고).
 */
export default function CandidatesModal({
  visible,
  barcode,
  initialTab,
  onClose,
  onPhotoApplied,
}: {
  visible: boolean;
  barcode: string;
  initialTab: Tab;
  onClose: () => void;
  /** 사진 탭에서 좋아요를 눌러 그 사진이 내 상품 사진으로 즉시 반영됐을 때 알려준다. */
  onPhotoApplied?: (photoUri: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [candidates, setCandidates] = useState<AnyCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [newValue, setNewValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTab(initialTab);
  }, [visible, initialTab]);

  useEffect(() => {
    if (!visible) return;
    setNewValue('');
    let cancelled = false;
    setLoading(true);
    TAB_CONFIG[tab]
      .list(barcode)
      .then((result) => {
        if (!cancelled) setCandidates(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, barcode, tab]);

  const vote = async (candidateId: string, value: 1 | -1) => {
    const target = candidates.find((c) => c.id === candidateId);
    // 이미 좋아요 상태에서 다시 누르면 투표 취소(중립)이지 "선택"이 아니므로, 그때는 적용하지 않는다.
    const applyAsMyPhoto = tab === 'photo' && value === 1 && target?.myVote !== 1;
    setVotingId(candidateId);
    try {
      await TAB_CONFIG[tab].vote(candidateId, value);
      const fresh = await TAB_CONFIG[tab].list(barcode);
      setCandidates(fresh);
      if (applyAsMyPhoto && target) {
        const photoUri = (target as PhotoCandidate).photoUri;
        await applyOrderProductPhoto(barcode, photoUri);
        onPhotoApplied?.(photoUri);
      }
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  const submitNew = async () => {
    const submit = TAB_CONFIG[tab].submit;
    const v = newValue.trim();
    if (!submit || !v) return;
    setSubmitting(true);
    try {
      await submit(barcode, v);
      setNewValue('');
      setCandidates(await TAB_CONFIG[tab].list(barcode));
    } finally {
      setSubmitting(false);
    }
  };

  const config = TAB_CONFIG[tab];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="mb-3 flex-row" style={{ gap: 8 }}>
            {(Object.keys(TAB_CONFIG) as Tab[]).map((t) => (
              <Chip key={t} label={TAB_CONFIG[t].title} active={tab === t} onPress={() => setTab(t)} />
            ))}
          </View>
          <Text className="text-ink mb-3 text-base font-bold">{config.title} 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">{config.emptyText}</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className={`mb-3 flex-row items-center rounded-xl border border-line ${
                    tab === 'photo' ? 'p-2' : 'p-3'
                  }`}
                >
                  {tab === 'photo' ? (
                    <Image
                      source={{ uri: (c as PhotoCandidate).photoUri }}
                      style={{ width: 64, height: 64, borderRadius: 8 }}
                      contentFit="cover"
                    />
                  ) : (
                    <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                      {candidateLabel(tab, c)}
                    </Text>
                  )}
                  <View
                    className={tab === 'photo' ? 'ml-3 flex-1 flex-row items-center justify-around' : 'flex-row items-center'}
                    style={tab === 'photo' ? undefined : { gap: 16 }}
                  >
                    <Pressable
                      onPress={() => vote(c.id, 1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      hitSlop={11}
                      accessibilityRole="button"
                      accessibilityLabel="좋아요"
                    >
                      {votingId === c.id ? (
                        <ActivityIndicator size="small" color="#2E7D32" />
                      ) : (
                        <MaterialCommunityIcons
                          name={c.myVote === 1 ? 'thumb-up' : 'thumb-up-outline'}
                          size={22}
                          color={c.myVote === 1 ? '#2E7D32' : '#888888'}
                        />
                      )}
                      <Text className="text-ink mt-0.5 text-xs">{c.likes}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => vote(c.id, -1)}
                      disabled={votingId === c.id}
                      className="items-center"
                      hitSlop={11}
                      accessibilityRole="button"
                      accessibilityLabel="싫어요"
                    >
                      {votingId === c.id ? (
                        <ActivityIndicator size="small" color="#C62828" />
                      ) : (
                        <MaterialCommunityIcons
                          name={c.myVote === -1 ? 'thumb-down' : 'thumb-down-outline'}
                          size={22}
                          color={c.myVote === -1 ? '#C62828' : '#888888'}
                        />
                      )}
                      <Text className="text-ink mt-0.5 text-xs">{c.dislikes}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
          {config.submit ? (
            <View className="mt-3 flex-row gap-2">
              <TextInput
                className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                placeholder={config.placeholder}
                placeholderTextColor="#BBBBBB"
                value={newValue}
                onChangeText={setNewValue}
                onSubmitEditing={submitNew}
              />
              <Pressable
                onPress={submitNew}
                disabled={submitting}
                className="items-center justify-center rounded-xl border border-line bg-bg px-4 active:opacity-70"
              >
                <Text className="text-ink text-sm font-medium">{submitting ? '제출 중' : '제안'}</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
