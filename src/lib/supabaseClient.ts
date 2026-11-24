import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;
let currentKey = '';

export function initBrowserSupabase(url: string, anonKey: string): SupabaseClient | null {
  if (!url || !anonKey) return null;
  const cacheKey = `${url}|${anonKey}`;
  if (!browserClient || currentKey !== cacheKey) {
    browserClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
    currentKey = cacheKey;
  }
  return browserClient;
}

export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    throw new Error('Supabase client is not initialized yet.');
  }
  return browserClient;
}
