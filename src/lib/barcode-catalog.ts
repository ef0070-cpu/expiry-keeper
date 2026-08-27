import { supabase } from './supabase';

/** 바코드로 등록된 상품이면 이름·사진을 공용 카탈로그에 저장해, 다음 스캔 때 재사용한다. */
export async function upsertBarcodeCatalog(
  barcode: string | null,
  name: string,
  imageUri: string | null,
): Promise<void> {
  if (!supabase || !barcode || !name.trim()) return;
  const row: Record<string, unknown> = {
    barcode,
    name: name.trim(),
    updated_at: new Date().toISOString(),
  };
  if (imageUri?.startsWith('http')) row.image_uri = imageUri;
  await supabase.from('barcode_catalog').upsert(row);
}
