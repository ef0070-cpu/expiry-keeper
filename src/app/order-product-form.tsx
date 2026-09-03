import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import ImageCandidatesModal from '@/components/ImageCandidatesModal';
import PhotoCandidatesModal from '@/components/PhotoCandidatesModal';
import { hasImageSearchKeys, lookupBarcode, searchProductImageCandidates } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderProduct,
  getOrderProduct,
  listOrderCategories,
  newId,
  saveOrderProduct,
} from '@/lib/order-repo';
import { reportOrderProductIssue } from '@/lib/order-report';
import { OrderProduct, OrderStatus } from '@/lib/order-types';

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return '알 수 없는 오류';
}

export default function OrderProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const isEdit = !!params.id;
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(params.prefillName ?? '');
  const [imageUri, setImageUri] = useState<string | null>(params.prefillImage || null);
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [status, setStatus] = useState<OrderStatus>('active');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [checkingBarcode, setCheckingBarcode] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportMessage, setReportMessage] = useState('');
  const [reportPhotoUri, setReportPhotoUri] = useState<string | null>(null);
  const [reportCopyright, setReportCopyright] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showPhotoCandidates, setShowPhotoCandidates] = useState(false);
  const [imageCandidates, setImageCandidates] = useState<string[] | null>(null);

  useEffect(() => {
    listOrderCategories().then((list) => {
      setCategories(list);
      if (!params.id && list.length > 0) setCategory((prev) => prev || list[0]);
    });

    if (params.id) {
      getOrderProduct(params.id).then((p) => {
        if (!p) return;
        setName(p.name);
        setImageUri(p.imageUri);
        setBrand(p.brand);
        setPrice(String(p.price));
        setBarcode(p.barcode ?? '');
        setCategory(p.category);
        setStatus(p.status ?? 'active');
      });
    }
  }, [params.id]);

  const pickPhoto = (
    title: string,
    message: string,
    onPicked: (uri: string) => void,
    aspect?: [number, number]
  ) => {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel' },
      { text: '앨범에서 선택', onPress: () => launchPicker('library', onPicked, aspect) },
      { text: '카메라 촬영', onPress: () => launchPicker('camera', onPicked, aspect) },
    ]);
  };

  const pickImage = () => pickPhoto('상품 사진', '사진을 어떻게 추가할까요?', setImageUri);
  const pickReportPhoto = () =>
    pickPhoto('신고 사진', '사진을 어떻게 첨부할까요?', setReportPhotoUri);

  const launchPicker = async (
    source: 'camera' | 'library',
    onPicked: (uri: string) => void,
    aspect?: [number, number]
  ) => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      ...(aspect ? { aspect } : {}),
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
      onPicked(result.assets[0].uri);
    }
  };

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
    // 바코드 매칭 이미지(있으면)를 1순위 후보로 넣고, 상품명(+브랜드) 검색 결과를 더해
    // 사용자가 직접 고르게 한다 — 자동으로 하나를 확정 적용하지 않는다.
    const candidates: string[] = [];
    if (barcode.trim()) {
      const info = await lookupBarcode(barcode.trim(), brand.trim() || undefined);
      if (info.imageUrl) candidates.push(info.imageUrl);
    }
    const query = brand.trim() ? `${brand.trim()} ${name.trim()}` : name.trim();
    const found = await searchProductImageCandidates(query);
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

  const checkBarcode = async () => {
    const v = barcode.trim();
    if (!v) {
      Alert.alert('입력 확인', '바코드를 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '바코드 조회를 사용하려면 로그인이 필요합니다.');
      return;
    }
    setCheckingBarcode(true);
    const info = await lookupBarcode(v, brand.trim() || undefined);
    setCheckingBarcode(false);
    if (!info.name && !info.imageUrl) {
      Alert.alert('조회 결과 없음', '일치하는 정보를 찾지 못했습니다. 직접 입력해 주세요.');
      return;
    }
    if (info.name && !name.trim()) setName(info.name);
    if (info.imageUrl && !imageUri) setImageUri(info.imageUrl);
  };

  const addCategory = async () => {
    const v = newCategory.trim();
    if (!v) return;
    const next = await addOrderCategory(v);
    setCategories(next);
    setCategory(v);
    setNewCategory('');
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('입력 확인', '상품명을 입력해 주세요.');
      return;
    }
    if (!category) {
      Alert.alert('입력 확인', '카테고리를 선택해 주세요.');
      return;
    }
    const parsedPrice = Number(price);
    if (price.trim() && Number.isNaN(parsedPrice)) {
      Alert.alert('입력 확인', '가격은 숫자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const product: OrderProduct = {
        id: params.id ?? newId(),
        name: name.trim(),
        brand: brand.trim(),
        price: price.trim() ? parsedPrice : 0,
        category,
        barcode: barcode.trim() || null,
        imageUri,
        status,
      };
      await saveOrderProduct(product);
      router.back();
    } catch (e) {
      Alert.alert('저장 실패', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    const msg = reportMessage.trim();
    if (!msg) {
      Alert.alert('입력 확인', '신고 내용을 입력해 주세요.');
      return;
    }
    if (!hasImageSearchKeys()) {
      Alert.alert('로그인 필요', '신고 기능을 사용하려면 로그인이 필요합니다.');
      return;
    }
    setReporting(true);
    try {
      await reportOrderProductIssue(
        {
          id: params.id ?? '',
          name: name.trim(),
          brand: brand.trim(),
          price: Number(price) || 0,
          category,
          barcode: barcode.trim() || null,
          imageUri,
          status,
        },
        msg,
        reportPhotoUri,
        reportCopyright,
      );
      Alert.alert(
        '접수 완료',
        reportCopyright
          ? '저작권 신고가 접수됐습니다. 해당 사진이 즉시 초기화됐습니다.'
          : '신고가 접수됐습니다. 확인 후 반영하겠습니다.',
      );
      setReportMessage('');
      setReportPhotoUri(null);
      setReportCopyright(false);
      setShowReport(false);
    } catch (e) {
      Alert.alert('신고 실패', errorMessage(e));
    } finally {
      setReporting(false);
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
          await deleteOrderProduct(params.id!);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <Stack.Screen options={{ title: isEdit ? '발주 상품 수정' : '발주 상품 등록' }} />
      <ImageCandidatesModal
        visible={imageCandidates !== null}
        candidates={imageCandidates ?? []}
        onSelect={(url) => {
          setImageUri(url);
          setImageCandidates(null);
        }}
        onClose={() => setImageCandidates(null)}
      />
      <PhotoCandidatesModal
        visible={showPhotoCandidates}
        barcode={barcode.trim()}
        onClose={() => setShowPhotoCandidates(false)}
      />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16) + 32 }}
        keyboardShouldPersistTaps="handled"
      >
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
            <Text className="text-ink text-sm font-bold">상품명 *</Text>
            <TextInput
              className="text-ink mt-1.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 메로나"
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
            </View>
            {isEdit && barcode.trim() ? (
              <Pressable onPress={() => setShowPhotoCandidates(true)} className="mt-1.5">
                <Text className="text-muted text-xs underline">사진 후보 보기 / 투표</Text>
              </Pressable>
            ) : null}
            <Text className="text-muted mt-1.5 text-xs">
              이 사진은 다른 사용자들의 투표를 통해 대표 사진으로 채택될 수 있어요
            </Text>
          </View>
        </View>

        <View className="mt-4">
          <Label text="바코드" />
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="바코드 번호 입력 또는 스캔"
              placeholderTextColor="#BBBBBB"
              value={barcode}
              onChangeText={setBarcode}
            />
            <Pressable
              onPress={checkBarcode}
              disabled={checkingBarcode}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              {checkingBarcode ? (
                <ActivityIndicator size="small" color="#CC2222" />
              ) : (
                <Text className="text-ink text-sm font-medium">조회</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <View className="flex-1">
            <Label text="브랜드" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 빙그레"
              placeholderTextColor="#BBBBBB"
              value={brand}
              onChangeText={setBrand}
            />
          </View>
          <View className="flex-1">
            <Label text="가격 (원)" />
            <TextInput
              className="text-ink rounded-xl border border-line bg-paper px-3 py-2.5 text-base"
              placeholder="예: 400"
              placeholderTextColor="#BBBBBB"
              keyboardType="number-pad"
              value={price}
              onChangeText={setPrice}
            />
          </View>
        </View>

        <View className="mt-4">
          <Label text="카테고리 *" />
          {categories.length > 0 ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <TextInput
              className="text-ink flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm"
              placeholder="새 카테고리 입력 (예: 컵)"
              placeholderTextColor="#BBBBBB"
              value={newCategory}
              onChangeText={setNewCategory}
            />
            <Pressable
              onPress={addCategory}
              className="items-center justify-center rounded-xl border border-line bg-paper px-4 active:opacity-70"
            >
              <Text className="text-ink text-sm font-medium">추가</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4">
          <Label text="납품상태" />
          <View className="flex-row gap-2">
            <StatusOption
              label="시판중"
              color="#2E7D32"
              active={status === 'active'}
              onPress={() => setStatus('active')}
            />
            <StatusOption
              label="단종"
              color="#C62828"
              active={status === 'discontinued'}
              onPress={() => setStatus('discontinued')}
            />
            <StatusOption
              label="생산중단"
              color="#F9A825"
              active={status === 'paused'}
              onPress={() => setStatus('paused')}
            />
          </View>
        </View>

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

        {isEdit ? (
          <View className="mt-4">
            {showReport ? (
              <View className="rounded-xl border border-line bg-paper p-3">
                <Text className="text-ink mb-1.5 text-sm font-bold">정보 오류 신고</Text>
                <TextInput
                  className="text-ink rounded-xl border border-line bg-bg px-3 py-2 text-sm"
                  placeholder="예시:가격오류,사진오류,바코드오류등 신고 해주시면 반영 됩니다"
                  placeholderTextColor="#BBBBBB"
                  value={reportMessage}
                  onChangeText={setReportMessage}
                  multiline
                />
                <View className="mt-2 flex-row items-center gap-3">
                  <Pressable
                    onPress={pickReportPhoto}
                    className="items-center justify-center rounded-xl border border-line bg-bg"
                    style={{ width: 56, height: 56 }}
                    accessibilityRole="button"
                    accessibilityLabel={reportPhotoUri ? '신고 사진 변경' : '신고 사진 첨부'}
                  >
                    {reportPhotoUri ? (
                      <Image
                        source={{ uri: reportPhotoUri }}
                        style={{ width: 56, height: 56, borderRadius: 12 }}
                        contentFit="cover"
                      />
                    ) : (
                      <MaterialCommunityIcons name="camera-plus-outline" size={20} color="#888888" />
                    )}
                  </Pressable>
                  <Text className="text-muted text-xs">사진 첨부 (선택)</Text>
                  {reportPhotoUri ? (
                    <Pressable onPress={() => setReportPhotoUri(null)}>
                      <Text className="text-muted text-xs underline">제거</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setReportCopyright((v) => !v)}
                  className="mt-2 flex-row items-center"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: reportCopyright }}
                  accessibilityLabel="제 사진의 저작권을 침해했어요"
                >
                  <MaterialCommunityIcons
                    name={reportCopyright ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={20}
                    color={reportCopyright ? '#CC2222' : '#888888'}
                  />
                  <Text className="text-ink ml-1.5 text-xs">
                    제 사진의 저작권을 침해했어요 (체크 시 사진 즉시 초기화)
                  </Text>
                </Pressable>
                <View className="mt-2 flex-row gap-2">
                  <Pressable
                    onPress={submitReport}
                    disabled={reporting}
                    className="flex-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80"
                  >
                    {reporting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text className="text-paper text-sm font-bold">제출</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setShowReport(false);
                      setReportMessage('');
                      setReportCopyright(false);
                    }}
                    className="items-center justify-center px-3"
                  >
                    <Text className="text-muted text-sm">취소</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setShowReport(true)} className="items-center py-2">
                <Text className="text-muted text-xs underline">정보 오류 신고</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Label({ text }: { text: string }) {
  return <Text className="text-ink mb-1.5 text-sm font-bold">{text}</Text>;
}

function StatusOption({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center justify-center rounded-xl border py-2.5 active:opacity-70"
      style={{
        borderColor: active ? color : '#E5E5E5',
        backgroundColor: active ? color : '#FFFFFF',
      }}
    >
      <Text className="text-sm font-bold" style={{ color: active ? '#FFFFFF' : '#888888' }}>
        {label}
      </Text>
    </Pressable>
  );
}
