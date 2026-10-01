import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import CandidatesModal from '@/components/CandidatesModal';
import ExpiryLiveScanModal from '@/components/ExpiryLiveScanModal';
import PhotoSourceSheet from '@/components/PhotoSourceSheet';
import { extractDateCandidates } from '@/lib/date-ocr';
import { errorMessage } from '@/lib/errors';
import { deleteLocalPhotoIfOwned, persistLocalPhoto } from '@/lib/local-photo';
import { addMonths, autoFormatDate, formatDate, isValidDateStr, todayStr } from '@/lib/dates';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import {
  deleteProduct,
  getCachedCategories,
  getCachedProduct,
  getProduct,
  listProducts,
  listProductsByBarcode,
  newId,
  saveProduct,
} from '@/lib/repo';
import { AppMode, useAppMode, useCoupangSuggestEnabled, useDateInputMethod, useDateOcrOrder } from '@/lib/settings';
import CoupangRebuyCard from '@/components/CoupangRebuyCard';
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
  const coupangSuggest = useCoupangSuggestEnabled();
  const dateInputMethod = useDateInputMethod();
  const dateOcrOrder = useDateOcrOrder();

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
  const [existingCategories, setExistingCategories] = useState<string[]>(getCachedCategories);
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPhotoSource, setShowPhotoSource] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [liveScanVisible, setLiveScanVisible] = useState(false);
  const [manufactureCalcVisible, setManufactureCalcVisible] = useState(false);
  const [manufactureDate, setManufactureDate] = useState('');
  const [manufactureMonths, setManufactureMonths] = useState('6');

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

  }, []);

  // 사용자가 고칠 수 있는 칸의 최신 값 — 늦게 온 서버 응답이 방금 고친 내용을 덮어쓰지 않게 비교용
  const editableRef = useRef('');
  editableRef.current = JSON.stringify([
    name,
    imageUri,
    barcode,
    expiryDate,
    quantity,
    [...selectedCategories].sort(),
    memo,
  ]);

  // 수정 모드: 기존 상품 불러오기. 목록에서 받아 둔 값으로 화면을 그리기 전에(useLayoutEffect)
  // 먼저 채우고, 서버의 최신 값은 뒤이어 받아 덮어쓴다. 받아오기 실패는 조용히 넘기지 않는다.
  useLayoutEffect(() => {
    if (!params.id) return;
    const id = params.id;
    const snapshot = (p: Product) =>
      JSON.stringify([
        p.name,
        p.imageUri,
        p.barcode,
        p.expiryDate,
        p.quantity,
        [...p.categories].sort(),
        p.memo ?? '',
      ]);
    const apply = (p: Product) => {
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
    };
    const cached = getCachedProduct(id);
    if (cached) apply(cached);
    let alive = true;
    const fetchLatest = () =>
      getProduct(id)
        .then((p) => {
          if (!alive || !p) return;
          // 캐시로 채운 뒤 사용자가 이미 고치기 시작했으면 서버 값으로 되돌리지 않는다
          if (cached && editableRef.current !== snapshot(cached)) return;
          apply(p);
        })
        .catch((e) => {
          if (!alive || cached) return; // 화면에 이미 내용이 있으면 최신화 실패는 넘어간다
          Alert.alert('상품을 불러오지 못했어요', errorMessage(e), [
            { text: '닫기', style: 'cancel', onPress: () => router.back() },
            { text: '다시 시도', onPress: () => void fetchLatest() },
          ]);
        });
    fetchLatest();
    return () => {
      alive = false;
    };
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

  const pickImage = () => setShowPhotoSource(true);

  const ensureCameraPermission = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) return true;
    if (perm.canAskAgain) {
      Alert.alert('권한 필요', '카메라 접근 권한을 허용해 주세요.');
    } else {
      Alert.alert(
        '권한 필요',
        '카메라 접근 권한이 거부되어 있어요. 설정에서 권한을 허용해 주세요.',
        [
          { text: '취소', style: 'cancel' },
          { text: '설정 열기', onPress: () => Linking.openSettings() },
        ],
      );
    }
    return false;
  };

  // Alert 버튼의 onPress나 Pressable의 onPress는 await/catch 없이 호출되므로, 여기서 못 잡은
  // 예외는 사용자에게 아무 표시도 없이 사라진다 — "눌러도 반응이 없다"로 보이는 원인.
  const launchPicker = async (source: 'camera' | 'library') => {
    try {
      await launchPickerUnsafe(source);
    } catch (e) {
      Alert.alert('사진 선택 실패', errorMessage(e));
    }
  };

  const launchPickerUnsafe = async (source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    };
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      if (!(await ensureCameraPermission())) return;
      result = await ImagePicker.launchCameraAsync(options);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!result.canceled && result.assets[0]) {
      deleteLocalPhotoIfOwned(imageUri);
      setImageUri(persistLocalPhoto(result.assets[0].uri));
    }
  };

  const scanExpiryDatePhoto = async () => {
    // 권한 요청·카메라 실행까지 전부 try 안에 둔다. 예전엔 이 두 단계가 밖에 있어서,
    // 여기서 예외가 나면 화면에 아무 변화가 없어 "터치해도 무반응"으로 보였다.
    setOcrBusy(true);
    try {
      if (!(await ensureCameraPermission())) return;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets[0]) return;

      const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
      const { text } = await recognizeText(result.assets[0].uri);
      const candidates = extractDateCandidates(text, dateOcrOrder);
      const today = todayStr();
      // 오늘 이후 날짜 하나만 읽혔을 때만 묻지 않고 바로 넣는다(단계 최소화). 지난 날짜 하나는
      // 제조일일 수 있어(유통기한이 흐리게 찍힌 경우) 바로 넣지 않고 확인받는다.
      if (candidates.length === 1 && candidates[0] >= today) {
        setExpiryDate(candidates[0]);
        return;
      }
      const retry = { text: '다시 찍기', onPress: () => void scanExpiryDatePhoto() };
      if (candidates.length === 0) {
        Alert.alert(
          '날짜를 못 읽었어요',
          '날짜 글자가 크고 선명하게 나오도록 가까이에서 초점을 맞춰 다시 찍거나, 직접 입력해 주세요.',
          [{ text: '직접 입력', style: 'cancel' }, retry],
        );
        return;
      }
      const label = (d: string) => (d < today ? `${d} (지난 날짜)` : d);
      // 안드로이드 알림창 버튼은 최대 3개 — 후보가 더 있으면 '다른 날짜…'로 다음 후보를 넘겨 본다
      // (예전엔 3번째 후보부터는 고를 방법이 없어 다시 찍어도 같은 후보만 반복됐다)
      const showChoices = (from: number) => {
        const rest = candidates.slice(from);
        const hasMore = rest.length > 2;
        const shown = hasMore ? rest.slice(0, 1) : rest.slice(0, 2);
        Alert.alert(
          '읽은 날짜를 확인해 주세요',
          `읽은 날짜: ${candidates.map(label).join(', ')}\n맞는 날짜를 눌러 주세요.`,
          [
            hasMore ? { text: '다른 날짜…', onPress: () => showChoices(from + 1) } : retry,
            ...shown.map((d) => ({ text: label(d), onPress: () => setExpiryDate(d) })),
          ],
          { cancelable: true },
        );
      };
      showChoices(0);
    } catch (e) {
      // 원인을 그대로 보여준다. 네이티브 모듈 누락·카메라 실행 실패를 구분할 수 있어야 한다.
      Alert.alert('사진 인식 실패', errorMessage(e));
    } finally {
      setOcrBusy(false);
    }
  };

  const doSave = async () => {
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

  const addQuantityTo = async (existing: Product) => {
    setBusy(true);
    try {
      const merged: Product = { ...existing, quantity: existing.quantity + quantity };
      await saveProduct(merged);
      await scheduleExpiryAlerts(merged);
      router.dismissAll();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setBusy(false);
    }
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

    // 신규 등록이고 바코드가 있으면, 같은 바코드+같은 유통기한의 기존(보관 중) 상품이 있는지
    // 확인해 수량만 합칠지 물어본다 — 반복 스캔 시 매번 별도 행으로 쌓이는 걸 막기 위함.
    if (!isEdit && barcode) {
      const existing = await listProductsByBarcode(barcode);
      const sameExpiry = existing.find((p) => p.expiryDate === expiryDate);
      if (sameExpiry) {
        Alert.alert(
          '같은 유통기한 상품이 있어요',
          `"${sameExpiry.name}" (${expiryDate})에 이미 ${sameExpiry.quantity}개가 등록돼 있어요.`,
          [
            { text: '취소', style: 'cancel' },
            { text: '새로 등록', onPress: () => doSave() },
            { text: `수량 추가 (+${quantity})`, onPress: () => addQuantityTo(sameExpiry) },
          ],
        );
        return;
      }
    }

    await doSave();
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
      <PhotoSourceSheet
        visible={showPhotoSource}
        title="상품 사진"
        message="사진을 어떻게 추가할까요?"
        onClose={() => setShowPhotoSource(false)}
        onCamera={() => launchPicker('camera')}
        onLibrary={() => launchPicker('library')}
        web={{
          name,
          barcode,
          onPicked: (url) => {
            deleteLocalPhotoIfOwned(imageUri);
            setImageUri(url);
          },
        }}
      />
      <CandidatesModal
        visible={showPhotoPicker}
        barcode={barcode ?? ''}
        onClose={() => setShowPhotoPicker(false)}
      />
      <Modal
        visible={manufactureCalcVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setManufactureCalcVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/60 px-8">
          <View className="w-full rounded-2xl bg-paper p-4">
            <Text className="text-ink mb-3 text-base font-bold">제조일+기간으로 계산</Text>
            <Label text="제조일자" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              maxLength={10}
              value={manufactureDate}
              onChangeText={(t) => setManufactureDate(autoFormatDate(t))}
            />
            <View className="mt-3">
              <Label text="개월 수" />
              <TextInput
                className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
                placeholder="6"
                placeholderTextColor="#BBBBBB"
                keyboardType="number-pad"
                value={manufactureMonths}
                onChangeText={setManufactureMonths}
              />
            </View>
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => {
                  setManufactureCalcVisible(false);
                  setManufactureDate('');
                  setManufactureMonths('6');
                }}
                className="flex-1 items-center rounded-xl border border-line bg-paper py-2.5 active:opacity-70"
              >
                <Text className="text-ink text-sm font-medium">취소</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const months = Number(manufactureMonths);
                  if (!isValidDateStr(manufactureDate) || !Number.isFinite(months) || months <= 0) {
                    Alert.alert('입력 확인', '제조일자(YYYY-MM-DD)와 개월 수를 올바르게 입력해 주세요.');
                    return;
                  }
                  setExpiryDate(addMonths(manufactureDate, months));
                  setManufactureCalcVisible(false);
                }}
                className="flex-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80"
              >
                <Text className="text-paper text-sm font-bold">계산</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 사진 + 상품명 (한 줄 배치) */}
        <View className="flex-row">
          <View className="items-center">
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
            {imageUri ? (
              <Pressable onPress={() => setImageUri(null)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 제거</Text>
              </Pressable>
            ) : null}
          </View>

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
              placeholder={mode === 'home' ? '예: 두부' : '예: 해태 오예스 360g'}
              placeholderTextColor="#BBBBBB"
              value={name}
              onChangeText={setName}
            />
            {barcode ? (
              <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 12 }}>
                <Pressable onPress={() => setShowPhotoPicker(true)}>
                  <Text className="text-muted text-xs underline">제품 사진 선택 하기</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {/* 유통기한 + 수량 (한 줄 배치) */}
        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="유통기한 *" />
            {liveScanVisible ? (
              <ExpiryLiveScanModal
                dateOcrOrder={dateOcrOrder}
                onClose={() => setLiveScanVisible(false)}
                onDetected={(date) => {
                  setLiveScanVisible(false);
                  // 지난 날짜는 제조일일 수 있어 바로 넣지 않고 확인받는다(사진 인식과 같은 규칙)
                  if (date >= todayStr()) {
                    setExpiryDate(date);
                    return;
                  }
                  Alert.alert('지난 날짜예요', `${date}로 읽었어요. 이 날짜로 입력할까요?`, [
                    { text: '다시 읽기', onPress: () => setLiveScanVisible(true) },
                    { text: '입력', onPress: () => setExpiryDate(date) },
                  ]);
                }}
              />
            ) : null}
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
            {/* 인식 버튼은 입력칸 아래 — 제목 줄에 두면 좁은 화면에서 두 줄로 밀려 옆 '수량'과 높이가 어긋났다 */}
            <View className="mt-2 flex-row flex-wrap items-center" style={{ columnGap: 14, rowGap: 6 }}>
              <Pressable
                onPress={() => setLiveScanVisible(true)}
                className="flex-row items-center"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="카메라로 유통기한 자동 인식"
              >
                <MaterialCommunityIcons name="line-scan" size={15} color="#CC2222" />
                <Text className="text-primary ml-1 text-xs font-medium">자동 인식</Text>
              </Pressable>
              <Pressable
                onPress={scanExpiryDatePhoto}
                disabled={ocrBusy}
                className="flex-row items-center"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="사진으로 유통기한 인식"
              >
                {ocrBusy ? (
                  <ActivityIndicator size="small" color="#CC2222" />
                ) : (
                  <MaterialCommunityIcons name="text-recognition" size={15} color="#CC2222" />
                )}
                <Text className="text-primary ml-1 text-xs font-medium">사진으로 인식</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setManufactureCalcVisible(true)} className="mt-1.5">
              <Text className="text-muted text-xs underline">제조일+기간으로 계산</Text>
            </Pressable>
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

        {/* 가정용: 이미 등록한 상품을 쿠팡에서 다시 찾아보기 (설정에서 끌 수 있음) */}
        {isEdit && mode === 'home' && coupangSuggest && name.trim() ? (
          <View className="mt-5">
            <CoupangRebuyCard name={name} imageUri={imageUri} />
          </View>
        ) : null}
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
