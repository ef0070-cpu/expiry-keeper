export type ProductStatus = 'active' | 'consumed' | 'discarded';

export const STATUS_LABELS: Record<ProductStatus, string> = {
  active: '보관 중',
  consumed: '소진',
  discarded: '폐기',
};

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  imageUri: string | null;
  expiryDate: string; // YYYY-MM-DD
  category: string | null;
  memo: string | null;
  quantity: number;
  status: ProductStatus;
  resolvedAt: string | null; // 소진/폐기 처리 시각 (ISO)
  createdAt: string;
}

export interface BarcodeInfo {
  name: string | null;
  imageUrl: string | null;
}

export interface Team {
  id: string;
  name: string;
  inviteCode: string;
}

export interface TeamMember {
  userId: string;
  email: string | null;
  joinedAt: string;
}
