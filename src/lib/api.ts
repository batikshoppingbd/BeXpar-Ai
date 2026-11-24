import { getBrowserSupabase } from './supabaseClient';

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { businessId?: string } = {}
): Promise<T> {
  let token = '';
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token || '';
  } catch {
    token = '';
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.businessId) {
    headers.set('x-business-id', options.businessId);
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(plain || `HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error((json.error as string) || (json.message as string) || `Request failed (${res.status})`);
  }

  return json as T;
}

export function formatMoney(amount: number | string, currency = '৳'): string {
  const num = Number(amount || 0);
  return `${currency}${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
