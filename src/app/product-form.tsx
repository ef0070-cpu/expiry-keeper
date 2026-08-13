import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { hasImageSearchKeys, searchProductImage } from '@/lib/barcode-lookup';
import { autoFormatDate, isValidDateStr } from '@/lib/dates';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, getProduct, listProducts, newId, saveProduct } from '@/lib/repo';
import { useAppMode } from '@/lib/settings';
import { Product, ProductStatus } from '@/lib/types';

export default function ProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const isEdit = !!params.id;
  const mode = useAppMode();

  const [name, setName] = useState(params.prefillName ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.prefillImage || null);
  // 새 상품이면 현재 연도를 미리 채워 월·일만 입력하면 되게 한다
  const [expiryDate, setExpiryDate] = useState(params.id ? '' : String(new Date().getFullYear()));
  const [quantity, setQuantity] = useState(1);
  const [category, setCategory] = useState<string | null>(null);
  const [memo, setMemo] = useState('');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  // 수정 시 기존 소진/폐기 상태를 잃지 않도록 함께 보관
  const [status, setStatus] = useState<ProductStatus>('active');
  const [resolvedAt, setResolvedAt] = useState<string | null>(null);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  const barcode = params.barcode ?? null;

  useEffect(() => {
    // 기존 카테고리 목록 수집
    listProducts()
      .then((items) => {
        const set = new Set<string>();
        items.forEach((p) => p.category && set.add(p.category));
        setExistingCategories([...set].sort());
      })
      .catch(() => {});

    // 수정 모드: 기존 상품 불러오기
    if (params.id) {
      getProduct(params.id).then((p) => {
        if (!p) return;
        setName(p.name);
        setImageUri(p.imageUri);
        setExpiryDate(p.expiryDate);
        setQuantity(p.quantity);
        setCategory(p.category);
        setMemo(p.memo ?? '');
        setCreatedAt(p.createdAt);
        setStatus(p.status);
        setResolvedAt(p.resolvedAt);
      });
    }
  }, [params.id]);

  const categories = useMemo(() => {
    const set = new Set(existingCategories);
    if (category) set.add(category);
    return [...set].sort();
  }, [existingCategories, category]);

  const pickImage = () => {
    Alert.alert('상품 사진', '사진을 어떻게 추가할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '앨범에서 선택', onPress: () => launchPicker('library') },
      { text: '카메라 촬영', onPress: () => launchPicker('camera') },
    ]);
  };

  const launchPicker = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '카메라 접근 권한을 허용해 주세요.');
        return;
      }
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  /** 상품명으로 웹에서 이미지 자동 검색 */
  const findImageOnWeb = async () => {
    if (!name.trim()) {
      Alert.alert('입력 확인', '먼저 상품명을 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '이미지 검색을 사용하려면 로그인이 필요합니다.');
      return;
    }
    setSearching(true);
    const url = await searchProductImage(name.trim());
    setSearching(false);
    if (url) setImageUri(url);
    else Alert.alert('검색 결과 없음', '이미지를 찾지 못했습니다. 직접 촬영해 주세요.');
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('입력 확인', '상품명을 입력해 주세요.');
      return;
    }
    if (!isValidDateStr(expiryDate)) {
      Alert.alert('입력 확인', '유통기한을 YYYY-MM-DD 형식으로 입력해 주세요.\n예: 2026-12-31');
      return;
    }
    setBusy(true);
    try {
      const product: Product = {
        id: params.id ?? newId(),
        barcode,
        name: name.trim(),
        imageUri,
        expiryDate,
        category,
        memo: memo.trim() || null,
        quantity,
        status,
        resolvedAt,
        createdAt: createdAt ?? new Date().toISOString(),
      };
      await saveProduct(product);
      await scheduleExpiryAlerts(product);
      router.dismissAll();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!params.id) return;
    Alert.alert('상품 삭제', '이 상품을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteProduct(params.id!);
          await cancelExpiryAlerts(params.id!);
          router.dismissAll();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <Stack.Screen options={{ title: isEdit ? '상품 수정' : '상품 등록' }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 사진 + 상품명 (한 줄 배치) */}
        <View className="flex-row">
          <Pressable
            onPress={pickImage}
            className="items-center justify-center rounded-xl border border-line bg-paper active:opacity-70"
            style={{ width: 96, height: 96 }}
          >
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={{ width: 96, height: 96, borderRadius: 12 }}
                contentFit="cover"
              />
            ) : (
              <View className="items-center">
                <MaterialCommunityIcons name="camera-plus-outline" size={26} color="#888888" />
                <Text className="text-muted mt-1 text-xs">사진 추가</Text>
              </View>
            )}
          </Pressable>

          <View className="ml-3 flex-1">
            <View className="flex-row items-center justify-between">
              <Text className="text-ink text-sm font-bold">상품명 *</Text>
              {barcode ? (
                <View className="flex-row items-center">
                  <MaterialCommunityIcons name="barcode" size={14} color="#888888" />
                  <Text className="text-muted ml-1 text-xs">{barcode}</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              className="text-ink mt-1.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 해태 오예스 360g"
              placeholderTextColor="#BBBBBB"
              value={name}
              onChangeText={setName}
            />
            <View className="mt-2 flex-row items-center gap-4">
              <Pressable
                onPress={findImageOnWeb}
                disabled={searching}
                className="flex-row items-center"
              >
                {searching ? (
                  <ActivityIndicator size="small" color="#CC2222" />
                ) : (
                  <MaterialCommunityIcons name="image-search-outline" size={15} color="#CC2222" />
                )}
                <Text className="text-primary ml-1 text-xs font-medium">웹에서 이미지 찾기</Text>
              </Pressable>
              {imageUri ? (
                <Pressable onPress={() => setImageUri(null)}>
                  <Text className="text-muted text-xs underline">사진 제거</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        {/* 유통기한 + 수량 (한 줄 배치) */}
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="유통기한 *" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              maxLength={10}
              value={expiryDate}
              onChangeText={(t) => setExpiryDate(autoFormatDate(t))}
            />
          </View>
          <View>
            <Label text="수량" />
            <View className="flex-row items-center">
              <Stepper icon="minus" onPress={() => setQuantity((n) => Math.max(1, n - 1))} />
              <Text className="text-ink mx-4 text-lg font-bold">{quantity}</Text>
              <Stepper icon="plus" onPress={() => setQuantity((n) => n + 1)} />
            </View>
          </View>
        </View>

        {/* 카테고리 */}
        <View className="mt-4">
          <Label text={mode === 'home' ? '카테고리 (보관 위치 등)' : '카테고리 (매장 위치 등)'} />
          {categories.length > 0 ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {categories.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(category === c ? null : c)}
                  className={`rounded-full border px-3.5 py-1.5 ${
                    category === c ? 'border-primary bg-primary' : 'border-line bg-paper'
                  }`}
                >
                  <Text
                    className={`text-sm ${category === c ? 'text-paper font-bold' : 'text-muted'}`}
                  >
                    {c}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              placeholder={
                mode === 'home' ? '새 카테고리 입력 (예: 냉장실)' : '새 카테고리 입력 (예: 00동 1호점)'
              }
              placeholderTextColor="#BBBBBB"
              value={newCategory}
              onChangeText={setNewCategory}
            />
            <Pressable
              onPress={() => {
                const v = newCategory.trim();
                if (!v) return;
                setCategory(v);
                setExistingCategories((prev) => (prev.includes(v) ? prev : [...prev, v]));
                setNewCategory('');
              }}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">추가</Text>
            </Pressable>
          </View>
        </View>

        {/* 메모 */}
        <View className="mt-4">
          <Label text="메모" />
          <TextInput
            className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
            placeholder={mode === 'home' ? '예: 개봉함, 반찬용' : '예: 매대 3번, 할인 예정'}
            placeholderTextColor="#BBBBBB"
            multiline
            style={{ minHeight: 56, textAlignVertical: 'top' }}
            value={memo}
            onChangeText={setMemo}
          />
        </View>

        {/* 저장 / 삭제 */}
        <View className="mt-5 flex-row gap-3">
          {isEdit ? (
            <Pressable
              onPress={remove}
              className="flex-1 items-center rounded-xl border border-line bg-paper py-3.5 active:opacity-70"
            >
              <Text className="text-primary text-base font-medium">삭제</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={save}
            disabled={busy}
            className={`items-center rounded-xl bg-primary py-3.5 active:opacity-80 ${
              isEdit ? 'flex-[2]' : 'flex-1'
            }`}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-paper text-base font-bold">{isEdit ? '수정 저장' : '등록'}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Label({ text }: { text: string }) {
  return <Text className="text-ink mb-1.5 text-sm font-bold">{text}</Text>;
}

function Stepper({ icon, onPress }: { icon: 'plus' | 'minus'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper active:opacity-70"
    >
      <MaterialCommunityIcons name={icon} size={20} color="#1A1A1A" />
    </Pressable>
  );
}
