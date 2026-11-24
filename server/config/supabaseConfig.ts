import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseRuntimeConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl?: string;
  connectedAt?: string;
}

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
const CONFIG_PATH = path.resolve(process.cwd(), '.bexpar.config.json');
const TMP_CONFIG_PATH = '/tmp/.bexpar.config.json';
const BOOTSTRAP_CODE_PATH = path.resolve(IS_SERVERLESS ? '/tmp' : process.cwd(), '.bexpar-bootstrap-code');

let cachedAdminClient: SupabaseClient | null = null;
let cachedAnonClient: SupabaseClient | null = null;
let cachedConfigKey = '';
let memoryBootstrapCode = '';

export function loadSupabaseConfig(): SupabaseRuntimeConfig | null {
  const envUrl = process.env.SUPABASE_URL?.trim();
  const envAnon = process.env.SUPABASE_ANON_KEY?.trim();
  const envService = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const envDb = process.env.SUPABASE_DB_URL?.trim();

  if (envUrl && envAnon && envService) {
    return {
      url: envUrl,
      anonKey: envAnon,
      serviceRoleKey: envService,
      dbUrl: envDb || undefined,
    };
  }

  for (const cfgFile of [CONFIG_PATH, TMP_CONFIG_PATH]) {
    if (fs.existsSync(cfgFile)) {
      try {
        const raw = fs.readFileSync(cfgFile, 'utf8');
        const parsed = JSON.parse(raw) as SupabaseRuntimeConfig;
        if (parsed.url && parsed.anonKey && parsed.serviceRoleKey) {
          return parsed;
        }
      } catch {
        // continue checking fallback
      }
    }
  }
  return null;
}

export function saveSupabaseConfig(cfg: SupabaseRuntimeConfig): void {
  const normalizedUrl = cfg.url.trim().replace(/\/+$/, '');
  const fullUrl = normalizedUrl.startsWith('http') ? normalizedUrl : `https://${normalizedUrl}.supabase.co`;
  const payload: SupabaseRuntimeConfig = {
    url: fullUrl,
    anonKey: cfg.anonKey.trim(),
    serviceRoleKey: cfg.serviceRoleKey.trim(),
    dbUrl: cfg.dbUrl?.trim() || undefined,
    connectedAt: new Date().toISOString(),
  };
  const targetPath = IS_SERVERLESS ? TMP_CONFIG_PATH : CONFIG_PATH;
  try {
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  } catch {
    if (targetPath !== TMP_CONFIG_PATH) {
      fs.writeFileSync(TMP_CONFIG_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
    }
  }
  cachedAdminClient = null;
  cachedAnonClient = null;
  cachedConfigKey = '';
}

export function clearSupabaseConfig(): void {
  for (const cfgFile of [CONFIG_PATH, TMP_CONFIG_PATH]) {
    try {
      if (fs.existsSync(cfgFile)) {
        fs.unlinkSync(cfgFile);
      }
    } catch {
      // ignore read-only FS unlink
    }
  }
  cachedAdminClient = null;
  cachedAnonClient = null;
  cachedConfigKey = '';
}

export function getSupabaseAdmin(): SupabaseClient {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase is not configured yet.');
  }
  const key = `${cfg.url}|${cfg.serviceRoleKey}`;
  if (!cachedAdminClient || cachedConfigKey !== key) {
    cachedAdminClient = createClient(cfg.url, cfg.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cachedAnonClient = createClient(cfg.url, cfg.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    cachedConfigKey = key;
  }
  return cachedAdminClient;
}

export function getSupabaseAnon(): SupabaseClient {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase is not configured yet.');
  }
  getSupabaseAdmin();
  return cachedAnonClient!;
}

export function getPublicSupabaseConfig(): { configured: boolean; url: string; anonKey: string } {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return { configured: false, url: '', anonKey: '' };
  }
  return {
    configured: true,
    url: cfg.url,
    anonKey: cfg.anonKey,
  };
}

function deriveEncryptionKey(): Buffer {
  const cfg = loadSupabaseConfig();
  const seed = cfg?.serviceRoleKey || process.env.ADMIN_BOOTSTRAP_SECRET || 'bexpar-fallback-key-seed';
  return crypto.createHash('sha256').update(seed).digest();
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const key = deriveEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText) return '';
  if (!cipherText.startsWith('enc:')) return cipherText;
  const parts = cipherText.split(':');
  if (parts.length !== 4) return '';
  try {
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function getOrGenerateBootstrapCode(): string {
  if (process.env.ADMIN_BOOTSTRAP_SECRET?.trim()) {
    return process.env.ADMIN_BOOTSTRAP_SECRET.trim();
  }
  if (memoryBootstrapCode) {
    return memoryBootstrapCode;
  }
  try {
    if (fs.existsSync(BOOTSTRAP_CODE_PATH)) {
      const existing = fs.readFileSync(BOOTSTRAP_CODE_PATH, 'utf8').trim();
      if (existing) {
        memoryBootstrapCode = existing;
        return existing;
      }
    }
  } catch {
    // ignore read error
  }
  const code = `BEXPAR-ADMIN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  memoryBootstrapCode = code;
  try {
    fs.writeFileSync(BOOTSTRAP_CODE_PATH, code, { mode: 0o600 });
  } catch {
    // Vercel /var/task is read-only; keep in-memory fallback and encourage ADMIN_BOOTSTRAP_SECRET env var
  }
  console.log(`\n[BeXpar Ai Security] First-time Super Admin Bootstrap Verification Code: ${code}\n`);
  return code;
}
