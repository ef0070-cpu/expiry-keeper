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
import Chip from '@/components/Chip';
import { hasImageSearchKeys, lookupBarcode, searchProductImage } from '@/lib/barcode-lookup';
import {
  addOrderCategory,
  deleteOrderProduct,
  getOrderProduct,
  listOrderCategories,
  newId,
  saveOrderProduct,
} from '@/lib/order-repo';
import { OrderProduct, OrderStatus } from '@/lib/order-types';

export default function OrderProductForm() {
  const params = useLocalSearchParams<{
    id?: string;
    barcode?: string;
    prefillName?: string;
    prefillImage?: string;
  }>();
  const isEdit = !!params.id;

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
    // 바코드가 있으면 정확도가 더 높은 바코드 기반 조회를 먼저 시도하고,
    // 못 찾았을 때만 상품명(+브랜드) 기반 웹 이미지 검색으로 보완한다.
    let url: string | null = null;
    if (barcode.trim()) {
      const info = await lookupBarcode(barcode.trim(), brand.trim() || undefined);
      url = info.imageUrl;
    }
    if (!url) {
      const query = brand.trim() ? `${brand.trim()} ${name.trim()}` : name.trim();
      url = await searchProductImage(query);
    }
    setSearching(false);
    if (url) setImageUri(url);
    else Alert.alert('검색 결과 없음', '이미지를 찾지 못했습니다. 직접 촬영해 주세요.');
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
          await deleteOrderProduct(params.id!);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
      <Stack.Screen options={{ title: isEdit ? '발주 상품 수정' : '발주 상품 등록' }} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
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
              {imageUri ? (
                <Pressable onPress={() => setImageUri(null)}>
                  <Text className="text-muted text-xs underline">사진 제거</Text>
                </Pressable>
              ) : null}
            </View>
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
