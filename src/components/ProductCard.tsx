import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DdayBadge from './DdayBadge';
import { daysUntil } from '@/lib/dates';
import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onPress: () => void;
  onLongPress: () => void;
}

export default function ProductCard({ product, onPress, onLongPress }: Props) {
  const days = daysUntil(product.expiryDate);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      {product.imageUri ? (
        <Image
          source={{ uri: product.imageUri }}
          style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#F0F0F0' }}
          contentFit="cover"
        />
      ) : (
        <View className="h-16 w-16 items-center justify-center rounded-lg bg-bg">
          <MaterialCommunityIcons name="image-off-outline" size={24} color="#BBBBBB" />
        </View>
      )}

      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-sm">{product.expiryDate}</Text>
        <View className="mt-1 flex-row items-center">
          {product.category ? (
            <View className="rounded border border-line bg-bg px-1.5 py-0.5">
              <Text className="text-muted text-xs">{product.category}</Text>
            </View>
          ) : null}
          {product.quantity > 1 ? (
            <Text className="text-muted ml-2 text-xs">{product.quantity}개</Text>
          ) : null}
        </View>
      </View>

      <DdayBadge days={days} />
    </Pressable>
  );
}
