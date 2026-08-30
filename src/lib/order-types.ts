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
}

export type OrderCart = Record<string, number>;

export interface OrderHistoryEntry {
  id: string;
  dateKey: string; // YYYY-MM-DD (전송한 날짜, 캘린더 그룹핑 키)
  sentAt: string; // ISO timestamp (정렬/표시용)
  branch: string;
  items: { productId: string; name: string; qty: number }[];
  totalBoxes: number;
}
