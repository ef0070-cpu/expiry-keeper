import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { applyOrderProductPhoto } from '@/lib/order-repo';
import { listPhotoCandidates, voteOnPhoto, type PhotoCandidate } from '@/lib/order-report';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return '알 수 없는 오류';
}

/**
 * 이 바코드에 등록된 사진 후보들을 보여주고 좋아요/싫어요 투표를 받는다.
 * 대표 사진은 DB 트리거가 득표수로 자동 결정하므로, 여기서 직접 "이걸로 확정" 선택은 없다.
 */
export default function PhotoCandidatesModal({
  visible,
  barcode,
  onClose,
  onPhotoApplied,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
  /** 좋아요를 눌러 그 사진이 내 상품 사진으로 즉시 반영됐을 때 알려준다(폼 화면의 미리보기 갱신용). */
  onPhotoApplied?: (photoUri: string) => void;
}) {
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    listPhotoCandidates(barcode)
      .then(setCandidates)
      .finally(() => setLoading(false));
  }, [visible, barcode]);

  const vote = async (photoId: string, value: 1 | -1) => {
    // 이미 좋아요 상태에서 다시 누르면 투표 취소(중립)이지 "선택"이 아니므로, 그때는 적용하지 않는다.
    const target = candidates.find((c) => c.id === photoId);
    const applyAsMyPhoto = value === 1 && target?.myVote !== 1;
    setVotingId(photoId);
    try {
      await voteOnPhoto(photoId, value);
      setCandidates(await listPhotoCandidates(barcode));
      if (applyAsMyPhoto && target) {
        await applyOrderProductPhoto(barcode, target.photoUri);
        onPhotoApplied?.(target.photoUri);
      }
    } catch (e) {
      Alert.alert('투표 실패', errorMessage(e));
    } finally {
      setVotingId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">사진 후보 / 투표</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 후보 사진이 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View
                  key={c.id}
                  className="mb-3 flex-row items-center rounded-xl border border-line p-2"
                >
                  <Image
                    source={{ uri: c.photoUri }}
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                    contentFit="cover"
                  />
                  <View className="ml-3 flex-1 flex-row items-center justify-around">
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
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
