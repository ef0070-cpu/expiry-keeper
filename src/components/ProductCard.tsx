import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import DdayBadge from './DdayBadge';
import Thumbnail from './Thumbnail';
import { daysUntil } from '@/lib/dates';
import { Product } from '@/lib/types';

interface Props {
  product: Product;
  onPress: (id: string) => void;
  onLongPress: (product: Product) => void;
}

function ProductCard({ product, onPress, onLongPress }: Props) {
  const days = daysUntil(product.expiryDate);

  return (
    <Pressable
      onPress={() => onPress(product.id)}
      onLongPress={() => onLongPress(product)}
      className="mx-4 mb-2.5 flex-row items-center rounded-xl border border-line bg-paper p-3 active:opacity-70"
    >
      <Thumbnail uri={product.imageUri} size={64} radius={8} iconSize={24} />

      <View className="ml-3 flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>
          {product.name}
        </Text>
        <Text className="text-muted mt-0.5 text-sm">{product.expiryDate}</Text>
        <View className="mt-1 flex-row flex-wrap items-center" style={{ gap: 4 }}>
          {product.categories.map((c) => (
            <View key={c} className="rounded border border-line bg-bg px-1.5 py-0.5">
              <Text className="text-muted text-xs">{c}</Text>
            </View>
          ))}
          {product.quantity > 1 ? (
            <Text className="text-muted ml-2 text-xs">{product.quantity}개</Text>
          ) : null}
        </View>
      </View>

      <DdayBadge days={days} />
    </Pressable>
  );
}

export default memo(ProductCard);
