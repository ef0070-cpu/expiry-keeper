import { MaterialCommunityIcons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { LayoutRectangle, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import {
  extractDateCandidates,
  stableDate,
  textInRegion,
  viewRectToImage,
} from '@/lib/date-ocr';
import { errorMessage } from '@/lib/errors';
import { DateOcrOrder, getScanHapticEnabled } from '@/lib/settings';

// 한 장 인식이 끝난 뒤 다음 캡처까지 쉬는 시간(ms) — 배터리·발열과 반응 속도의 절충
const INTERVAL_MS = 150;
// 안내 사각형을 사방으로 이만큼 넓혀서 읽는다 — 손떨림·화각 차이 흡수
const BOX_PAD_RATIO = 0.3;
// 광각 렌즈 기준 2배. 가까이(10cm 안쪽) 대면 초점이 안 맞으므로 한 뼘 떨어져도 글자가 크게
// 보이게 한다. 광각 렌즈 하나만 쓰므로 망원으로 넘어가 가까운 초점이 더 나빠지지 않는다.
// ponytail: 기기마다 적정 배율이 다를 수 있음 — 손가락으로 벌려 바꿀 수 있게 해 둠(enableZoomGesture)
const ZOOM_FACTOR = 2;

type Props = {
  dateOcrOrder: DateOcrOrder;
  onDetected: (date: string) => void;
  onClose: () => void;
};

/** 카메라를 비추기만 하면 유통기한을 계속 읽는 화면(react-native-vision-camera 4).
 * 셔터로 사진을 찍지 않고 미리보기 화면을 캡처(takeSnapshot)해 빠르고, 화면을 누르면 그 자리에
 * 초점을 맞춘다. 사각형 안 글자만 읽고, 최근 3번 중 2번 같은 날짜가 읽히면 확정한다. */
export default function ExpiryLiveScanCamera({ dateOcrOrder, onDetected, onClose }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back', { physicalDevices: ['wide-angle-camera'] });
  const cameraRef = useRef<Camera>(null);
  const previewRef = useRef<LayoutRectangle | null>(null);
  const boxRef = useRef<LayoutRectangle | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [ready, setReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (hasPermission === false) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const history: (string | null)[] = [];

    (async () => {
      const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
      while (!stopped) {
        let uri: string | undefined;
        try {
          const shot = await cameraRef.current?.takeSnapshot({ quality: 80 });
          if (!shot || stopped) break;
          uri = shot.path.startsWith('file://') ? shot.path : `file://${shot.path}`;
          const { text, blocks } = await recognizeText(uri);
          const preview = previewRef.current;
          const box = boxRef.current;
          const target =
            preview && box
              ? textInRegion(
                  blocks.flatMap((b) => b.lines),
                  viewRectToImage(box, preview, shot, BOX_PAD_RATIO),
                )
              : text;
          const found = extractDateCandidates(target, dateOcrOrder)[0] ?? null;
          if (stopped) break;
          history.push(found);
          if (found) setLastRead(found);
          setError(null);
          const confirmed = stableDate(history);
          if (confirmed) {
            stopped = true;
            if (await getScanHapticEnabled()) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
            onDetectedRef.current(confirmed);
            break;
          }
        } catch (e) {
          // 한 장 실패로 멈추지 않는다 — 원인만 보여주고 다음 장을 시도한다
          if (!stopped) setError(errorMessage(e));
        } finally {
          if (uri) {
            try {
              new File(uri).delete();
            } catch {
              // 캐시 파일 — 못 지워도 OS가 정리한다
            }
          }
        }
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [ready, dateOcrOrder]);

  const top = Math.max(insets.top, 16) + 8;

  if (hasPermission === false || !device) {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <MaterialCommunityIcons name="camera-off-outline" size={48} color="#888888" />
        <Text className="text-ink mt-4 text-center text-base font-bold">
          {!device ? '카메라를 찾지 못했어요' : '카메라 권한이 필요합니다'}
        </Text>
        {device ? (
          <Pressable
            onPress={() => Linking.openSettings()}
            className="mt-6 rounded-xl bg-primary px-8 py-3 active:opacity-80"
            accessibilityRole="button"
          >
            <Text className="text-paper text-base font-bold">설정 열기</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} className="mt-4 px-8 py-3" accessibilityRole="button">
          <Text className="text-muted text-base">닫기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink">
      {/* 화면을 누르면 그 자리에 초점 — 작은 날짜 글자에 초점이 안 맞던 문제 */}
      <Pressable
        style={{ flex: 1 }}
        onLayout={(e) => (previewRef.current = e.nativeEvent.layout)}
        onPress={(e) => {
          cameraRef.current
            ?.focus({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })
            .catch(() => {});
        }}
        accessibilityLabel="누른 곳에 초점 맞추기"
      >
        <Camera
          ref={cameraRef}
          style={{ flex: 1 }}
          device={device}
          isActive
          zoom={Math.min(device.neutralZoom * ZOOM_FACTOR, device.maxZoom)}
          enableZoomGesture
          torch={torchOn ? 'on' : 'off'}
          onInitialized={() => setReady(true)}
        />
      </Pressable>

      <View className="absolute left-4" style={{ top }}>
        <Pressable
          onPress={() => setTorchOn((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={torchOn ? '손전등 끄기' : '손전등 켜기'}
        >
          <MaterialCommunityIcons
            name={torchOn ? 'flashlight' : 'flashlight-off'}
            size={26}
            color="#FFFFFF"
          />
        </Pressable>
      </View>

      <View className="absolute right-4" style={{ top }}>
        <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button">
          <Text className="text-paper text-base font-medium">닫기</Text>
        </Pressable>
      </View>

      <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
        <View
          className="h-24 w-72 rounded-2xl border-2 border-paper/90"
          onLayout={(e) => (boxRef.current = e.nativeEvent.layout)}
        />
        <Text className="text-paper mt-5 text-base font-medium">
          유통기한 글자를 사각형 안에 맞춰 주세요
        </Text>
        <Text className="text-paper/80 mt-1 text-sm">
          흐리면 화면을 눌러 초점을 맞추거나 한 뼘 떨어져 주세요
        </Text>
        <View className="mt-4 rounded-full bg-ink/70 px-4 py-2" accessibilityLiveRegion="polite">
          <Text className="text-paper text-sm">
            {lastRead ? `읽는 중: ${lastRead}` : '날짜를 찾는 중...'}
          </Text>
        </View>
        {error ? (
          <Text className="mt-2 px-8 text-center text-xs text-paper/70">{error}</Text>
        ) : null}
      </View>
    </View>
  );
}
