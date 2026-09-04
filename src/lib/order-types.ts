export type OrderStatus = 'active' | 'discontinued' | 'paused';

export interface OrderProduct {
  id: string;
  name: string;
  brand: string;
  price: number;
  category: string;
  barcode: string | null;
  imageUri: string | null;
  status?: OrderStatus;
  /** 검색용 별칭/동의어 (예: "메로나"의 별칭 "메론바"). 이 기기에만 저장되는 로컬 값 —
   * 공용 카탈로그(order_catalog)로 동기화되지 않는다. */
  aliases?: string[];
}

export type OrderCart = Record<string, number>;

export interface Store {
  id: string;
  name: string;
}

export type FridgeSection = '600바' | '100바콘류' | '1000바' | '샌드류';

export interface FridgeAssignment {
  productId: string;
  section: FridgeSection;
}
