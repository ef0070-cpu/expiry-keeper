import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { View } from 'react-native';

export default function Thumbnail({
  uri,
  size,
  radius = 8,
  iconSize,
}: {
  uri: string | null | undefined;
  size: number;
  radius?: number;
  iconSize?: number;
}) {
  if (!uri) {
    return (
      <View
        className="items-center justify-center bg-bg"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <MaterialCommunityIcons
          name="image-off-outline"
          size={iconSize ?? size * 0.35}
          color="#BBBBBB"
        />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#F0F0F0' }}
        contentFit="cover"
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: 'rgba(0,0,0,0.1)',
        }}
      />
    </View>
  );
}
