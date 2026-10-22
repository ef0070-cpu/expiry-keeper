import type { FridgeBackground, FridgeColumns, TileSpan } from './fridge-layout';

export type OrderStatus = 'active' | 'discontinued' | 'paused';

/** 매장별 빠른발주 화면 설정: 구역마다 열 수, 냉동고 배경 */
export interface FridgeLayoutSettings {
  columns: Record<string, FridgeColumns>;
  background: FridgeBackground;
}

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
  /** 상품 id, 또는 진열대 빈 자리면 'spacer:…'(fridge-layout.ts isSpacerId) */
  productId: string;
  section: FridgeSection;
  /** 빠른발주 카드가 차지하는 칸(없으면 1칸). 옛 버전 앱은 이 값을 모른다 */
  span?: TileSpan;
}
