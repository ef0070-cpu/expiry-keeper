import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lookupBarcode } from '@/lib/barcode-lookup';
import { listProductsByBarcode } from '@/lib/repo';
import { listOrderProductsByBarcode } from '@/lib/order-repo';

// 가이드 사각형 크기 (아래 오버레이의 h-40 w-72 와 동일한 값, px 단위)
const GUIDE_W = 288;
const GUIDE_H = 160;
// 실제 상품 바코드 포맷만 인식한다 (code128/code39/qr은 택배 송장·쿠폰·홍보용 QR 등과
// 혼동되어 엉뚱한 값을 상품 바코드로 잘못 인식하는 원인이 되므로 제외)
const PRODUCT_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;
const VALID_LENGTHS: Record<string, number[]> = {
  ean13: [13],
  ean8: [8],
  upc_a: [12],
  upc_e: [6, 8],
};

export default function Scan() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [looking, setLooking] = useState(false);
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const scannedRef = useRef(false);
  const insets = useSafeAreaInsets();
  const layoutRef = useRef({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    layoutRef.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    };
  };

  // 스캔된 바코드가 화면 중앙 가이드 사각형 안에 있는지 확인한다
  // (가이드 밖의 다른 상품·배경 바코드까지 함께 인식되는 오인식을 방지)
  const isInsideGuide = (bounds: BarcodeScanningResult['bounds']) => {
    const { width, height } = layoutRef.current;
    if (!width || !height || !bounds?.size?.width || !bounds?.size?.height) return true;
    const cx = bounds.origin.x + bounds.size.width / 2;
    const cy = bounds.origin.y + bounds.size.height / 2;
    const guideLeft = (width - GUIDE_W) / 2;
    const guideTop = (height - GUIDE_H) / 2;
    const margin = 0.4; // 가이드는 보조 표시일 뿐이므로 여유를 좀 둔다
    const left = guideLeft - GUIDE_W * margin;
    const top = guideTop - GUIDE_H * margin;
    const right = guideLeft + GUIDE_W * (1 + margin);
    const bottom = guideTop + GUIDE_H * (1 + margin);
    return cx >= left && cx <= right && cy >= top && cy <= bottom;
  };

  const isValidBarcode = (type: string, data: string) => {
    if (!/^\d+$/.test(data)) return false;
    const lengths = VALID_LENGTHS[type];
    return !lengths || lengths.includes(data.length);
  };

  const onScanned = async ({ type, data, bounds }: BarcodeScanningResult) => {
    if (scannedRef.current) return;
    if (!isValidBarcode(type, data)) return;
    if (!isInsideGuide(bounds)) return;
    scannedRef.current = true;
    await handleBarcode(data);
  };

  /** 카메라로 스캔했든 직접 입력했든, 인식된 바코드 문자열 이후 처리는 동일하다. */
  const handleBarcode = async (data: string) => {
    if (params.mode === 'search') {
      // 검색 모드: 외부 조회 없이 스캔한 바코드만 들고 홈 화면으로 돌아간다.
      // replace 대신 dismissTo를 써서 스택에 이미 있는 홈 화면으로 되돌아가며
      // params만 갱신한다(리마운트 없음 — replace는 홈 화면을 스택에 중복시킴).
      router.dismissTo({
        pathname: '/',
        params: { scannedBarcode: data, nonce: String(Date.now()) },
      });
      return;
    }

    if (params.mode === 'order') {
      // 발주 모드: 카탈로그에 이미 있으면 검색어만 채우고, 없으면 신규 등록 화면으로 보낸다.
      setLooking(true);
      const [info, duplicates] = await Promise.all([
        lookupBarcode(data),
        listOrderProductsByBarcode(data),
      ]);
      setLooking(false);

      if (duplicates.length > 0) {
        router.dismissTo({
          pathname: '/order',
          params: { scannedBarcode: data, nonce: String(Date.now()) },
        });
        return;
      }

      router.replace({
        pathname: '/order-product-form',
        params: { barcode: data, prefillName: info.name ?? '', prefillImage: info.imageUrl ?? '' },
      });
      return;
    }

    setLooking(true);
    // 상품 정보 조회와 동시에 같은 바코드로 이미 등록된(보관중) 상품이 있는지 확인한다
    const [info, duplicates] = await Promise.all([
      lookupBarcode(data),
      listProductsByBarcode(data),
    ]);

    if (duplicates.length > 0) {
      router.replace({
        pathname: '/product-duplicates',
        params: {
          barcode: data,
          prefillName: info.name ?? '',
          prefillImage: info.imageUrl ?? '',
        },
      });
      return;
    }

    router.replace({
      pathname: '/product-form',
      params: {
        barcode: data,
        prefillName: info.name ?? '',
        prefillImage: info.imageUrl ?? '',
      },
    });
  };

  const submitManualBarcode = async () => {
    const data = manualBarcode.trim();
    if (!/^\d{6,13}$/.test(data)) {
      Alert.alert('입력 확인', '바코드는 6~13자리 숫자여야 합니다.');
      return;
    }
    if (scannedRef.current) return;
    scannedRef.current = true;
    setManualEntryVisible(false);
    setManualBarcode('');
    await handleBarcode(data);
  };

  if (!permission) return <View className="flex-1 bg-ink" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        <MaterialCommunityIcons name="camera-off-outline" size={48} color="#888888" />
        <Text className="text-ink mt-4 text-center text-base font-bold">
          카메라 권한이 필요합니다
        </Text>
        <Text className="text-muted mt-2 text-center text-sm">
          바코드를 스캔하려면 카메라 접근을 허용해 주세요.
        </Text>
        <Pressable
          onPress={requestPermission}
          className="mt-6 rounded-xl bg-primary px-8 py-3 active:opacity-80"
        >
          <Text className="text-paper text-base font-bold">권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        onLayout={onLayout}
        barcodeScannerSettings={{
          barcodeTypes: [...PRODUCT_BARCODE_TYPES],
        }}
        onBarcodeScanned={onScanned}
      />

      {/* 직접 입력(바코드 숫자 수기 입력) 트리거 — 카메라 인식이 잘 안 될 때 사용 */}
      <View
        className="absolute right-4 flex-row justify-end"
        style={{ top: Math.max(insets.top, 16) + 8 }}
      >
        <Pressable
          onPress={() => setManualEntryVisible(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="바코드 직접 입력"
        >
          <Text className="text-paper text-base font-medium">직접 입력</Text>
        </Pressable>
      </View>

      <Modal
        visible={manualEntryVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManualEntryVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full rounded-2xl bg-paper p-4">
            <Text className="text-ink mb-3 text-base font-bold">바코드 직접 입력</Text>
            <TextInput
              className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
              placeholder="바코드 숫자 입력"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              value={manualBarcode}
              onChangeText={setManualBarcode}
              autoFocus
            />
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => {
                  setManualEntryVisible(false);
                  setManualBarcode('');
                }}
                className="flex-1 items-center rounded-xl border border-line bg-paper py-2.5 active:opacity-70"
              >
                <Text className="text-ink text-sm font-medium">취소</Text>
              </Pressable>
              <Pressable
                onPress={submitManualBarcode}
                className="flex-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80"
              >
                <Text className="text-paper text-sm font-bold">확인</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 스캔 가이드 오버레이 */}
      <View className="absolute inset-0 items-center justify-center" pointerEvents="box-none">
        <View className="h-40 w-72 rounded-2xl border-2 border-paper/90" />
        <Text className="text-paper mt-5 text-base font-medium">
          바코드를 사각형 안에 맞춰 주세요
        </Text>
        {looking ? (
          <View className="mt-4 flex-row items-center rounded-full bg-ink/70 px-4 py-2">
            <ActivityIndicator color="#FFFFFF" size="small" />
            <Text className="text-paper ml-2 text-sm">상품 정보 조회 중...</Text>
          </View>
        ) : null}
      </View>

      {/* 직접 입력 (검색 모드에서는 의미가 없으므로 숨김) */}
      {params.mode !== 'search' ? (
        <View
          className="absolute w-full items-center"
          style={{ bottom: Math.max(insets.bottom, 48) + 24 }}
        >
          <Pressable
            onPress={() =>
              router.replace(params.mode === 'order' ? '/order-product-form' : '/product-form')
            }
            className="rounded-full border border-paper/60 bg-ink/50 px-6 py-3 active:opacity-70"
          >
            <Text className="text-paper text-base font-medium">바코드 없이 직접 입력</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
