import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentType } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { DateOcrOrder } from '@/lib/settings';

type Props = {
  dateOcrOrder: DateOcrOrder;
  onDetected: (date: string) => void;
  onClose: () => void;
};

// 카메라 모듈(react-native-vision-camera)은 새 빌드에만 들어 있다. 예전 빌드에서 바로 import하면
// 앱이 켜지자마자 멈추므로, 필요할 때 불러오고 없으면 안내만 보여 준다.
let LiveCamera: ComponentType<Props> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LiveCamera = require('./ExpiryLiveScanCamera').default;
} catch {
  LiveCamera = null;
}

/** 유통기한 실시간 자동 인식 화면(전체 화면 Modal). */
export default function ExpiryLiveScanModal(props: Props) {
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      {LiveCamera ? (
        <LiveCamera {...props} />
      ) : (
        <View className="flex-1 items-center justify-center bg-paper px-8">
          <MaterialCommunityIcons name="update" size={48} color="#888888" />
          <Text className="text-ink mt-4 text-center text-base font-bold">
            앱을 최신 버전으로 업데이트하면 쓸 수 있어요
          </Text>
          <Pressable onPress={props.onClose} className="mt-6 px-8 py-3" accessibilityRole="button">
            <Text className="text-muted text-base">닫기</Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}
