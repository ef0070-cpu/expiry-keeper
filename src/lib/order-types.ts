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
