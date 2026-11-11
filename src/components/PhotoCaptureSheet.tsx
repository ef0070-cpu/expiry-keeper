import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { persistLocalPhoto } from '@/lib/local-photo';
import { setPhotoPrivate } from '@/lib/photo-privacy';

const CORNER = { position: 'absolute', width: 34, height: 34, borderColor: '#FFFFFF' } as const;
const GRID = 'rgba(255,255,255,0.35)';

/**
 * 상품 사진 직접 등록(2026-10-22): 바코드를 찍었는데 사진을 못 찾으면 바로 올라와 카메라를 켠다.
 * 공유 동의는 처음부터 체크 — 끄면 이 바코드 사진은 공용 사진 후보로 올리지 않고 내 매장에서만 쓴다.
 * ✕로 닫으면 사진 없이 등록을 이어간다.
 */
export default function PhotoCaptureSheet({
  visible,
  barcode,
  onClose,
  onDone,
}: {
  visible: boolean;
  barcode: string;
  onClose: () => void;
  onDone: (uri: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  // 카메라 높이: 폭 기준 비율(1.08)과 화면 높이의 40% 중 작은 쪽. 큰 화면·가로 모드에서도 아래 버튼이 화면 안에 들어오게 한다
  const camH = Math.min((winW - 36) / 1.08, winH * 0.4);
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setShot(null);
    setAgreed(true);
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    // 열릴 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const askPermission = async () => {
    const res = await requestPermission();
    if (!res.granted && !res.canAskAgain) Linking.openSettings();
  };

  const shoot = async () => {
    if (busy || !camRef.current) return;
    setBusy(true);
    try {
      const pic = await camRef.current.takePictureAsync({ quality: 0.7 });
      if (pic?.uri) setShot(pic.uri);
    } catch {
      // 촬영 실패는 다시 누르면 된다
    } finally {
      setBusy(false);
    }
  };

  const fromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets[0]) setShot(res.assets[0].uri);
  };

  const register = async () => {
    if (!shot) return;
    await setPhotoPrivate(barcode, !agreed);
    onDone(persistLocalPhoto(shot));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12) + 6,
          }}
        >
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: '#DDDDDD', alignSelf: 'center', marginBottom: 10 }} />
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="닫고 사진 없이 등록"
            style={{ position: 'absolute', right: 14, top: 14, zIndex: 1 }}
          >
            <MaterialCommunityIcons name="close" size={28} color="#222222" />
          </Pressable>
          <Text style={{ fontSize: 22, fontWeight: '900', textAlign: 'center', color: '#1A1A1A' }}>📷 상품 사진 직접 등록</Text>
          <Text style={{ textAlign: 'center', color: '#333333', fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
            바코드를 찍었으나 아직 등록된 이미지가 없어요.{'\n'}이름과 바코드에 맞는 상품 사진을 직접 찍어 등록해 주세요!
          </Text>

          <View style={{ marginTop: 14, width: '100%', height: camH, borderRadius: 18, overflow: 'hidden', backgroundColor: '#2A2F33' }}>
            {shot ? (
              <Image source={{ uri: shot }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} contentFit="cover" />
            ) : permission?.granted ? (
              <>
                <CameraView ref={camRef} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} facing="back" />
                {/* 3×3 격자 */}
                {[1, 2].map((i) => (
                  <View key={`v${i}`} pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i * 100) / 3}%`, width: 1, backgroundColor: GRID }} />
                ))}
                {[1, 2].map((i) => (
                  <View key={`h${i}`} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: `${(i * 100) / 3}%`, height: 1, backgroundColor: GRID }} />
                ))}
                <Text
                  pointerEvents="none"
                  style={{ position: 'absolute', top: '13%', left: 0, right: 0, textAlign: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 }}
                >
                  여기에 상품을 맞춰주세요
                </Text>
              </>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 15, textAlign: 'center', marginBottom: 14 }}>사진을 찍으려면 카메라 권한이 필요해요</Text>
                <Pressable onPress={askPermission} style={{ backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 }}>
                  <Text style={{ fontWeight: 'bold', color: '#1A1A1A' }}>카메라 허용</Text>
                </Pressable>
              </View>
            )}
            <View pointerEvents="none" style={{ ...CORNER, left: 16, top: 16, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 10 }} />
            <View pointerEvents="none" style={{ ...CORNER, right: 16, top: 16, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 10 }} />
            <View pointerEvents="none" style={{ ...CORNER, left: 16, bottom: 16, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 10 }} />
            <View pointerEvents="none" style={{ ...CORNER, right: 16, bottom: 16, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 10 }} />
          </View>

          {shot ? (
            // 촬영 후: 한 줄에 [다시 찍기] [저장하기]
            <View style={{ marginTop: 12, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setShot(null)}
                accessibilityRole="button"
                accessibilityLabel="다시 찍기"
                style={({ pressed }) => ({
                  flex: 1,
                  height: 56,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: '#222222',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name="restore" size={22} color="#111111" />
                <Text style={{ color: '#111111', fontSize: 17, fontWeight: '800' }}>다시 찍기</Text>
              </Pressable>
              <Pressable
                onPress={register}
                accessibilityRole="button"
                accessibilityLabel="저장하기"
                style={({ pressed }) => ({
                  flex: 1.4,
                  height: 56,
                  borderRadius: 18,
                  backgroundColor: '#B81F26',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name="check" size={22} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>저장하기</Text>
              </Pressable>
            </View>
          ) : (
            // 촬영 전: 카메라 아래 가운데 셔터, 왼쪽에 갤러리 (일반 카메라 앱 배치 — 셔터가 상품을 가리지 않는다)
            <View style={{ marginTop: 12, height: 80, alignItems: 'center', justifyContent: 'center' }}>
              <Pressable
                onPress={fromGallery}
                accessibilityRole="button"
                accessibilityLabel="갤러리에서 선택"
                style={({ pressed }) => ({
                  position: 'absolute',
                  left: 0,
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  borderColor: '#222222',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name="image-outline" size={26} color="#111111" />
              </Pressable>
              <View style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#B81F26', alignItems: 'center', justifyContent: 'center' }}>
                <Pressable
                  onPress={shoot}
                  disabled={busy || !permission?.granted}
                  accessibilityRole="button"
                  accessibilityLabel="사진 촬영하기"
                  style={({ pressed }) => ({
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: '#B81F26',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed || busy || !permission?.granted ? 0.6 : 1,
                  })}
                >
                  <MaterialCommunityIcons name="camera" size={28} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>
          )}
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 12 }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: agreed ? '#1A1A1A' : '#FFFFFF',
                borderWidth: agreed ? 0 : 2,
                borderColor: '#999999',
              }}
            >
              {agreed ? <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" /> : null}
            </View>
            <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: '#222222' }}>
              내가 촬영한 사진을 다른 사장님들과 함께 공유하고 서비스에 사용하는 데 동의합니다
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
