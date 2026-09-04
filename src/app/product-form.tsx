import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Directory, File, Paths } from 'expo-file-system';
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
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import PhotoCandidatesModal from '@/components/PhotoCandidatesModal';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import { uploadPhotoToBucket } from '@/lib/storage';
import { autoFormatDate, formatDate, isValidDateStr } from '@/lib/dates';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import { deleteProduct, getProduct, listProducts, newId, saveProduct } from '@/lib/repo';
import { AppMode, useAppMode, useDateInputMethod } from '@/lib/settings';
import { Product, ProductStatus } from '@/lib/types';

/** 카메라/앨범에서 고른 사진은 임시 캐시 경로(uri)를 가리켜서 앱 재시작이나 OS의 저장공간
 * 정리로 사라질 수 있다 — 저장하기 전에 앱 전용 영구 디렉터리로 복사해 안정적인 uri로 바꾼다.
 * 복사에 실패하면(드묾) 원본 uri라도 우선 쓴다. */
function persistLocalPhoto(uri: string): string {
  try {
    const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
    const dir = new Directory(Paths.document, 'product-photos');
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

export default function ProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const isEdit = !!params.id;
  const mode = useAppMode();
  const dateInputMethod = useDateInputMethod();

  const [name, setName] = useState(params.prefillName ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.prefillImage || null);
  // 새 상품이면 현재 연도를 미리 채워 월·일만 입력하면 되게 한다
  const [expiryDate, setExpiryDate] = useState(params.id ? '' : String(new Date().getFullYear()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState('');
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  // 수정 시 기존 소진/폐기 상태를 잃지 않도록 함께 보관
  const [status, setStatus] = useState<ProductStatus>('active');
  const [resolvedAt, setResolvedAt] = useState<string | null>(null);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [imageCandidates, setImageCandidates] = useState<string[] | null>(null);
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);

  const [barcode, setBarcode] = useState<string | null>(params.barcode ?? null);
  // 수정 시 원래 등록됐던 모드를 유지 (현재 화면 모드로 덮어쓰지 않음)
  const [productMode, setProductMode] = useState<AppMode>(mode ?? 'retail');

  useEffect(() => {
    // 기존 카테고리 목록 수집
    listProducts()
      .then((items) => {
        const set = new Set<string>();
        items.forEach((p) => p.categories.forEach((c) => set.add(c)));
        setExistingCategories([...set].sort());
      })
      .catch(() => {});

    // 수정 모드: 기존 상품 불러오기
    if (params.id) {
      getProduct(params.id).then((p) => {
        if (!p) return;
        setName(p.name);
        setImageUri(p.imageUri);
        setBarcode(p.barcode);
        setExpiryDate(p.expiryDate);
        setQuantity(p.quantity);
        setSelectedCategories(new Set(p.categories));
        setMemo(p.memo ?? '');
        setCreatedAt(p.createdAt);
        setStatus(p.status);
        setResolvedAt(p.resolvedAt);
        setProductMode(p.mode);
      });
    }
  }, [params.id]);

  const categories = useMemo(() => {
    const set = new Set(existingCategories);
    selectedCategories.forEach((c) => set.add(c));
    return [...set].sort();
  }, [existingCategories, selectedCategories]);

  const toggleCategory = (c: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const datePickerDisplay = Platform.select<'calendar' | 'spinner' | 'inline'>({
    android: dateInputMethod === 'spinner' ? 'spinner' : 'calendar',
    ios: dateInputMethod === 'spinner' ? 'spinner' : 'inline',
    default: 'spinner',
  });

  const datePickerValue = isValidDateStr(expiryDate)
    ? new Date(
        Number(expiryDate.slice(0, 4)),
        Number(expiryDate.slice(5, 7)) - 1,
        Number(expiryDate.slice(8, 10)),
      )
    : new Date();

  const onPickDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'set' && selected) setExpiryDate(formatDate(selected));
  };

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
      setImageUri(persistLocalPhoto(result.assets[0].uri));
    }
  };

  /** 웹에서 이미지 후보 검색 — 바코드 매칭 이미지(있으면)를 1순위 후보로 넣고 상품명
   * 검색 결과를 더해 사용자가 직접 고르게 한다. 자동으로 하나를 확정 적용하지 않는다. */
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
    const candidates: string[] = [];
    if (barcode && barcode.trim()) {
      const info = await lookupBarcode(barcode.trim());
      if (info.imageUrl) candidates.push(info.imageUrl);
    }
    const found = await searchProductImageCandidates(name.trim());
    for (const url of found) {
      if (!candidates.includes(url)) candidates.push(url);
    }
    setSearching(false);
    if (candidates.length === 0) {
      Alert.alert('검색 결과 없음', '이미지를 찾지 못했습니다. 직접 촬영해 주세요.');
      return;
    }
    setImageCandidates(candidates);
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
        categories: [...selectedCategories],
        memo: memo.trim() || null,
        quantity,
        status,
        resolvedAt,
        createdAt: createdAt ?? new Date().toISOString(),
        mode: productMode,
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
      <Stack.Screen options={{ title: isEdit ? '상품 수정' : '상품 등록' }} />
      <ImageCandidatesModal
        visible={imageCandidates !== null}
        candidates={imageCandidates ?? []}
        onSelect={async (url) => {
          setImageCandidates(null);
          // 검색결과 원본 링크는 핫링크 차단·임시 링크 등으로 나중에 깨질 수 있어, 고르는 순간
          // 우리 Storage로 재업로드해 안정적인 URL로 바꾼다. 실패하면 원본 링크라도 우선 보여준다.
          const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          const hosted = await uploadPhotoToBucket(url, 'product-images', path, true);
          setImageUri(hosted ?? url);
        }}
        onClose={() => setImageCandidates(null)}
      />
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode ?? ''}
        onClose={() => setShowPhotoCandidates(false)}
      />
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
            accessibilityRole="button"
            accessibilityLabel={imageUri ? '사진 변경' : '사진 추가'}
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
            {barcode ? (
              <Pressable onPress={() => setShowPhotoCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* 유통기한 + 수량 (한 줄 배치) */}
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="유통기한 *" />
            {dateInputMethod === 'text' ? (
              <TextInput
                className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#BBBBBB"
                keyboardType="number-pad"
                maxLength={10}
                value={expiryDate}
                onChangeText={(t) => setExpiryDate(autoFormatDate(t))}
              />
            ) : (
              <Pressable
                onPress={() => setShowDatePicker(true)}
                className="rounded-xl border border-line bg-paper px-3 py-2.5"
              >
                <Text
                  className="text-base"
                  style={{ color: expiryDate ? '#1A1A1A' : '#BBBBBB' }}
                >
                  {expiryDate || 'YYYY-MM-DD'}
                </Text>
              </Pressable>
            )}
            {showDatePicker && dateInputMethod !== 'text' ? (
              <View className="mt-2 overflow-hidden rounded-xl border border-line bg-paper">
                <DateTimePicker
                  value={datePickerValue}
                  mode="date"
                  display={datePickerDisplay}
                  onChange={onPickDate}
                />
                {Platform.OS === 'ios' ? (
                  <Pressable
                    onPress={() => setShowDatePicker(false)}
                    className="items-center border-t border-line py-2.5"
                  >
                    <Text className="text-primary text-sm font-bold">완료</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
          <View>
            <Label text="수량" />
            <View className="flex-row items-center">
              <Stepper
                icon="minus"
                label="수량 감소"
                onPress={() => setQuantity((n) => Math.max(1, n - 1))}
              />
              <Text
                className="text-ink mx-4 text-lg font-bold"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {quantity}
              </Text>
              <Stepper icon="plus" label="수량 증가" onPress={() => setQuantity((n) => n + 1)} />
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
                  onPress={() => toggleCategory(c)}
                  className={`rounded-full border px-3.5 py-1.5 ${
                    selectedCategories.has(c) ? 'border-primary bg-primary' : 'border-line bg-paper'
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      selectedCategories.has(c) ? 'text-paper font-bold' : 'text-muted'
                    }`}
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
                mode === 'home' ? '새 카테고리 입력 (예: 냉장실)' : '새 카테고리 입력 (예: 1호매장, 2호매장)'
              }
              placeholderTextColor="#BBBBBB"
              value={newCategory}
              onChangeText={setNewCategory}
            />
            <Pressable
              onPress={() => {
                const v = newCategory.trim();
                if (!v) return;
                setSelectedCategories((prev) => new Set(prev).add(v));
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

function Stepper({
  icon,
  label,
  onPress,
}: {
  icon: 'plus' | 'minus';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      className="h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={20} color="#1A1A1A" />
    </Pressable>
  );
}
