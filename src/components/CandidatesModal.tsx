import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { errorMessage } from '@/lib/errors';
import { applyOrderProductPhoto } from '@/lib/order-repo';
import { deletePhotoCandidate, listPhotoCandidates, voteOnPhoto, type PhotoCandidate } from '@/lib/order-report';

/**
 * 이 바코드에 다른 사용자들이 올린 사진 중 하나를 골라 내 상품 사진으로 바로 적용한다.
 * 고르면 내부적으로 좋아요 투표도 함께 기록되어(자동투표) 대표 사진 선정에 반영되지만,
 * 화면에는 득표수·좋아요/싫어요 같은 투표 UI를 노출하지 않고 "사진 선택" 동작으로만 보여준다.
 */
export default function CandidatesModal({
  visible,
  barcode,
  onClose,
  onPhotoApplied,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
  onPhotoApplied?: (photoUri: string) => void;
}) {
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setImageErrors(new Set());
    let cancelled = false;
    setLoading(true);
    listPhotoCandidates(barcode)
      .then((result) => {
        if (!cancelled) setCandidates(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, barcode]);

  const selectPhoto = async (candidate: PhotoCandidate) => {
    setApplyingId(candidate.id);
    try {
      // 이미 내가 좋아요 누른 사진이면 다시 투표할 필요 없다(voteOnPhoto는 같은 값 재투표 시
      // 취소로 동작해, 그러면 이 선택 자체가 좋아요를 도로 지워버린다).
      if (candidate.myVote !== 1) await voteOnPhoto(candidate.id, 1);
      await applyOrderProductPhoto(barcode, candidate.photoUri);
      onPhotoApplied?.(candidate.photoUri);
      onClose();
    } catch (e) {
      Alert.alert('적용 실패', errorMessage(e));
    } finally {
      setApplyingId(null);
    }
  };

  // 같은 상품을 여러 번 촬영해 올리면(재촬영·재선택) 매번 새 URL로 후보가 추가되어
  // 겉보기엔 같은 사진인데 후보 목록에 여러 장이 쌓일 수 있다(파일 내용을 서버가 비교하지
  // 않기 때문). 잘못 올렸거나 중복인 사진을 직접 지울 수 있게 한다.
  const deleteCandidate = (candidate: PhotoCandidate) => {
    Alert.alert('사진 삭제', '이 사진을 후보 목록에서 제거할까요? 모든 사용자에게서 사라집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(candidate.id);
          try {
            await deletePhotoCandidate(barcode, candidate.photoUri);
            setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
          } catch (e) {
            Alert.alert('삭제 실패', errorMessage(e));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">제품 사진 선택 하기</Text>
          {loading ? (
            <ActivityIndicator color="#CC2222" />
          ) : candidates.length === 0 ? (
            <Text className="text-muted text-sm">등록된 사진이 없습니다.</Text>
          ) : (
            <ScrollView>
              {candidates.map((c) => (
                <View key={c.id} className="mb-3 flex-row items-center rounded-xl border border-line p-2">
                  {imageErrors.has(c.id) ? (
                    // 죽은 링크/핫링크 차단 등으로 로드에 실패한 사진 — 빈 칸 대신 실패임을 표시한다.
                    <View
                      style={{ width: 64, height: 64, borderRadius: 8 }}
                      className="items-center justify-center bg-bg"
                    >
                      <MaterialCommunityIcons name="image-off-outline" size={22} color="#BBBBBB" />
                    </View>
                  ) : (
                    <Image
                      source={{ uri: c.photoUri }}
                      style={{ width: 64, height: 64, borderRadius: 8 }}
                      contentFit="cover"
                      onError={() => setImageErrors((prev) => new Set(prev).add(c.id))}
                    />
                  )}
                  <Pressable
                    onPress={() => selectPhoto(c)}
                    disabled={applyingId === c.id || deletingId === c.id}
                    className="ml-3 flex-1 items-center justify-center rounded-xl border border-line bg-bg py-2.5 active:opacity-70"
                  >
                    {applyingId === c.id ? (
                      <ActivityIndicator size="small" color="#CC2222" />
                    ) : (
                      <Text className="text-ink text-sm font-medium">이 사진으로 변경할래요</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => deleteCandidate(c)}
                    disabled={applyingId === c.id || deletingId === c.id}
                    className="ml-2 items-center justify-center"
                    style={{ width: 32, height: 32 }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="사진 삭제"
                  >
                    {deletingId === c.id ? (
                      <ActivityIndicator size="small" color="#888888" />
                    ) : (
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color="#888888" />
                    )}
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          <Text className="text-muted mt-3 text-xs">
            다른 사용자가 직접 촬영해 올린 사진입니다. 마음에 드는 사진이 없다면 직접 촬영해서 올려주세요.
          </Text>
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
