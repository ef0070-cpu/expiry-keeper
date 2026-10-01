import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

/** 검색된 이미지 후보 중 사용자가 직접 고르게 하는 모달 — 자동 선택 대신 명시적 선택을 강제한다. */
export default function ImageCandidatesModal({
  visible,
  candidates,
  onSelect,
  onClose,
}: {
  visible: boolean;
  candidates: string[];
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  // 미리 내려받아 검사하지 않고 바로 보여 주는 대신, 못 여는 사진(깨진 링크·차단)은 여기서 빼서 빈 칸이 안 남게 한다
  const [failed, setFailed] = useState<Set<string>>(new Set());
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
        <Pressable
          className="w-full max-h-[70%] rounded-2xl bg-paper p-4"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-ink mb-3 text-base font-bold">사진을 선택하세요</Text>
          <ScrollView>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {candidates.filter((u) => !failed.has(u)).map((url) => (
                <Pressable
                  key={url}
                  onPress={() => onSelect(url)}
                  className="overflow-hidden rounded-xl border border-line active:opacity-70"
                  style={{ width: '31%', aspectRatio: 1 }}
                  accessibilityRole="button"
                  accessibilityLabel="이 사진 선택"
                >
                  <Image
                    source={{ uri: url }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    onError={() => setFailed((prev) => new Set(prev).add(url))}
                  />
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Pressable onPress={onClose} className="mt-3 items-center py-2">
            <Text className="text-muted text-sm">취소</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
