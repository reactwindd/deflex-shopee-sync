import type { AppConfig, Customer, LogEntry, PreviewOrder, ShopConfig, SyncResult } from './types';

const TOKEN_KEY = 'shopee-sync-token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': getToken(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new ApiError('Not authorized', 401);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `HTTP ${res.status}`, res.status);
  return data as T;
}

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

export const api = {
  login: (password: string) => req<{ token: string }>('POST', '/api/login', { password }),
  logout: () => req<{ ok: boolean }>('POST', '/api/logout'),
  config: () => req<AppConfig>('GET', '/api/config'),
  saveConfig: (c: {
    partnerId?: string;
    partnerKey?: string;
    daysBack?: number;
    sellerCenterUrl?: string;
    adminPassword?: string;
    shops?: Array<Partial<ShopConfig>>;
  }) => req<{ ok: boolean }>('POST', '/api/config', c),
  customers: () => req<{ customers: Customer[] }>('GET', '/api/customers'),
  preview: (shop: number) => req<{ orders: PreviewOrder[]; shop: string }>('GET', `/api/preview?shop=${shop}`),
  sync: (shop: number, orderSns: string[]) => req<{ results: SyncResult[] }>('POST', '/api/sync', { shop, orderSns }),
  log: () => req<{ log: LogEntry[] }>('GET', '/api/log'),
  authLink: (shop: number) => req<{ authUrl: string; callback: string }>('POST', '/api/shopee/auth-link', { shop }),
};

/** Image URL through the authenticated proxy (token as query param for <img> tags). */
export function imgSrc(url: string): string {
  return `/api/img?t=${encodeURIComponent(getToken())}&u=${encodeURIComponent(url)}`;
}

export function fmtRm(n: number): string {
  return 'RM ' + (Number.isFinite(n) ? n.toFixed(2) : '0.00');
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(Number(iso) * 1000 || iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
