import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
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

          <View style={{ marginTop: 14, width: '100%', aspectRatio: 1.08, borderRadius: 18, overflow: 'hidden', backgroundColor: '#2A2F33' }}>
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
                <Pressable
                  onPress={shoot}
                  accessibilityRole="button"
                  accessibilityLabel="셔터"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    marginLeft: -42,
                    marginTop: -42,
                    width: 84,
                    height: 84,
                    borderRadius: 42,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    borderWidth: 3,
                    borderColor: 'rgba(255,255,255,0.9)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="camera" size={28} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }}>셔터</Text>
                </Pressable>
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

          <Pressable
            onPress={shot ? register : shoot}
            disabled={busy || (!shot && !permission?.granted)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 12,
              height: 56,
              borderRadius: 18,
              backgroundColor: '#B81F26',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: pressed || busy || (!shot && !permission?.granted) ? 0.6 : 1,
            })}
          >
            <MaterialCommunityIcons name={shot ? 'check' : 'camera'} size={22} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800' }}>{shot ? '이 사진으로 등록' : '사진 촬영하기'}</Text>
          </Pressable>
          <Pressable
            onPress={shot ? () => setShot(null) : fromGallery}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 10,
              height: 56,
              borderRadius: 18,
              borderWidth: 1.5,
              borderColor: '#222222',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <MaterialCommunityIcons name={shot ? 'restore' : 'image-outline'} size={22} color="#111111" />
            <Text style={{ color: '#111111', fontSize: 18, fontWeight: '800' }}>{shot ? '다시 찍기' : '갤러리에서 선택'}</Text>
          </Pressable>
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
