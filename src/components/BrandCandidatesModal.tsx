import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { submitBrandCandidateIfChanged } from '@/lib/brand-candidates';
import { listBrandCandidates, voteOnBrand, type BrandCandidate } from '@/lib/order-report';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

/**
 * 이 바코드에 등록된 브랜드 후보들을 보여주고 좋아요/싫어요 투표를 받는다. 하단에서 새
 * 브랜드도 제안할 수 있다. 대표 브랜드는 DB 트리거가 득표수로 자동 결정하므로, 여기서 직접
 * "이걸로 확정" 선택은 없다.
 */
export default function BrandCandidatesModal({
  visible,
  barcode,
  onClose,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<BrandCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    listBrandCandidates(barcode)
      .then(setCandidates)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, barcode]);

  const vote = async (candidateId: string, value: 1 | -1) => {
    setVotingId(candidateId);
    try {
      await voteOnBrand(candidateId, value);
      load();
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  const submitNew = async () => {
    const v = newBrand.trim();
    if (!v) return;
    setSubmitting(true);
    try {
      await submitBrandCandidateIfChanged(barcode, v);
      setNewBrand('');
      load();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">브랜드 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 후보가 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className="mb-3 flex-row items-center rounded-xl border border-line p-3"
                >
                  <Text className="text-ink flex-1 text-sm font-medium" numberOfLines={1}>
                    {c.brand}
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 16 }}>
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
          <View className="mt-3 flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-bg px-3 py-2 text-sm"
              placeholder="다른 브랜드 제안하기"
              placeholderTextColor="#BBBBBB"
              value={newBrand}
              onChangeText={setNewBrand}
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
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
