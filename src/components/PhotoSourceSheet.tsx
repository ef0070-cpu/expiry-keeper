import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import { dedupeByImage } from '@/lib/image-dedupe';
import { uploadPhotoToBucket } from '@/lib/storage';

/**
 * 사진 추가 방법 고르기(유통기한·발주 공용): 카메라 촬영 → 앨범에서 선택 → 웹에서 사진 찾기 → 취소.
 * 안드로이드 기본 Alert는 버튼이 3개까지라 직접 그린다. web을 안 넘기면(신고 사진) 웹 찾기는 숨긴다.
 */
export default function PhotoSourceSheet({
  visible,
  title,
  message,
  onClose,
  onCamera,
  onLibrary,
  web,
}: {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onCamera: () => void;
  onLibrary: () => void;
  web?: { name: string; barcode?: string | null; onPicked: (url: string) => void };
}) {
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);

  const pick = (fn: () => void) => {
    onClose();
    fn();
  };

  /** 바코드 매칭 사진(있으면)을 1순위로, 상품명 검색 결과를 더해 사용자가 직접 고르게 한다. */
  const searchWeb = async () => {
    if (!web) return;
    const name = web.name.trim();
    if (!name) {
      Alert.alert('입력 확인', '먼저 상품명을 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '웹에서 사진 찾기는 로그인해야 쓸 수 있어요. 직접 촬영하거나 앨범에서 선택해 주세요.');
      return;
    }
    setSearching(true);
    try {
      const urls: string[] = [];
      const code = web.barcode?.trim();
      if (code) {
        const info = await lookupBarcode(code);
        if (info.imageUrl) urls.push(info.imageUrl);
      }
      for (const u of await searchProductImageCandidates(name)) if (!urls.includes(u)) urls.push(u);
      // 주소만 다른 같은 사진은 하나로, 못 불러오는 사진은 빼고 보여 준다
      const shown = await dedupeByImage(urls, (u) => u);
      if (shown.length === 0) {
        Alert.alert('검색 결과 없음', '사진을 찾지 못했습니다. 직접 촬영해 주세요.');
        return;
      }
      onClose();
      setCandidates(shown);
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={onClose}>
          <Pressable className="w-full rounded-2xl bg-paper p-5" onPress={(e) => e.stopPropagation()}>
            <Text className="text-ink text-lg font-bold">{title}</Text>
            <Text className="text-muted mt-1 text-sm">{message}</Text>
            <View className="mt-4" style={{ gap: 8 }}>
              <SourceButton label="카메라 촬영" onPress={() => pick(onCamera)} />
              <SourceButton label="앨범에서 선택" onPress={() => pick(onLibrary)} />
              {web ? <SourceButton label="웹에서 사진 찾기" onPress={searchWeb} busy={searching} /> : null}
            </View>
            <Pressable onPress={onClose} className="mt-4 items-center self-end rounded-lg bg-primary px-5 py-2.5 active:opacity-80">
              <Text className="text-paper text-sm font-bold">취소</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <ImageCandidatesModal
        visible={candidates !== null}
        candidates={candidates ?? []}
        onSelect={async (url) => {
          setCandidates(null);
          // 검색결과 원본 링크는 핫링크 차단·임시 링크로 나중에 깨질 수 있어, 고르는 순간 우리
          // Storage로 다시 올려 안정적인 주소로 바꾼다. 실패하면 원본 링크라도 우선 쓴다.
          const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          const hosted = await uploadPhotoToBucket(url, 'product-images', path, true);
          web?.onPicked(hosted ?? url);
        }}
        onClose={() => setCandidates(null)}
      />
    </>
  );
}

function SourceButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="items-center rounded-xl border border-line bg-bg py-3 active:opacity-70"
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator size="small" color="#CC2222" /> : <Text className="text-ink text-base">{label}</Text>}
    </Pressable>
  );
}
