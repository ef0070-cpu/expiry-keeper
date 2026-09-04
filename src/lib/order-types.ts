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

/** 사용자가 자유롭게 추가/이름변경/삭제할 수 있는 전역(공용) 구역 이름. */
export type FridgeSection = string;

export interface FridgeAssignment {
  productId: string;
  section: FridgeSection;
}
