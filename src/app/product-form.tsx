import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { takePickedBarcode } from '@/lib/scan-pick';
import { useBarcodeAutoFill } from '@/lib/barcode-lookup';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { extractDateCandidates, dateOrderFromBarcode } from '@/lib/date-ocr';
import { errorMessage } from '@/lib/errors';
import { getMfgPeriod, saveMfgPeriod } from '@/lib/mfg-period';
import { deleteLocalPhotoIfOwned, persistLocalPhoto } from '@/lib/local-photo';
import {
  autoFormatDate,
  autoFormatDateByOrder,
  expiryFromManufacture,
  formatDate,
  isoToOrderedInput,
  isValidDateStr,
  orderedInputToIso,
  todayStr,
} from '@/lib/dates';
import { withinProductLimit } from '@/lib/entitlement';
import { maybeShowInterstitial } from '@/lib/interstitial';
import { cancelExpiryAlerts, scheduleExpiryAlerts } from '@/lib/notifications';
import {
  deleteProduct,
  getCachedActiveProducts,
  getCachedCategories,
  getCachedProduct,
  getProduct,
  listProducts,
  listProductsByBarcode,
  newId,
  saveProduct,
} from '@/lib/repo';
import {
  AppMode,
  DATE_OCR_ORDERS,
  DateOcrOrder,
  useAppMode,
  useCoupangSuggestEnabled,
  useDateInputMethod,
  useDateOcrOrder,
} from '@/lib/settings';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CoupangRebuyCard from '@/components/CoupangRebuyCard';
import { Product, ProductStatus } from '@/lib/types';

const MFG_PRESETS: [number, 'month' | 'day'][] = [
  [30, 'day'], [60, 'day'], [90, 'day'], [180, 'day'], [6, 'month'], [12, 'month'],
];

/** YYYY-MM-DD → '화' 같은 요일 한 글자 */
function weekdayKo(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return '일월화수목금토'[new Date(y, m - 1, d).getDay()];
}
const ORDER_SHORT: Record<DateOcrOrder, string> = { ymd: '년/월/일', dmy: '일/월/년', mdy: '월/일/년' };
const ORDER_PLACEHOLDER: Record<DateOcrOrder, string> = { ymd: 'YYYY-MM-DD', dmy: 'DD-MM-YYYY', mdy: 'MM-DD-YYYY' };

export default function ProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
    lookup?: string;
  }>();
  const isEdit = !!params.id;
  const mode = useAppMode();
  const insets = useSafeAreaInsets();
  const coupangSuggest = useCoupangSuggestEnabled();
  const dateInputMethod = useDateInputMethod();
  // 기본 순서는 설정값. 이 상품에서만 바꾼 순서(버튼·바코드 국가 추천)가 있으면 그게 우선 — 설정은 안 바뀐다
  const defaultDateOrder = useDateOcrOrder();
  const [orderOverride, setOrderOverride] = useState<DateOcrOrder | null>(null);
  const [orderSheetVisible, setOrderSheetVisible] = useState(false);
  // 바코드 잘못 읽힘 → 번호를 눌러 다시 촬영·직접 수정
  const [barcodeEditVisible, setBarcodeEditVisible] = useState(false);
  const [barcodeDraft, setBarcodeDraft] = useState('');
  const dateOcrOrder = orderOverride ?? defaultDateOrder;

  const [name, setName] = useState(params.prefillName ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.prefillImage || null);
  // 스캔 직후 넘어왔으면 상품명·사진을 뒤에서 찾아 빈칸만 채운다(이미 입력했으면 그대로)
  const lookingUp = useBarcodeAutoFill(params.barcode, params.lookup === '1', (info) => {
    if (info.name) setName((prev) => prev || info.name!);
    if (info.imageUrl) setImageUri((prev) => prev ?? info.imageUrl);
  });
  // 새 상품이면 현재 연도를 미리 채워 월·일만 입력하면 되게 한다
  const [expiryDate, setExpiryDate] = useState(params.id ? '' : String(new Date().getFullYear()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  // 직접 입력칸에 보이는 글자(고른 날짜 순서대로). 저장·검사는 항상 expiryDate(YYYY-MM-DD)
  const [expiryText, setExpiryText] = useState(expiryDate);
  // 인식·달력·제조일 계산·수정 불러오기·순서 전환으로 날짜가 바뀌면 입력칸 글자를 맞춘다.
  // 해외 순서로 입력하는 중(expiryDate가 빈칸)이면 친 글자를 그대로 둔다
  useEffect(() => {
    setExpiryText((prev) =>
      dateOcrOrder !== 'ymd' && expiryDate === '' ? prev : isoToOrderedInput(expiryDate, dateOcrOrder),
    );
  }, [expiryDate, dateOcrOrder]);
  const [quantity, setQuantity] = useState(1);
  // 수량 직접 입력 중인 글자(지우는 중 빈칸 허용). quantity는 항상 1 이상으로 유지한다
  const [qtyText, setQtyText] = useState<string | null>(null);
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
  // 제조일+기간 팝업(중국 제품 등 제조일과 보존기간만 있는 경우)
  const [mfgVisible, setMfgVisible] = useState(false);
  const [mfgPickerVisible, setMfgPickerVisible] = useState(false);
  const [manufactureDate, setManufactureDate] = useState('');
  const [manufactureMonths, setManufactureMonths] = useState('6');
  // 중국 제품 보관 기간(保质期)은 '12个月'처럼 개월, '180天'처럼 일 단위가 섞여 있다
  const [manufactureUnit, setManufactureUnit] = useState<'month' | 'day'>('month');
  // 자동·사진 인식 결과를 팝업의 제조일로 보낼지 — 중국 제품 확인 창에서 [예]를 누른 경우
  const mfgTargetRef = useRef(false);
  const openMfg = (date?: string) => {
    mfgTargetRef.current = false;
    if (date) setManufactureDate(date);
    setMfgVisible(true);
  };
  // 인식·달력으로 읽은 날짜는 유통기한 칸으로, 중국 제품 [예]였으면 팝업의 제조일로
  const applyPickedDate = (d: string) => (mfgTargetRef.current ? openMfg(d) : setExpiryDate(d));

  const [barcode, setBarcode] = useState<string | null>(params.barcode ?? null);
  const barcodeHint = useMemo(() => dateOrderFromBarcode(barcode), [barcode]);
  const foreignHint = barcodeHint && barcodeHint.country !== '한국' ? barcodeHint : null;

  const onBarcodePress = () => {
    const edit = () => {
      setBarcodeDraft(barcode ?? '');
      setBarcodeEditVisible(true);
    };
    Alert.alert('바코드가 잘못 읽혔나요?', barcode ?? '', [
      { text: '취소', style: 'cancel' },
      { text: '직접 수정', onPress: edit },
      // 번호만 읽어 이 화면으로 돌아온다(발주 화면과 같은 방식) — 수정 중인 상품도 쓸 수 있다
      { text: '다시 촬영', onPress: () => router.push('/scan?mode=pick') },
    ]);
  };

  const applyBarcode = (value = barcodeDraft) => {
    const v = value.trim();
    if (!/^\d{6,13}$/.test(v)) {
      Alert.alert('입력 확인', '바코드는 6~13자리 숫자여야 합니다.');
      return;
    }
    setBarcodeEditVisible(false);
    if (isEdit) {
      setBarcode(v);
      return;
    }
    // 새 상품은 스캔 직후와 똑같이 — 상품명·사진을 새 바코드로 다시 찾는다
    router.replace({ pathname: '/product-form', params: { barcode: v, lookup: '1' } });
  };

  // [다시 촬영]으로 스캔 화면에 갔다가 돌아오면 읽은 번호 적용
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedBarcode();
      if (picked) applyBarcode(picked);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEdit]),
  );
  useEffect(() => {
    if (barcodeHint) setOrderOverride(barcodeHint.order);
  }, [barcodeHint]);
  // 이 바코드로 기간을 기억해 두었으면 팝업에 미리 채운다
  useEffect(() => {
    if (!barcode) return;
    let alive = true;
    getMfgPeriod(barcode).then((p) => {
      if (!alive || !p) return;
      setManufactureMonths(String(p.n));
      setManufactureUnit(p.unit);
    });
    return () => {
      alive = false;
    };
  }, [barcode]);
  const mfgResult = expiryFromManufacture(manufactureDate, Number(manufactureMonths), manufactureUnit);

  // 자동·사진 인식 — 중국 바코드면 먼저 묻는다: 제조일만 있으면 읽은 날짜를 제조일로 팝업에
  const startRecognition = (run: () => void) => {
    mfgTargetRef.current = false;
    if (!barcodeHint?.mfg) return run();
    Alert.alert('중국 제품입니다', '포장에 제조일과 보존기간만 있나요?\n[예]를 누르면 제조일을 읽어 유통기한을 계산해요.', [
      { text: '아니오', onPress: run },
      {
        text: '예',
        onPress: () => {
          mfgTargetRef.current = true;
          run();
        },
      },
    ]);
  };
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
    if (event.type === 'set' && selected) applyPickedDate(formatDate(selected));
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
      const isMfg = mfgTargetRef.current;
      // 제조일로 읽으려다 촬영을 취소했으면 팝업에서 직접 입력하게
      if (result.canceled || !result.assets[0]) {
        if (isMfg) openMfg();
        return;
      }

      const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
      const { text } = await recognizeText(result.assets[0].uri);
      const raw = extractDateCandidates(text, isMfg ? 'ymd' : dateOcrOrder);
      const today = todayStr();
      // 제조일을 읽을 땐 지난 날짜(최근 순)가 맞는 쪽 — 앞으로 놓는다
      const candidates = isMfg ? [...raw.filter((d) => d <= today), ...raw.filter((d) => d > today)] : raw;
      // 맞는 쪽 날짜 하나만 읽혔을 때만 묻지 않고 바로 넣는다(단계 최소화). 유통기한인데 지난 날짜
      // 하나면 제조일일 수 있어(유통기한이 흐리게 찍힌 경우) 바로 넣지 않고 확인받는다.
      if (candidates.length === 1 && (isMfg ? candidates[0] <= today : candidates[0] >= today)) {
        applyPickedDate(candidates[0]);
        return;
      }
      const retry = { text: '다시 찍기', onPress: () => void scanExpiryDatePhoto() };
      if (candidates.length === 0 && isMfg) {
        // 제조일을 못 읽었으면 팝업에서 직접 입력·달력·[오늘]로
        openMfg();
        return;
      }
      if (candidates.length === 0) {
        Alert.alert(
          '날짜를 못 읽었어요',
          '날짜 글자가 크고 선명하게 나오도록 가까이에서 초점을 맞춰 다시 찍거나, 직접 입력해 주세요.',
          [{ text: '직접 입력', style: 'cancel' }, retry],
        );
        return;
      }
      const label = (d: string) => (!isMfg && d < today ? `${d} (지난 날짜)` : d);
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
            ...shown.map((d) => ({ text: label(d), onPress: () => applyPickedDate(d) })),
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
    // 매장 무료 한도는 새 상품 추가에만 — 기존 상품 수정·수량 합치기는 한도를 넘어도 막지 않는다
    if (!isEdit && productMode === 'retail') {
      const active = await listProducts('active').catch(() => getCachedActiveProducts());
      if (!(await withinProductLimit(active.length))) {
        router.push('/premium?reason=products');
        return;
      }
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
      if (!isEdit && productMode === 'home') maybeShowInterstitial(); // 가정용 새 상품 저장 직후에만
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
      <ScrollView
        className="flex-1 bg-bg"
        // 하단 안내바(제스처·버튼 바)에 마지막 줄(쿠팡 표시 문구)이 가리지 않게 그 높이만큼 더 띄운다
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 32 }}
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
            <Text className="text-ink text-sm font-bold">상품명 *</Text>
            {/* 바코드는 제목 옆에 붙이면 작고 눌리는 줄 몰라서 따로 한 줄, 글씨 크게 */}
            {barcode ? (
              <Pressable
                onPress={onBarcodePress}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`바코드 ${barcode}, 눌러서 다시 촬영하거나 수정`}
                className="mt-1 flex-row items-center"
              >
                <MaterialCommunityIcons name="barcode" size={18} color="#555555" />
                <Text
                  numberOfLines={1}
                  className="text-ink ml-1 flex-shrink text-sm underline"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {barcode}
                </Text>
                <MaterialCommunityIcons name="pencil-outline" size={16} color="#CC2222" style={{ marginLeft: 4 }} />
              </Pressable>
            ) : null}
            <TextInput
              className="text-ink mt-1.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder={lookingUp ? '상품명 찾는 중…' : mode === 'home' ? '예: 두부' : '예: 해태 오예스 360g'}
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
            <View className="flex-row items-start justify-between">
              <Label text="유통기한 *" />
              {/* 날짜 순서 — 버튼 3개를 늘어놓으면 조잡해 작은 선택 하나로 */}
              <Pressable
                onPress={() => setOrderSheetVisible(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`날짜 순서 ${ORDER_SHORT[dateOcrOrder]}, 눌러서 바꾸기`}
                className={`ml-2 flex-shrink flex-row items-center rounded-full border px-2 py-0.5 ${
                  foreignHint ? 'border-primary' : 'border-line'
                } bg-paper`}
              >
                <Text
                  numberOfLines={1}
                  className={`flex-shrink text-xs ${foreignHint ? 'text-primary font-bold' : 'text-muted'}`}
                >
                  {ORDER_SHORT[dateOcrOrder]}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={14} color={foreignHint ? '#CC2222' : '#888888'} />
              </Pressable>
            </View>
            {liveScanVisible ? (
              <ExpiryLiveScanModal
                dateOcrOrder={mfgTargetRef.current ? 'ymd' : dateOcrOrder}
                preferPast={mfgTargetRef.current}
                onClose={() => {
                  setLiveScanVisible(false);
                  // 제조일로 읽으려다 닫았으면 팝업에서 직접 입력하게
                  if (mfgTargetRef.current) openMfg();
                }}
                onDetected={(date) => {
                  setLiveScanVisible(false);
                  // 제조일은 지난 날짜가 정상 — 묻지 않고 팝업에 넣는다
                  if (mfgTargetRef.current) {
                    openMfg(date);
                    return;
                  }
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
                placeholder={ORDER_PLACEHOLDER[dateOcrOrder]}
                placeholderTextColor="#BBBBBB"
                keyboardType="number-pad"
                maxLength={10}
                value={expiryText}
                onChangeText={(t) => {
                  const text = autoFormatDateByOrder(t, dateOcrOrder);
                  setExpiryText(text);
                  // 년/월/일은 예전처럼 입력 중 글자 그대로, 해외 순서는 다 입력돼야 날짜로 저장
                  setExpiryDate(dateOcrOrder === 'ymd' ? text : (orderedInputToIso(text, dateOcrOrder) ?? ''));
                }}
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
                onPress={() => {
                  setQtyText(null);
                  setQuantity((n) => Math.max(1, n - 1));
                }}
              />
              {/* 많이 넣을 때 +를 여러 번 누르기 불편하다는 의견 — 숫자를 눌러 직접 입력 */}
              <TextInput
                value={qtyText ?? String(quantity)}
                onChangeText={(t) => {
                  const digits = t.replace(/[^0-9]/g, '').slice(0, 4);
                  setQtyText(digits);
                  const n = parseInt(digits, 10);
                  if (n >= 1) setQuantity(n);
                }}
                onFocus={() => setQtyText(String(quantity))}
                onBlur={() => setQtyText(null)}
                selectTextOnFocus
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="수량 직접 입력"
                className="text-ink mx-2 min-w-[56px] rounded-lg border border-line bg-paper px-2 py-1 text-center text-lg font-bold"
                style={{ fontVariant: ['tabular-nums'] }}
              />
              <Stepper
                icon="plus"
                label="수량 증가"
                onPress={() => {
                  setQtyText(null);
                  setQuantity((n) => Math.min(9999, n + 1));
                }}
              />
            </View>
          </View>
        </View>

        {/* 해외 바코드 안내 한 줄 — 전체 폭(유통기한 칸 안은 수량 옆이라 좁아 두 줄로 밀림). 길면 글자를 줄여 한 줄 유지 */}
        {foreignHint ? (
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="text-primary mt-1.5 text-xs">
            {foreignHint.mfg
              ? `${foreignHint.country} 제품 바코드예요. 제조일만 있으면 [제조일+기간]을 누르세요.`
              : `${foreignHint.country} 제품 바코드예요(${ORDER_SHORT[foreignHint.order]}). 다르면 바꿔 주세요.`}
          </Text>
        ) : null}

        {/* 유통기한 입력 도구 한 줄 — 중국 바코드일 때만 [제조일+기간]이 붙는다 */}
        <View className="mt-2 flex-row" style={{ gap: 6 }}>
          <ToolButton
            icon="line-scan"
            label="자동 인식"
            a11y="카메라로 유통기한 자동 인식"
            onPress={() => startRecognition(() => setLiveScanVisible(true))}
          />
          <ToolButton
            icon="text-recognition"
            label="사진 인식"
            a11y="사진으로 유통기한 인식"
            busy={ocrBusy}
            onPress={() => startRecognition(() => void scanExpiryDatePhoto())}
          />
          {barcodeHint?.mfg ? (
            <ToolButton
              icon="calendar-plus"
              label="제조일+기간"
              a11y="제조일과 보존기간으로 유통기한 계산"
              onPress={() => openMfg()}
            />
          ) : null}
        </View>

        {/* 제조일+기간 팝업 — 중국 제품 등 제조일과 보존기간만 있는 경우 */}
        <Modal visible={mfgVisible} transparent animationType="fade" onRequestClose={() => setMfgVisible(false)}>
          <View className="flex-1 items-center justify-center bg-black/60 px-6">
            <View className="w-full rounded-2xl bg-paper p-5">
              <View className="flex-row items-center">
                <Text className="text-ink flex-1 text-center text-lg font-bold">제조일 + 기간 입력</Text>
                <Pressable
                  onPress={() => setMfgVisible(false)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="닫기"
                  className="absolute right-0"
                >
                  <MaterialCommunityIcons name="close" size={24} color="#1A1A1A" />
                </Pressable>
              </View>
              <Text className="text-muted mt-1 text-center text-xs">(중국 제품 등 제조일과 보존기간만 있는 경우)</Text>

              <Text className="text-ink mb-1.5 mt-4 text-sm font-bold">제조일 (생산일)</Text>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <View className="flex-1 flex-row items-center rounded-xl border border-line bg-paper px-3">
                  <Pressable onPress={() => setMfgPickerVisible(true)} hitSlop={8} accessibilityLabel="달력에서 제조일 고르기">
                    <MaterialCommunityIcons name="calendar-month-outline" size={20} color="#888888" />
                  </Pressable>
                  <TextInput
                    className="text-ink ml-2 flex-1 py-2.5 text-base"
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#BBBBBB"
                    keyboardType="number-pad"
                    maxLength={10}
                    value={manufactureDate}
                    onChangeText={(t) => setManufactureDate(autoFormatDate(t))}
                    accessibilityLabel="제조일"
                  />
                </View>
                <Pressable
                  onPress={() => setManufactureDate(todayStr())}
                  className="rounded-xl border border-line bg-paper px-3 py-2.5 active:opacity-70"
                >
                  <Text className="text-ink text-sm">오늘</Text>
                </Pressable>
              </View>
              {mfgPickerVisible ? (
                <DateTimePicker
                  value={isValidDateStr(manufactureDate) ? new Date(`${manufactureDate}T00:00:00`) : new Date()}
                  mode="date"
                  onChange={(e, d) => {
                    setMfgPickerVisible(false);
                    if (e.type === 'set' && d) setManufactureDate(formatDate(d));
                  }}
                />
              ) : null}

              <Text className="text-ink mb-1.5 mt-4 text-sm font-bold">+ 기간 입력 (소비·유통기한)</Text>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <TextInput
                  className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
                  keyboardType="number-pad"
                  maxLength={4}
                  value={manufactureMonths}
                  onChangeText={(t) => setManufactureMonths(t.replace(/[^0-9]/g, ''))}
                  accessibilityLabel="보존기간 숫자"
                />
                <View className="flex-row overflow-hidden rounded-xl border border-line">
                  {(['day', 'month'] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setManufactureUnit(u)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: manufactureUnit === u }}
                      className={`px-4 py-2.5 ${manufactureUnit === u ? 'bg-primary' : 'bg-paper'}`}
                    >
                      <Text className={`text-sm ${manufactureUnit === u ? 'text-paper font-bold' : 'text-ink'}`}>
                        {u === 'month' ? '개월' : '일'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* 자주 쓰는 보존기간 — 한 번 누르면 숫자·단위가 함께 채워진다 */}
              <View className="mt-2.5 flex-row flex-wrap" style={{ gap: 6 }}>
                {MFG_PRESETS.map(([n, u]) => {
                  const on = manufactureMonths === String(n) && manufactureUnit === u;
                  return (
                    <Pressable
                      key={`${n}${u}`}
                      onPress={() => {
                        setManufactureMonths(String(n));
                        setManufactureUnit(u);
                      }}
                      className={`rounded-full border px-3 py-1.5 ${on ? 'border-primary bg-primary/10' : 'border-line bg-paper'}`}
                    >
                      <Text className={`text-sm ${on ? 'text-primary font-bold' : 'text-ink'}`}>
                        {n}
                        {u === 'month' ? '개월' : '일'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View className="mt-4 rounded-xl bg-bg p-3.5">
                <Text className="text-muted text-sm">자동 계산된 유통기한</Text>
                <Text className="text-primary mt-1 text-xl font-bold">
                  {mfgResult ? `${mfgResult} (${weekdayKo(mfgResult)}요일 까지)` : '제조일과 기간을 입력하세요'}
                </Text>
              </View>

              <View className="mt-4 flex-row" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => setMfgVisible(false)}
                  className="flex-1 items-center rounded-xl border border-line bg-paper py-3 active:opacity-70"
                >
                  <Text className="text-muted text-base">취소</Text>
                </Pressable>
                <Pressable
                  disabled={!mfgResult}
                  onPress={() => {
                    if (!mfgResult) return;
                    setExpiryDate(mfgResult);
                    // 이 바코드의 보존기간을 기억 — 다음엔 제조일만 넣으면 된다
                    if (barcode) {
                      void saveMfgPeriod(barcode, { n: Number(manufactureMonths), unit: manufactureUnit });
                    }
                    setMfgVisible(false);
                  }}
                  className={`flex-1 items-center rounded-xl py-3 active:opacity-80 ${mfgResult ? 'bg-primary' : 'bg-line'}`}
                >
                  <Text className="text-paper text-base font-bold">확인 (적용)</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={barcodeEditVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setBarcodeEditVisible(false)}
        >
          <View className="flex-1 items-center justify-center bg-black/60 px-8">
            <View className="w-full rounded-2xl bg-paper p-4">
              <Text className="text-ink mb-3 text-base font-bold">바코드 수정</Text>
              <TextInput
                className="text-ink rounded-xl border border-line bg-bg px-3 py-2.5 text-base"
                placeholder="바코드 숫자"
                placeholderTextColor="#BBBBBB"
                keyboardType="number-pad"
                maxLength={13}
                autoFocus
                value={barcodeDraft}
                onChangeText={(t) => setBarcodeDraft(t.replace(/[^0-9]/g, ''))}
              />
              <View className="mt-4 flex-row gap-2">
                <Pressable
                  onPress={() => setBarcodeEditVisible(false)}
                  className="flex-1 items-center rounded-xl border border-line bg-paper py-2.5 active:opacity-70"
                >
                  <Text className="text-ink text-sm font-medium">취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => applyBarcode()}
                  className="flex-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80"
                >
                  <Text className="text-paper text-sm font-bold">확인</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={orderSheetVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setOrderSheetVisible(false)}
        >
          <Pressable className="flex-1 items-center justify-center bg-black/60 px-8" onPress={() => setOrderSheetVisible(false)}>
            <View className="w-full rounded-2xl bg-paper p-4">
              <Text className="text-ink text-base font-bold">날짜 표기 순서</Text>
              <Text className="text-muted mb-3 mt-1 text-xs">
                {foreignHint
                  ? `${foreignHint.country} 바코드라 자동으로 골랐어요. 포장과 다르면 바꾸세요.`
                  : '포장에 적힌 순서를 고르세요. 이 상품에만 적용돼요.'}
              </Text>
              {DATE_OCR_ORDERS.map((o) => (
                <Pressable
                  key={o}
                  onPress={() => {
                    setOrderOverride(o);
                    setOrderSheetVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: dateOcrOrder === o }}
                  className={`mb-2 flex-row items-center rounded-xl border px-3 py-2.5 ${
                    dateOcrOrder === o ? 'border-primary' : 'border-line'
                  }`}
                >
                  <Text className={`flex-1 text-sm ${dateOcrOrder === o ? 'text-primary font-bold' : 'text-ink'}`}>
                    {ORDER_SHORT[o]}
                  </Text>
                  <Text className="text-muted text-xs">{ORDER_EXAMPLE[o]}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

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
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm"
              textAlignVertical="center"
              // 문구가 길면 큰 글자에서 두 줄로 넘어가 잘렸다 — 짧게, 한 줄 고정
              placeholder={mode === 'home' ? '새 카테고리 (예: 냉장실)' : '새 카테고리 (예: 1호매장)'}
              numberOfLines={1}
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
            <CoupangRebuyCard
              name={name}
              imageUri={imageUri}
              expiryDate={isValidDateStr(expiryDate) ? expiryDate : undefined}
            />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ORDER_EXAMPLE: Record<DateOcrOrder, string> = {
  ymd: '예: 2026.09.10',
  dmy: '예: 10.09.2026',
  mdy: '예: 09.10.2026',
};

/** 유통기한 입력 도구 버튼(자동 인식·사진 인식·제조일+기간) — 한 줄 3등분, 글자가 길면 줄임 */
function ToolButton({
  icon,
  label,
  a11y,
  onPress,
  busy = false,
  highlight = false,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  a11y: string;
  onPress: () => void;
  busy?: boolean;
  highlight?: boolean;
}) {
  const color = highlight ? '#FFFFFF' : '#CC2222';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      className={`flex-1 flex-row items-center justify-center rounded-xl border py-2 active:opacity-70 ${
        highlight ? 'border-primary bg-primary' : 'border-line bg-paper'
      }`}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : <MaterialCommunityIcons name={icon} size={15} color={color} />}
      <Text numberOfLines={1} className={`ml-1 flex-shrink text-xs font-medium ${highlight ? 'text-paper' : 'text-primary'}`}>
        {label}
      </Text>
    </Pressable>
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
