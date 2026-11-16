/** Preview item (one Shopee order line matched against OBM). */
export interface PreviewItem {
  sku: string;
  variant: string;
  name: string; // Shopee listing title
  imageUrl: string;
  qty: number;
  price: number; // paid price after voucher
  match: boolean;
  pkey: number | null;
  productName: string; // OBM product name
  stockNow: number | null;
  unit: number;
}

export interface PreviewOrder {
  orderSn: string;
  currency: string;
  buyerName: string;
  payTime: string;
  total: number;
  items: PreviewItem[];
  ok: boolean;
  alreadySynced: boolean;
  selected?: boolean; // client-side checkbox state
}

export interface ShopConfig {
  name: string;
  shopId: string;
  accessTokenMasked: string;
  refreshTokenMasked: string;
  hasTokens: boolean;
  customerPkey: number;
  active: boolean;
}

export interface AppConfig {
  partnerId: string;
  partnerKeyMasked: string;
  daysBack: number;
  sellerCenterUrl: string;
  shops: ShopConfig[];
}

export interface Customer {
  pkey: number;
  name: string;
}

export interface SyncResult {
  orderSn: string;
  status: 'created' | 'exists' | 'skipped' | 'error';
  message?: string;
  transNo?: string;
  pkey?: number;
  total?: number;
}

export interface LogEntry {
  orderSn: string;
  shopName: string;
  customerPkey: number;
  transNo: string;
  pkey: number;
  total: number;
  at: string;
}
