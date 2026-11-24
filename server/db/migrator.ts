import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { getSupabaseAdmin, loadSupabaseConfig } from '../config/supabaseConfig.ts';
import { executeSqlViaManagementApi } from '../services/supabaseManagement.ts';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase', 'migrations');

export interface MigrationResult {
  success: boolean;
  schemaReady: boolean;
  appliedMigrations: string[];
  bucketsReady: string[];
  readWriteVerified: boolean;
  error?: string;
}

export function getMigrationFiles(): Array<{ version: string; sql: string }> {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => ({
    version: file.replace(/\.sql$/, ''),
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
  }));
}

export function getConsolidatedMigrationSql(): string {
  const files = getMigrationFiles();
  return files.map((f) => `-- === ${f.version} ===\n${f.sql}`).join('\n\n');
}

export async function ensureStorageBuckets(): Promise<string[]> {
  const admin = getSupabaseAdmin();
  const desiredBuckets = [
    { name: 'product-images', public: true },
    { name: 'business-logos', public: true },
    { name: 'chat-attachments', public: true },
    { name: 'knowledge-docs', public: false },
    { name: 'payment-proofs', public: false },
  ];

  const { data: existingBuckets } = await admin.storage.listBuckets();
  const existingNames = new Set((existingBuckets || []).map((b) => b.name));
  const ready: string[] = [];

  for (const bucket of desiredBuckets) {
    if (!existingNames.has(bucket.name)) {
      const { error } = await admin.storage.createBucket(bucket.name, {
        public: bucket.public,
        fileSizeLimit: 10 * 1024 * 1024,
      });
      if (!error) ready.push(bucket.name);
    } else {
      ready.push(bucket.name);
    }
  }
  return ready;
}

export async function runDatabaseMigrations(
  explicitDbUrl?: string,
  mgmtAuth?: { accessToken: string; projectRef: string }
): Promise<MigrationResult> {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return {
      success: false,
      schemaReady: false,
      appliedMigrations: [],
      bucketsReady: [],
      readWriteVerified: false,
      error: 'Supabase is not configured.',
    };
  }

  const dbUrl = explicitDbUrl || cfg.dbUrl;
  const appliedMigrations: string[] = [];

  // 1. Verify Supabase Admin REST/Auth connectivity
  const admin = getSupabaseAdmin();
  const { error: authCheckError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authCheckError) {
    return {
      success: false,
      schemaReady: false,
      appliedMigrations: [],
      bucketsReady: [],
      readWriteVerified: false,
      error: `Supabase Auth connection failed: ${authCheckError.message}`,
    };
  }

  // 2A. If Supabase Management API token is supplied, run SQL migrations directly via Management API
  if (mgmtAuth?.accessToken && mgmtAuth?.projectRef) {
    try {
      await executeSqlViaManagementApi(
        mgmtAuth.accessToken,
        mgmtAuth.projectRef,
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`
      );
      const existingRows = (await executeSqlViaManagementApi(
        mgmtAuth.accessToken,
        mgmtAuth.projectRef,
        'SELECT version FROM schema_migrations;'
      )) as Array<{ version?: string }>;

      const alreadyApplied = new Set(
        Array.isArray(existingRows) ? existingRows.map((r) => String(r.version || '')).filter(Boolean) : []
      );

      const migrations = getMigrationFiles();
      for (const mig of migrations) {
        if (!alreadyApplied.has(mig.version)) {
          await executeSqlViaManagementApi(mgmtAuth.accessToken, mgmtAuth.projectRef, mig.sql);
          await executeSqlViaManagementApi(
            mgmtAuth.accessToken,
            mgmtAuth.projectRef,
            `INSERT INTO schema_migrations (version) VALUES ('${mig.version.replace(/'/g, "''")}') ON CONFLICT (version) DO NOTHING;`
          );
        }
        appliedMigrations.push(mig.version);
      }

      // Reload PostgREST schema cache so REST queries see newly created tables immediately
      await executeSqlViaManagementApi(
        mgmtAuth.accessToken,
        mgmtAuth.projectRef,
        `NOTIFY pgrst, 'reload schema';`
      ).catch(() => {});
    } catch (err) {
      return {
        success: false,
        schemaReady: false,
        appliedMigrations,
        bucketsReady: [],
        readWriteVerified: false,
        error: `Auto-migration failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (dbUrl) {
    // 2B. If direct Postgres DB URL is provided, execute versioned SQL migrations
    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
      const alreadyApplied = new Set(rows.map((r) => r.version));

      const migrations = getMigrationFiles();
      for (const mig of migrations) {
        if (!alreadyApplied.has(mig.version)) {
          await client.query('BEGIN');
          try {
            await client.query(mig.sql);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [
              mig.version,
            ]);
            await client.query('COMMIT');
            appliedMigrations.push(mig.version);
          } catch (err) {
            await client.query('ROLLBACK');
            throw new Error(`Migration ${mig.version} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          appliedMigrations.push(mig.version);
        }
      }
      await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
    } catch (err) {
      return {
        success: false,
        schemaReady: false,
        appliedMigrations,
        bucketsReady: [],
        readWriteVerified: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  // 3. Ensure Storage buckets
  let bucketsReady: string[] = [];
  try {
    bucketsReady = await ensureStorageBuckets();
  } catch {
    bucketsReady = [];
  }

  // 4. Verify schema existence & read/write via Supabase PostgREST (brief retry for PostgREST schema cache reload)
  let settingsRow: { id: number; app_name: string; updated_at: string } | null = null;
  let readErr: { message: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await admin
      .from('application_settings')
      .select('id, app_name, updated_at')
      .eq('id', 1)
      .maybeSingle();
    settingsRow = res.data;
    readErr = res.error;
    if (!readErr) break;
    if (appliedMigrations.length === 0) break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (readErr) {
    return {
      success: false,
      schemaReady: false,
      appliedMigrations,
      bucketsReady,
      readWriteVerified: false,
      error: `Database schema not initialized yet (${readErr.message}). Use Auto-Connect, provide the Postgres Connection URL, or run the SQL migration script in Supabase SQL Editor.`,
    };
  }

  let readWriteVerified = false;
  if (settingsRow) {
    const { error: writeErr } = await admin
      .from('application_settings')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', 1);
    readWriteVerified = !writeErr;
  }

  return {
    success: true,
    schemaReady: !!settingsRow,
    appliedMigrations,
    bucketsReady,
    readWriteVerified,
  };
}

export async function checkSchemaStatus(): Promise<{
  connected: boolean;
  schemaReady: boolean;
  appliedMigrations: string[];
  error?: string;
}> {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return { connected: false, schemaReady: false, appliedMigrations: [] };
  }
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('schema_migrations').select('version').order('version');
    if (error) {
      // Check if application_settings exists even if schema_migrations wasn't inserted manually
      const { error: appErr } = await admin.from('application_settings').select('id').limit(1);
      if (appErr) {
        return { connected: true, schemaReady: false, appliedMigrations: [], error: appErr.message };
      }
      return { connected: true, schemaReady: true, appliedMigrations: ['manual'] };
    }
    return {
      connected: true,
      schemaReady: true,
      appliedMigrations: (data || []).map((r: { version: string }) => r.version),
    };
  } catch (err) {
    return {
      connected: false,
      schemaReady: false,
      appliedMigrations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
