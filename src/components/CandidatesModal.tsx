import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { errorMessage } from '@/lib/errors';
import { dedupeByImage } from '@/lib/image-dedupe';
import { applyOrderProductPhoto } from '@/lib/order-repo';
import { deletePhotoCandidate, listPhotoCandidates, voteOnPhoto, type PhotoCandidate } from '@/lib/order-report';
import { ownPhotoDeleteVerdict, type DeleteVerdict } from '@/lib/photo-delete-rule';
import { getHiddenPhotoIds, hidePhotoCandidate } from '@/lib/photo-hidden';

/** 사진 카드 위쪽 한 줄 안내 — 내가 올린 사진이면 지금 삭제할 수 있는지와 그 이유를 알려 준다 */
function sourceLabel(c: PhotoCandidate, verdict: DeleteVerdict): string {
  if (!c.mine) return '다른 사용자가 올린 사진';
  if (verdict.ok) return '내가 올린 사진 · 지금은 삭제할 수 있어요';
  if (verdict.reason === 'used-by-others') return '내가 올린 사진 · 다른 분도 쓰는 사진이라 삭제할 수 없어요';
  return '내가 올린 사진 · 올린 지 하루가 지나 삭제할 수 없어요';
}

const PHOTO_SIZE = 96; // 같은 상품인지 알아볼 수 있게(예전 64)
const BRAND = '#CC2222';

/** 사진 카드 아래의 글자 버튼(아이콘만 있으면 무슨 동작인지 알 수 없어 글자를 함께 둔다). 터치 높이 44 */
function TextAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
  busy,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  busy?: boolean;
}) {
  const color = danger ? BRAND : '#555555';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center justify-center rounded-lg px-2 active:bg-bg"
      style={{ minHeight: 44, gap: 4, opacity: disabled ? 0.5 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : <MaterialCommunityIcons name={icon} size={18} color={color} />}
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * 이 바코드에 다른 사용자들이 올린 사진 중 하나를 골라 내 상품 사진으로 바로 적용한다.
 * 고르면 내부적으로 좋아요 투표도 함께 기록되어(자동투표) 대표 사진 선정에 반영되지만,
 * 화면에는 득표수 같은 투표 숫자를 노출하지 않는다.
 *
 * 엉뚱한 사진 정리(2026-10-30): 사진 삭제는 모든 사용자의 목록에서 사라지므로 내가 올린 사진에만 둔다.
 * 남의 사진은 "내 폰에서 숨기기"(이 기기에만 저장, 서버 그대로)나 "이 사진 아니에요"(비추천 투표)로 정리한다.
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
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setImageErrors(new Set());
    let cancelled = false;
    setLoading(true);
    Promise.all([listPhotoCandidates(barcode), getHiddenPhotoIds(barcode)])
      // 같은 사진(주소만 다름)은 하나로, 내가 숨긴 사진은 빼고 보여 준다.
      // 목록은 먼저 올린 순이라 첫 번째(오래된 후보)가 남는다.
      .then(async ([result, hidden]) => (await dedupeByImage(result, (c) => c.photoUri)).filter((c) => !hidden.has(c.id)))
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

  const busy = applyingId !== null || deletingId !== null || reportingId !== null;

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

  const removeFromList = (id: string) => setCandidates((prev) => prev.filter((c) => c.id !== id));

  /** 내가 올린 사진만 지운다 — 지우면 다른 사용자의 목록에서도 사라지므로 문구로 분명히 알린다 */
  const deleteMine = (candidate: PhotoCandidate) => {
    Alert.alert('내가 올린 사진 삭제', '지우면 다른 사용자의 사진 목록에서도 사라져요. 지울까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(candidate.id);
          try {
            await deletePhotoCandidate(barcode, candidate.photoUri);
            removeFromList(candidate.id);
          } catch (e) {
            Alert.alert('삭제 실패', errorMessage(e));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  /** 서버는 그대로 두고 이 폰의 목록에서만 뺀다 */
  const hideForMe = (candidate: PhotoCandidate) => {
    hidePhotoCandidate(barcode, candidate.id);
    removeFromList(candidate.id);
  };

  /** "이 사진 아니에요": 비추천 투표 한 표를 남기고 내 목록에서도 숨긴다. 다른 사용자 목록에서 바로 지워지지는 않는다 */
  const reportWrong = (candidate: PhotoCandidate) => {
    Alert.alert(
      '이 상품 사진이 아닌가요?',
      '"이 사진 아니에요" 의견을 한 표 남기고, 내 목록에서는 숨겨요. 다른 사용자 목록에서 바로 지워지지는 않고, 이런 의견이 쌓이면 대표 사진에서 빠져요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '알리기',
          onPress: async () => {
            setReportingId(candidate.id);
            try {
              // 이미 비추천이면 다시 누르면 취소로 동작하므로 건너뛴다
              if (candidate.myVote !== -1) await voteOnPhoto(candidate.id, -1);
              hideForMe(candidate);
            } catch (e) {
              Alert.alert('알리기 실패', errorMessage(e));
            } finally {
              setReportingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-5" onPress={onClose}>
        <Pressable className="w-full rounded-3xl bg-paper p-5" style={{ maxHeight: '82%' }} onPress={(e) => e.stopPropagation()}>
          <Text className="text-ink text-lg font-bold">제품 사진 선택하기</Text>
          <Text className="text-muted mt-1 text-sm">다른 사용자가 올린 사진이에요. 맞는 사진을 골라 주세요.</Text>

          {loading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={BRAND} />
            </View>
          ) : candidates.length === 0 ? (
            <View className="items-center py-8" style={{ gap: 8 }}>
              <MaterialCommunityIcons name="image-off-outline" size={36} color="#BBBBBB" />
              <Text className="text-ink text-base font-bold">보여 드릴 사진이 없어요</Text>
              <Text className="text-muted text-center text-sm">직접 촬영해서 올려 주시면 다른 분들도 쓸 수 있어요.</Text>
            </View>
          ) : (
            <ScrollView className="mt-4" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {candidates.map((c) => {
                const verdict = ownPhotoDeleteVerdict(c, Date.now());
                return (
                <View key={c.id} className="mb-3 rounded-2xl border border-line bg-bg p-3">
                  <View className="flex-row" style={{ gap: 12 }}>
                    {imageErrors.has(c.id) ? (
                      // 죽은 링크/핫링크 차단 등으로 로드에 실패한 사진 — 빈 칸 대신 실패임을 표시한다.
                      <View
                        style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 12 }}
                        className="items-center justify-center bg-paper"
                      >
                        <MaterialCommunityIcons name="image-off-outline" size={26} color="#BBBBBB" />
                      </View>
                    ) : (
                      <Image
                        source={{ uri: c.photoUri }}
                        style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 12, backgroundColor: '#FFFFFF' }}
                        contentFit="cover"
                        onError={() => setImageErrors((prev) => new Set(prev).add(c.id))}
                      />
                    )}
                    <View className="flex-1 justify-between">
                      <Text className="text-muted text-xs">{sourceLabel(c, verdict)}</Text>
                      <Pressable
                        onPress={() => selectPhoto(c)}
                        disabled={busy}
                        className="items-center justify-center rounded-xl active:opacity-80"
                        style={{ minHeight: 48, backgroundColor: BRAND, opacity: busy && applyingId !== c.id ? 0.5 : 1 }}
                        accessibilityRole="button"
                        accessibilityLabel="이 사진으로 바꾸기"
                      >
                        {applyingId === c.id ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text className="text-base font-bold" style={{ color: '#FFFFFF' }} numberOfLines={1}>
                            이 사진으로 바꾸기
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                  <View className="mt-2 flex-row flex-wrap items-center justify-end" style={{ gap: 4 }}>
                    {verdict.ok ? (
                      // 내가 올렸고, 다른 사람이 안 쓰고, 24시간 안 — 실수로 올린 사진을 바로 지울 수 있다
                      <TextAction
                        icon="trash-can-outline"
                        label="삭제"
                        danger
                        busy={deletingId === c.id}
                        disabled={busy}
                        onPress={() => deleteMine(c)}
                      />
                    ) : (
                      <>
                        <TextAction icon="eye-off-outline" label="내 폰에서 숨기기" disabled={busy} onPress={() => hideForMe(c)} />
                        {c.mine ? null : (
                          <TextAction
                            icon="thumb-down-outline"
                            label="이 사진 아니에요"
                            busy={reportingId === c.id}
                            disabled={busy}
                            onPress={() => reportWrong(c)}
                          />
                        )}
                      </>
                    )}
                  </View>
                </View>
                );
              })}
            </ScrollView>
          )}

          <Text className="text-muted mt-2 text-xs">
            마음에 드는 사진이 없다면 직접 촬영해서 올려 주세요. 숨긴 사진은 이 폰에서만 안 보여요.
          </Text>
          <Pressable
            onPress={onClose}
            className="mt-3 items-center justify-center rounded-xl border border-line active:bg-bg"
            style={{ minHeight: 48 }}
            accessibilityRole="button"
            accessibilityLabel="닫기"
          >
            <Text className="text-ink text-base font-medium">닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
