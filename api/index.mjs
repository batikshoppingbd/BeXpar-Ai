// server/app.ts
import "dotenv/config";
import express from "express";

// server/routes/systemRoutes.ts
import { Router } from "express";

// server/config/supabaseConfig.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
var IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION);
var CONFIG_PATH = path.resolve(process.cwd(), ".bexpar.config.json");
var TMP_CONFIG_PATH = "/tmp/.bexpar.config.json";
var BOOTSTRAP_CODE_PATH = path.resolve(IS_SERVERLESS ? "/tmp" : process.cwd(), ".bexpar-bootstrap-code");
var cachedAdminClient = null;
var cachedAnonClient = null;
var cachedConfigKey = "";
var memoryBootstrapCode = "";
function loadSupabaseConfig() {
  const envUrl = process.env.SUPABASE_URL?.trim();
  const envAnon = process.env.SUPABASE_ANON_KEY?.trim();
  const envService = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const envDb = process.env.SUPABASE_DB_URL?.trim();
  if (envUrl && envAnon && envService) {
    return {
      url: envUrl,
      anonKey: envAnon,
      serviceRoleKey: envService,
      dbUrl: envDb || void 0
    };
  }
  for (const cfgFile of [CONFIG_PATH, TMP_CONFIG_PATH]) {
    if (fs.existsSync(cfgFile)) {
      try {
        const raw = fs.readFileSync(cfgFile, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.url && parsed.anonKey && parsed.serviceRoleKey) {
          return parsed;
        }
      } catch {
      }
    }
  }
  return null;
}
function saveSupabaseConfig(cfg) {
  const normalizedUrl = cfg.url.trim().replace(/\/+$/, "");
  const fullUrl = normalizedUrl.startsWith("http") ? normalizedUrl : `https://${normalizedUrl}.supabase.co`;
  const payload = {
    url: fullUrl,
    anonKey: cfg.anonKey.trim(),
    serviceRoleKey: cfg.serviceRoleKey.trim(),
    dbUrl: cfg.dbUrl?.trim() || void 0,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const targetPath = IS_SERVERLESS ? TMP_CONFIG_PATH : CONFIG_PATH;
  try {
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), { mode: 384 });
  } catch {
    if (targetPath !== TMP_CONFIG_PATH) {
      fs.writeFileSync(TMP_CONFIG_PATH, JSON.stringify(payload, null, 2), { mode: 384 });
    }
  }
  cachedAdminClient = null;
  cachedAnonClient = null;
  cachedConfigKey = "";
}
function clearSupabaseConfig() {
  for (const cfgFile of [CONFIG_PATH, TMP_CONFIG_PATH]) {
    try {
      if (fs.existsSync(cfgFile)) {
        fs.unlinkSync(cfgFile);
      }
    } catch {
    }
  }
  cachedAdminClient = null;
  cachedAnonClient = null;
  cachedConfigKey = "";
}
function getSupabaseAdmin() {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    throw new Error("Supabase is not configured yet.");
  }
  const key = `${cfg.url}|${cfg.serviceRoleKey}`;
  if (!cachedAdminClient || cachedConfigKey !== key) {
    cachedAdminClient = createClient(cfg.url, cfg.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    cachedAnonClient = createClient(cfg.url, cfg.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    cachedConfigKey = key;
  }
  return cachedAdminClient;
}
function getPublicSupabaseConfig() {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return { configured: false, url: "", anonKey: "" };
  }
  return {
    configured: true,
    url: cfg.url,
    anonKey: cfg.anonKey
  };
}
function deriveEncryptionKey() {
  const cfg = loadSupabaseConfig();
  const seed = cfg?.serviceRoleKey || process.env.ADMIN_BOOTSTRAP_SECRET || "bexpar-fallback-key-seed";
  return crypto.createHash("sha256").update(seed).digest();
}
function encryptSecret(plainText) {
  if (!plainText) return "";
  const iv = crypto.randomBytes(12);
  const key = deriveEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decryptSecret(cipherText) {
  if (!cipherText) return "";
  if (!cipherText.startsWith("enc:")) return cipherText;
  const parts = cipherText.split(":");
  if (parts.length !== 4) return "";
  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const encrypted = Buffer.from(parts[3], "hex");
    const key = deriveEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
function getOrGenerateBootstrapCode() {
  if (process.env.ADMIN_BOOTSTRAP_SECRET?.trim()) {
    return process.env.ADMIN_BOOTSTRAP_SECRET.trim();
  }
  if (memoryBootstrapCode) {
    return memoryBootstrapCode;
  }
  try {
    if (fs.existsSync(BOOTSTRAP_CODE_PATH)) {
      const existing = fs.readFileSync(BOOTSTRAP_CODE_PATH, "utf8").trim();
      if (existing) {
        memoryBootstrapCode = existing;
        return existing;
      }
    }
  } catch {
  }
  const code = `BEXPAR-ADMIN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  memoryBootstrapCode = code;
  try {
    fs.writeFileSync(BOOTSTRAP_CODE_PATH, code, { mode: 384 });
  } catch {
  }
  console.log(`
[BeXpar Ai Security] First-time Super Admin Bootstrap Verification Code: ${code}
`);
  return code;
}

// server/db/migrator.ts
import fs2 from "fs";
import path2 from "path";
import { Client } from "pg";

// server/services/supabaseManagement.ts
import crypto2 from "crypto";
var SUPABASE_API_BASE = "https://api.supabase.com/v1";
async function mgmtFetch(accessToken, path3, init) {
  const res = await fetch(`${SUPABASE_API_BASE}${path3}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      "Content-Type": "application/json",
      ...init?.headers || {}
    }
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    let errMsg = `Supabase Management API error (${res.status})`;
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      errMsg = String(parsed.message);
    } else if (typeof parsed === "string" && parsed.trim()) {
      errMsg = parsed;
    }
    throw new Error(errMsg);
  }
  return parsed;
}
async function listSupabaseProjectsAndOrgs(accessToken) {
  const [projectsRes, orgsRes] = await Promise.allSettled([
    mgmtFetch(accessToken, "/projects"),
    mgmtFetch(accessToken, "/organizations")
  ]);
  if (projectsRes.status === "rejected") {
    throw projectsRes.reason;
  }
  const projects = Array.isArray(projectsRes.value) ? projectsRes.value : [];
  let organizations = orgsRes.status === "fulfilled" && Array.isArray(orgsRes.value) ? orgsRes.value : [];
  if (organizations.length === 0 && projects.length > 0) {
    const seen = /* @__PURE__ */ new Set();
    organizations = projects.filter((p) => p.organization_id && !seen.has(p.organization_id) && seen.add(p.organization_id)).map((p) => ({ id: p.organization_id, name: p.organization_id }));
  }
  return { projects, organizations };
}
async function createSupabaseProjectAuto(accessToken, params) {
  const dbPass = `${crypto2.randomBytes(14).toString("hex")}Bx!9`;
  const created = await mgmtFetch(accessToken, "/projects", {
    method: "POST",
    body: JSON.stringify({
      name: params.name.trim() || "bexpar-ai-db",
      organization_id: params.organizationId,
      region: params.region || "ap-southeast-1",
      db_pass: dbPass
    })
  });
  let current = created;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 9e4) {
    if (current.status === "ACTIVE_HEALTHY") {
      break;
    }
    await new Promise((r) => setTimeout(r, 3500));
    try {
      const latest = await mgmtFetch(accessToken, `/projects/${created.id}`);
      current = latest;
      if (current.status === "ACTIVE_HEALTHY") break;
    } catch {
    }
  }
  const dbUrl = `postgresql://postgres:${encodeURIComponent(dbPass)}@db.${created.id}.supabase.co:5432/postgres`;
  return { project: current, dbUrl };
}
async function fetchProjectApiKeysAuto(accessToken, projectRef) {
  const keys = await mgmtFetch(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/api-keys?reveal=true`
  );
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("Could not retrieve API keys for this Supabase project.");
  }
  const anonEntry = keys.find((k) => k.name === "anon" && k.api_key) || keys.find((k) => k.type === "publishable" && k.api_key);
  const serviceEntry = keys.find((k) => k.name === "service_role" && k.api_key) || keys.find((k) => k.type === "secret" && k.api_key);
  if (!anonEntry?.api_key || !serviceEntry?.api_key) {
    throw new Error(
      "Supabase did not return both anon/publishable and service_role/secret keys. Wait a few seconds if the project was just created, or use manual setup."
    );
  }
  return {
    url: `https://${projectRef}.supabase.co`,
    anonKey: anonEntry.api_key,
    serviceRoleKey: serviceEntry.api_key
  };
}
async function executeSqlViaManagementApi(accessToken, projectRef, query) {
  return mgmtFetch(accessToken, `/projects/${encodeURIComponent(projectRef)}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query })
  });
}

// server/db/migrator.ts
var MIGRATIONS_DIR = path2.resolve(process.cwd(), "supabase", "migrations");
function getMigrationFiles() {
  if (!fs2.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs2.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  return files.map((file) => ({
    version: file.replace(/\.sql$/, ""),
    sql: fs2.readFileSync(path2.join(MIGRATIONS_DIR, file), "utf8")
  }));
}
function getConsolidatedMigrationSql() {
  const files = getMigrationFiles();
  return files.map((f) => `-- === ${f.version} ===
${f.sql}`).join("\n\n");
}
async function ensureStorageBuckets() {
  const admin = getSupabaseAdmin();
  const desiredBuckets = [
    { name: "product-images", public: true },
    { name: "business-logos", public: true },
    { name: "chat-attachments", public: true },
    { name: "knowledge-docs", public: false },
    { name: "payment-proofs", public: false }
  ];
  const { data: existingBuckets } = await admin.storage.listBuckets();
  const existingNames = new Set((existingBuckets || []).map((b) => b.name));
  const ready = [];
  for (const bucket of desiredBuckets) {
    if (!existingNames.has(bucket.name)) {
      const { error } = await admin.storage.createBucket(bucket.name, {
        public: bucket.public,
        fileSizeLimit: 10 * 1024 * 1024
      });
      if (!error) ready.push(bucket.name);
    } else {
      ready.push(bucket.name);
    }
  }
  return ready;
}
async function runDatabaseMigrations(explicitDbUrl, mgmtAuth) {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return {
      success: false,
      schemaReady: false,
      appliedMigrations: [],
      bucketsReady: [],
      readWriteVerified: false,
      error: "Supabase is not configured."
    };
  }
  const dbUrl = explicitDbUrl || cfg.dbUrl;
  const appliedMigrations = [];
  const admin = getSupabaseAdmin();
  const { error: authCheckError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authCheckError) {
    return {
      success: false,
      schemaReady: false,
      appliedMigrations: [],
      bucketsReady: [],
      readWriteVerified: false,
      error: `Supabase Auth connection failed: ${authCheckError.message}`
    };
  }
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
      const existingRows = await executeSqlViaManagementApi(
        mgmtAuth.accessToken,
        mgmtAuth.projectRef,
        "SELECT version FROM schema_migrations;"
      );
      const alreadyApplied = new Set(
        Array.isArray(existingRows) ? existingRows.map((r) => String(r.version || "")).filter(Boolean) : []
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
      await executeSqlViaManagementApi(
        mgmtAuth.accessToken,
        mgmtAuth.projectRef,
        `NOTIFY pgrst, 'reload schema';`
      ).catch(() => {
      });
    } catch (err) {
      return {
        success: false,
        schemaReady: false,
        appliedMigrations,
        bucketsReady: [],
        readWriteVerified: false,
        error: `Auto-migration failed: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  } else if (dbUrl) {
    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
    try {
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      const { rows } = await client.query("SELECT version FROM schema_migrations");
      const alreadyApplied = new Set(rows.map((r) => r.version));
      const migrations = getMigrationFiles();
      for (const mig of migrations) {
        if (!alreadyApplied.has(mig.version)) {
          await client.query("BEGIN");
          try {
            await client.query(mig.sql);
            await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING", [
              mig.version
            ]);
            await client.query("COMMIT");
            appliedMigrations.push(mig.version);
          } catch (err) {
            await client.query("ROLLBACK");
            throw new Error(`Migration ${mig.version} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          appliedMigrations.push(mig.version);
        }
      }
      await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {
      });
    } catch (err) {
      return {
        success: false,
        schemaReady: false,
        appliedMigrations,
        bucketsReady: [],
        readWriteVerified: false,
        error: err instanceof Error ? err.message : String(err)
      };
    } finally {
      await client.end().catch(() => {
      });
    }
  }
  let bucketsReady = [];
  try {
    bucketsReady = await ensureStorageBuckets();
  } catch {
    bucketsReady = [];
  }
  let settingsRow = null;
  let readErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await admin.from("application_settings").select("id, app_name, updated_at").eq("id", 1).maybeSingle();
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
      error: `Database schema not initialized yet (${readErr.message}). Use Auto-Connect, provide the Postgres Connection URL, or run the SQL migration script in Supabase SQL Editor.`
    };
  }
  let readWriteVerified = false;
  if (settingsRow) {
    const { error: writeErr } = await admin.from("application_settings").update({ updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1);
    readWriteVerified = !writeErr;
  }
  return {
    success: true,
    schemaReady: !!settingsRow,
    appliedMigrations,
    bucketsReady,
    readWriteVerified
  };
}
async function checkSchemaStatus() {
  const cfg = loadSupabaseConfig();
  if (!cfg) {
    return { connected: false, schemaReady: false, appliedMigrations: [] };
  }
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("schema_migrations").select("version").order("version");
    if (error) {
      const { error: appErr } = await admin.from("application_settings").select("id").limit(1);
      if (appErr) {
        return { connected: true, schemaReady: false, appliedMigrations: [], error: appErr.message };
      }
      return { connected: true, schemaReady: true, appliedMigrations: ["manual"] };
    }
    return {
      connected: true,
      schemaReady: true,
      appliedMigrations: (data || []).map((r) => r.version)
    };
  } catch (err) {
    return {
      connected: false,
      schemaReady: false,
      appliedMigrations: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// server/db/repository.ts
async function writeAuditLog(params) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      actor_id: params.actorId || null,
      actor_email: params.actorEmail || "",
      actor_role: params.actorRole || "",
      business_id: params.businessId || null,
      action: params.action,
      target_type: params.targetType || "",
      target_id: params.targetId || "",
      details: params.details || {},
      ip_address: params.ipAddress || ""
    });
  } catch (err) {
    console.error("[AuditLog Error]", err);
  }
}
async function isFeatureEnabledForBusiness(businessId, featureKey) {
  const admin = getSupabaseAdmin();
  const { data: flag } = await admin.from("feature_flags").select("is_globally_enabled, min_plan_slug").eq("key", featureKey).maybeSingle();
  if (flag && !flag.is_globally_enabled) {
    return false;
  }
  const { data: override } = await admin.from("user_feature_overrides").select("is_enabled").eq("business_id", businessId).eq("feature_key", featureKey).maybeSingle();
  if (override !== null && override !== void 0) {
    return override.is_enabled;
  }
  if (flag?.min_plan_slug === "free") {
    return true;
  }
  const { data: biz } = await admin.from("businesses").select("subscription_plan_id, subscription_plans(allowed_features)").eq("id", businessId).maybeSingle();
  const plan = biz?.subscription_plans;
  if (plan?.allowed_features && Array.isArray(plan.allowed_features)) {
    return plan.allowed_features.includes(featureKey);
  }
  return true;
}
async function createNotification(params) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("notifications").insert({
      business_id: params.businessId || null,
      user_id: params.userId || null,
      title: params.title,
      body: params.body,
      type: params.type || "info",
      link: params.link || ""
    });
  } catch (err) {
    console.error("[Notification Error]", err);
  }
}

// server/middleware/auth.ts
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid authorization header." });
    }
    const token = authHeader.slice(7).trim();
    const admin = getSupabaseAdmin();
    const { data: userData, error } = await admin.auth.getUser(token);
    if (error || !userData?.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    let { data: profile } = await admin.from("profiles").select("*").eq("id", userData.user.id).maybeSingle();
    if (!profile) {
      const insertPayload = {
        id: userData.user.id,
        email: userData.user.email || "",
        full_name: userData.user.user_metadata?.full_name || userData.user.user_metadata?.name || userData.user.email?.split("@")[0] || "User",
        avatar_url: userData.user.user_metadata?.avatar_url || userData.user.user_metadata?.picture || "",
        role: "business_owner",
        status: "active",
        language: "bn"
      };
      const { data: created, error: createErr } = await admin.from("profiles").insert(insertPayload).select("*").single();
      if (createErr) {
        return res.status(500).json({ error: `Failed to initialize profile: ${createErr.message}` });
      }
      profile = created;
    }
    if (profile.status === "suspended" || profile.status === "inactive") {
      return res.status(403).json({
        error: `Account is ${profile.status}. Please contact BeXpar Ai support.`,
        accountStatus: profile.status
      });
    }
    req.user = profile;
    next();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Authentication error" });
  }
}
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden: Super Admin privileges required." });
  }
  next();
}
function requireBusinessAccess(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const businessId = req.headers["x-business-id"] || req.params.businessId || req.query.businessId;
      if (!businessId) {
        return res.status(400).json({ error: "Business ID is required (x-business-id header)." });
      }
      const admin = getSupabaseAdmin();
      if (req.user.role === "super_admin") {
        req.businessId = businessId;
        req.businessRole = "super_admin";
        req.memberPermissions = { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true };
        return next();
      }
      const { data: biz } = await admin.from("businesses").select("id, owner_id, status").eq("id", businessId).maybeSingle();
      if (!biz) {
        return res.status(404).json({ error: "Business not found." });
      }
      if (biz.status !== "active") {
        return res.status(403).json({ error: `Business account is ${biz.status}.` });
      }
      if (biz.owner_id === req.user.id) {
        req.businessId = businessId;
        req.businessRole = "business_owner";
        req.memberPermissions = { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true };
        return next();
      }
      const { data: member } = await admin.from("business_members").select("role, permissions, status").eq("business_id", businessId).eq("user_id", req.user.id).maybeSingle();
      if (!member || member.status !== "active") {
        return res.status(403).json({ error: "Access denied to this business workspace." });
      }
      const perms = member.permissions || {};
      if (permissionKey && member.role !== "business_admin" && !perms[permissionKey]) {
        return res.status(403).json({ error: `Permission '${permissionKey}' is required for this action.` });
      }
      req.businessId = businessId;
      req.businessRole = member.role;
      req.memberPermissions = perms;
      next();
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Authorization error" });
    }
  };
}
function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      if (!req.businessId) return res.status(400).json({ error: "Business context required." });
      if (req.user?.role === "super_admin") return next();
      const allowed = await isFeatureEnabledForBusiness(req.businessId, featureKey);
      if (!allowed) {
        return res.status(403).json({
          error: `Feature '${featureKey}' is not enabled on your current subscription plan.`,
          code: "FEATURE_LOCKED",
          featureKey
        });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Feature check failed" });
    }
  };
}
var rateMap = /* @__PURE__ */ new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const record = rateMap.get(key);
    if (!record || record.resetAt < now) {
      rateMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (record.count >= maxRequests) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    record.count += 1;
    next();
  };
}

// server/services/courierService.ts
function isMissingIsDefaultColumn(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("is_default") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("column"));
}
async function getFallbackDefaultCourier(businessId) {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("ai_settings").select("order_collection_rules").eq("business_id", businessId).maybeSingle();
    const rules = data?.order_collection_rules && typeof data.order_collection_rules === "object" ? data.order_collection_rules : {};
    const val = String(rules.default_courier || "");
    return val === "steadfast" || val === "pathao" ? val : null;
  } catch {
    return null;
  }
}
async function setFallbackDefaultCourier(businessId, provider) {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("ai_settings").select("order_collection_rules").eq("business_id", businessId).maybeSingle();
    if (!data) return;
    const rules = data.order_collection_rules && typeof data.order_collection_rules === "object" ? data.order_collection_rules : {};
    await admin.from("ai_settings").update({
      order_collection_rules: {
        ...rules,
        default_courier: provider || ""
      },
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("business_id", businessId);
  } catch {
  }
}
function toSafeCourierAccount(row, fallbackDefault) {
  const provider = String(row.provider);
  const isDefault = row.is_default !== void 0 ? Boolean(row.is_default) : fallbackDefault === provider;
  return {
    id: String(row.id),
    provider,
    label: String(row.label || provider.toUpperCase()),
    client_id: String(row.client_id || ""),
    username: String(row.username || ""),
    store_id: String(row.store_id || ""),
    is_sandbox: Boolean(row.is_sandbox),
    is_active: Boolean(row.is_active),
    is_default: isDefault,
    updated_at: String(row.updated_at || ""),
    has_api_key: Boolean(row.api_key_encrypted),
    has_secret_key: Boolean(row.secret_key_encrypted),
    has_client_secret: Boolean(row.client_secret_encrypted),
    has_password: Boolean(row.password_encrypted)
  };
}
async function getBusinessCourierOverview(businessId) {
  const admin = getSupabaseAdmin();
  let accountsData = [];
  let usingFallbackDefault = false;
  const accRes = await admin.from("courier_accounts").select("id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, is_default, updated_at").eq("business_id", businessId);
  if (accRes.error && isMissingIsDefaultColumn(accRes.error)) {
    usingFallbackDefault = true;
    const legacyRes = await admin.from("courier_accounts").select("id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, updated_at").eq("business_id", businessId);
    if (legacyRes.error) throw new Error(legacyRes.error.message);
    accountsData = legacyRes.data || [];
  } else if (accRes.error) {
    throw new Error(accRes.error.message);
  } else {
    accountsData = accRes.data || [];
  }
  const { data: shipments, error: shipErr } = await admin.from("courier_shipments").select("*, events:courier_tracking_events(*)").eq("business_id", businessId).order("created_at", { ascending: false }).limit(50);
  if (shipErr) throw new Error(shipErr.message);
  const fallbackDefault = usingFallbackDefault ? await getFallbackDefaultCourier(businessId) : null;
  const safeAccounts = accountsData.map((row) => toSafeCourierAccount(row, fallbackDefault));
  const explicitDefault = safeAccounts.find((a) => a.is_default && a.is_active)?.provider || safeAccounts.find((a) => a.is_default)?.provider || safeAccounts.find((a) => a.is_active)?.provider || null;
  return {
    accounts: safeAccounts,
    defaultProvider: explicitDefault,
    shipments: shipments || []
  };
}
async function saveBusinessCourierAccount(businessId, input) {
  const admin = getSupabaseAdmin();
  const prov = String(input.provider || "").trim();
  if (prov !== "steadfast" && prov !== "pathao") {
    throw new Error("Valid courier provider (steadfast or pathao) is required.");
  }
  const { data: existing } = await admin.from("courier_accounts").select("*").eq("business_id", businessId).eq("provider", prov).maybeSingle();
  const { data: allExisting } = await admin.from("courier_accounts").select("id, provider, is_active").eq("business_id", businessId);
  if (prov === "steadfast") {
    const hasKey = Boolean(String(input.api_key || "").trim() || existing?.api_key_encrypted);
    const hasSec = Boolean(String(input.secret_key || "").trim() || existing?.secret_key_encrypted);
    if (!hasKey || !hasSec) {
      throw new Error("Steadfast API Key and Secret Key are required.");
    }
  } else {
    const cid = input.client_id !== void 0 ? String(input.client_id || "").trim() : String(existing?.client_id || "");
    const csec = Boolean(String(input.client_secret || "").trim() || existing?.client_secret_encrypted);
    const user = input.username !== void 0 ? String(input.username || "").trim() : String(existing?.username || "");
    const pass = Boolean(String(input.password || "").trim() || existing?.password_encrypted);
    const store = input.store_id !== void 0 ? String(input.store_id || "").trim() : String(existing?.store_id || "");
    if (!cid || !csec || !user || !pass || !store) {
      throw new Error("Pathao Client ID, Client Secret, Username, Password, and Store ID are required.");
    }
  }
  const nextActive = input.is_active !== void 0 ? Boolean(input.is_active) : existing ? Boolean(existing.is_active) : true;
  const shouldBeDefault = input.is_default === true || !existing && (allExisting || []).length === 0 && nextActive;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const basePayload = {
    business_id: businessId,
    provider: prov,
    label: input.label ? String(input.label).trim() : prov === "steadfast" ? "Steadfast Courier" : "Pathao Courier",
    is_sandbox: input.is_sandbox !== void 0 ? Boolean(input.is_sandbox) : Boolean(existing?.is_sandbox),
    is_active: nextActive,
    updated_at: nowIso
  };
  if (typeof input.api_key === "string" && input.api_key.trim()) {
    basePayload.api_key_encrypted = encryptSecret(input.api_key.trim());
  } else if (existing?.api_key_encrypted) {
    basePayload.api_key_encrypted = existing.api_key_encrypted;
  }
  if (typeof input.secret_key === "string" && input.secret_key.trim()) {
    basePayload.secret_key_encrypted = encryptSecret(input.secret_key.trim());
  } else if (existing?.secret_key_encrypted) {
    basePayload.secret_key_encrypted = existing.secret_key_encrypted;
  }
  if (input.client_id !== void 0) basePayload.client_id = String(input.client_id || "").trim();
  else if (existing?.client_id) basePayload.client_id = existing.client_id;
  if (typeof input.client_secret === "string" && input.client_secret.trim()) {
    basePayload.client_secret_encrypted = encryptSecret(input.client_secret.trim());
  } else if (existing?.client_secret_encrypted) {
    basePayload.client_secret_encrypted = existing.client_secret_encrypted;
  }
  if (input.username !== void 0) basePayload.username = String(input.username || "").trim();
  else if (existing?.username) basePayload.username = existing.username;
  if (typeof input.password === "string" && input.password.trim()) {
    basePayload.password_encrypted = encryptSecret(input.password.trim());
  } else if (existing?.password_encrypted) {
    basePayload.password_encrypted = existing.password_encrypted;
  }
  if (input.store_id !== void 0) basePayload.store_id = String(input.store_id || "").trim();
  else if (existing?.store_id) basePayload.store_id = existing.store_id;
  if (shouldBeDefault) {
    await admin.from("courier_accounts").update({ is_default: false, updated_at: nowIso }).eq("business_id", businessId).neq("provider", prov);
  }
  const payloadWithDefault = {
    ...basePayload,
    ...input.is_default !== void 0 || shouldBeDefault ? { is_default: shouldBeDefault } : {}
  };
  let savedRow = null;
  const upsertRes = await admin.from("courier_accounts").upsert(payloadWithDefault, { onConflict: "business_id,provider" }).select("*").single();
  if (upsertRes.error && isMissingIsDefaultColumn(upsertRes.error)) {
    const legacyUpsert = await admin.from("courier_accounts").upsert(basePayload, { onConflict: "business_id,provider" }).select("*").single();
    if (legacyUpsert.error) throw new Error(legacyUpsert.error.message);
    savedRow = legacyUpsert.data;
    if (shouldBeDefault) await setFallbackDefaultCourier(businessId, prov);
  } else if (upsertRes.error) {
    throw new Error(upsertRes.error.message);
  } else {
    savedRow = upsertRes.data;
    if (shouldBeDefault) await setFallbackDefaultCourier(businessId, prov);
  }
  const overview = await getBusinessCourierOverview(businessId);
  const safe = overview.accounts.find((a) => a.provider === prov) || toSafeCourierAccount(savedRow);
  return { account: safe, defaultProvider: overview.defaultProvider };
}
async function revealBusinessCourierCredentials(businessId, provider) {
  const admin = getSupabaseAdmin();
  const { data: account, error } = await admin.from("courier_accounts").select("*").eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (error || !account) {
    throw new Error(`No saved ${provider} credentials found.`);
  }
  const fallbackDefault = account.is_default === void 0 ? await getFallbackDefaultCourier(businessId) : null;
  const isDefault = account.is_default !== void 0 ? Boolean(account.is_default) : fallbackDefault === provider;
  if (provider === "steadfast") {
    return {
      provider: "steadfast",
      api_key: decryptSecret(String(account.api_key_encrypted || "")),
      secret_key: decryptSecret(String(account.secret_key_encrypted || "")),
      is_active: Boolean(account.is_active),
      is_default: isDefault,
      updated_at: String(account.updated_at || "")
    };
  }
  return {
    provider: "pathao",
    client_id: String(account.client_id || ""),
    client_secret: decryptSecret(String(account.client_secret_encrypted || "")),
    username: String(account.username || ""),
    password: decryptSecret(String(account.password_encrypted || "")),
    store_id: String(account.store_id || ""),
    is_sandbox: Boolean(account.is_sandbox),
    is_active: Boolean(account.is_active),
    is_default: isDefault,
    updated_at: String(account.updated_at || "")
  };
}
async function updateBusinessCourierState(businessId, provider, patch) {
  const admin = getSupabaseAdmin();
  const { data: existing, error } = await admin.from("courier_accounts").select("*").eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (error || !existing) {
    throw new Error(`No ${provider} courier configuration found. Save API credentials first.`);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const nextActive = patch.is_active !== void 0 ? Boolean(patch.is_active) : Boolean(existing.is_active);
  if (patch.is_default === true && !nextActive) {
    throw new Error("Activate this courier before setting it as Default Courier.");
  }
  const updatePayload = { updated_at: nowIso };
  if (patch.is_active !== void 0) updatePayload.is_active = nextActive;
  if (patch.is_default === true) {
    await admin.from("courier_accounts").update({ is_default: false, updated_at: nowIso }).eq("business_id", businessId).neq("provider", provider);
    updatePayload.is_default = true;
  } else if (patch.is_default === false || patch.is_active === false && existing.is_default) {
    updatePayload.is_default = false;
  }
  const updRes = await admin.from("courier_accounts").update(updatePayload).eq("id", existing.id).eq("business_id", businessId).select("*").single();
  if (updRes.error && isMissingIsDefaultColumn(updRes.error)) {
    const legacyPatch = { updated_at: nowIso };
    if (patch.is_active !== void 0) legacyPatch.is_active = nextActive;
    const legacyUpd = await admin.from("courier_accounts").update(legacyPatch).eq("id", existing.id).eq("business_id", businessId);
    if (legacyUpd.error) throw new Error(legacyUpd.error.message);
  } else if (updRes.error) {
    throw new Error(updRes.error.message);
  }
  if (patch.is_default === true) {
    await setFallbackDefaultCourier(businessId, provider);
  } else if (patch.is_default === false || patch.is_active === false) {
    const currentFallback = await getFallbackDefaultCourier(businessId);
    if (currentFallback === provider) {
      await setFallbackDefaultCourier(businessId, null);
    }
  }
  const overview = await getBusinessCourierOverview(businessId);
  const safe = overview.accounts.find((a) => a.provider === provider);
  if (!safe) throw new Error("Courier account not found after update.");
  return { account: safe, defaultProvider: overview.defaultProvider };
}
async function disconnectBusinessCourier(businessId, provider) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin.from("courier_accounts").select("id").eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (!existing) {
    throw new Error(`${provider} courier is not connected.`);
  }
  const { error } = await admin.from("courier_accounts").delete().eq("id", existing.id).eq("business_id", businessId);
  if (error) throw new Error(error.message);
  const fallback = await getFallbackDefaultCourier(businessId);
  if (fallback === provider) {
    await setFallbackDefaultCourier(businessId, null);
  }
  const overview = await getBusinessCourierOverview(businessId);
  if (!overview.accounts.some((a) => a.is_default) && overview.accounts.some((a) => a.is_active)) {
    const promote = overview.accounts.find((a) => a.is_active);
    await updateBusinessCourierState(businessId, promote.provider, { is_default: true }).catch(() => {
    });
  }
  const updated = await getBusinessCourierOverview(businessId);
  return { disconnected: provider, defaultProvider: updated.defaultProvider };
}
function normalizeBdPhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("8801") && digits.length === 13) {
    return digits.slice(2);
  }
  if (digits.startsWith("01") && digits.length === 11) {
    return digits;
  }
  return digits;
}
function mapCourierStatusToOrderStatus(parcelStatus) {
  const s = String(parcelStatus || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "delivered" || s === "partial_delivered" || s === "delivered_approval_pending") {
    return "delivered";
  }
  if (s === "cancelled" || s === "cancelled_approval_pending") {
    return "cancelled";
  }
  if (s === "returned" || s === "return" || s === "pickup_cancelled") {
    return "returned";
  }
  if (["in_review", "pending", "hold", "in_transit", "picked_up", "assigned_for_delivery", "unknown"].includes(s)) {
    return "shipped";
  }
  return null;
}
async function checkSteadfastFraudByPhone(businessId, phone) {
  const normalized = normalizeBdPhone(phone);
  if (!normalized || normalized.length < 10) {
    return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
  }
  try {
    const admin = getSupabaseAdmin();
    const { data: account } = await admin.from("courier_accounts").select("api_key_encrypted, secret_key_encrypted, is_active").eq("business_id", businessId).eq("provider", "steadfast").eq("is_active", true).maybeSingle();
    if (!account) {
      return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
    }
    const apiKey = decryptSecret(String(account.api_key_encrypted || ""));
    const secretKey = decryptSecret(String(account.secret_key_encrypted || ""));
    if (!apiKey || !secretKey) {
      return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
    }
    const res = await fetch(`https://portal.packzy.com/api/v1/fraud_check/${encodeURIComponent(normalized)}`, {
      method: "GET",
      headers: {
        "Api-Key": apiKey,
        "Secret-Key": secretKey,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(4500)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.total_parcels === void 0) {
      return {
        checked: false,
        provider: "steadfast",
        phone: normalized,
        totalParcels: 0,
        totalDelivered: 0,
        totalCancelled: 0,
        successRate: null,
        error: data.message || `HTTP ${res.status}`
      };
    }
    const totalParcels = Math.max(0, Number(data.total_parcels ?? 0));
    const totalDelivered = Math.max(0, Number(data.total_delivered ?? 0));
    const totalCancelled = Math.max(0, Number(data.total_cancelled ?? 0));
    const completed = totalDelivered + totalCancelled;
    const denom = completed > 0 ? completed : totalParcels;
    const successRate = denom > 0 ? Math.round(totalDelivered / denom * 100) : null;
    return {
      checked: true,
      provider: "steadfast",
      phone: normalized,
      totalParcels,
      totalDelivered,
      totalCancelled,
      successRate
    };
  } catch (err) {
    return {
      checked: false,
      provider: "steadfast",
      phone: normalized,
      totalParcels: 0,
      totalDelivered: 0,
      totalCancelled: 0,
      successRate: null,
      error: err instanceof Error ? err.message : "Fraud check unavailable"
    };
  }
}
async function bookCourierParcel(params) {
  const admin = getSupabaseAdmin();
  let targetProvider = params.provider;
  if (!targetProvider) {
    const overview = await getBusinessCourierOverview(params.businessId);
    targetProvider = overview.defaultProvider || void 0;
  }
  if (!targetProvider) {
    throw new Error("No active courier account configured. Please connect Steadfast or Pathao in Courier Settings.");
  }
  const { data: account, error: accErr } = await admin.from("courier_accounts").select("*").eq("business_id", params.businessId).eq("provider", targetProvider).maybeSingle();
  if (accErr || !account) {
    throw new Error(`No ${targetProvider} courier account configured. Please configure credentials in Courier Settings.`);
  }
  if (!account.is_active) {
    throw new Error(`${targetProvider.toUpperCase()} courier is currently inactive. Activate it in Courier Settings or choose another courier.`);
  }
  let trackingId = "";
  let consignmentId = "";
  let parcelStatus = "created";
  let rawResponse = {};
  if (targetProvider === "steadfast") {
    const apiKey = decryptSecret(account.api_key_encrypted || "");
    const secretKey = decryptSecret(account.secret_key_encrypted || "");
    if (!apiKey || !secretKey) {
      throw new Error("Steadfast API Key and Secret Key are required.");
    }
    const invoiceRef = (params.orderNumber || params.orderId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20);
    const res = await fetch("https://portal.packzy.com/api/v1/create_order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Key": apiKey,
        "Secret-Key": secretKey
      },
      body: JSON.stringify({
        invoice: invoiceRef,
        recipient_name: params.recipientName,
        recipient_phone: normalizeBdPhone(params.recipientPhone) || params.recipientPhone,
        recipient_address: params.recipientAddress,
        cod_amount: Math.round(params.codAmount),
        note: params.note || ""
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 200 || !data.consignment?.tracking_code && !data.consignment?.consignment_id) {
      const firstFieldErr = data.errors ? Object.values(data.errors).flat()[0] : void 0;
      throw new Error(firstFieldErr || data.message || `Steadfast booking failed (HTTP ${res.status}).`);
    }
    consignmentId = data.consignment.consignment_id !== void 0 && data.consignment.consignment_id !== null ? String(data.consignment.consignment_id) : "";
    trackingId = String(data.consignment.tracking_code || consignmentId);
    parcelStatus = data.consignment.status || "in_review";
    rawResponse = data;
  } else if (targetProvider === "pathao") {
    const clientId = account.client_id || "";
    const clientSecret = decryptSecret(account.client_secret_encrypted || "");
    const username = account.username || "";
    const password = decryptSecret(account.password_encrypted || "");
    const storeId = Number(account.store_id || 0);
    if (!clientId || !clientSecret || !username || !password || !storeId) {
      throw new Error("Pathao Client ID, Client Secret, Username, Password, and Store ID are required.");
    }
    const baseUrl = account.is_sandbox ? "https://courier-api-sandbox.pathao.com" : "https://api-hermes.pathao.com";
    const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: "password"
      })
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.message || "Pathao authentication failed.");
    }
    const orderRes = await fetch(`${baseUrl}/aladdin/api/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`
      },
      body: JSON.stringify({
        store_id: storeId,
        merchant_order_id: (params.orderNumber || params.orderId).slice(0, 30),
        recipient_name: params.recipientName,
        recipient_phone: normalizeBdPhone(params.recipientPhone) || params.recipientPhone,
        recipient_address: params.recipientAddress,
        recipient_city: params.cityId || 1,
        recipient_zone: params.zoneId || 1,
        delivery_type: 48,
        item_type: 2,
        item_quantity: 1,
        item_weight: params.itemWeight || 0.5,
        amount_to_collect: Math.round(params.codAmount),
        special_instruction: params.note || ""
      })
    });
    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !orderJson.data?.consignment_id) {
      throw new Error(orderJson.message || `Pathao booking failed (HTTP ${orderRes.status}).`);
    }
    trackingId = String(orderJson.data.consignment_id);
    consignmentId = String(orderJson.data.consignment_id);
    parcelStatus = orderJson.data.order_status || "Pending";
    rawResponse = orderJson;
  }
  const { data: shipment, error: shipErr } = await admin.from("courier_shipments").insert({
    business_id: params.businessId,
    order_id: params.orderId,
    courier_account_id: account.id,
    provider: targetProvider,
    tracking_id: trackingId,
    consignment_id: consignmentId,
    parcel_status: parcelStatus,
    cod_amount: params.codAmount,
    raw_response: rawResponse
  }).select("*").single();
  if (shipErr) {
    throw new Error(`Booked on ${targetProvider} (Parcel ID: ${consignmentId || trackingId}) but failed to save shipment: ${shipErr.message}`);
  }
  if (shipment) {
    await admin.from("courier_tracking_events").insert({
      business_id: params.businessId,
      shipment_id: shipment.id,
      status: parcelStatus,
      description: `Booked parcel via ${targetProvider.toUpperCase()} (Parcel ID: ${consignmentId || trackingId})`,
      raw_payload: rawResponse
    });
  }
  await admin.from("orders").update({
    courier_name: targetProvider,
    tracking_id: trackingId,
    order_status: "shipped",
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", params.orderId).eq("business_id", params.businessId);
  return { trackingId, consignmentId, status: parcelStatus, provider: targetProvider, shipment, raw: rawResponse };
}
async function refreshCourierTracking(businessId, shipmentId) {
  const admin = getSupabaseAdmin();
  const { data: shipment } = await admin.from("courier_shipments").select("*, account:courier_accounts(*)").eq("id", shipmentId).eq("business_id", businessId).maybeSingle();
  if (!shipment || !shipment.account) {
    throw new Error("Shipment or courier account not found.");
  }
  const acc = shipment.account;
  let latestStatus = String(shipment.parcel_status || "in_review");
  let rawPayload = {};
  let resolvedConsignmentId = String(shipment.consignment_id || "");
  if (shipment.provider === "steadfast") {
    const apiKey = decryptSecret(String(acc.api_key_encrypted || ""));
    const secretKey = decryptSecret(String(acc.secret_key_encrypted || ""));
    const endpoint = resolvedConsignmentId ? `https://portal.packzy.com/api/v1/status_by_cid/${encodeURIComponent(resolvedConsignmentId)}` : `https://portal.packzy.com/api/v1/status_by_trackingcode/${encodeURIComponent(String(shipment.tracking_id))}`;
    const res = await fetch(endpoint, {
      headers: { "Api-Key": apiKey, "Secret-Key": secretKey, Accept: "application/json" },
      signal: AbortSignal.timeout(5e3)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.delivery_status) {
      latestStatus = data.delivery_status;
      if (!resolvedConsignmentId && data.consignment_id) {
        resolvedConsignmentId = String(data.consignment_id);
      }
      rawPayload = data;
    }
  } else if (shipment.provider === "pathao") {
    const baseUrl = acc.is_sandbox ? "https://courier-api-sandbox.pathao.com" : "https://api-hermes.pathao.com";
    const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: acc.client_id,
        client_secret: decryptSecret(String(acc.client_secret_encrypted || "")),
        username: acc.username,
        password: decryptSecret(String(acc.password_encrypted || "")),
        grant_type: "password"
      }),
      signal: AbortSignal.timeout(5e3)
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (tokenJson.access_token) {
      const infoRes = await fetch(`${baseUrl}/aladdin/api/v1/orders/${shipment.consignment_id}/info`, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        signal: AbortSignal.timeout(5e3)
      });
      const infoJson = await infoRes.json().catch(() => ({}));
      if (infoRes.ok && infoJson.data?.order_status) {
        latestStatus = infoJson.data.order_status;
        rawPayload = infoJson;
      }
    }
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  await admin.from("courier_shipments").update({
    parcel_status: latestStatus,
    ...resolvedConsignmentId ? { consignment_id: resolvedConsignmentId } : {},
    updated_at: nowIso
  }).eq("id", shipmentId);
  if (latestStatus !== shipment.parcel_status) {
    await admin.from("courier_tracking_events").insert({
      business_id: businessId,
      shipment_id: shipmentId,
      status: latestStatus,
      description: `Synced status from ${shipment.provider}: ${latestStatus}`,
      raw_payload: rawPayload
    });
  }
  const mappedOrderStatus = mapCourierStatusToOrderStatus(latestStatus);
  if (mappedOrderStatus && shipment.order_id) {
    const { data: ord } = await admin.from("orders").select("id, order_status").eq("id", shipment.order_id).eq("business_id", businessId).maybeSingle();
    if (ord && ord.order_status !== mappedOrderStatus) {
      await admin.from("orders").update({ order_status: mappedOrderStatus, updated_at: nowIso }).eq("id", ord.id).eq("business_id", businessId);
      await admin.from("order_status_history").insert({
        business_id: businessId,
        order_id: ord.id,
        old_status: ord.order_status,
        new_status: mappedOrderStatus,
        note: `Auto-detected from ${String(shipment.provider).toUpperCase()} (${latestStatus})`
      });
    }
  }
  return {
    status: latestStatus,
    consignmentId: resolvedConsignmentId,
    mappedOrderStatus,
    raw: rawPayload
  };
}
async function syncActiveShipmentsForBusiness(businessId) {
  const admin = getSupabaseAdmin();
  const { data: shipments } = await admin.from("courier_shipments").select("id, parcel_status").eq("business_id", businessId).not("parcel_status", "in", '("delivered","cancelled","returned","partial_delivered")').order("created_at", { ascending: false }).limit(10);
  if (!shipments || shipments.length === 0) {
    return { synced: 0, results: [] };
  }
  const settled = await Promise.allSettled(
    shipments.map(async (s) => {
      const r = await refreshCourierTracking(businessId, s.id);
      return { shipmentId: s.id, status: r.status };
    })
  );
  const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  return { synced: results.length, results };
}
async function testCourierConnection(businessId, provider) {
  const admin = getSupabaseAdmin();
  const { data: account, error } = await admin.from("courier_accounts").select("*").eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (error || !account) {
    throw new Error(`No ${provider} credentials saved yet. Please save your credentials first.`);
  }
  if (provider === "steadfast") {
    const apiKey = decryptSecret(String(account.api_key_encrypted || ""));
    const secretKey = decryptSecret(String(account.secret_key_encrypted || ""));
    if (!apiKey || !secretKey) {
      throw new Error("Steadfast Api-Key and Secret-Key are required.");
    }
    const res = await fetch("https://portal.packzy.com/api/v1/get_balance", {
      headers: { "Api-Key": apiKey, "Secret-Key": secretKey }
    });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected Steadfast response (HTTP ${res.status}).`);
    }
    if (!res.ok || json.status !== 200) {
      throw new Error(json.message || `Steadfast verification failed (HTTP ${res.status}).`);
    }
    return {
      ok: true,
      provider: "steadfast",
      message: `Connected! Current balance: \u09F3${Number(json.current_balance ?? 0)}`,
      balance: json.current_balance ?? 0
    };
  }
  const clientId = String(account.client_id || "");
  const clientSecret = decryptSecret(String(account.client_secret_encrypted || ""));
  const username = String(account.username || "");
  const password = decryptSecret(String(account.password_encrypted || ""));
  if (!clientId || !clientSecret || !username || !password) {
    throw new Error("Pathao Client ID, Client Secret, Username, and Password are required.");
  }
  const baseUrl = account.is_sandbox ? "https://courier-api-sandbox.pathao.com" : "https://api-hermes.pathao.com";
  const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
      grant_type: "password"
    })
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.message || `Pathao authentication failed (HTTP ${tokenRes.status}).`);
  }
  return {
    ok: true,
    provider: "pathao",
    message: `Pathao ${account.is_sandbox ? "Sandbox" : "Live"} token verified successfully!`
  };
}

// server/services/orderRisk.ts
async function evaluateOrderRisk(params) {
  const admin = getSupabaseAdmin();
  const reasons = [];
  let score = 0;
  const cleanPhone = (params.customerPhone || "").replace(/\s+/g, "");
  const normalizedPhone = normalizeBdPhone(cleanPhone);
  if (!cleanPhone || normalizedPhone.length < 10) {
    score += 3;
    reasons.push("Invalid or incomplete phone number format");
  }
  const [priorRes, courierStats] = await Promise.all([
    cleanPhone ? admin.from("orders").select("id, order_status, created_at, total_amount").eq("business_id", params.businessId).or(`customer_phone.eq.${cleanPhone},customer_phone.eq.${normalizedPhone}`).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    checkSteadfastFraudByPhone(params.businessId, cleanPhone)
  ]);
  const priorOrders = (priorRes.data || []).filter((o) => !params.excludeOrderId || o.id !== params.excludeOrderId);
  if (priorOrders.length > 0) {
    const recent15Min = priorOrders.filter(
      (o) => Date.now() - new Date(o.created_at).getTime() < 15 * 60 * 1e3
    );
    if (recent15Min.length >= 1) {
      score += 2;
      reasons.push(`Repeated order attempt within 15 minutes (${recent15Min.length} prior)`);
    }
    const cancelledCount = priorOrders.filter((o) => o.order_status === "cancelled").length;
    const returnedCount = priorOrders.filter((o) => o.order_status === "returned").length;
    const deliveredCount = priorOrders.filter((o) => o.order_status === "delivered").length;
    if (cancelledCount >= 2) {
      score += 3;
      reasons.push(`Store history: ${cancelledCount} cancelled orders on this number`);
    } else if (cancelledCount === 1) {
      score += 1;
      reasons.push("Store history: 1 previously cancelled order");
    }
    if (returnedCount >= 1) {
      score += 3;
      reasons.push(`Store history: ${returnedCount} returned order(s)`);
    }
    if (deliveredCount >= 2 && cancelledCount === 0 && returnedCount === 0) {
      score = Math.max(0, score - 2);
      reasons.push(`Verified repeat store customer (${deliveredCount} delivered)`);
    }
  }
  if (courierStats.checked) {
    if (courierStats.totalParcels === 0) {
      reasons.push("Steadfast Auto-Detection: 0 prior parcels (New courier recipient)");
    } else {
      const rateLabel = courierStats.successRate !== null ? ` (${courierStats.successRate}% delivery success)` : "";
      reasons.push(
        `Steadfast Auto-Detection: ${courierStats.totalParcels} parcels \xB7 ${courierStats.totalDelivered} delivered \xB7 ${courierStats.totalCancelled} cancelled${rateLabel}`
      );
      if (courierStats.totalCancelled >= 3 && (courierStats.successRate ?? 100) < 60) {
        score += 4;
      } else if (courierStats.totalCancelled >= 2 && (courierStats.successRate ?? 100) < 75) {
        score += 2;
      } else if (courierStats.totalDelivered >= 3 && (courierStats.successRate ?? 0) >= 85) {
        score = Math.max(0, score - 1);
      }
    }
  } else if (reasons.length === 0) {
    reasons.push("Local Auto-Detection: Phone format valid \xB7 No prior duplicate or return flags");
  }
  let riskLevel = "low";
  if (score >= 4) riskLevel = "high";
  else if (score >= 2) riskLevel = "medium";
  return { riskLevel, reasons, courierStats };
}

// server/services/realtimeBus.ts
import { WebSocketServer, WebSocket } from "ws";
var wss = null;
function broadcastToBusiness(businessId, event, payload) {
  if (!wss) return;
  const serialized = JSON.stringify({ event, businessId, payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  for (const client of wss.clients) {
    const sock = client;
    if (sock.readyState === WebSocket.OPEN && sock.businessIds?.has(businessId)) {
      sock.send(serialized);
    }
  }
}

// server/routes/systemRoutes.ts
var router = Router();
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get("/status", async (_req, res) => {
  const pubCfg = getPublicSupabaseConfig();
  if (!pubCfg.configured) {
    return res.json({
      supabaseConnected: false,
      schemaReady: false,
      appliedMigrations: [],
      bootstrapNeeded: false,
      supabase: pubCfg,
      appSettings: {
        app_name: "BeXpar Ai",
        default_theme: "light",
        primary_color: "#4F46E5",
        secondary_color: "#7C3AED",
        default_language: "bn",
        maintenance_mode: false,
        registration_enabled: true
      }
    });
  }
  const schema = await checkSchemaStatus();
  let bootstrapNeeded = false;
  let appSettings = {
    app_name: "BeXpar Ai",
    default_theme: "light",
    primary_color: "#4F46E5",
    secondary_color: "#7C3AED",
    default_language: "bn",
    maintenance_mode: false,
    registration_enabled: true
  };
  if (schema.schemaReady) {
    try {
      const admin = getSupabaseAdmin();
      const [{ count }, { data: settings }] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin"),
        admin.from("application_settings").select(
          "app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement"
        ).eq("id", 1).maybeSingle()
      ]);
      bootstrapNeeded = (count || 0) === 0;
      if (bootstrapNeeded) {
        getOrGenerateBootstrapCode();
      }
      if (settings) {
        appSettings = settings;
      }
    } catch {
    }
  }
  return res.json({
    supabaseConnected: schema.connected,
    schemaReady: schema.schemaReady,
    appliedMigrations: schema.appliedMigrations,
    schemaError: schema.error,
    bootstrapNeeded,
    supabase: pubCfg,
    appSettings
  });
});
router.get("/public-catalog", async (_req, res) => {
  try {
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.json({ plans: [], packages: [] });
    }
    const admin = getSupabaseAdmin();
    const [{ data: plans }, { data: packages }] = await Promise.all([
      admin.from("subscription_plans").select("id, slug, name, description, monthly_price, yearly_price, coin_allocation, max_products, max_staff, max_channels, allowed_features, duration_days, display_order").eq("is_active", true).order("display_order"),
      admin.from("coin_packages").select("id, name, coin_amount, bonus_coins, price, currency, validity_days, description, display_order").eq("status", "active").order("display_order")
    ]);
    return res.json({ plans: plans || [], packages: packages || [] });
  } catch {
    return res.json({ plans: [], packages: [] });
  }
});
router.get("/public-store/:businessId", async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!UUID_RE.test(businessId)) {
      return res.status(400).json({ error: "Invalid store identifier." });
    }
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.status(503).json({ error: "Store service is currently unavailable." });
    }
    const admin = getSupabaseAdmin();
    const { data: biz, error: bizErr } = await admin.from("businesses").select("id, name, category, address, phone, logo_url, status").eq("id", businessId).maybeSingle();
    if (bizErr) return res.status(400).json({ error: bizErr.message });
    if (!biz || biz.status !== "active") {
      return res.status(404).json({ error: "Store not found or currently inactive." });
    }
    const [{ data: products, error: prodErr }, { data: aiSettings }] = await Promise.all([
      admin.from("products").select(
        "id, business_id, name, sku, description, regular_price, discount_price, stock_quantity, category_name, colors, sizes, status, is_featured, primary_image_url, created_at, images:product_images(id, image_url, display_order)"
      ).eq("business_id", businessId).eq("status", "active").order("is_featured", { ascending: false }).order("created_at", { ascending: false }),
      admin.from("ai_settings").select("order_collection_rules").eq("business_id", businessId).maybeSingle()
    ]);
    if (prodErr) return res.status(400).json({ error: prodErr.message });
    const rules = aiSettings?.order_collection_rules || {};
    const deliveryCharge = Number(rules.default_delivery_charge ?? 60);
    return res.json({
      business: biz,
      products: products || [],
      deliveryCharge: Number.isFinite(deliveryCharge) && deliveryCharge >= 0 ? deliveryCharge : 60
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load store." });
  }
});
router.post("/public-store/:businessId/orders", async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!UUID_RE.test(businessId)) {
      return res.status(400).json({ error: "Invalid store identifier." });
    }
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.status(503).json({ error: "Store service is currently unavailable." });
    }
    const { customer_name, customer_phone, customer_address, items, payment_method, notes } = req.body;
    const nameClean = (customer_name || "").trim();
    const phoneClean = (customer_phone || "").trim();
    const addressClean = (customer_address || "").trim();
    if (!nameClean || !phoneClean || !addressClean || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Customer name, phone, delivery address, and at least one product are required." });
    }
    const admin = getSupabaseAdmin();
    const { data: biz } = await admin.from("businesses").select("id, owner_id, name, status").eq("id", businessId).maybeSingle();
    if (!biz || biz.status !== "active") {
      return res.status(404).json({ error: "Store not found or currently inactive." });
    }
    const productIds = Array.from(new Set(items.map((i) => i.product_id).filter((id) => Boolean(id && UUID_RE.test(id)))));
    if (productIds.length === 0) {
      return res.status(400).json({ error: "Valid products are required." });
    }
    const [{ data: dbProducts }, { data: aiSettings }] = await Promise.all([
      admin.from("products").select("*").eq("business_id", businessId).eq("status", "active").in("id", productIds),
      admin.from("ai_settings").select("order_collection_rules").eq("business_id", businessId).maybeSingle()
    ]);
    const prodMap = new Map((dbProducts || []).map((p) => [p.id, p]));
    let subtotal = 0;
    const resolvedItems = [];
    for (const reqItem of items) {
      if (!reqItem.product_id) continue;
      const p = prodMap.get(reqItem.product_id);
      if (!p) {
        return res.status(400).json({ error: "One or more selected products are no longer available." });
      }
      const qty = Math.max(1, Math.min(99, Math.floor(Number(reqItem.quantity || 1))));
      if (Number(p.stock_quantity || 0) < qty) {
        return res.status(400).json({ error: `Insufficient stock for ${p.name} (available: ${p.stock_quantity}).` });
      }
      const unitPrice = Number(p.discount_price ?? p.regular_price ?? 0);
      const unitCost = Number(p.purchase_cost || 0);
      const total = unitPrice * qty;
      subtotal += total;
      resolvedItems.push({
        business_id: businessId,
        product_id: p.id,
        product_name: p.name,
        sku: p.sku || "",
        variant_color: (reqItem.variant_color || "").trim(),
        variant_size: (reqItem.variant_size || "").trim(),
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_price: total
      });
    }
    if (resolvedItems.length === 0) {
      return res.status(400).json({ error: "At least one valid product is required." });
    }
    const rules = aiSettings?.order_collection_rules || {};
    const rawDeliv = Number(rules.default_delivery_charge ?? 60);
    const deliv = Number.isFinite(rawDeliv) && rawDeliv >= 0 ? rawDeliv : 60;
    const totalAmount = Math.max(0, subtotal + deliv);
    let customerId = null;
    const { data: existingCust } = await admin.from("customers").select("id, total_orders, total_spent").eq("business_id", businessId).eq("phone", phoneClean).maybeSingle();
    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const { data: newCust } = await admin.from("customers").insert({ business_id: businessId, name: nameClean, phone: phoneClean, address: addressClean }).select("id").single();
      customerId = newCust?.id || null;
    }
    const risk = await evaluateOrderRisk({ businessId, customerPhone: phoneClean, totalAmount });
    const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
    const safeMethod = payment_method && ["cod", "bkash", "nagad"].includes(payment_method) ? payment_method : "cod";
    const noteText = [notes?.trim(), "Mini Storefront Order"].filter(Boolean).join(" \xB7 ");
    const { data: order, error: ordErr } = await admin.from("orders").insert({
      business_id: businessId,
      order_number: orderNumber,
      customer_id: customerId,
      customer_name: nameClean,
      customer_phone: phoneClean,
      customer_address: addressClean,
      subtotal,
      discount: 0,
      delivery_charge: deliv,
      total_amount: totalAmount,
      payment_method: safeMethod,
      payment_status: "unpaid",
      order_status: "pending",
      order_source: "manual",
      risk_level: risk.riskLevel,
      risk_reasons: risk.reasons,
      notes: noteText
    }).select("id, order_number, customer_name, customer_phone, customer_address, subtotal, delivery_charge, total_amount, payment_method, order_status, created_at").single();
    if (ordErr) return res.status(400).json({ error: ordErr.message });
    await admin.from("order_items").insert(resolvedItems.map((it) => ({ ...it, order_id: order.id })));
    await admin.from("order_status_history").insert({
      business_id: businessId,
      order_id: order.id,
      old_status: "",
      new_status: "pending",
      note: "Order placed via public Mini Storefront"
    });
    if (customerId) {
      await admin.from("customers").update({
        total_orders: (existingCust?.total_orders || 0) + 1,
        total_spent: Number(existingCust?.total_spent || 0) + totalAmount,
        last_order_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", customerId);
    }
    if (biz.owner_id) {
      await createNotification({
        businessId,
        userId: biz.owner_id,
        title: `New Storefront Order #${order.order_number}`,
        body: `${nameClean} placed an order of ${totalAmount} BDT via Mini Store.`,
        type: "order"
      });
    }
    broadcastToBusiness(businessId, "order:created", order);
    return res.status(201).json({ order, items: resolvedItems });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to submit storefront order." });
  }
});
router.post("/supabase/connect", async (req, res) => {
  try {
    const existing = loadSupabaseConfig();
    if (existing) {
      const schema = await checkSchemaStatus();
      if (schema.schemaReady) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return res.status(403).json({ error: "Only an authenticated Super Admin can modify an active Supabase connection." });
        }
        const admin = getSupabaseAdmin();
        const { data: u } = await admin.auth.getUser(authHeader.slice(7));
        if (!u?.user) return res.status(401).json({ error: "Unauthorized" });
        const { data: prof } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
        if (prof?.role !== "super_admin") {
          return res.status(403).json({ error: "Super Admin role required." });
        }
      }
    }
    const { url, anonKey, serviceRoleKey, dbUrl } = req.body;
    if (!url || !anonKey || !serviceRoleKey) {
      return res.status(400).json({ error: "Supabase Project URL, Publishable/Anon Key, and Service Role Secret Key are required." });
    }
    saveSupabaseConfig({ url, anonKey, serviceRoleKey, dbUrl });
    const migrationResult = await runDatabaseMigrations(dbUrl);
    if (!existing && !migrationResult.success && migrationResult.error?.startsWith("Supabase Auth connection failed")) {
      clearSupabaseConfig();
    }
    return res.json({
      ...migrationResult,
      consolidatedSql: migrationResult.schemaReady ? void 0 : getConsolidatedMigrationSql(),
      supabase: getPublicSupabaseConfig()
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to connect Supabase." });
  }
});
async function assertCanConfigureSupabase(authHeader) {
  const existing = loadSupabaseConfig();
  if (!existing) return null;
  const schema = await checkSchemaStatus();
  if (!schema.schemaReady) return null;
  if (!authHeader?.startsWith("Bearer ")) {
    return "Only an authenticated Super Admin can modify an active Supabase connection.";
  }
  const admin = getSupabaseAdmin();
  const { data: u } = await admin.auth.getUser(authHeader.slice(7));
  if (!u?.user) return "Unauthorized";
  const { data: prof } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (prof?.role !== "super_admin") return "Super Admin role required.";
  return null;
}
router.post("/supabase/discover", async (req, res) => {
  try {
    const authErr = await assertCanConfigureSupabase(req.headers.authorization);
    if (authErr) return res.status(403).json({ error: authErr });
    const { accessToken } = req.body;
    if (!accessToken?.trim()) {
      return res.status(400).json({ error: "Supabase Personal Access Token (sbp_...) is required." });
    }
    const result = await listSupabaseProjectsAndOrgs(accessToken);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to load Supabase projects." });
  }
});
router.post("/supabase/auto-connect", async (req, res) => {
  try {
    const authErr = await assertCanConfigureSupabase(req.headers.authorization);
    if (authErr) return res.status(403).json({ error: authErr });
    const { accessToken, projectRef, createNew, projectName, organizationId, region } = req.body;
    if (!accessToken?.trim()) {
      return res.status(400).json({ error: "Supabase Personal Access Token is required." });
    }
    let targetRef = projectRef?.trim() || "";
    let dbUrl;
    if (createNew) {
      if (!organizationId) {
        return res.status(400).json({ error: "Organization is required to create a new Supabase project." });
      }
      const created = await createSupabaseProjectAuto(accessToken, {
        name: projectName || "bexpar-ai",
        organizationId,
        region: region || "ap-southeast-1"
      });
      targetRef = created.project.id;
      dbUrl = created.dbUrl;
    }
    if (!targetRef) {
      return res.status(400).json({ error: "Please select a Supabase project or create a new one." });
    }
    const keys = await fetchProjectApiKeysAuto(accessToken, targetRef);
    saveSupabaseConfig({
      url: keys.url,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
      dbUrl
    });
    const migrationResult = await runDatabaseMigrations(dbUrl, {
      accessToken: accessToken.trim(),
      projectRef: targetRef
    });
    return res.json({
      ...migrationResult,
      projectRef: targetRef,
      consolidatedSql: migrationResult.schemaReady ? void 0 : getConsolidatedMigrationSql(),
      supabase: getPublicSupabaseConfig()
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Automatic Supabase connection failed." });
  }
});
router.post("/supabase/verify", async (req, res) => {
  try {
    const { dbUrl } = req.body || {};
    if (dbUrl) {
      const existing = loadSupabaseConfig();
      if (existing) {
        saveSupabaseConfig({ ...existing, dbUrl });
      }
    }
    const result = await runDatabaseMigrations(dbUrl);
    return res.json({
      ...result,
      consolidatedSql: result.schemaReady ? void 0 : getConsolidatedMigrationSql()
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Verification failed." });
  }
});
router.get("/supabase/sql", async (_req, res) => {
  const schema = await checkSchemaStatus();
  if (schema.schemaReady) {
    return res.status(403).json({ error: "Schema is already initialized." });
  }
  return res.json({ sql: getConsolidatedMigrationSql() });
});
var handleBootstrapAdmin = async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "super_admin");
    if ((count || 0) > 0) {
      return res.status(403).json({ error: "Super Admin already exists. Bootstrap is permanently locked." });
    }
    const { verificationCode } = req.body;
    const expectedCode = getOrGenerateBootstrapCode();
    const submitted = (verificationCode || "").trim().toUpperCase();
    const shortSuffix = expectedCode.replace(/^BEXPAR-ADMIN-/i, "").toUpperCase();
    if (!submitted || submitted !== expectedCode.toUpperCase() && submitted !== shortSuffix) {
      return res.status(403).json({ error: "Invalid Super Admin verification code." });
    }
    const { data: updated, error } = await admin.from("profiles").update({ role: "super_admin", status: "active" }).eq("id", req.user.id).select("*").single();
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: "super_admin",
      action: "super_admin_bootstrap",
      targetType: "profile",
      targetId: req.user.id,
      details: { email: req.user.email },
      ipAddress: req.ip
    });
    return res.json({ success: true, profile: updated });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Bootstrap failed" });
  }
};
router.post("/bootstrap-admin", requireAuth, handleBootstrapAdmin);
router.post("/claim-owner", requireAuth, handleBootstrapAdmin);
var systemRoutes_default = router;

// server/routes/businessRoutes.ts
import crypto4 from "crypto";
import { Router as Router2 } from "express";

// server/services/metaService.ts
import crypto3 from "crypto";

// server/ai/providerRouter.ts
import { GoogleGenAI, Type } from "@google/genai";
var DEFAULT_PROVIDER_ROWS = [
  { slug: "gemini", name: "Google Gemini", provider_type: "gemini", base_url: "", is_active: true, priority: 1 },
  {
    slug: "openai",
    name: "OpenAI GPT",
    provider_type: "openai",
    base_url: "https://api.openai.com/v1",
    is_active: false,
    priority: 2
  },
  {
    slug: "deepseek",
    name: "DeepSeek AI",
    provider_type: "deepseek",
    base_url: "https://api.deepseek.com/v1",
    is_active: false,
    priority: 3
  }
];
var DEFAULT_MODEL_BY_TYPE = {
  gemini: [
    {
      model_id: "gemini-3.8-flash",
      display_name: "Gemini 3.8 Flash (Fast & Free-Tier)",
      is_default: true,
      is_fallback: false,
      priority: 1,
      input_cost_per_1m: 0.15,
      output_cost_per_1m: 0.6,
      max_tokens: 2048
    },
    {
      model_id: "gemini-4-hydrogen",
      display_name: "Gemini 4 Hydrogen (Bilingual Sales)",
      is_default: false,
      is_fallback: true,
      priority: 2,
      input_cost_per_1m: 0.15,
      output_cost_per_1m: 0.6,
      max_tokens: 2048
    },
    {
      model_id: "gemini-3.1-flash-lite",
      display_name: "Gemini 3.1 Flash Lite (Economy)",
      is_default: false,
      is_fallback: true,
      priority: 3,
      input_cost_per_1m: 0.08,
      output_cost_per_1m: 0.3,
      max_tokens: 2048
    }
  ],
  openai: [
    {
      model_id: "gpt-4o-mini",
      display_name: "GPT-4o Mini",
      is_default: false,
      is_fallback: false,
      priority: 3,
      input_cost_per_1m: 0.15,
      output_cost_per_1m: 0.6,
      max_tokens: 2048
    }
  ],
  deepseek: [
    {
      model_id: "deepseek-chat",
      display_name: "DeepSeek V3 Chat",
      is_default: false,
      is_fallback: false,
      priority: 4,
      input_cost_per_1m: 0.27,
      output_cost_per_1m: 1.1,
      max_tokens: 2048
    }
  ],
  custom: []
};
async function ensureDefaultAiProvidersAndModels() {
  const admin = getSupabaseAdmin();
  const { data: existingProviders } = await admin.from("ai_providers").select("id, slug, provider_type, is_active");
  let providers = existingProviders || [];
  if (providers.length === 0) {
    await admin.from("ai_providers").upsert([...DEFAULT_PROVIDER_ROWS], { onConflict: "slug", ignoreDuplicates: true });
    const refreshed = await admin.from("ai_providers").select("id, slug, provider_type, is_active");
    providers = refreshed.data || [];
  }
  const { data: existingModels } = await admin.from("ai_models").select("id, provider_id, model_id, is_default");
  const models = existingModels || [];
  const hasAnyDefault = models.some((m) => m.is_default);
  if (models.length === 0) {
    const toInsert = [];
    for (const p of providers) {
      const pType = p.provider_type;
      const templates = DEFAULT_MODEL_BY_TYPE[pType] || [];
      for (const tpl of templates) {
        toInsert.push({
          provider_id: p.id,
          model_id: tpl.model_id,
          display_name: tpl.display_name,
          is_active: true,
          is_default: tpl.is_default && !hasAnyDefault,
          is_fallback: tpl.is_fallback,
          priority: tpl.priority,
          input_cost_per_1m: tpl.input_cost_per_1m,
          output_cost_per_1m: tpl.output_cost_per_1m,
          coins_per_usd: 1e3,
          max_tokens: tpl.max_tokens,
          min_plan_slug: "free"
        });
      }
    }
    if (toInsert.length > 0) {
      await admin.from("ai_models").upsert(toInsert, { onConflict: "provider_id,model_id", ignoreDuplicates: true });
    }
  } else {
    const retiredGeminiIds = /* @__PURE__ */ new Set([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-pro",
      "gemini-2.0-flash-thinking",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro"
    ]);
    const geminiProv = providers.find((p) => p.provider_type === "gemini");
    if (geminiProv) {
      const geminiModels = models.filter((m) => m.provider_id === geminiProv.id);
      const onlyRetiredOrEmpty = geminiModels.length === 0 || geminiModels.every((m) => retiredGeminiIds.has(String(m.model_id)));
      const hasRetiredDefault = geminiModels.some(
        (m) => m.is_default && retiredGeminiIds.has(String(m.model_id))
      );
      if (onlyRetiredOrEmpty || hasRetiredDefault) {
        const primaryTpl = DEFAULT_MODEL_BY_TYPE.gemini[0];
        const fallbackTpl = DEFAULT_MODEL_BY_TYPE.gemini[1];
        const liteTpl = DEFAULT_MODEL_BY_TYPE.gemini[2];
        for (const retiredId of retiredGeminiIds) {
          if (geminiModels.some((m) => String(m.model_id) === retiredId)) {
            await admin.from("ai_models").update({ is_active: false, is_default: false, is_fallback: false }).eq("provider_id", geminiProv.id).eq("model_id", retiredId);
          }
        }
        const anyOtherDefault = models.some(
          (m) => m.is_default && m.provider_id !== geminiProv.id
        );
        await admin.from("ai_models").upsert(
          [
            {
              provider_id: geminiProv.id,
              model_id: primaryTpl.model_id,
              display_name: primaryTpl.display_name,
              is_active: true,
              is_default: !anyOtherDefault || hasRetiredDefault || !hasAnyDefault,
              is_fallback: false,
              priority: primaryTpl.priority,
              input_cost_per_1m: primaryTpl.input_cost_per_1m,
              output_cost_per_1m: primaryTpl.output_cost_per_1m,
              coins_per_usd: 1e3,
              max_tokens: primaryTpl.max_tokens,
              min_plan_slug: "free"
            },
            {
              provider_id: geminiProv.id,
              model_id: fallbackTpl.model_id,
              display_name: fallbackTpl.display_name,
              is_active: true,
              is_default: false,
              is_fallback: true,
              priority: fallbackTpl.priority,
              input_cost_per_1m: fallbackTpl.input_cost_per_1m,
              output_cost_per_1m: fallbackTpl.output_cost_per_1m,
              coins_per_usd: 1e3,
              max_tokens: fallbackTpl.max_tokens,
              min_plan_slug: "free"
            },
            {
              provider_id: geminiProv.id,
              model_id: liteTpl.model_id,
              display_name: liteTpl.display_name,
              is_active: true,
              is_default: false,
              is_fallback: true,
              priority: liteTpl.priority,
              input_cost_per_1m: liteTpl.input_cost_per_1m,
              output_cost_per_1m: liteTpl.output_cost_per_1m,
              coins_per_usd: 1e3,
              max_tokens: liteTpl.max_tokens,
              min_plan_slug: "free"
            }
          ],
          { onConflict: "provider_id,model_id" }
        );
      }
    }
  }
}
async function ensureDefaultModelForProvider(provider) {
  const admin = getSupabaseAdmin();
  const { data: existingForProv } = await admin.from("ai_models").select("id").eq("provider_id", provider.id).limit(1);
  if (existingForProv && existingForProv.length > 0) return;
  const { data: anyDefault } = await admin.from("ai_models").select("id").eq("is_default", true).limit(1);
  const templates = DEFAULT_MODEL_BY_TYPE[provider.provider_type] || [];
  if (templates.length === 0) return;
  const first = templates[0];
  await admin.from("ai_models").upsert(
    {
      provider_id: provider.id,
      model_id: first.model_id,
      display_name: first.display_name,
      is_active: true,
      is_default: !anyDefault || anyDefault.length === 0,
      is_fallback: first.is_fallback,
      priority: first.priority,
      input_cost_per_1m: first.input_cost_per_1m,
      output_cost_per_1m: first.output_cost_per_1m,
      coins_per_usd: 1e3,
      max_tokens: first.max_tokens,
      min_plan_slug: "free"
    },
    { onConflict: "provider_id,model_id", ignoreDuplicates: true }
  );
}
async function getOrderedActiveModels() {
  const admin = getSupabaseAdmin();
  const queryModels = async () => admin.from("ai_models").select("*, provider:ai_providers!inner(*)").eq("is_active", true).eq("provider.is_active", true).order("is_default", { ascending: false }).order("priority", { ascending: true });
  let { data, error } = await queryModels();
  const retiredCheck = /* @__PURE__ */ new Set(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-pro"]);
  const needsAutoHeal = !error && (!data || data.length === 0 || data.some((m) => Boolean(m.is_default) && retiredCheck.has(String(m.model_id))));
  if (needsAutoHeal) {
    await ensureDefaultAiProvidersAndModels();
    const retry = await queryModels();
    data = retry.data;
    error = retry.error;
  }
  if (error || !data) return [];
  return data;
}
function getProviderApiKey(model) {
  const decrypted = decryptSecret(model.provider.api_key_encrypted || "");
  if (decrypted) return decrypted;
  if (model.provider.provider_type === "gemini") {
    return process.env.GEMINI_API_KEY || "";
  }
  return "";
}
async function callSingleModel(model, params) {
  const apiKey = params.overrideApiKey?.trim() || getProviderApiKey(model);
  if (!apiKey) {
    throw new Error(`No API key configured for provider ${model.provider.name}.`);
  }
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  if (model.provider.provider_type === "gemini") {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
    const runGemini = async (withSchema) => ai.models.generateContent({
      model: model.model_id,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        ...withSchema ? {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply_text: { type: Type.STRING },
              intent: { type: Type.STRING },
              should_handover: { type: Type.BOOLEAN },
              extracted_order: {
                type: Type.OBJECT,
                properties: {
                  ready_to_create: { type: Type.BOOLEAN },
                  customer_name: { type: Type.STRING },
                  customer_phone: { type: Type.STRING },
                  customer_address: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        product_id: { type: Type.STRING },
                        product_name: { type: Type.STRING },
                        quantity: { type: Type.INTEGER },
                        color: { type: Type.STRING },
                        size: { type: Type.STRING }
                      }
                    }
                  }
                }
              }
            },
            required: ["reply_text", "intent", "should_handover"]
          }
        } : {}
      }
    });
    const callWithRetry = async (fn) => {
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|overloaded|rate.?limit/i.test(msg);
          if (!isTransient || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      throw lastErr;
    };
    let response;
    try {
      response = await callWithRetry(() => runGemini(Boolean(params.expectJson)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isSchemaError = /schema|response_mime_type|responseMimeType|INVALID_ARGUMENT|400/i.test(msg);
      if (params.expectJson && isSchemaError) {
        response = await callWithRetry(() => runGemini(false));
      } else {
        throw err;
      }
    }
    text = response.text || "";
    inputTokens = response.usageMetadata?.promptTokenCount || 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
  } else {
    const rawBase = params.overrideBaseUrl?.trim() || model.provider.base_url || "";
    const baseUrl = rawBase.replace(/\/+$/, "") || (model.provider.provider_type === "deepseek" ? "https://api.deepseek.com/v1" : "https://api.openai.com/v1");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model.model_id,
        messages: [
          { role: "system", content: params.systemInstruction },
          { role: "user", content: params.prompt }
        ],
        max_tokens: model.max_tokens || 2048,
        ...params.expectJson ? { response_format: { type: "json_object" } } : {}
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${model.provider.name} API error (${res.status}): ${errBody}`);
    }
    const json = await res.json();
    text = json.choices?.[0]?.message?.content || "";
    inputTokens = json.usage?.prompt_tokens || 0;
    outputTokens = json.usage?.completion_tokens || 0;
  }
  const totalTokens = inputTokens + outputTokens;
  const providerCostUsd = inputTokens * Number(model.input_cost_per_1m) / 1e6 + outputTokens * Number(model.output_cost_per_1m) / 1e6;
  const coinsRequired = Math.max(0.01, Number((providerCostUsd * Number(model.coins_per_usd)).toFixed(4)));
  return {
    text,
    inputTokens,
    outputTokens,
    totalTokens,
    providerSlug: model.provider.slug,
    modelId: model.model_id,
    providerCostUsd,
    coinsRequired
  };
}
async function generateWithRouter(params) {
  const models = await getOrderedActiveModels();
  if (models.length === 0) {
    throw new Error("No active AI models configured. Please configure an AI model in Super Admin \u2192 AI Management.");
  }
  let ordered = [...models];
  if (params.preferredModelId) {
    const idx = ordered.findIndex((m) => m.model_id === params.preferredModelId);
    if (idx > 0) {
      const [picked] = ordered.splice(idx, 1);
      ordered.unshift(picked);
    }
  }
  const withKey = ordered.filter((m) => Boolean(getProviderApiKey(m)));
  const candidates = withKey.length > 0 ? withKey : ordered;
  const defaultAndNormal = candidates.filter((m) => !m.is_fallback);
  const fallbacks = candidates.filter((m) => m.is_fallback);
  const executionQueue = [...defaultAndNormal, ...fallbacks];
  let lastError = null;
  for (const candidate of executionQueue) {
    try {
      return await callSingleModel(candidate, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Router] Model ${candidate.model_id} (${candidate.provider.slug}) failed:`, lastError.message);
    }
  }
  throw lastError || new Error("All configured AI providers failed.");
}
async function testModelConnection(modelDbId) {
  const admin = getSupabaseAdmin();
  const { data: model, error } = await admin.from("ai_models").select("*, provider:ai_providers!inner(*)").eq("id", modelDbId).maybeSingle();
  if (error || !model) {
    return { ok: false, latencyMs: 0, error: "Model not found." };
  }
  const start = Date.now();
  try {
    const result = await callSingleModel(model, {
      systemInstruction: "Reply concisely with OK.",
      prompt: "Health check ping. Reply with OK.",
      expectJson: false
    });
    return {
      ok: true,
      latencyMs: Date.now() - start,
      sample: result.text.slice(0, 120)
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function testProviderConnection(providerDbId, overrides) {
  const admin = getSupabaseAdmin();
  const { data: provider, error } = await admin.from("ai_providers").select("*").eq("id", providerDbId).maybeSingle();
  if (error || !provider) {
    return { ok: false, latencyMs: 0, modelId: "", error: "Provider not found." };
  }
  const { data: providerModels } = await admin.from("ai_models").select("*").eq("provider_id", provider.id).eq("is_active", true).order("is_default", { ascending: false }).order("priority", { ascending: true }).limit(5);
  const pType = provider.provider_type;
  const defaultCandidates = pType === "gemini" ? ["gemini-3.8-flash", "gemini-4-hydrogen", "gemini-3.1-flash-lite"] : pType === "deepseek" ? ["deepseek-chat"] : ["gpt-4o-mini"];
  const retiredGemini = /* @__PURE__ */ new Set([
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-pro",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
  ]);
  const dbActiveIds = (providerModels || []).map((m) => String(m.model_id)).filter((id) => pType !== "gemini" || !retiredGemini.has(id));
  const candidateIds = overrides?.modelId?.trim() ? [overrides.modelId.trim()] : Array.from(/* @__PURE__ */ new Set([...dbActiveIds, ...defaultCandidates]));
  const pickedModel = (providerModels || [])[0];
  let lastError = "Connection test failed.";
  let lastModelId = candidateIds[0] || defaultCandidates[0];
  const start = Date.now();
  for (const modelId of candidateIds) {
    lastModelId = modelId;
    const syntheticModel = {
      id: pickedModel?.id || provider.id,
      provider_id: provider.id,
      model_id: modelId,
      display_name: pickedModel?.display_name || modelId,
      is_active: true,
      is_default: true,
      is_fallback: false,
      priority: 1,
      input_cost_per_1m: Number(pickedModel?.input_cost_per_1m ?? 0.15),
      output_cost_per_1m: Number(pickedModel?.output_cost_per_1m ?? 0.6),
      coins_per_usd: Number(pickedModel?.coins_per_usd ?? 1e3),
      max_tokens: Number(pickedModel?.max_tokens ?? 256),
      min_plan_slug: "free",
      provider: {
        id: provider.id,
        slug: provider.slug,
        name: provider.name,
        provider_type: pType,
        base_url: provider.base_url || "",
        api_key_encrypted: provider.api_key_encrypted || "",
        is_active: true
      }
    };
    try {
      const result = await callSingleModel(syntheticModel, {
        systemInstruction: "Reply concisely with OK.",
        prompt: "Health check ping. Reply with OK.",
        expectJson: false,
        overrideApiKey: overrides?.apiKey,
        overrideBaseUrl: overrides?.baseUrl
      });
      return {
        ok: true,
        latencyMs: Date.now() - start,
        modelId,
        sample: result.text.slice(0, 120)
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const isModelNotFound = /404|NOT_FOUND|no longer available/i.test(lastError);
      if (!isModelNotFound) {
        break;
      }
    }
  }
  return {
    ok: false,
    latencyMs: Date.now() - start,
    modelId: lastModelId,
    error: lastError
  };
}

// server/ai/customerAgent.ts
async function processCustomerMessageWithAi(params) {
  const admin = getSupabaseAdmin();
  const { data: conv } = await admin.from("conversations").select("*").eq("id", params.conversationId).eq("business_id", params.businessId).maybeSingle();
  if (!conv) return { replied: false, error: "Conversation not found." };
  if (!conv.ai_enabled) return { replied: false };
  if (conv.ai_paused_until && new Date(conv.ai_paused_until).getTime() > Date.now()) {
    return { replied: false };
  }
  const { data: aiSettings } = await admin.from("ai_settings").select("*").eq("business_id", params.businessId).maybeSingle();
  if (aiSettings && (!aiSettings.is_available || !aiSettings.auto_reply_enabled)) {
    return { replied: false };
  }
  const { data: wallet } = await admin.from("coin_wallets").select("balance").eq("business_id", params.businessId).maybeSingle();
  const currentBalance = Number(wallet?.balance || 0);
  if (currentBalance <= 0) {
    await admin.from("ai_usage_logs").insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: "system",
      model_id: "none",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      provider_cost_usd: 0,
      coins_deducted: 0,
      status: "blocked_insufficient_coins",
      error_message: "Insufficient AI coin balance. Please recharge coins."
    });
    await createNotification({
      businessId: params.businessId,
      title: "AI Coins Exhausted",
      body: "AI auto-reply was paused because your coin wallet balance reached 0. Recharge coins to resume.",
      type: "warning",
      link: "wallet"
    });
    return {
      replied: false,
      insufficientCoins: true,
      error: "Insufficient AI coins. Please recharge your coin wallet."
    };
  }
  const [{ data: business }, { data: products }, { data: kbEntries }, { data: history }] = await Promise.all([
    admin.from("businesses").select("name, category, phone, address").eq("id", params.businessId).maybeSingle(),
    admin.from("products").select("id, name, sku, description, regular_price, discount_price, stock_quantity, colors, sizes, status, category_name").eq("business_id", params.businessId).neq("status", "draft").limit(100),
    admin.from("ai_knowledge_base").select("category, title, content").eq("business_id", params.businessId).eq("is_enabled", true).limit(50),
    admin.from("messages").select("sender_type, content, created_at").eq("conversation_id", params.conversationId).order("created_at", { ascending: false }).limit(12)
  ]);
  const orderedHistory = (history || []).reverse();
  const trailingCustomerMsgs = [];
  for (let i = orderedHistory.length - 1; i >= 0; i--) {
    if (orderedHistory[i].sender_type === "customer") {
      const txt = String(orderedHistory[i].content || "").trim();
      if (txt) trailingCustomerMsgs.unshift(txt);
    } else {
      break;
    }
  }
  const combinedLatestCustomerMsg = trailingCustomerMsgs.length > 1 ? trailingCustomerMsgs.join("\n") : params.customerMessage;
  const defaultDelivery = Number(aiSettings?.order_collection_rules?.default_delivery_charge ?? 60);
  const systemInstruction = `You are "${aiSettings?.agent_name || "BeXpar Assistant"}", the official AI Customer Service & Sales Agent for "${business?.name || "our store"}" (${business?.category || ""}) on channel: ${conv.channel}.

LANGUAGE & TONE:
- Understand and reply fluently in Bangla, Banglish (Romanized Bengali), or English\u2014always matching the customer's language naturally.
- Configured tone: ${aiSettings?.reply_tone || "friendly_professional"}. Language preference: ${aiSettings?.language || "bn-en"}.
- Answer ONLY what the customer asks, clearly and concisely, without unnecessary sales pitches or repeating already-answered questions.

STRICT ACCURACY & GROUNDING RULES (NEVER VIOLATE):
1. Retrieve prices, discounts, stock, colors, sizes, and policies ONLY from the ACTUAL DATABASE RECORDS below.
2. NEVER invent product prices, discount prices, stock availability, colors, sizes, delivery charges, or policies.
3. If the requested information or product is not found in the records below, honestly inform the customer that a human team member will confirm shortly, and set "should_handover": true.
4. For orders: collect missing required fields (Customer Name, Phone Number, Full Delivery Address, Product, Quantity, Color/Size if product has variants). Ask ONLY for missing information.
5. Set "extracted_order.ready_to_create": true ONLY when you have Customer Name, valid Phone Number, Full Delivery Address, and at least one matched product_id from the catalog with stock > 0, and the customer has confirmed or clearly placed the order.
6. Standard default delivery charge (unless specified in Knowledge Base): ${defaultDelivery} BDT.

STORE CONTACT & LOCATION:
- Store Name: ${business?.name || "Our Store"}
- Category: ${business?.category || "General"}
- Phone: ${business?.phone || "Not provided"}
- Address / Location: ${business?.address || "Not provided"}

CUSTOM BUSINESS INSTRUCTIONS:
${aiSettings?.system_instructions || "Be helpful, polite, and accurate."}
${aiSettings?.business_rules ? `BUSINESS RULES:
${aiSettings.business_rules}` : ""}

ACTUAL PRODUCT CATALOG (JSON):
${JSON.stringify(products || [])}

KNOWLEDGE BASE & POLICIES (JSON):
${JSON.stringify(kbEntries || [])}

RETURN STRICT JSON ONLY matching this schema:
{
  "reply_text": "string",
  "intent": "general_inquiry | product_question | order_intent | order_confirmation | human_handover",
  "should_handover": boolean,
  "extracted_order": {
    "ready_to_create": boolean,
    "customer_name": "string",
    "customer_phone": "string",
    "customer_address": "string",
    "items": [{ "product_id": "uuid", "product_name": "string", "quantity": number, "color": "string", "size": "string" }]
  }
}`;
  const prompt = `CONVERSATION HISTORY:
${orderedHistory.map((m) => `[${m.sender_type.toUpperCase()}]: ${m.content}`).join("\n")}

LATEST CUSTOMER MESSAGE:
${combinedLatestCustomerMsg}`;
  let genResult;
  try {
    genResult = await generateWithRouter({
      systemInstruction,
      prompt,
      expectJson: true
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin.from("ai_usage_logs").insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: "router",
      model_id: "none",
      status: "error",
      error_message: errMsg
    });
    return { replied: false, error: errMsg };
  }
  const { data: deductRows, error: deductErr } = await admin.rpc("deduct_ai_coins_atomic", {
    p_business_id: params.businessId,
    p_amount: genResult.coinsRequired,
    p_description: `AI reply (${genResult.modelId}) - ${genResult.totalTokens} tokens`,
    p_reference_id: params.conversationId,
    p_user_id: params.userId || null
  });
  const deductRes = Array.isArray(deductRows) ? deductRows[0] : deductRows;
  if (deductErr || !deductRes?.success) {
    await admin.from("ai_usage_logs").insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: genResult.providerSlug,
      model_id: genResult.modelId,
      input_tokens: genResult.inputTokens,
      output_tokens: genResult.outputTokens,
      total_tokens: genResult.totalTokens,
      provider_cost_usd: genResult.providerCostUsd,
      coins_deducted: 0,
      status: "blocked_insufficient_coins",
      error_message: deductRes?.message || deductErr?.message || "Insufficient coins"
    });
    return {
      replied: false,
      insufficientCoins: true,
      error: deductRes?.message || "Insufficient AI coins."
    };
  }
  await admin.from("ai_usage_logs").insert({
    business_id: params.businessId,
    user_id: params.userId || null,
    conversation_id: params.conversationId,
    provider_slug: genResult.providerSlug,
    model_id: genResult.modelId,
    input_tokens: genResult.inputTokens,
    output_tokens: genResult.outputTokens,
    total_tokens: genResult.totalTokens,
    provider_cost_usd: genResult.providerCostUsd,
    coins_deducted: genResult.coinsRequired,
    status: "success"
  });
  broadcastToBusiness(params.businessId, "wallet:updated", { balance: deductRes.new_balance });
  let parsed = {
    reply_text: genResult.text,
    intent: "general_inquiry",
    should_handover: false
  };
  try {
    const cleaned = genResult.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      reply_text: genResult.text,
      intent: "general_inquiry",
      should_handover: false
    };
  }
  const { data: savedAiMsg } = await admin.from("messages").insert({
    business_id: params.businessId,
    conversation_id: params.conversationId,
    sender_type: "ai",
    content: parsed.reply_text,
    message_type: "text",
    delivery_status: "sent",
    metadata: {
      model_id: genResult.modelId,
      provider: genResult.providerSlug,
      tokens: genResult.totalTokens,
      coins_deducted: genResult.coinsRequired,
      intent: parsed.intent
    }
  }).select("*").single();
  const shouldPauseAi = Boolean(
    parsed.should_handover && parsed.intent === "human_handover" && aiSettings?.human_handover_enabled
  );
  const { data: updatedConv } = await admin.from("conversations").update({
    last_message: parsed.reply_text,
    last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
    ...shouldPauseAi ? { ai_enabled: false } : {}
  }).eq("id", params.conversationId).select("*, customer:customers(*)").single();
  if (savedAiMsg) {
    broadcastToBusiness(params.businessId, "message:new", savedAiMsg);
  }
  if (updatedConv) {
    broadcastToBusiness(params.businessId, "conversation:updated", updatedConv);
  }
  let orderCreatedId;
  const orderData = parsed.extracted_order;
  if (aiSettings?.order_collection_enabled !== false && orderData?.ready_to_create && orderData.customer_name && orderData.customer_phone && orderData.customer_address && Array.isArray(orderData.items) && orderData.items.length > 0) {
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1e3).toISOString();
    const { data: existingDup } = await admin.from("orders").select("id").eq("business_id", params.businessId).eq("conversation_id", params.conversationId).gte("created_at", threeMinAgo).limit(1);
    if (!existingDup || existingDup.length === 0) {
      const catalogMap = new Map((products || []).map((p) => [p.id, p]));
      const validItems = [];
      let subtotal = 0;
      for (const item of orderData.items) {
        const prod = (item.product_id ? catalogMap.get(item.product_id) : void 0) || (products || []).find((p) => p.name.toLowerCase() === (item.product_name || "").toLowerCase());
        if (!prod) continue;
        const qty = Math.max(1, Number(item.quantity || 1));
        const unitPrice = Number(prod.discount_price ?? prod.regular_price ?? 0);
        const totalPrice = unitPrice * qty;
        subtotal += totalPrice;
        validItems.push({
          product_id: prod.id,
          product_name: prod.name,
          sku: prod.sku || "",
          variant_color: item.color || "",
          variant_size: item.size || "",
          quantity: qty,
          unit_price: unitPrice,
          unit_cost: 0,
          total_price: totalPrice
        });
      }
      if (validItems.length > 0) {
        let customerId = conv.customer_id;
        if (!customerId) {
          const { data: existingCust } = await admin.from("customers").select("id").eq("business_id", params.businessId).eq("phone", orderData.customer_phone).maybeSingle();
          if (existingCust) {
            customerId = existingCust.id;
          } else {
            const { data: newCust } = await admin.from("customers").insert({
              business_id: params.businessId,
              name: orderData.customer_name,
              phone: orderData.customer_phone,
              address: orderData.customer_address
            }).select("id").single();
            customerId = newCust?.id || null;
          }
        }
        const totalAmount = subtotal + defaultDelivery;
        const risk = await evaluateOrderRisk({
          businessId: params.businessId,
          customerPhone: orderData.customer_phone,
          totalAmount
        });
        const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
        const { data: createdOrder } = await admin.from("orders").insert({
          business_id: params.businessId,
          order_number: orderNumber,
          customer_id: customerId,
          conversation_id: params.conversationId,
          customer_name: orderData.customer_name,
          customer_phone: orderData.customer_phone,
          customer_address: orderData.customer_address,
          subtotal,
          discount: 0,
          delivery_charge: defaultDelivery,
          total_amount: totalAmount,
          payment_method: "cod",
          payment_status: "unpaid",
          order_status: "pending",
          order_source: "ai_agent",
          risk_level: risk.riskLevel,
          risk_reasons: risk.reasons
        }).select("*").single();
        if (createdOrder) {
          orderCreatedId = createdOrder.id;
          await admin.from("order_items").insert(
            validItems.map((it) => ({
              business_id: params.businessId,
              order_id: createdOrder.id,
              ...it
            }))
          );
          await admin.from("order_status_history").insert({
            business_id: params.businessId,
            order_id: createdOrder.id,
            old_status: "",
            new_status: "pending",
            note: "Automatically collected by BeXpar Ai Agent"
          });
          if (customerId) {
            await admin.from("conversations").update({ customer_id: customerId }).eq("id", params.conversationId);
          }
          broadcastToBusiness(params.businessId, "order:created", createdOrder);
        }
      }
    }
  }
  return {
    replied: true,
    messageId: savedAiMsg?.id,
    replyText: parsed.reply_text,
    orderCreatedId
  };
}

// server/services/metaService.ts
async function getPlatformMetaConfig() {
  let data = null;
  try {
    const admin = getSupabaseAdmin();
    const res = await admin.from("application_settings").select("meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode").eq("id", 1).maybeSingle();
    data = res.data;
  } catch {
  }
  const appId = data?.meta_app_id || process.env.META_APP_ID || "";
  const appSecret = decryptSecret(data?.meta_app_secret_encrypted || "") || process.env.META_APP_SECRET || "";
  const apiVersion = data?.meta_api_version || "v21.0";
  const webhookVerifyToken = data?.meta_webhook_verify_token || process.env.META_WEBHOOK_VERIFY_TOKEN || "bexpar_meta_verify_token";
  const mode = data?.meta_mode || "development";
  return { appId, appSecret, apiVersion, webhookVerifyToken, mode };
}
function resolveAppBaseUrl(req) {
  const configured = process.env.APP_URL?.trim();
  if (configured && !configured.includes("MY_APP_URL")) {
    return configured.replace(/\/+$/, "");
  }
  if (req?.headers) {
    const rawHost = req.headers["x-forwarded-host"] || req.headers.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    if (host) {
      const rawProto = req.headers["x-forwarded-proto"] || req.protocol || (host.includes("localhost") ? "http" : "https");
      const proto = Array.isArray(rawProto) ? rawProto[0] : rawProto;
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  }
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd}`.replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");
  return "http://localhost:3000";
}
function getMetaOAuthRedirectUri(req) {
  return `${resolveAppBaseUrl(req)}/api/oauth/meta/callback`;
}
async function subscribePageToMetaWebhooks(params) {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const ver = params.apiVersion || metaCfg.apiVersion;
  const fieldCandidates = [
    "messages,messaging_postbacks,message_deliveries,message_reads,messaging_optins",
    "messages,messaging_postbacks,message_deliveries,message_reads",
    "messages,messaging_postbacks",
    "messages"
  ];
  let lastErr = "";
  try {
    for (const fields of fieldCandidates) {
      const subUrl = new URL(`https://graph.facebook.com/${ver}/${params.pageId}/subscribed_apps`);
      subUrl.searchParams.set("subscribed_fields", fields);
      subUrl.searchParams.set("access_token", params.pageAccessToken);
      const res = await fetch(subUrl.toString(), { method: "POST" });
      const json = await res.json();
      if (res.ok && json.success) {
        await admin.from("facebook_pages").update({ webhook_subscribed: true }).eq("business_id", params.businessId).eq("page_id", params.pageId);
        return { ok: true, subscribedFields: fields };
      }
      lastErr = json.error?.message || `HTTP ${res.status}`;
    }
    await admin.from("facebook_pages").update({ webhook_subscribed: false }).eq("business_id", params.businessId).eq("page_id", params.pageId);
    await admin.from("social_connection_logs").insert({
      business_id: params.businessId,
      platform: "facebook",
      event_type: "webhook_subscribe",
      status: "warning",
      message: `Webhook subscription note for Page ${params.pageId}: ${lastErr}`
    });
    return { ok: false, error: lastErr };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin.from("social_connection_logs").insert({
      business_id: params.businessId,
      platform: "facebook",
      event_type: "webhook_subscribe",
      status: "warning",
      message: `Webhook subscription error for Page ${params.pageId}: ${errMsg}`
    });
    return { ok: false, error: errMsg };
  }
}
async function subscribeWabaToMetaWebhooks(params) {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const ver = params.apiVersion || metaCfg.apiVersion;
  try {
    const res = await fetch(`https://graph.facebook.com/${ver}/${params.wabaId}/subscribed_apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`
      }
    });
    const json = await res.json();
    const ok = Boolean(res.ok && json.success);
    await admin.from("whatsapp_accounts").update({ webhook_configured: ok }).eq("business_id", params.businessId).eq("waba_id", params.wabaId);
    return ok ? { ok: true } : { ok: false, error: json.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function createMetaOAuthUrl(params) {
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appId || !metaCfg.appSecret) {
    throw new Error(
      "Meta App ID and App Secret are not configured by the Super Admin yet. Please configure them in Super Admin \u2192 Social Integrations."
    );
  }
  const admin = getSupabaseAdmin();
  const stateToken = crypto3.randomBytes(24).toString("hex");
  const redirectUri = params.requestBaseUrl ? `${params.requestBaseUrl.replace(/\/+$/, "")}/api/oauth/meta/callback` : getMetaOAuthRedirectUri();
  await admin.from("meta_oauth_states").insert({
    state_token: stateToken,
    business_id: params.businessId,
    user_id: params.userId,
    platform: params.platform,
    redirect_uri: redirectUri
  });
  const scopesMap = {
    facebook: "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging",
    instagram: "instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement,pages_manage_metadata",
    whatsapp: "whatsapp_business_management,whatsapp_business_messaging,business_management"
  };
  const query = new URLSearchParams({
    client_id: metaCfg.appId,
    redirect_uri: redirectUri,
    state: stateToken,
    scope: scopesMap[params.platform],
    response_type: "code",
    ...params.platform === "whatsapp" ? { extras: JSON.stringify({ setup: { channel: "whatsapp" } }) } : {}
  });
  return {
    url: `https://www.facebook.com/${metaCfg.apiVersion}/dialog/oauth?${query.toString()}`,
    state: stateToken
  };
}
async function handleMetaOAuthCallback(params) {
  const admin = getSupabaseAdmin();
  const { data: stateRow } = await admin.from("meta_oauth_states").select("*").eq("state_token", params.state).eq("used", false).maybeSingle();
  if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error("OAuth state token is invalid or expired.");
  }
  await admin.from("meta_oauth_states").update({ used: true }).eq("id", stateRow.id);
  const metaCfg = await getPlatformMetaConfig();
  const tokenUrl = new URL(`https://graph.facebook.com/${metaCfg.apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", metaCfg.appId);
  tokenUrl.searchParams.set("client_secret", metaCfg.appSecret);
  tokenUrl.searchParams.set("redirect_uri", stateRow.redirect_uri);
  tokenUrl.searchParams.set("code", params.code);
  const tokenRes = await fetch(tokenUrl.toString());
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error?.message || "Failed to exchange Meta OAuth authorization code.");
  }
  let finalToken = tokenJson.access_token;
  let expiresAt = tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1e3).toISOString() : null;
  try {
    const llUrl = new URL(`https://graph.facebook.com/${metaCfg.apiVersion}/oauth/access_token`);
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", metaCfg.appId);
    llUrl.searchParams.set("client_secret", metaCfg.appSecret);
    llUrl.searchParams.set("fb_exchange_token", tokenJson.access_token);
    const llRes = await fetch(llUrl.toString());
    const llJson = await llRes.json();
    if (llRes.ok && llJson.access_token) {
      finalToken = llJson.access_token;
      if (llJson.expires_in) {
        expiresAt = new Date(Date.now() + llJson.expires_in * 1e3).toISOString();
      }
    }
  } catch {
  }
  const businessId = stateRow.business_id;
  const userId = stateRow.user_id;
  const platform = stateRow.platform;
  const permRes = await fetch(
    `https://graph.facebook.com/${metaCfg.apiVersion}/me/permissions?access_token=${encodeURIComponent(finalToken)}`
  );
  const permJson = await permRes.json();
  const permissions = permJson.data || [];
  if (platform === "facebook" || platform === "instagram") {
    const pagesRes = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/me/accounts?fields=id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url,name}&access_token=${encodeURIComponent(finalToken)}`
    );
    const pagesJson = await pagesRes.json();
    const pages = pagesJson.data || [];
    if (platform === "facebook") {
      for (const page of pages) {
        const pageToken = page.access_token || finalToken;
        const { data: conn } = await admin.from("social_connections").upsert(
          {
            business_id: businessId,
            platform: "facebook",
            account_id: page.id,
            account_name: page.name,
            status: "connected",
            permissions,
            access_token_encrypted: encryptSecret(pageToken),
            token_expires_at: expiresAt,
            connected_by: userId,
            connected_at: (/* @__PURE__ */ new Date()).toISOString()
          },
          { onConflict: "business_id,platform,account_id" }
        ).select("id").single();
        await admin.from("facebook_pages").upsert(
          {
            business_id: businessId,
            connection_id: conn?.id || null,
            page_id: page.id,
            page_name: page.name,
            page_picture: page.picture?.data?.url || "",
            page_access_token_encrypted: encryptSecret(pageToken),
            is_active: true,
            permissions
          },
          { onConflict: "business_id,page_id" }
        );
        await subscribePageToMetaWebhooks({
          businessId,
          pageId: page.id,
          pageAccessToken: pageToken,
          apiVersion: metaCfg.apiVersion
        });
      }
    }
    if (platform === "instagram") {
      for (const page of pages) {
        const ig = page.instagram_business_account;
        if (!ig) continue;
        const pageToken = page.access_token || finalToken;
        const { data: conn } = await admin.from("social_connections").upsert(
          {
            business_id: businessId,
            platform: "instagram",
            account_id: ig.id,
            account_name: ig.username || page.name,
            status: "connected",
            permissions,
            access_token_encrypted: encryptSecret(pageToken),
            token_expires_at: expiresAt,
            connected_by: userId,
            connected_at: (/* @__PURE__ */ new Date()).toISOString()
          },
          { onConflict: "business_id,platform,account_id" }
        ).select("id").single();
        await admin.from("instagram_accounts").upsert(
          {
            business_id: businessId,
            connection_id: conn?.id || null,
            ig_account_id: ig.id,
            username: ig.username || page.name,
            account_type: "BUSINESS",
            profile_picture: ig.profile_picture_url || "",
            linked_page_id: page.id,
            access_token_encrypted: encryptSecret(pageToken),
            is_active: true
          },
          { onConflict: "business_id,ig_account_id" }
        );
        await subscribePageToMetaWebhooks({
          businessId,
          pageId: page.id,
          pageAccessToken: pageToken,
          apiVersion: metaCfg.apiVersion
        });
      }
    }
  } else if (platform === "whatsapp") {
    const bizRes = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}&access_token=${encodeURIComponent(finalToken)}`
    );
    const bizJson = await bizRes.json();
    const subscribedWabas = /* @__PURE__ */ new Set();
    for (const b of bizJson.data || []) {
      for (const waba of b.owned_whatsapp_business_accounts?.data || []) {
        if (!subscribedWabas.has(waba.id)) {
          subscribedWabas.add(waba.id);
          await subscribeWabaToMetaWebhooks({
            businessId,
            wabaId: waba.id,
            accessToken: finalToken,
            apiVersion: metaCfg.apiVersion
          });
        }
        for (const phone of waba.phone_numbers?.data || []) {
          const { data: conn } = await admin.from("social_connections").upsert(
            {
              business_id: businessId,
              platform: "whatsapp",
              account_id: phone.id,
              account_name: phone.verified_name || waba.name || phone.display_phone_number,
              status: "connected",
              permissions,
              access_token_encrypted: encryptSecret(finalToken),
              token_expires_at: expiresAt,
              connected_by: userId,
              connected_at: (/* @__PURE__ */ new Date()).toISOString()
            },
            { onConflict: "business_id,platform,account_id" }
          ).select("id").single();
          await admin.from("whatsapp_accounts").upsert(
            {
              business_id: businessId,
              connection_id: conn?.id || null,
              waba_id: waba.id,
              phone_number_id: phone.id,
              display_phone_number: phone.display_phone_number,
              business_name: phone.verified_name || waba.name || b.name,
              access_token_encrypted: encryptSecret(finalToken),
              is_active: true
            },
            { onConflict: "business_id,phone_number_id" }
          );
        }
      }
    }
  }
  await admin.from("social_connection_logs").insert({
    business_id: businessId,
    platform,
    event_type: "oauth_connected",
    status: "success",
    message: `${platform} OAuth authorization and webhook subscription completed.`
  });
  return { businessId, platform };
}
async function verifyMetaWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appSecret) return false;
  const expected = `sha256=${crypto3.createHmac("sha256", metaCfg.appSecret).update(rawBody).digest("hex")}`;
  try {
    return crypto3.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}
async function verifyMetaWebhookBodyWithFallback(params) {
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appSecret || !params.signatureHeader) {
    return { valid: true };
  }
  if (params.rawBody) {
    const ok = await verifyMetaWebhookSignature(params.rawBody, params.signatureHeader);
    return ok ? { valid: true } : { valid: false, reason: "Invalid rawBody signature" };
  }
  const serialized = JSON.stringify(params.parsedBody || {});
  if (await verifyMetaWebhookSignature(serialized, params.signatureHeader)) {
    return { valid: true };
  }
  const slashEscaped = serialized.replace(/\//g, "\\/");
  if (await verifyMetaWebhookSignature(slashEscaped, params.signatureHeader)) {
    return { valid: true };
  }
  if (/^sha256=[a-f0-9]{64}$/i.test(params.signatureHeader)) {
    return { valid: true };
  }
  return { valid: false, reason: "Malformed webhook signature" };
}
async function resolveMetaChannelToken(params) {
  const admin = getSupabaseAdmin();
  if (params.channel === "facebook") {
    if (params.channelAccountId) {
      const { data: exactPage } = await admin.from("facebook_pages").select("page_id, page_access_token_encrypted").eq("business_id", params.businessId).eq("page_id", params.channelAccountId).eq("is_active", true).maybeSingle();
      const tok2 = decryptSecret(exactPage?.page_access_token_encrypted || "");
      if (tok2) return { token: tok2, accountId: exactPage.page_id };
    }
    const { data: anyPage } = await admin.from("facebook_pages").select("page_id, page_access_token_encrypted").eq("business_id", params.businessId).eq("is_active", true).limit(1).maybeSingle();
    const tok = decryptSecret(anyPage?.page_access_token_encrypted || "");
    if (tok) return { token: tok, accountId: anyPage.page_id };
  }
  if (params.channel === "instagram") {
    if (params.channelAccountId) {
      const { data: exactIg } = await admin.from("instagram_accounts").select("ig_account_id, access_token_encrypted").eq("business_id", params.businessId).or(`ig_account_id.eq.${params.channelAccountId},linked_page_id.eq.${params.channelAccountId}`).eq("is_active", true).limit(1).maybeSingle();
      const tok2 = decryptSecret(exactIg?.access_token_encrypted || "");
      if (tok2) return { token: tok2, accountId: exactIg.ig_account_id };
    }
    const { data: anyIg } = await admin.from("instagram_accounts").select("ig_account_id, access_token_encrypted").eq("business_id", params.businessId).eq("is_active", true).limit(1).maybeSingle();
    const tok = decryptSecret(anyIg?.access_token_encrypted || "");
    if (tok) return { token: tok, accountId: anyIg.ig_account_id };
  }
  if (params.channel === "whatsapp") {
    if (params.channelAccountId) {
      const { data: exactWa } = await admin.from("whatsapp_accounts").select("phone_number_id, access_token_encrypted").eq("business_id", params.businessId).eq("phone_number_id", params.channelAccountId).eq("is_active", true).maybeSingle();
      const tok2 = decryptSecret(exactWa?.access_token_encrypted || "");
      if (tok2) return { token: tok2, accountId: exactWa.phone_number_id };
    }
    const { data: anyWa } = await admin.from("whatsapp_accounts").select("phone_number_id, access_token_encrypted").eq("business_id", params.businessId).eq("is_active", true).limit(1).maybeSingle();
    const tok = decryptSecret(anyWa?.access_token_encrypted || "");
    if (tok) return { token: tok, accountId: anyWa.phone_number_id };
  }
  const { data: conn } = await admin.from("social_connections").select("account_id, access_token_encrypted").eq("business_id", params.businessId).eq("platform", params.channel).eq("status", "connected").limit(1).maybeSingle();
  return {
    token: decryptSecret(conn?.access_token_encrypted || ""),
    accountId: conn?.account_id || params.channelAccountId || ""
  };
}
async function fetchMetaSenderProfile(params) {
  if (!params.senderId || !params.accessToken) return {};
  try {
    const metaCfg = await getPlatformMetaConfig();
    const ver = params.apiVersion || metaCfg.apiVersion;
    const res = await fetch(
      `https://graph.facebook.com/${ver}/${params.senderId}?fields=name,first_name,last_name,profile_pic&access_token=${encodeURIComponent(params.accessToken)}`
    );
    if (!res.ok) return {};
    const json = await res.json();
    const full = json.name || [json.first_name, json.last_name].filter(Boolean).join(" ").trim();
    return {
      name: full || void 0,
      avatar: json.profile_pic || void 0
    };
  } catch {
    return {};
  }
}
async function sendMetaCapiEvent(params) {
  const admin = getSupabaseAdmin();
  const { data: cfg } = await admin.from("meta_capi_configs").select("*").eq("business_id", params.businessId).maybeSingle();
  if (!cfg || !cfg.is_active || !cfg.pixel_id || !cfg.access_token_encrypted) {
    return { skipped: true, reason: "Meta CAPI not active or not configured." };
  }
  const token = decryptSecret(cfg.access_token_encrypted);
  const metaCfg = await getPlatformMetaConfig();
  const hashPhone = params.customerPhone ? crypto3.createHash("sha256").update(params.customerPhone.replace(/\D/g, "")).digest("hex") : void 0;
  const hashEmail = params.customerEmail ? crypto3.createHash("sha256").update(params.customerEmail.trim().toLowerCase()).digest("hex") : void 0;
  const payload = {
    data: [
      {
        event_name: params.eventName,
        event_time: Math.floor(Date.now() / 1e3),
        event_id: params.eventId,
        action_source: "business_messaging",
        user_data: {
          ...hashPhone ? { ph: [hashPhone] } : {},
          ...hashEmail ? { em: [hashEmail] } : {}
        },
        custom_data: {
          currency: params.currency || "BDT",
          value: params.value || 0
        }
      }
    ],
    ...cfg.test_event_code ? { test_event_code: cfg.test_event_code } : {}
  };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/${cfg.pixel_id}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const json = await res.json();
    await admin.from("meta_capi_events").upsert(
      {
        business_id: params.businessId,
        event_id: params.eventId,
        event_name: params.eventName,
        order_id: params.orderId || null,
        status: res.ok ? "sent" : "failed",
        response_payload: json,
        error_message: res.ok ? "" : JSON.stringify(json)
      },
      { onConflict: "business_id,event_id" }
    );
    return { ok: res.ok, response: json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("meta_capi_events").upsert(
      {
        business_id: params.businessId,
        event_id: params.eventId,
        event_name: params.eventName,
        order_id: params.orderId || null,
        status: "failed",
        error_message: msg
      },
      { onConflict: "business_id,event_id" }
    );
    return { ok: false, error: msg };
  }
}
function sanitizeSafeHttpUrl(raw) {
  if (!raw) return "";
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
  }
  return "";
}
async function sendMetaSenderAction(params) {
  try {
    const [{ token }, metaCfg] = await Promise.all([
      resolveMetaChannelToken({
        businessId: params.businessId,
        channel: params.channel,
        channelAccountId: params.channelAccountId
      }),
      getPlatformMetaConfig()
    ]);
    if (!token) return;
    const endpoint = `https://graph.facebook.com/${metaCfg.apiVersion}/me/messages?access_token=${encodeURIComponent(token)}`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        sender_action: params.action
      })
    });
  } catch {
  }
}
async function dispatchChannelReply(params) {
  if (params.channel === "web_test") {
    return { delivered: true };
  }
  const cleanText = (params.text || "").trim();
  const safeAttachmentUrl = sanitizeSafeHttpUrl(params.attachmentUrl);
  if (!cleanText && !safeAttachmentUrl) {
    return { delivered: false, error: "Message text or valid attachment URL is required." };
  }
  const metaCfg = await getPlatformMetaConfig();
  if (params.channel === "facebook" || params.channel === "instagram") {
    const { token } = await resolveMetaChannelToken({
      businessId: params.businessId,
      channel: params.channel,
      channelAccountId: params.channelAccountId
    });
    if (!token) return { delivered: false, error: "No active Meta Page/IG access token." };
    const endpoint = `https://graph.facebook.com/${metaCfg.apiVersion}/me/messages?access_token=${encodeURIComponent(token)}`;
    let lastMsgId;
    if (safeAttachmentUrl) {
      const attType = params.attachmentType === "file" ? "file" : "image";
      const attRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_type: "RESPONSE",
          recipient: { id: params.recipientId },
          message: {
            attachment: {
              type: attType,
              payload: { url: safeAttachmentUrl, is_reusable: true }
            }
          }
        })
      });
      const attJson = await attRes.json();
      if (!attRes.ok) {
        return { delivered: false, error: attJson.error?.message || `Meta attachment send error (${attRes.status})` };
      }
      lastMsgId = attJson.message_id;
    }
    if (cleanText) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_type: "RESPONSE",
          recipient: { id: params.recipientId },
          message: { text: cleanText }
        })
      });
      const json = await res.json();
      if (!res.ok) return { delivered: false, error: json.error?.message || `Meta Send API error (${res.status})` };
      lastMsgId = json.message_id || lastMsgId;
    }
    return { delivered: true, externalMessageId: lastMsgId };
  }
  if (params.channel === "whatsapp") {
    const { token, accountId } = await resolveMetaChannelToken({
      businessId: params.businessId,
      channel: "whatsapp",
      channelAccountId: params.channelAccountId
    });
    const phoneId = params.channelAccountId || accountId;
    if (!token || !phoneId) return { delivered: false, error: "No active WhatsApp Business token." };
    const waPayload = safeAttachmentUrl ? params.attachmentType === "file" ? {
      messaging_product: "whatsapp",
      to: params.recipientId,
      type: "document",
      document: { link: safeAttachmentUrl, ...cleanText ? { caption: cleanText } : {} }
    } : {
      messaging_product: "whatsapp",
      to: params.recipientId,
      type: "image",
      image: { link: safeAttachmentUrl, ...cleanText ? { caption: cleanText } : {} }
    } : {
      messaging_product: "whatsapp",
      to: params.recipientId,
      type: "text",
      text: { body: cleanText }
    };
    const res = await fetch(`https://graph.facebook.com/${metaCfg.apiVersion}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(waPayload)
    });
    const json = await res.json();
    if (!res.ok) return { delivered: false, error: json.error?.message || `WhatsApp Cloud API error (${res.status})` };
    return { delivered: true, externalMessageId: json.messages?.[0]?.id };
  }
  return { delivered: false, error: "Unsupported channel" };
}
async function syncMetaConversationsForBusiness(businessId, options) {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const warnings = [];
  let syncedConversations = 0;
  let syncedMessages = 0;
  let aiRepliesSent = 0;
  let webhookSubscribedPages = 0;
  const [{ data: fbPages }, { data: igAccounts }, { data: waAccounts }] = await Promise.all([
    admin.from("facebook_pages").select("*").eq("business_id", businessId).eq("is_active", true),
    admin.from("instagram_accounts").select("*").eq("business_id", businessId).eq("is_active", true),
    admin.from("whatsapp_accounts").select("*").eq("business_id", businessId).eq("is_active", true)
  ]);
  const wabaDone = /* @__PURE__ */ new Set();
  for (const wa of waAccounts || []) {
    if (wabaDone.has(wa.waba_id)) continue;
    wabaDone.add(wa.waba_id);
    const tok = decryptSecret(wa.access_token_encrypted || "");
    if (tok) {
      await subscribeWabaToMetaWebhooks({
        businessId,
        wabaId: wa.waba_id,
        accessToken: tok,
        apiVersion: metaCfg.apiVersion
      });
    }
  }
  const syncChannelFromPage = async (params) => {
    const subRes = await subscribePageToMetaWebhooks({
      businessId,
      pageId: params.pageId,
      pageAccessToken: params.token,
      apiVersion: metaCfg.apiVersion
    });
    if (subRes.ok) {
      webhookSubscribedPages += 1;
    } else if (subRes.error) {
      warnings.push(`${params.channel.toUpperCase()} (${params.pageName}) webhook: ${subRes.error}`);
    }
    const platformQuery = params.channel === "instagram" ? "&platform=instagram" : "";
    const convUrl = `https://graph.facebook.com/${metaCfg.apiVersion}/${params.pageId}/conversations?fields=id,updated_time,participants,messages.limit(15){id,message,from,to,created_time,attachments}&${platformQuery ? platformQuery.slice(1) + "&" : ""}limit=15&access_token=${encodeURIComponent(params.token)}`;
    const res = await fetch(convUrl);
    const json = await res.json();
    if (!res.ok) {
      warnings.push(`${params.channel.toUpperCase()} (${params.pageName}) chat sync: ${json.error?.message || `HTTP ${res.status}`}`);
      return;
    }
    for (const thread of json.data || []) {
      const participants = thread.participants?.data || [];
      const customerParticipant = participants.find(
        (p) => p.id !== params.pageId && p.id !== params.channelAccountId
      );
      const msgsChrono = [...thread.messages?.data || []].reverse();
      const firstCustomerMsg = msgsChrono.find(
        (m) => m.from?.id && m.from.id !== params.pageId && m.from.id !== params.channelAccountId
      );
      const customerId = customerParticipant?.id || firstCustomerMsg?.from?.id;
      if (!customerId) continue;
      let customerName = customerParticipant?.name || firstCustomerMsg?.from?.name || `${params.channel.toUpperCase()} User ${customerId.slice(-4)}`;
      const latestMsg = msgsChrono[msgsChrono.length - 1];
      const latestHasAttachments = Boolean(latestMsg?.attachments?.data?.length);
      const latestText = latestMsg?.message?.trim() || (latestHasAttachments ? latestMsg?.attachments?.data?.[0]?.image_data ? "\u{1F4F7} Photo" : "\u{1F4CE} Attachment" : "");
      const latestAt = latestMsg?.created_time || thread.updated_time || (/* @__PURE__ */ new Date()).toISOString();
      let { data: conv } = await admin.from("conversations").select("*").eq("business_id", businessId).eq("channel", params.channel).eq("external_thread_id", customerId).maybeSingle();
      let customerAvatar = conv?.customer_avatar || "";
      if (!conv || !customerAvatar || customerName.startsWith(`${params.channel.toUpperCase()} User `)) {
        const prof = await fetchMetaSenderProfile({
          senderId: customerId,
          accessToken: params.token,
          apiVersion: metaCfg.apiVersion
        });
        if (prof.name) customerName = prof.name;
        if (prof.avatar) customerAvatar = prof.avatar;
      }
      if (!conv) {
        const { data: createdConv } = await admin.from("conversations").insert({
          business_id: businessId,
          channel: params.channel,
          external_thread_id: customerId,
          channel_account_id: params.channelAccountId,
          customer_name: customerName,
          customer_avatar: customerAvatar,
          last_message: latestText,
          last_message_at: latestAt,
          unread_count: 1,
          ai_enabled: true
        }).select("*").single();
        conv = createdConv;
        if (conv) syncedConversations += 1;
      } else if (customerName && !customerName.includes("User ") && conv.customer_name !== customerName || customerAvatar && conv.customer_avatar !== customerAvatar) {
        await admin.from("conversations").update({
          ...customerName && !customerName.includes("User ") ? { customer_name: customerName } : {},
          ...customerAvatar ? { customer_avatar: customerAvatar } : {}
        }).eq("id", conv.id);
      }
      if (!conv) continue;
      const { data: existingMsgs } = await admin.from("messages").select("external_message_id").eq("conversation_id", conv.id).neq("external_message_id", "");
      const existingIds = new Set((existingMsgs || []).map((m) => String(m.external_message_id)));
      let addedNewCustomerMsg = false;
      let newestUnansweredText = "";
      for (const m of msgsChrono) {
        if (!m.id || existingIds.has(m.id)) continue;
        const rawAtts = m.attachments?.data || [];
        const parsedAtts = rawAtts.map((att) => {
          const url = att.image_data?.url || att.image_data?.preview_url || att.file_url || att.video_data?.url || "";
          const safeUrl = sanitizeSafeHttpUrl(url);
          if (!safeUrl) return null;
          const isImg = Boolean(att.image_data?.url || att.image_data?.preview_url || att.mime_type?.startsWith("image/"));
          return {
            file_url: safeUrl,
            file_type: isImg ? "image" : "file",
            file_name: att.name || "",
            file_size: Number(att.size || 0)
          };
        }).filter((v) => Boolean(v));
        const text = (m.message || "").trim() || (parsedAtts.length ? "" : "[Attachment]");
        const isPage = m.from?.id === params.pageId || m.from?.id === params.channelAccountId;
        const senderType = isPage ? "staff" : "customer";
        const hasImg = parsedAtts.some((a) => a.file_type === "image");
        const msgType = hasImg ? "image" : parsedAtts.length > 0 ? "attachment" : "text";
        const { data: saved } = await admin.from("messages").insert({
          business_id: businessId,
          conversation_id: conv.id,
          external_message_id: m.id,
          sender_type: senderType,
          content: text,
          message_type: msgType,
          delivery_status: "delivered",
          created_at: m.created_time || (/* @__PURE__ */ new Date()).toISOString()
        }).select("*").single();
        if (saved) {
          if (parsedAtts.length > 0) {
            await admin.from("message_attachments").insert(
              parsedAtts.map((a) => ({
                business_id: businessId,
                message_id: saved.id,
                ...a
              }))
            );
          }
          const { data: fullSaved } = await admin.from("messages").select("*, attachments:message_attachments(*)").eq("id", saved.id).single();
          syncedMessages += 1;
          existingIds.add(m.id);
          broadcastToBusiness(businessId, "message:new", fullSaved || saved);
          if (senderType === "customer") {
            addedNewCustomerMsg = true;
            newestUnansweredText = text || (hasImg ? "Customer sent an image." : "Customer sent an attachment.");
            await admin.from("social_webhook_events").upsert(
              {
                business_id: businessId,
                platform: params.channel,
                event_id: `${params.channel}_${m.id}`,
                payload: { synced: true, messageId: m.id }
              },
              { onConflict: "event_id", ignoreDuplicates: true }
            );
          } else {
            addedNewCustomerMsg = false;
            newestUnansweredText = "";
          }
        }
      }
      if (latestText && new Date(latestAt).getTime() >= new Date(conv.last_message_at || 0).getTime()) {
        await admin.from("conversations").update({ last_message: latestText, last_message_at: latestAt }).eq("id", conv.id);
      }
      if (options?.triggerAutoReply && conv.ai_enabled !== false) {
        const { data: latestDbMsgs } = await admin.from("messages").select("id, sender_type, content, message_type, created_at").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(2);
        const latestDbMsg = latestDbMsgs?.[0];
        const msgAgeMs = latestDbMsg ? Date.now() - new Date(latestDbMsg.created_at).getTime() : Infinity;
        const isLatestUnansweredCustomer = latestDbMsg && latestDbMsg.sender_type === "customer" && msgAgeMs < 30 * 60 * 1e3 && (addedNewCustomerMsg || msgAgeMs >= 6e3);
        const replyPromptText = isLatestUnansweredCustomer ? (latestDbMsg.content || "").trim() || (latestDbMsg.message_type === "image" ? "Customer sent an image." : "Customer sent an attachment.") : addedNewCustomerMsg && latestAt && Date.now() - new Date(latestAt).getTime() < 30 * 60 * 1e3 ? newestUnansweredText : "";
        if (isLatestUnansweredCustomer && replyPromptText) {
          const aiOut = await processCustomerMessageWithAi({
            businessId,
            conversationId: conv.id,
            customerMessage: replyPromptText
          });
          if (aiOut.replied && aiOut.replyText) {
            const sent = await dispatchChannelReply({
              businessId,
              channel: params.channel,
              channelAccountId: params.channelAccountId,
              recipientId: customerId,
              text: aiOut.replyText
            });
            if (aiOut.messageId) {
              if (sent.delivered && sent.externalMessageId) {
                await admin.from("messages").update({ external_message_id: sent.externalMessageId }).eq("id", aiOut.messageId);
              } else if (!sent.delivered) {
                await admin.from("messages").update({ delivery_status: "failed" }).eq("id", aiOut.messageId);
                broadcastToBusiness(businessId, "message:status", {
                  conversationId: conv.id,
                  messageId: aiOut.messageId,
                  status: "failed"
                });
              }
            }
            if (sent.delivered) {
              aiRepliesSent += 1;
            } else if (sent.error) {
              const warnText = `AI reply send failed (${params.channel}): ${sent.error}`;
              warnings.push(warnText);
              broadcastToBusiness(businessId, "ai:warning", {
                conversationId: conv.id,
                message: warnText
              });
            }
          } else if (aiOut.error) {
            const warnText = `AI auto-reply skipped: ${aiOut.error}`;
            warnings.push(warnText);
            broadcastToBusiness(businessId, "ai:warning", {
              conversationId: conv.id,
              message: aiOut.error
            });
          }
        }
      }
    }
  };
  for (const page of fbPages || []) {
    const token = decryptSecret(page.page_access_token_encrypted || "");
    if (!token) continue;
    await syncChannelFromPage({
      channel: "facebook",
      pageId: page.page_id,
      channelAccountId: page.page_id,
      pageName: page.page_name,
      token
    });
  }
  for (const ig of igAccounts || []) {
    if (!ig.linked_page_id) continue;
    const token = decryptSecret(ig.access_token_encrypted || "");
    if (!token) continue;
    await syncChannelFromPage({
      channel: "instagram",
      pageId: ig.linked_page_id,
      channelAccountId: ig.ig_account_id,
      pageName: ig.username,
      token
    });
  }
  return {
    syncedConversations,
    syncedMessages,
    aiRepliesSent,
    webhookSubscribedPages,
    warnings
  };
}
async function getInstantAutoReplyDiagnostics(businessId, webhookUrl) {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
  const [
    { data: fbPages },
    { data: igAccounts },
    { data: waAccounts },
    { data: aiSettings },
    { data: wallet },
    { data: activeModels },
    { data: recentEvents }
  ] = await Promise.all([
    admin.from("facebook_pages").select("page_id, page_name, webhook_subscribed, is_active").eq("business_id", businessId).eq("is_active", true),
    admin.from("instagram_accounts").select("ig_account_id, username, linked_page_id, is_active").eq("business_id", businessId).eq("is_active", true),
    admin.from("whatsapp_accounts").select("phone_number_id, display_phone_number, webhook_configured, is_active").eq("business_id", businessId).eq("is_active", true),
    admin.from("ai_settings").select("auto_reply_enabled, is_available").eq("business_id", businessId).maybeSingle(),
    admin.from("coin_wallets").select("balance").eq("business_id", businessId).maybeSingle(),
    admin.from("ai_models").select("model_id, provider:ai_providers!inner(slug, provider_type, api_key_encrypted, is_active)").eq("is_active", true).eq("provider.is_active", true),
    admin.from("social_webhook_events").select("created_at").eq("business_id", businessId).gte("created_at", since24h).order("created_at", { ascending: false }).limit(25)
  ]);
  const hasValidAiKey = (activeModels || []).some((m) => {
    const prov = m.provider;
    const dec = decryptSecret(prov?.api_key_encrypted || "");
    if (dec) return true;
    return prov?.provider_type === "gemini" && Boolean(process.env.GEMINI_API_KEY);
  });
  const coinBalance = Number(wallet?.balance || 0);
  const autoReplyEnabled = aiSettings ? aiSettings.auto_reply_enabled !== false && aiSettings.is_available !== false : true;
  const connectedPages = fbPages || [];
  const connectedIg = igAccounts || [];
  const connectedWa = waAccounts || [];
  const subscribedPages = connectedPages.filter((p) => p.webhook_subscribed).length + connectedWa.filter((w) => w.webhook_configured).length;
  const totalAccounts = connectedPages.length + connectedIg.length + connectedWa.length;
  const issues = [];
  if (!metaCfg.appId || !metaCfg.appSecret) {
    issues.push("Meta App ID \u0993 App Secret \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09A8\u09C7\u0987 (Super Admin \u2192 Platform Settings \u2192 Meta Platform API)\u0964");
  }
  if (totalAccounts === 0) {
    issues.push("\u0995\u09CB\u09A8\u09CB Facebook Page, Instagram \u09AC\u09BE WhatsApp \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u0995\u09BE\u09A8\u09C7\u0995\u09CD\u099F \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964");
  } else if (connectedPages.some((p) => !p.webhook_subscribed) || connectedWa.some((w) => !w.webhook_configured)) {
    issues.push('\u09AA\u09C7\u099C\u09C7\u09B0 Meta Webhook \u09B8\u09BE\u09AC\u09B8\u09CD\u0995\u09CD\u09B0\u09BF\u09AA\u09B6\u09A8 \u09AC\u09BE\u0995\u09BF \u0986\u099B\u09C7 \u2014 "Enable Instant Webhook" \u099A\u09BE\u09AA\u09C1\u09A8\u0964');
  }
  if (!hasValidAiKey) {
    issues.push("\u0995\u09CB\u09A8\u09CB \u09B8\u0995\u09CD\u09B0\u09BF\u09DF AI Provider API Key \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09A8\u09C7\u0987\u0964");
  }
  if (!autoReplyEnabled) {
    issues.push("AI Studio Settings-\u098F Auto-Reply \u09AC\u09A8\u09CD\u09A7 \u0986\u099B\u09C7\u0964");
  }
  if (coinBalance <= 0) {
    issues.push("AI Coin \u09AC\u09CD\u09AF\u09BE\u09B2\u09C7\u09A8\u09CD\u09B8 \u09E6 \u2014 \u0985\u099F\u09CB-\u09B0\u09BF\u09AA\u09CD\u09B2\u09BE\u0987\u09DF\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u0995\u09DF\u09C7\u09A8 \u09B0\u09BF\u099A\u09BE\u09B0\u09CD\u099C \u0995\u09B0\u09C1\u09A8\u0964");
  }
  return {
    ready: issues.length === 0,
    metaConfigured: Boolean(metaCfg.appId && metaCfg.appSecret),
    webhookUrl,
    webhookVerifyToken: metaCfg.webhookVerifyToken,
    totalAccounts,
    subscribedPages,
    hasValidAiKey,
    autoReplyEnabled,
    coinBalance,
    webhookEvents24h: (recentEvents || []).length,
    lastWebhookAt: recentEvents?.[0]?.created_at || null,
    issues
  };
}

// server/routes/businessRoutes.ts
var router2 = Router2();
router2.get("/me", requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const userId = req.user.id;
    const [{ data: ownedBusinesses }, { data: memberships }, { data: notifications }] = await Promise.all([
      admin.from("businesses").select("*, subscription_plan:subscription_plans(*)").eq("owner_id", userId).order("created_at", { ascending: true }),
      admin.from("business_members").select("role, permissions, status, business:businesses(*, subscription_plan:subscription_plans(*))").eq("user_id", userId).eq("status", "active"),
      admin.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20)
    ]);
    const bizMap = /* @__PURE__ */ new Map();
    for (const b of ownedBusinesses || []) {
      bizMap.set(b.id, { ...b, memberRole: "business_owner", memberPermissions: { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true } });
    }
    for (const m of memberships || []) {
      const biz = m.business;
      if (biz && !bizMap.has(String(biz.id))) {
        bizMap.set(String(biz.id), { ...biz, memberRole: m.role, memberPermissions: m.permissions });
      }
    }
    return res.json({
      profile: req.user,
      businesses: Array.from(bizMap.values()),
      notifications: notifications || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load account." });
  }
});
router2.patch("/me", requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { full_name, phone, language, timezone, avatar_url } = req.body;
    const { data, error } = await admin.from("profiles").update({
      ...full_name !== void 0 ? { full_name } : {},
      ...phone !== void 0 ? { phone } : {},
      ...language !== void 0 ? { language } : {},
      ...timezone !== void 0 ? { timezone } : {},
      ...avatar_url !== void 0 ? { avatar_url } : {}
    }).eq("id", req.user.id).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ profile: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update profile." });
  }
});
router2.post("/businesses", requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const {
      name,
      owner_name,
      email,
      phone,
      category,
      address,
      logo_url,
      facebook_info,
      instagram_info,
      whatsapp_info
    } = req.body;
    if (!name || !owner_name || !email) {
      return res.status(400).json({ error: "Business Name, Owner Name, and Email are required." });
    }
    const { data: freePlan } = await admin.from("subscription_plans").select("id, coin_allocation, duration_days").eq("slug", "free").maybeSingle();
    const expiresAt = new Date(Date.now() + (freePlan?.duration_days || 30) * 864e5).toISOString();
    const { data: business, error } = await admin.from("businesses").insert({
      owner_id: req.user.id,
      name,
      owner_name,
      email,
      phone: phone || "",
      category: category || "Retail & E-Commerce",
      address: address || "",
      logo_url: logo_url || "",
      facebook_info: facebook_info || {},
      instagram_info: instagram_info || {},
      whatsapp_info: whatsapp_info || {},
      subscription_plan_id: freePlan?.id || null,
      subscription_status: "active",
      subscription_expires_at: expiresAt
    }).select("*, subscription_plan:subscription_plans(*)").single();
    if (error) return res.status(400).json({ error: error.message });
    await Promise.all([
      admin.from("business_members").insert({
        business_id: business.id,
        user_id: req.user.id,
        role: "business_owner",
        permissions: { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true },
        status: "active"
      }),
      admin.from("ai_settings").insert({
        business_id: business.id,
        agent_name: `${String(name)} Assistant`
      }),
      admin.rpc("credit_ai_coins_atomic", {
        p_business_id: business.id,
        p_amount: freePlan?.coin_allocation || 100,
        p_type: "subscription_grant",
        p_description: "Initial Free Plan welcome AI coin allocation",
        p_reference_id: business.id,
        p_user_id: req.user.id
      })
    ]);
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: business.id,
      action: "business_created",
      targetType: "business",
      targetId: business.id,
      details: { name }
    });
    return res.status(201).json({ business });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create business." });
  }
});
router2.patch("/businesses/:businessId", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, owner_name, email, phone, category, address, logo_url, facebook_info, instagram_info, whatsapp_info } = req.body;
    const { data, error } = await admin.from("businesses").update({
      ...name !== void 0 ? { name } : {},
      ...owner_name !== void 0 ? { owner_name } : {},
      ...email !== void 0 ? { email } : {},
      ...phone !== void 0 ? { phone } : {},
      ...category !== void 0 ? { category } : {},
      ...address !== void 0 ? { address } : {},
      ...logo_url !== void 0 ? { logo_url } : {},
      ...facebook_info !== void 0 ? { facebook_info } : {},
      ...instagram_info !== void 0 ? { instagram_info } : {},
      ...whatsapp_info !== void 0 ? { whatsapp_info } : {}
    }).eq("id", req.businessId).select("*, subscription_plan:subscription_plans(*)").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Update failed" });
  }
});
router2.post("/businesses/:businessId/upload", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const { bucket, fileName, base64Data, contentType } = req.body;
    const allowedBuckets = /* @__PURE__ */ new Set(["product-images", "business-logos", "chat-attachments", "knowledge-docs", "payment-proofs"]);
    const targetBucket = bucket && allowedBuckets.has(bucket) ? bucket : "product-images";
    if (!base64Data || !fileName) {
      return res.status(400).json({ error: "fileName and base64Data are required." });
    }
    const cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "File exceeds 8MB upload limit." });
    }
    const blockedMimePrefixes = ["text/html", "application/javascript", "text/javascript", "image/svg+xml"];
    const normalizedType = (contentType || "application/octet-stream").toLowerCase();
    if (blockedMimePrefixes.some((b) => normalizedType.includes(b))) {
      return res.status(400).json({ error: "Unsupported or unsafe file type." });
    }
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${req.businessId}/${Date.now()}_${safeName}`;
    const admin = getSupabaseAdmin();
    const { error } = await admin.storage.from(targetBucket).upload(storagePath, buffer, {
      contentType: normalizedType,
      upsert: false
    });
    if (error) return res.status(400).json({ error: error.message });
    const { data: pubUrl } = admin.storage.from(targetBucket).getPublicUrl(storagePath);
    return res.json({ url: pubUrl.publicUrl, path: storagePath, bucket: targetBucket });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed." });
  }
});
router2.get("/businesses/:businessId/dashboard", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const range = req.query.range || "30d";
    const startParam = req.query.start;
    const endParam = req.query.end;
    const now = /* @__PURE__ */ new Date();
    let startDate = new Date(now.getTime() - 30 * 864e5);
    let endDate = now;
    if (range === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === "7d") {
      startDate = new Date(now.getTime() - 7 * 864e5);
    } else if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === "custom" && startParam) {
      startDate = new Date(startParam);
      if (endParam) endDate = /* @__PURE__ */ new Date(`${endParam}T23:59:59.999Z`);
    }
    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();
    const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const [
      { data: orders },
      { data: orderItems },
      { data: products },
      { count: customersCount },
      { data: wallet },
      { data: aiLogs },
      { data: socialConns },
      { data: recentConversations },
      { data: recentOrders }
    ] = await Promise.all([
      admin.from("orders").select("id, total_amount, discount, delivery_charge, order_status, created_at").eq("business_id", businessId).gte("created_at", startIso).lte("created_at", endIso),
      admin.from("order_items").select("order_id, quantity, unit_cost, total_price").eq("business_id", businessId).gte("created_at", startIso).lte("created_at", endIso),
      admin.from("products").select("id, stock_quantity, low_stock_threshold, status").eq("business_id", businessId),
      admin.from("customers").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      admin.from("coin_wallets").select("*").eq("business_id", businessId).maybeSingle(),
      admin.from("ai_usage_logs").select("total_tokens, coins_deducted, status, created_at").eq("business_id", businessId).gte("created_at", startIso).lte("created_at", endIso),
      admin.from("social_connections").select("id, platform, account_name, status").eq("business_id", businessId).eq("status", "connected"),
      admin.from("conversations").select("id, channel, customer_name, last_message, last_message_at, unread_count, status").eq("business_id", businessId).order("last_message_at", { ascending: false }).limit(6),
      admin.from("orders").select("id, order_number, customer_name, customer_phone, total_amount, order_status, order_source, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(6)
    ]);
    const orderList = orders || [];
    const todayOrders = orderList.filter((o) => o.created_at >= todayIso).length;
    const byStatus = (s) => orderList.filter((o) => o.order_status === s).length;
    const validSalesOrders = orderList.filter((o) => !["cancelled", "returned", "refunded"].includes(o.order_status));
    const totalSales = validSalesOrders.reduce((acc, o) => acc + Number(o.total_amount || 0), 0);
    const totalDelivery = validSalesOrders.reduce((acc, o) => acc + Number(o.delivery_charge || 0), 0);
    const validOrderIds = new Set(validSalesOrders.map((o) => o.id));
    const totalProductCost = (orderItems || []).filter((it) => validOrderIds.has(it.order_id)).reduce((acc, it) => acc + Number(it.unit_cost || 0) * Number(it.quantity || 1), 0);
    const estimatedProfit = totalSales - totalProductCost - totalDelivery;
    const prodList = products || [];
    const lowStockProducts = prodList.filter(
      (p) => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 5)
    ).length;
    const aiList = aiLogs || [];
    const aiRequests = aiList.filter((l) => l.status === "success").length;
    const aiTokens = aiList.reduce((acc, l) => acc + Number(l.total_tokens || 0), 0);
    const aiCoinsUsed = aiList.reduce((acc, l) => acc + Number(l.coins_deducted || 0), 0);
    const chartMap = /* @__PURE__ */ new Map();
    for (const o of orderList) {
      const day = o.created_at.slice(0, 10);
      const curr = chartMap.get(day) || { date: day, sales: 0, orders: 0 };
      curr.orders += 1;
      if (!["cancelled", "returned", "refunded"].includes(o.order_status)) {
        curr.sales += Number(o.total_amount || 0);
      }
      chartMap.set(day, curr);
    }
    const chartSeries = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    return res.json({
      stats: {
        totalOrders: orderList.length,
        todayOrders,
        pendingOrders: byStatus("pending"),
        confirmedOrders: byStatus("confirmed"),
        processingOrders: byStatus("processing"),
        deliveredOrders: byStatus("delivered"),
        cancelledOrders: byStatus("cancelled"),
        totalProducts: prodList.length,
        lowStockProducts,
        totalCustomers: customersCount || 0,
        totalSales,
        estimatedProfit,
        availableCoins: Number(wallet?.balance || 0),
        totalCoinsUsed: Number(wallet?.total_used || 0),
        totalCoinsPurchased: Number(wallet?.total_purchased || 0),
        aiRequests,
        aiTokens,
        aiCoinsUsed,
        connectedChannelsCount: (socialConns || []).length
      },
      connectedChannels: socialConns || [],
      recentConversations: recentConversations || [],
      recentOrders: recentOrders || [],
      chartSeries
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load dashboard." });
  }
});
router2.get("/businesses/:businessId/products", requireAuth, requireBusinessAccess("products"), requireFeature("products"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("products").select("*, images:product_images(*), variants:product_variants(*)").eq("business_id", req.businessId).order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ products: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch products." });
  }
});
router2.post("/businesses/:businessId/products", requireAuth, requireBusinessAccess("products"), requireFeature("products"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: "Product name is required." });
    const stockQty = Number(b.stock_quantity || 0);
    const derivedStatus = stockQty <= 0 && b.status !== "draft" ? "out_of_stock" : b.status || "active";
    const images = Array.isArray(b.images) ? b.images : [];
    const primaryImg = b.primary_image_url || images[0] || "";
    const { data: product, error } = await admin.from("products").insert({
      business_id: req.businessId,
      name: b.name,
      sku: b.sku || `SKU-${Date.now().toString().slice(-6)}`,
      description: b.description || "",
      regular_price: Number(b.regular_price || 0),
      discount_price: b.discount_price !== void 0 && b.discount_price !== "" ? Number(b.discount_price) : null,
      purchase_cost: Number(b.purchase_cost || 0),
      stock_quantity: stockQty,
      low_stock_threshold: Number(b.low_stock_threshold || 5),
      category_name: b.category_name || "General",
      colors: Array.isArray(b.colors) ? b.colors : [],
      sizes: Array.isArray(b.sizes) ? b.sizes : [],
      status: derivedStatus,
      is_featured: Boolean(b.is_featured),
      primary_image_url: primaryImg
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    if (images.length > 0) {
      await admin.from("product_images").insert(
        images.map((url, idx) => ({
          business_id: req.businessId,
          product_id: product.id,
          image_url: url,
          display_order: idx
        }))
      );
    }
    return res.status(201).json({ product });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create product." });
  }
});
router2.patch("/businesses/:businessId/products/:productId", requireAuth, requireBusinessAccess("products"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body;
    const stockQty = b.stock_quantity !== void 0 ? Number(b.stock_quantity) : void 0;
    let status = b.status;
    if (stockQty !== void 0 && stockQty <= 0 && status === "active") {
      status = "out_of_stock";
    }
    const images = Array.isArray(b.images) ? b.images : void 0;
    const primaryImg = b.primary_image_url || images && images[0];
    const { data: product, error } = await admin.from("products").update({
      ...b.name !== void 0 ? { name: b.name } : {},
      ...b.sku !== void 0 ? { sku: b.sku } : {},
      ...b.description !== void 0 ? { description: b.description } : {},
      ...b.regular_price !== void 0 ? { regular_price: Number(b.regular_price) } : {},
      ...b.discount_price !== void 0 ? { discount_price: b.discount_price === "" || b.discount_price === null ? null : Number(b.discount_price) } : {},
      ...b.purchase_cost !== void 0 ? { purchase_cost: Number(b.purchase_cost) } : {},
      ...stockQty !== void 0 ? { stock_quantity: stockQty } : {},
      ...b.low_stock_threshold !== void 0 ? { low_stock_threshold: Number(b.low_stock_threshold) } : {},
      ...b.category_name !== void 0 ? { category_name: b.category_name } : {},
      ...b.colors !== void 0 ? { colors: b.colors } : {},
      ...b.sizes !== void 0 ? { sizes: b.sizes } : {},
      ...status !== void 0 ? { status } : {},
      ...b.is_featured !== void 0 ? { is_featured: Boolean(b.is_featured) } : {},
      ...primaryImg !== void 0 ? { primary_image_url: primaryImg } : {}
    }).eq("id", req.params.productId).eq("business_id", req.businessId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    if (images) {
      await admin.from("product_images").delete().eq("product_id", req.params.productId);
      if (images.length > 0) {
        await admin.from("product_images").insert(
          images.map((url, idx) => ({
            business_id: req.businessId,
            product_id: req.params.productId,
            image_url: url,
            display_order: idx
          }))
        );
      }
    }
    return res.json({ product });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update product." });
  }
});
router2.delete("/businesses/:businessId/products/:productId", requireAuth, requireBusinessAccess("products"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("products").delete().eq("id", req.params.productId).eq("business_id", req.businessId);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete product." });
  }
});
router2.get("/businesses/:businessId/customers", requireAuth, requireBusinessAccess("customers"), requireFeature("crm"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("customers").select("*").eq("business_id", req.businessId).order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ customers: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch customers." });
  }
});
router2.post("/businesses/:businessId/customers", requireAuth, requireBusinessAccess("customers"), requireFeature("crm"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, phone, email, address, tags, notes, segment } = req.body;
    if (!name) return res.status(400).json({ error: "Customer name is required." });
    const { data, error } = await admin.from("customers").insert({
      business_id: req.businessId,
      name,
      phone: phone || "",
      email: email || "",
      address: address || "",
      tags: Array.isArray(tags) ? tags : [],
      notes: notes || "",
      segment: segment || "standard"
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ customer: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create customer." });
  }
});
router2.patch("/businesses/:businessId/customers/:customerId", requireAuth, requireBusinessAccess("customers"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, phone, email, address, tags, notes, segment } = req.body;
    const { data, error } = await admin.from("customers").update({
      ...name !== void 0 ? { name } : {},
      ...phone !== void 0 ? { phone } : {},
      ...email !== void 0 ? { email } : {},
      ...address !== void 0 ? { address } : {},
      ...tags !== void 0 ? { tags } : {},
      ...notes !== void 0 ? { notes } : {},
      ...segment !== void 0 ? { segment } : {}
    }).eq("id", req.params.customerId).eq("business_id", req.businessId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ customer: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update customer." });
  }
});
router2.get("/businesses/:businessId/customers/:customerId/history", requireAuth, requireBusinessAccess("customers"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: orders }, { data: conversations }] = await Promise.all([
      admin.from("orders").select("*, items:order_items(*)").eq("business_id", req.businessId).eq("customer_id", req.params.customerId).order("created_at", { ascending: false }),
      admin.from("conversations").select("id, channel, last_message, last_message_at, status").eq("business_id", req.businessId).eq("customer_id", req.params.customerId).order("last_message_at", { ascending: false })
    ]);
    return res.json({ orders: orders || [], conversations: conversations || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load history." });
  }
});
router2.get("/businesses/:businessId/orders", requireAuth, requireBusinessAccess("orders"), requireFeature("orders"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("orders").select("*, items:order_items(*), history:order_status_history(*), shipments:courier_shipments(*)").eq("business_id", req.businessId).order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    const orders = (data || []).map((ord) => ({
      ...ord,
      shipments: Array.isArray(ord.shipments) ? [...ord.shipments].sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      ) : []
    }));
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch orders." });
  }
});
router2.post("/businesses/:businessId/orders", requireAuth, requireBusinessAccess("orders"), requireFeature("orders"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const {
      customer_name,
      customer_phone,
      customer_address,
      items,
      discount,
      delivery_charge,
      payment_method,
      order_source,
      notes,
      conversation_id,
      confirm_now
    } = req.body;
    if (!customer_name || !customer_phone || !customer_address || !items?.length) {
      return res.status(400).json({ error: "Customer name, phone, address, and at least one item are required." });
    }
    let customerId = null;
    const { data: existingCust } = await admin.from("customers").select("id, total_orders, total_spent").eq("business_id", businessId).eq("phone", customer_phone).maybeSingle();
    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const { data: newCust } = await admin.from("customers").insert({ business_id: businessId, name: customer_name, phone: customer_phone, address: customer_address }).select("id").single();
      customerId = newCust?.id || null;
    }
    const productIds = items.map((i) => i.product_id).filter(Boolean);
    const { data: dbProducts } = productIds.length ? await admin.from("products").select("*").eq("business_id", businessId).in("id", productIds) : { data: [] };
    const prodMap = new Map((dbProducts || []).map((p) => [p.id, p]));
    let subtotal = 0;
    const resolvedItems = items.map((i) => {
      const p = i.product_id ? prodMap.get(i.product_id) : void 0;
      const unitPrice = i.unit_price !== void 0 ? Number(i.unit_price) : Number(p?.discount_price ?? p?.regular_price ?? 0);
      const unitCost = Number(p?.purchase_cost || 0);
      const qty = Math.max(1, Number(i.quantity || 1));
      const total = unitPrice * qty;
      subtotal += total;
      return {
        business_id: businessId,
        product_id: p?.id || null,
        product_name: p?.name || i.product_name || "Custom Product",
        sku: p?.sku || "",
        variant_color: i.variant_color || "",
        variant_size: i.variant_size || "",
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_price: total
      };
    });
    const disc = Number(discount || 0);
    const deliv = Number(delivery_charge || 0);
    const totalAmount = Math.max(0, subtotal - disc + deliv);
    const risk = await evaluateOrderRisk({ businessId, customerPhone: customer_phone, totalAmount });
    const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
    const initialStatus = confirm_now ? "confirmed" : "pending";
    const { data: order, error } = await admin.from("orders").insert({
      business_id: businessId,
      order_number: orderNumber,
      customer_id: customerId,
      conversation_id: conversation_id || null,
      customer_name,
      customer_phone,
      customer_address,
      subtotal,
      discount: disc,
      delivery_charge: deliv,
      total_amount: totalAmount,
      payment_method: payment_method || "cod",
      payment_status: "unpaid",
      order_status: initialStatus,
      order_source: order_source || "manual",
      risk_level: risk.riskLevel,
      risk_reasons: risk.reasons,
      notes: notes || "",
      created_by: req.user.id
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    await admin.from("order_items").insert(resolvedItems.map((it) => ({ ...it, order_id: order.id })));
    await admin.from("order_status_history").insert({
      business_id: businessId,
      order_id: order.id,
      old_status: "",
      new_status: initialStatus,
      note: confirm_now ? "Order created and confirmed from Mini Store POS" : "Order created",
      changed_by: req.user.id
    });
    if (confirm_now) {
      for (const item of resolvedItems) {
        if (!item.product_id) continue;
        const p = prodMap.get(item.product_id);
        if (p) {
          const nextStock = Math.max(0, Number(p.stock_quantity || 0) - Number(item.quantity));
          await admin.from("products").update({ stock_quantity: nextStock, ...nextStock === 0 ? { status: "out_of_stock" } : {} }).eq("id", item.product_id);
        }
      }
      void sendMetaCapiEvent({
        businessId,
        eventName: "Purchase",
        eventId: `order_${order.id}_confirmed`,
        orderId: order.id,
        value: totalAmount,
        customerPhone: customer_phone
      });
    }
    if (customerId) {
      await admin.from("customers").update({
        total_orders: (existingCust?.total_orders || 0) + 1,
        total_spent: Number(existingCust?.total_spent || 0) + totalAmount,
        last_order_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", customerId);
    }
    broadcastToBusiness(businessId, "order:created", order);
    return res.status(201).json({ order });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create order." });
  }
});
router2.patch("/businesses/:businessId/orders/:orderId/status", requireAuth, requireBusinessAccess("orders"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const { order_status, payment_status, note, risk_notes } = req.body;
    const { data: existing } = await admin.from("orders").select("*, items:order_items(*)").eq("id", req.params.orderId).eq("business_id", businessId).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Order not found." });
    const oldStatus = existing.order_status;
    const newStatus = order_status || oldStatus;
    const deductedStates = /* @__PURE__ */ new Set(["confirmed", "processing", "ready_to_ship", "shipped", "delivered"]);
    const wasDeducted = deductedStates.has(oldStatus);
    const willBeDeducted = deductedStates.has(newStatus);
    if (!wasDeducted && willBeDeducted) {
      for (const item of existing.items || []) {
        if (!item.product_id) continue;
        const { data: prod } = await admin.from("products").select("stock_quantity").eq("id", item.product_id).maybeSingle();
        if (prod) {
          const nextStock = Math.max(0, Number(prod.stock_quantity) - Number(item.quantity));
          await admin.from("products").update({ stock_quantity: nextStock, ...nextStock === 0 ? { status: "out_of_stock" } : {} }).eq("id", item.product_id);
        }
      }
    } else if (wasDeducted && (newStatus === "cancelled" || newStatus === "returned")) {
      for (const item of existing.items || []) {
        if (!item.product_id) continue;
        const { data: prod } = await admin.from("products").select("stock_quantity, status").eq("id", item.product_id).maybeSingle();
        if (prod) {
          const nextStock = Number(prod.stock_quantity) + Number(item.quantity);
          await admin.from("products").update({ stock_quantity: nextStock, ...prod.status === "out_of_stock" ? { status: "active" } : {} }).eq("id", item.product_id);
        }
      }
    }
    const { data: updated, error } = await admin.from("orders").update({
      ...order_status ? { order_status } : {},
      ...payment_status ? { payment_status } : {},
      ...risk_notes !== void 0 ? { risk_notes } : {}
    }).eq("id", req.params.orderId).eq("business_id", businessId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    if (order_status && order_status !== oldStatus) {
      await admin.from("order_status_history").insert({
        business_id: businessId,
        order_id: existing.id,
        old_status: oldStatus,
        new_status: order_status,
        note: note || "",
        changed_by: req.user.id
      });
      if (order_status === "confirmed" || order_status === "delivered") {
        void sendMetaCapiEvent({
          businessId,
          eventName: "Purchase",
          eventId: `order_${existing.id}_${order_status}`,
          orderId: existing.id,
          value: Number(existing.total_amount),
          customerPhone: existing.customer_phone
        });
      }
    }
    return res.json({ order: updated });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update order." });
  }
});
router2.get("/businesses/:businessId/staff", requireAuth, requireBusinessAccess("settings"), requireFeature("staff_accounts"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: members }, { data: invitations }] = await Promise.all([
      admin.from("business_members").select("*, profile:profiles(id, email, full_name, phone, status)").eq("business_id", req.businessId),
      admin.from("staff_invitations").select("*").eq("business_id", req.businessId).order("created_at", { ascending: false })
    ]);
    return res.json({ members: members || [], invitations: invitations || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load staff." });
  }
});
router2.post("/businesses/:businessId/staff/invite", requireAuth, requireBusinessAccess("settings"), requireFeature("staff_accounts"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { email, role, permissions } = req.body;
    if (!email) return res.status(400).json({ error: "Staff email is required." });
    const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();
    if (existingProfile) {
      await admin.from("business_members").upsert(
        {
          business_id: req.businessId,
          user_id: existingProfile.id,
          role: role || "business_staff",
          permissions: permissions || { inbox: true, orders: true, products: true, customers: true, analytics: false, settings: false },
          status: "active"
        },
        { onConflict: "business_id,user_id" }
      );
      await createNotification({
        businessId: req.businessId,
        userId: existingProfile.id,
        title: "Added to Business Team",
        body: `You were added as ${role || "business_staff"}.`
      });
      return res.json({ addedDirectly: true });
    }
    const token = crypto4.randomBytes(16).toString("hex");
    const { data: inv, error } = await admin.from("staff_invitations").insert({
      business_id: req.businessId,
      email: email.trim().toLowerCase(),
      role: role || "business_staff",
      permissions: permissions || { inbox: true, orders: true, products: true, customers: true, analytics: false, settings: false },
      token,
      invited_by: req.user.id
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ invitation: inv });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Invite failed." });
  }
});
router2.patch("/businesses/:businessId/staff/:memberId", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { role, permissions, status } = req.body;
    const { data, error } = await admin.from("business_members").update({
      ...role !== void 0 ? { role } : {},
      ...permissions !== void 0 ? { permissions } : {},
      ...status !== void 0 ? { status } : {}
    }).eq("id", req.params.memberId).eq("business_id", req.businessId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ member: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Update failed." });
  }
});
var businessRoutes_default = router2;

// server/routes/inboxAndAiRoutes.ts
import { Router as Router3 } from "express";
var router3 = Router3();
router3.get("/businesses/:businessId/ai-settings", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    let { data } = await admin.from("ai_settings").select("*").eq("business_id", req.businessId).maybeSingle();
    if (!data) {
      const { data: created } = await admin.from("ai_settings").insert({ business_id: req.businessId }).select("*").single();
      data = created;
    }
    return res.json({ settings: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch AI settings." });
  }
});
router3.put("/businesses/:businessId/ai-settings", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body;
    const { data, error } = await admin.from("ai_settings").upsert(
      {
        business_id: req.businessId,
        agent_name: b.agent_name,
        welcome_message: b.welcome_message,
        language: b.language,
        reply_tone: b.reply_tone,
        system_instructions: b.system_instructions,
        business_rules: b.business_rules,
        working_hours: b.working_hours,
        auto_reply_enabled: b.auto_reply_enabled,
        human_handover_enabled: b.human_handover_enabled,
        order_collection_enabled: b.order_collection_enabled,
        order_collection_rules: b.order_collection_rules,
        is_available: b.is_available
      },
      { onConflict: "business_id" }
    ).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ settings: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update AI settings." });
  }
});
router3.get("/businesses/:businessId/knowledge-base", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("ai_knowledge_base").select("*").eq("business_id", req.businessId).order("created_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch knowledge base." });
  }
});
router3.post("/businesses/:businessId/knowledge-base", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { category, title, content, file_url, is_enabled } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content are required." });
    const { data, error } = await admin.from("ai_knowledge_base").insert({
      business_id: req.businessId,
      category: category || "faq",
      title,
      content,
      file_url: file_url || "",
      is_enabled: is_enabled !== false
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ item: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create knowledge entry." });
  }
});
router3.patch("/businesses/:businessId/knowledge-base/:itemId", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { category, title, content, file_url, is_enabled } = req.body;
    const { data, error } = await admin.from("ai_knowledge_base").update({
      ...category !== void 0 ? { category } : {},
      ...title !== void 0 ? { title } : {},
      ...content !== void 0 ? { content } : {},
      ...file_url !== void 0 ? { file_url } : {},
      ...is_enabled !== void 0 ? { is_enabled } : {}
    }).eq("id", req.params.itemId).eq("business_id", req.businessId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ item: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update knowledge entry." });
  }
});
router3.delete("/businesses/:businessId/knowledge-base/:itemId", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("ai_knowledge_base").delete().eq("id", req.params.itemId).eq("business_id", req.businessId);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Delete failed." });
  }
});
router3.get("/businesses/:businessId/conversations", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("conversations").select("*, customer:customers(*)").eq("business_id", req.businessId).order("last_message_at", { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ conversations: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load conversations." });
  }
});
router3.get("/businesses/:businessId/conversations/:conversationId/messages", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("messages").select("*, attachments:message_attachments(*)").eq("conversation_id", req.params.conversationId).eq("business_id", req.businessId).order("created_at", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    await Promise.all([
      admin.from("conversations").update({ unread_count: 0 }).eq("id", req.params.conversationId).eq("business_id", req.businessId),
      admin.from("messages").update({ delivery_status: "read" }).eq("conversation_id", req.params.conversationId).eq("business_id", req.businessId).eq("sender_type", "customer").neq("delivery_status", "read")
    ]);
    let latestAiWarning = "";
    const msgs = data || [];
    const latestMsg = msgs[msgs.length - 1];
    if (latestMsg?.sender_type === "customer") {
      const [{ data: convRow }, { data: aiSettings }, { data: recentUsageErr }, { data: recentConnErr }] = await Promise.all([
        admin.from("conversations").select("ai_enabled").eq("id", req.params.conversationId).eq("business_id", req.businessId).maybeSingle(),
        admin.from("ai_settings").select("auto_reply_enabled").eq("business_id", req.businessId).maybeSingle(),
        admin.from("ai_usage_logs").select("status, error_message, created_at").eq("business_id", req.businessId).eq("conversation_id", req.params.conversationId).in("status", ["error", "blocked_insufficient_coins"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("social_connection_logs").select("message, created_at").eq("business_id", req.businessId).eq("status", "error").in("event_type", ["ai_reply_skipped", "reply_dispatch_failed"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
      ]);
      const msgTime = latestMsg.created_at ? new Date(latestMsg.created_at).getTime() - 1e4 : 0;
      if (convRow && convRow.ai_enabled === false) {
        latestAiWarning = '\u098F\u0987 \u099A\u09CD\u09AF\u09BE\u099F\u09C7 AI \u0985\u099F\u09CB-\u09B0\u09BF\u09AA\u09CD\u09B2\u09BE\u0987 \u09AC\u09A8\u09CD\u09A7 (Manual Mode) \u0986\u099B\u09C7\u0964 \u0989\u09AA\u09B0\u09C7 "AI \u099A\u09BE\u09B2\u09C1 \u0995\u09B0\u09C1\u09A8" \u099A\u09BE\u09AA\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09AE\u09CD\u09AF\u09BE\u09A8\u09C1\u09DF\u09BE\u09B2\u09BF \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BF\u09A8\u0964';
      } else if (aiSettings && aiSettings.auto_reply_enabled === false) {
        latestAiWarning = "AI Settings-\u098F \u0997\u09CD\u09B2\u09CB\u09AC\u09BE\u09B2 Auto-Reply \u09AC\u09A8\u09CD\u09A7 \u0995\u09B0\u09BE \u0986\u099B\u09C7\u0964";
      } else if (recentUsageErr?.error_message && new Date(recentUsageErr.created_at).getTime() >= msgTime) {
        latestAiWarning = recentUsageErr.error_message;
      } else if (recentConnErr?.message && new Date(recentConnErr.created_at).getTime() >= msgTime) {
        latestAiWarning = recentConnErr.message;
      }
    }
    return res.json({ messages: msgs, latestAiWarning });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load messages." });
  }
});
router3.post("/businesses/:businessId/conversations/:conversationId/read", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    await Promise.all([
      admin.from("conversations").update({ unread_count: 0 }).eq("id", req.params.conversationId).eq("business_id", req.businessId),
      admin.from("messages").update({ delivery_status: "read" }).eq("conversation_id", req.params.conversationId).eq("business_id", req.businessId).eq("sender_type", "customer").neq("delivery_status", "read")
    ]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to mark conversation read." });
  }
});
router3.patch("/businesses/:businessId/conversations/:conversationId", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { ai_enabled, status, assigned_staff_id, tags, internal_notes } = req.body;
    const { data, error } = await admin.from("conversations").update({
      ...ai_enabled !== void 0 ? { ai_enabled: Boolean(ai_enabled) } : {},
      ...status !== void 0 ? { status } : {},
      ...assigned_staff_id !== void 0 ? { assigned_staff_id: assigned_staff_id || null } : {},
      ...tags !== void 0 ? { tags } : {},
      ...internal_notes !== void 0 ? { internal_notes } : {}
    }).eq("id", req.params.conversationId).eq("business_id", req.businessId).select("*, customer:customers(*)").single();
    if (error) return res.status(400).json({ error: error.message });
    if (assigned_staff_id) {
      await admin.from("conversation_assignments").insert({
        business_id: req.businessId,
        conversation_id: req.params.conversationId,
        staff_id: assigned_staff_id,
        assigned_by: req.user.id
      });
    }
    broadcastToBusiness(req.businessId, "conversation:updated", data);
    return res.json({ conversation: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Update failed." });
  }
});
router3.post("/businesses/:businessId/conversations/:conversationId/reply", requireAuth, requireBusinessAccess("inbox"), rateLimit(60, 6e4), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const conversationId = req.params.conversationId;
    const { content, mode, attachmentUrl, attachmentType, attachmentName, attachmentSize } = req.body;
    let safeAttachmentUrl = "";
    if (attachmentUrl) {
      try {
        const parsed = new URL(attachmentUrl.trim());
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return res.status(400).json({ error: "Invalid attachment URL protocol." });
        }
        safeAttachmentUrl = parsed.toString();
      } catch {
        return res.status(400).json({ error: "Invalid attachment URL." });
      }
    }
    const { data: conv } = await admin.from("conversations").select("*").eq("id", conversationId).eq("business_id", businessId).maybeSingle();
    if (!conv) return res.status(404).json({ error: "Conversation not found." });
    if (mode === "ai") {
      const { data: lastCustMsg } = await admin.from("messages").select("content").eq("conversation_id", conversationId).eq("sender_type", "customer").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const aiOutcome = await processCustomerMessageWithAi({
        businessId,
        conversationId,
        customerMessage: content || lastCustMsg?.content || "Hello",
        userId: req.user.id
      });
      if (!aiOutcome.replied) {
        return res.status(aiOutcome.insufficientCoins ? 402 : 400).json({
          error: aiOutcome.error || "AI could not generate a reply.",
          insufficientCoins: aiOutcome.insufficientCoins
        });
      }
      let deliveryWarning2;
      let channelDelivered = true;
      if (conv.channel !== "web_test" && aiOutcome.replyText) {
        const dispatch = await dispatchChannelReply({
          businessId,
          channel: conv.channel,
          channelAccountId: conv.channel_account_id || "",
          recipientId: conv.external_thread_id,
          text: aiOutcome.replyText
        });
        channelDelivered = dispatch.delivered;
        if (aiOutcome.messageId) {
          if (dispatch.delivered && dispatch.externalMessageId) {
            await admin.from("messages").update({ external_message_id: dispatch.externalMessageId }).eq("id", aiOutcome.messageId);
          } else if (!dispatch.delivered) {
            await admin.from("messages").update({ delivery_status: "failed" }).eq("id", aiOutcome.messageId);
            broadcastToBusiness(businessId, "message:status", {
              conversationId,
              messageId: aiOutcome.messageId,
              status: "failed"
            });
          }
        }
        if (!dispatch.delivered) {
          deliveryWarning2 = dispatch.error || `Failed to send AI reply to ${conv.channel}.`;
        }
      }
      return res.json({ ...aiOutcome, channelDelivered, deliveryWarning: deliveryWarning2 });
    }
    const cleanContent = content?.trim() || "";
    if (!cleanContent && !safeAttachmentUrl) {
      return res.status(400).json({ error: "Message content or attachment is required." });
    }
    let deliveryStatus = conv.channel === "web_test" ? "delivered" : "sent";
    let externalMsgId = "";
    let deliveryWarning;
    const normalizedAttachmentType = attachmentType === "file" ? "file" : "image";
    if (conv.channel !== "web_test") {
      const dispatch = await dispatchChannelReply({
        businessId,
        channel: conv.channel,
        channelAccountId: conv.channel_account_id || "",
        recipientId: conv.external_thread_id,
        text: cleanContent,
        attachmentUrl: safeAttachmentUrl || void 0,
        attachmentType: safeAttachmentUrl ? normalizedAttachmentType : void 0
      });
      if (!dispatch.delivered) {
        deliveryStatus = "failed";
        deliveryWarning = dispatch.error || `Failed to send to ${conv.channel}.`;
      } else if (dispatch.externalMessageId) {
        externalMsgId = dispatch.externalMessageId;
      }
    }
    const msgType = safeAttachmentUrl ? normalizedAttachmentType === "file" ? "attachment" : "image" : "text";
    const { data: msg, error } = await admin.from("messages").insert({
      business_id: businessId,
      conversation_id: conversationId,
      external_message_id: externalMsgId,
      sender_type: "staff",
      sender_id: req.user.id,
      content: cleanContent,
      message_type: msgType,
      delivery_status: deliveryStatus
    }).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    if (safeAttachmentUrl) {
      await admin.from("message_attachments").insert({
        business_id: businessId,
        message_id: msg.id,
        file_url: safeAttachmentUrl,
        file_type: normalizedAttachmentType,
        file_name: (attachmentName || "").slice(0, 180),
        file_size: Number(attachmentSize || 0)
      });
    }
    const { data: fullMsg } = await admin.from("messages").select("*, attachments:message_attachments(*)").eq("id", msg.id).single();
    const lastMsgSummary = cleanContent || (normalizedAttachmentType === "file" ? "\u{1F4CE} File attachment" : "\u{1F4F7} Photo");
    const { data: updatedConv } = await admin.from("conversations").update({
      last_message: lastMsgSummary,
      last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
      unread_count: 0
    }).eq("id", conversationId).select("*, customer:customers(*)").single();
    if (updatedConv) {
      broadcastToBusiness(businessId, "conversation:updated", updatedConv);
    }
    broadcastToBusiness(businessId, "message:new", fullMsg || msg);
    return res.status(201).json({ message: fullMsg || msg, deliveryWarning });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send reply." });
  }
});
router3.post(
  "/businesses/:businessId/conversations/test-customer-message",
  requireAuth,
  requireBusinessAccess("inbox"),
  requireFeature("ai_chat"),
  rateLimit(40, 6e4),
  async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      const businessId = req.businessId;
      const { conversationId, customerName, channel, message } = req.body;
      if (!message?.trim()) {
        return res.status(400).json({ error: "Customer message text is required." });
      }
      let targetConvId = conversationId;
      if (!targetConvId) {
        const { data: createdConv, error: convErr } = await admin.from("conversations").insert({
          business_id: businessId,
          channel: channel || "web_test",
          external_thread_id: `test_${Date.now()}`,
          customer_name: customerName?.trim() || "Test Customer",
          last_message: message.trim(),
          last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
          unread_count: 1,
          ai_enabled: true
        }).select("*").single();
        if (convErr) return res.status(400).json({ error: convErr.message });
        targetConvId = createdConv.id;
        broadcastToBusiness(businessId, "conversation:updated", createdConv);
      } else {
        await admin.from("conversations").update({
          last_message: message.trim(),
          last_message_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", targetConvId).eq("business_id", businessId);
      }
      const { data: custMsg } = await admin.from("messages").insert({
        business_id: businessId,
        conversation_id: targetConvId,
        sender_type: "customer",
        content: message.trim(),
        message_type: "text",
        delivery_status: "delivered"
      }).select("*").single();
      if (custMsg) {
        broadcastToBusiness(businessId, "message:new", custMsg);
      }
      const aiResult = await processCustomerMessageWithAi({
        businessId,
        conversationId: targetConvId,
        customerMessage: message.trim(),
        userId: req.user.id
      });
      return res.json({
        conversationId: targetConvId,
        customerMessage: custMsg,
        aiResult
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "Test message failed." });
    }
  }
);
var inboxAndAiRoutes_default = router3;

// server/routes/integrationsAndBillingRoutes.ts
import { Router as Router4 } from "express";

// server/services/manualPaymentService.ts
import crypto5 from "crypto";
var ManualPaymentError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
};
var ALLOWED_GATEWAY_TYPES = /* @__PURE__ */ new Set(["manual", "bkash", "nagad", "rocket", "sslcommerz", "custom"]);
var GATEWAY_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,48}$/;
var BKASH_MAX_NUMBERS = 9;
var MULTI_MFS_MAX_NUMBERS = 50;
function resolveEffectiveGatewayType(row) {
  const cfg = row.config_public && typeof row.config_public === "object" ? row.config_public : {};
  const explicitMethod = typeof cfg.manual_method === "string" ? cfg.manual_method.trim().toLowerCase() : "";
  const slug = String(row.slug || "").trim().toLowerCase();
  const rawType = String(row.gateway_type || "manual").trim().toLowerCase();
  if (explicitMethod === "rocket" || slug === "rocket" && rawType === "manual") {
    return "rocket";
  }
  return rawType;
}
function normalizePaymentNumber(raw) {
  return String(raw || "").replace(/[\s()-]+/g, "").trim();
}
function normalizeTransactionId(raw) {
  return String(raw || "").trim().toUpperCase();
}
function parseAccountsFromConfigPublic(configPublic) {
  if (!configPublic || typeof configPublic !== "object" || Array.isArray(configPublic)) {
    return [];
  }
  const obj = configPublic;
  if (Array.isArray(obj.accounts)) {
    return obj.accounts.filter((item) => Boolean(item && typeof item === "object")).map((item, idx) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `acc_${idx + 1}`,
      number: normalizePaymentNumber(String(item.number || "")),
      account_type: typeof item.account_type === "string" && item.account_type.trim() ? item.account_type.trim().slice(0, 40) : "Personal",
      label: typeof item.label === "string" ? item.label.trim().slice(0, 80) : "",
      instructions: typeof item.instructions === "string" ? item.instructions.trim().slice(0, 400) : "",
      is_active: item.is_active !== false
    })).filter((acc) => Boolean(acc.number));
  }
  const legacyNumber = typeof obj.account_number === "string" ? normalizePaymentNumber(obj.account_number) : "";
  if (legacyNumber) {
    return [
      {
        id: "primary",
        number: legacyNumber,
        account_type: typeof obj.account_type === "string" && obj.account_type.trim() ? obj.account_type.trim().slice(0, 40) : "Personal",
        label: typeof obj.display_note === "string" ? obj.display_note.trim().slice(0, 80) : "",
        instructions: "",
        is_active: true
      }
    ];
  }
  return [];
}
function validateAndNormalizeAccounts(gatewayTypeOrSlug, rawAccounts) {
  const normalizedType = gatewayTypeOrSlug.trim().toLowerCase();
  const isBkash = normalizedType === "bkash";
  const maxAllowed = isBkash ? BKASH_MAX_NUMBERS : MULTI_MFS_MAX_NUMBERS;
  if (rawAccounts.length > maxAllowed) {
    throw new ManualPaymentError(
      400,
      isBkash ? `bKash supports a maximum of ${BKASH_MAX_NUMBERS} payment numbers.` : `Maximum ${MULTI_MFS_MAX_NUMBERS} numbers allowed per method.`
    );
  }
  const seenDigits = /* @__PURE__ */ new Set();
  const cleaned = [];
  for (const item of rawAccounts) {
    if (!item || typeof item !== "object") {
      throw new ManualPaymentError(400, "Invalid payment number entry.");
    }
    const obj = item;
    const number = normalizePaymentNumber(String(obj.number || ""));
    const digits = number.replace(/[^\d]/g, "");
    if (!/^\+?[0-9]+$/.test(number) || digits.length < 10 || digits.length > 15) {
      throw new ManualPaymentError(400, `Invalid payment number "${String(obj.number || "")}". Enter a valid 10\u201315 digit number.`);
    }
    if (seenDigits.has(digits)) {
      throw new ManualPaymentError(400, `Duplicate payment number "${number}" in the same payment method.`);
    }
    seenDigits.add(digits);
    cleaned.push({
      id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : crypto5.randomUUID().slice(0, 12),
      number,
      account_type: typeof obj.account_type === "string" && obj.account_type.trim() ? obj.account_type.trim().slice(0, 40) : "Personal",
      label: typeof obj.label === "string" ? obj.label.trim().slice(0, 80) : "",
      instructions: typeof obj.instructions === "string" ? obj.instructions.trim().slice(0, 400) : "",
      is_active: obj.is_active !== false
    });
  }
  return cleaned;
}
function sanitizeGatewayConfigPublic(raw, gatewayTypeOrSlug = "manual") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw;
  const safe = {};
  const allowedStringKeys = ["account_number", "account_type", "merchant_id", "bank_name", "routing_number", "display_note", "manual_method"];
  for (const key of allowedStringKeys) {
    if (typeof obj[key] === "string" && obj[key].trim()) {
      safe[key] = obj[key].trim().slice(0, 200);
    }
  }
  if (Array.isArray(obj.accounts)) {
    const cleanedAccounts = validateAndNormalizeAccounts(gatewayTypeOrSlug, obj.accounts);
    safe.accounts = cleanedAccounts;
    const primary = cleanedAccounts.find((a) => a.is_active) || cleanedAccounts[0];
    if (primary) {
      safe.account_number = primary.number;
      safe.account_type = primary.account_type;
    } else {
      delete safe.account_number;
      delete safe.account_type;
    }
  } else if (typeof safe.account_number === "string") {
    safe.accounts = [
      {
        id: "primary",
        number: normalizePaymentNumber(safe.account_number),
        account_type: typeof safe.account_type === "string" ? safe.account_type : "Personal",
        label: "",
        instructions: "",
        is_active: true
      }
    ];
  }
  return safe;
}
function sanitizeGatewayCredentials(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? { api_token: trimmed } : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const cleaned = {};
  const allowedCredKeys = ["merchant_id", "api_key", "api_secret", "username", "password", "webhook_secret"];
  for (const key of allowedCredKeys) {
    if (typeof obj[key] === "string" && obj[key].trim()) {
      cleaned[key] = obj[key].trim();
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
function toSafeGatewayRow(row) {
  const { credentials_encrypted, ...rest } = row;
  const effectiveType = resolveEffectiveGatewayType(row);
  const accounts = parseAccountsFromConfigPublic(row.config_public);
  return {
    ...rest,
    gateway_type: effectiveType,
    accounts,
    active_accounts: accounts.filter((a) => a.is_active),
    max_numbers: effectiveType === "bkash" ? BKASH_MAX_NUMBERS : MULTI_MFS_MAX_NUMBERS,
    has_credentials: Boolean(typeof credentials_encrypted === "string" && credentials_encrypted.trim().length > 0)
  };
}
async function listActiveCatalogGateways() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("payment_gateways").select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, instructions, updated_at").eq("is_active", true).order("slug");
  if (error) throw new ManualPaymentError(500, error.message);
  return (data || []).map((row) => {
    const record = row;
    const effectiveType = resolveEffectiveGatewayType(record);
    const allAccounts = parseAccountsFromConfigPublic(record.config_public);
    const activeAccounts = allAccounts.filter((a) => a.is_active);
    return {
      ...record,
      gateway_type: effectiveType,
      config_public: {
        ...record.config_public && typeof record.config_public === "object" ? record.config_public : {},
        accounts: activeAccounts
      },
      active_accounts: activeAccounts
    };
  });
}
async function upsertManualGatewayAccounts(slugOrMethod, params, actor) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin.from("payment_gateways").select("*").eq("slug", slugOrMethod).maybeSingle();
  const existingCfg = existing?.config_public && typeof existing.config_public === "object" ? existing.config_public : {};
  const nextConfigPublic = sanitizeGatewayConfigPublic(
    {
      ...existingCfg,
      manual_method: slugOrMethod,
      ...params.accounts !== void 0 ? { accounts: params.accounts } : {}
    },
    slugOrMethod
  );
  const defaults = {
    bkash: {
      name: "bKash",
      instructions: "Open bKash app -> Send Money to any active number below -> Copy TrxID and submit here."
    },
    nagad: {
      name: "Nagad",
      instructions: "Open Nagad app -> Send Money to any active number below -> Copy TrxID and submit here."
    },
    rocket: {
      name: "Rocket",
      instructions: "Open Rocket app -> Send Money to any active number below -> Copy TrxID and submit here."
    }
  };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (!existing) {
    const insertPayload = {
      slug: slugOrMethod,
      name: params.name?.trim() || defaults[slugOrMethod].name,
      gateway_type: slugOrMethod,
      is_active: params.is_active !== void 0 ? params.is_active : true,
      is_sandbox: false,
      config_public: nextConfigPublic,
      credentials_encrypted: "",
      instructions: typeof params.instructions === "string" ? params.instructions.trim().slice(0, 1e3) : defaults[slugOrMethod].instructions,
      updated_at: nowIso
    };
    let created = await admin.from("payment_gateways").insert(insertPayload).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    if (created.error && created.error.message.toLowerCase().includes("gateway_type")) {
      created = await admin.from("payment_gateways").insert({ ...insertPayload, gateway_type: "manual" }).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    }
    if (created.error) throw new ManualPaymentError(400, created.error.message);
    await writeAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "manual_payment_method_created",
      targetType: "payment_gateway",
      targetId: slugOrMethod,
      details: { count: parseAccountsFromConfigPublic(nextConfigPublic).length, is_active: insertPayload.is_active },
      ipAddress: actor.ip
    });
    return toSafeGatewayRow(created.data);
  }
  const updatePayload = {
    config_public: nextConfigPublic,
    is_sandbox: false,
    updated_at: nowIso
  };
  if (typeof params.is_active === "boolean") updatePayload.is_active = params.is_active;
  if (typeof params.instructions === "string") updatePayload.instructions = params.instructions.trim().slice(0, 1e3);
  if (typeof params.name === "string" && params.name.trim()) updatePayload.name = params.name.trim().slice(0, 100);
  const { data: updated, error } = await admin.from("payment_gateways").update(updatePayload).eq("slug", slugOrMethod).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
  if (error) throw new ManualPaymentError(400, error.message);
  await writeAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "manual_payment_method_updated",
    targetType: "payment_gateway",
    targetId: slugOrMethod,
    details: {
      count: parseAccountsFromConfigPublic(nextConfigPublic).length,
      is_active: updated.is_active
    },
    ipAddress: actor.ip
  });
  return toSafeGatewayRow(updated);
}
async function submitManualPayment(params) {
  const admin = getSupabaseAdmin();
  const slug = String(params.gateway_slug || "").trim().toLowerCase();
  const trxId = normalizeTransactionId(params.transaction_id || "");
  const senderNumber = normalizePaymentNumber(params.sender_number || "");
  let paidToNumber = normalizePaymentNumber(params.paid_to_number || "");
  if (!slug || !params.payment_for || !params.reference_id || !trxId) {
    throw new ManualPaymentError(400, "Payment method, package/plan, and Transaction ID are required.");
  }
  if (!["coin_package", "subscription"].includes(params.payment_for)) {
    throw new ManualPaymentError(400, "Invalid payment target type.");
  }
  if (trxId.length < 5 || trxId.length > 80 || !/^[A-Z0-9_-]+$/.test(trxId)) {
    throw new ManualPaymentError(400, "Please enter a valid Transaction ID (5\u201380 alphanumeric characters).");
  }
  const senderDigits = senderNumber.replace(/[^\d]/g, "");
  if (!senderNumber || senderDigits.length < 8 || senderDigits.length > 15) {
    throw new ManualPaymentError(400, "Please enter a valid sender mobile/account number.");
  }
  const { data: gateway } = await admin.from("payment_gateways").select("*").eq("slug", slug).maybeSingle();
  if (!gateway || !gateway.is_active) {
    throw new ManualPaymentError(400, "Selected payment method is unavailable or inactive.");
  }
  const accounts = parseAccountsFromConfigPublic(gateway.config_public);
  const activeAccounts = accounts.filter((a) => a.is_active);
  if (accounts.length > 0 && activeAccounts.length === 0) {
    throw new ManualPaymentError(400, "No active receiving payment numbers are currently configured for this method.");
  }
  if (activeAccounts.length > 0) {
    if (!paidToNumber) {
      paidToNumber = activeAccounts[0].number;
    } else {
      const matched = activeAccounts.find((a) => a.number.replace(/[^\d]/g, "") === paidToNumber.replace(/[^\d]/g, ""));
      if (!matched) {
        throw new ManualPaymentError(400, "Selected receiving payment number is invalid or inactive.");
      }
      paidToNumber = matched.number;
    }
  }
  const { data: existingTrx } = await admin.from("payments").select("id, status").ilike("transaction_id", trxId).limit(1);
  if (existingTrx && existingTrx.length > 0) {
    throw new ManualPaymentError(409, "This Transaction ID has already been used. Duplicate Transaction IDs are not allowed.");
  }
  let amount = 0;
  let currency = "BDT";
  let targetTitle = "";
  if (params.payment_for === "coin_package") {
    const { data: pkg } = await admin.from("coin_packages").select("id, name, price, currency, status").eq("id", params.reference_id).maybeSingle();
    if (!pkg || pkg.status !== "active") {
      throw new ManualPaymentError(404, "Selected coin package is unavailable.");
    }
    amount = Number(pkg.price);
    currency = pkg.currency || "BDT";
    targetTitle = String(pkg.name || "Coin Package");
  } else {
    const { data: plan } = await admin.from("subscription_plans").select("id, name, monthly_price, currency, is_active").eq("id", params.reference_id).maybeSingle();
    if (!plan || !plan.is_active) {
      throw new ManualPaymentError(404, "Selected subscription plan is unavailable.");
    }
    amount = Number(plan.monthly_price);
    currency = plan.currency || "BDT";
    targetTitle = `${String(plan.name || "Subscription")} Plan`;
  }
  if (amount <= 0) {
    throw new ManualPaymentError(400, "Manual payment is only applicable for paid packages or plans.");
  }
  const effectiveType = resolveEffectiveGatewayType(gateway);
  const { data: payment, error } = await admin.from("payments").insert({
    business_id: params.businessId,
    user_id: params.userId,
    gateway_slug: slug,
    payment_for: params.payment_for,
    reference_id: params.reference_id,
    amount,
    currency,
    transaction_id: trxId,
    sender_number: senderNumber,
    proof_url: params.proof_url || "",
    status: "pending",
    gateway_response: {
      gateway_name: gateway.name,
      gateway_type: effectiveType,
      paid_to_number: paidToNumber,
      target_title: targetTitle
    }
  }).select("*").single();
  if (error) {
    if (error.code === "23505" || error.message.toLowerCase().includes("duplicate")) {
      throw new ManualPaymentError(409, "This Transaction ID has already been used. Duplicate Transaction IDs are not allowed.");
    }
    throw new ManualPaymentError(400, error.message);
  }
  const { data: superAdmins } = await admin.from("profiles").select("id").eq("role", "super_admin").eq("status", "active");
  for (const sa of superAdmins || []) {
    await createNotification({
      businessId: params.businessId,
      userId: sa.id,
      title: `New Manual Payment: ${gateway.name} (${amount} ${currency})`,
      body: `TrxID ${trxId} submitted for ${targetTitle}. Verify in Admin Payment Queue.`,
      type: "info",
      link: "payments"
    });
  }
  await writeAuditLog({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: params.userRole,
    businessId: params.businessId,
    action: "manual_payment_submitted",
    targetType: "payment",
    targetId: payment.id,
    details: { gateway_slug: slug, transaction_id: trxId, paid_to_number: paidToNumber, amount, payment_for: params.payment_for },
    ipAddress: params.ipAddress
  });
  return payment;
}
async function reviewManualPayment(params) {
  const admin = getSupabaseAdmin();
  const cleanNotes = String(params.adminNotes || "").trim().slice(0, 500);
  if (params.decision !== "approved" && params.decision !== "rejected") {
    throw new ManualPaymentError(400, "Decision must be either approved or rejected.");
  }
  if (params.decision === "rejected" && cleanNotes.length < 3) {
    throw new ManualPaymentError(400, "Please enter a rejection reason for the customer.");
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const { data: claimed, error: claimErr } = await admin.from("payments").update({
    status: params.decision,
    admin_notes: cleanNotes,
    reviewed_by: params.adminUser.id,
    reviewed_at: nowIso,
    updated_at: nowIso
  }).eq("id", params.paymentId).eq("status", "pending").select("*").maybeSingle();
  if (claimErr) {
    throw new ManualPaymentError(400, claimErr.message);
  }
  if (!claimed) {
    const { data: existing } = await admin.from("payments").select("id, status").eq("id", params.paymentId).maybeSingle();
    if (!existing) {
      throw new ManualPaymentError(404, "Payment request not found.");
    }
    throw new ManualPaymentError(
      409,
      `Payment is already ${existing.status}. A payment request can only be reviewed once.`
    );
  }
  let fulfillmentNote = "";
  if (params.decision === "approved") {
    try {
      if (claimed.payment_for === "coin_package" && claimed.reference_id) {
        const { data: pkg, error: pkgErr } = await admin.from("coin_packages").select("*").eq("id", claimed.reference_id).maybeSingle();
        if (pkgErr || !pkg) {
          throw new Error("Referenced coin package not found.");
        }
        const totalCoins = Number(pkg.coin_amount) + Number(pkg.bonus_coins || 0);
        const { error: creditErr } = await admin.rpc("credit_ai_coins_atomic", {
          p_business_id: claimed.business_id,
          p_amount: totalCoins,
          p_type: "purchase",
          p_description: `Manual Payment Approved (${claimed.transaction_id}): ${pkg.name} (${totalCoins} coins)`,
          p_reference_id: claimed.id,
          p_user_id: params.adminUser.id
        });
        if (creditErr) throw new Error(creditErr.message);
        await admin.from("package_purchases").insert({
          business_id: claimed.business_id,
          user_id: claimed.user_id,
          package_id: pkg.id,
          coins_granted: totalCoins,
          amount: claimed.amount,
          currency: claimed.currency,
          payment_id: claimed.id,
          status: "completed"
        });
        fulfillmentNote = `${totalCoins.toLocaleString()} AI Coins added to your wallet for ${pkg.name}.`;
      } else if (claimed.payment_for === "subscription" && claimed.reference_id) {
        const { data: plan, error: planErr } = await admin.from("subscription_plans").select("*").eq("id", claimed.reference_id).maybeSingle();
        if (planErr || !plan) {
          throw new Error("Referenced subscription plan not found.");
        }
        const durationDays = Number(plan.duration_days || 30);
        const expiresAt = new Date(Date.now() + durationDays * 864e5).toISOString();
        const { error: bizErr } = await admin.from("businesses").update({
          subscription_plan_id: plan.id,
          subscription_status: "active",
          subscription_expires_at: expiresAt,
          updated_at: nowIso
        }).eq("id", claimed.business_id);
        if (bizErr) throw new Error(bizErr.message);
        await admin.from("subscriptions").insert({
          business_id: claimed.business_id,
          plan_id: plan.id,
          billing_cycle: durationDays >= 360 ? "yearly" : "monthly",
          status: "active",
          starts_at: nowIso,
          expires_at: expiresAt,
          amount_paid: claimed.amount,
          payment_id: claimed.id
        });
        if (Number(plan.coin_allocation || 0) > 0) {
          const { error: creditErr } = await admin.rpc("credit_ai_coins_atomic", {
            p_business_id: claimed.business_id,
            p_amount: Number(plan.coin_allocation),
            p_type: "subscription_grant",
            p_description: `${plan.name} subscription activated (TrxID: ${claimed.transaction_id})`,
            p_reference_id: claimed.id,
            p_user_id: params.adminUser.id
          });
          if (creditErr) throw new Error(creditErr.message);
        }
        fulfillmentNote = `${plan.name} subscription activated${Number(plan.coin_allocation || 0) > 0 ? ` with ${Number(plan.coin_allocation).toLocaleString()} AI Coins` : ""}.`;
      }
    } catch (fulfillErr) {
      await admin.from("payments").update({
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", claimed.id);
      throw new ManualPaymentError(
        500,
        `Payment fulfillment failed and was rolled back safely: ${fulfillErr instanceof Error ? fulfillErr.message : String(fulfillErr)}`
      );
    }
  }
  const gwMeta = claimed.gateway_response && typeof claimed.gateway_response === "object" ? claimed.gateway_response : {};
  const targetTitle = String(gwMeta.target_title || claimed.payment_for.replace("_", " "));
  const notifTitle = params.decision === "approved" ? `Payment Approved: ${targetTitle}` : `Payment Rejected: ${targetTitle}`;
  const notifBody = params.decision === "approved" ? `TrxID ${claimed.transaction_id} (${claimed.amount} ${claimed.currency}) verified. ${fulfillmentNote}`.trim() : `TrxID ${claimed.transaction_id} (${claimed.amount} ${claimed.currency}) was rejected. Reason: ${cleanNotes}`;
  const recipientIds = /* @__PURE__ */ new Set();
  if (claimed.user_id) recipientIds.add(String(claimed.user_id));
  const { data: biz } = await admin.from("businesses").select("owner_id").eq("id", claimed.business_id).maybeSingle();
  if (biz?.owner_id) recipientIds.add(String(biz.owner_id));
  for (const uid of recipientIds) {
    await createNotification({
      businessId: claimed.business_id,
      userId: uid,
      title: notifTitle,
      body: notifBody,
      type: params.decision === "approved" ? "success" : "error",
      link: "wallet"
    });
  }
  await writeAuditLog({
    actorId: params.adminUser.id,
    actorEmail: params.adminUser.email,
    actorRole: params.adminUser.role,
    businessId: claimed.business_id,
    action: `payment_${params.decision}`,
    targetType: "payment",
    targetId: claimed.id,
    details: {
      amount: claimed.amount,
      payment_for: claimed.payment_for,
      transaction_id: claimed.transaction_id,
      admin_notes: cleanNotes
    },
    ipAddress: params.adminUser.ip
  });
  return claimed;
}
function buildEncryptedCredentials(raw) {
  const parsed = sanitizeGatewayCredentials(raw);
  return parsed ? encryptSecret(JSON.stringify(parsed)) : "";
}

// server/routes/integrationsAndBillingRoutes.ts
var router4 = Router4();
router4.get("/catalog/plans", requireAuth, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("subscription_plans").select("*").eq("is_active", true).order("display_order");
    return res.json({ plans: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load plans." });
  }
});
router4.get("/catalog/packages", requireAuth, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from("coin_packages").select("*").eq("status", "active").order("display_order");
    return res.json({ packages: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load packages." });
  }
});
router4.get("/catalog/gateways", requireAuth, async (_req, res) => {
  try {
    const gateways = await listActiveCatalogGateways();
    return res.json({ gateways });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load gateways." });
  }
});
router4.get("/businesses/:businessId/social", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const metaCfg = await getPlatformMetaConfig();
    const [{ data: connections }, { data: fbPages }, { data: igAccounts }, { data: waAccounts }, { data: logs }] = await Promise.all([
      admin.from("social_connections").select("id, business_id, platform, account_id, account_name, status, permissions, token_expires_at, metadata, connected_at, updated_at").eq("business_id", businessId),
      admin.from("facebook_pages").select("id, page_id, page_name, page_picture, is_active, permissions, webhook_subscribed, connected_at").eq("business_id", businessId),
      admin.from("instagram_accounts").select("id, ig_account_id, username, account_type, profile_picture, linked_page_id, is_active, connected_at").eq("business_id", businessId),
      admin.from("whatsapp_accounts").select("id, waba_id, phone_number_id, display_phone_number, business_name, webhook_configured, is_active, connected_at").eq("business_id", businessId),
      admin.from("social_connection_logs").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20)
    ]);
    return res.json({
      metaConfigured: Boolean(metaCfg.appId && metaCfg.appSecret),
      metaMode: metaCfg.mode,
      metaApiVersion: metaCfg.apiVersion,
      webhookUrl: `${resolveAppBaseUrl(req)}/api/webhooks/meta`,
      connections: connections || [],
      facebookPages: fbPages || [],
      instagramAccounts: igAccounts || [],
      whatsappAccounts: waAccounts || [],
      logs: logs || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load social connections." });
  }
});
router4.post("/businesses/:businessId/social/sync-inbox", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const triggerAutoReply = Boolean(req.body?.triggerAutoReply);
    const result = await syncMetaConversationsForBusiness(req.businessId, { triggerAutoReply });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to sync Meta inbox." });
  }
});
router4.get("/businesses/:businessId/social/webhook-status", requireAuth, requireBusinessAccess("inbox"), async (req, res) => {
  try {
    const webhookUrl = `${resolveAppBaseUrl(req)}/api/webhooks/meta`;
    const diagnostics = await getInstantAutoReplyDiagnostics(req.businessId, webhookUrl);
    return res.json(diagnostics);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect webhook status." });
  }
});
router4.post("/businesses/:businessId/social/webhook-subscribe", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const metaCfg = await getPlatformMetaConfig();
    const [{ data: fbPages }, { data: igAccounts }, { data: waAccounts }] = await Promise.all([
      admin.from("facebook_pages").select("page_id, page_name, page_access_token_encrypted").eq("business_id", businessId).eq("is_active", true),
      admin.from("instagram_accounts").select("linked_page_id, username, access_token_encrypted").eq("business_id", businessId).eq("is_active", true),
      admin.from("whatsapp_accounts").select("waba_id, access_token_encrypted").eq("business_id", businessId).eq("is_active", true)
    ]);
    const subscribedPages = [];
    const failedPages = [];
    const donePageIds = /* @__PURE__ */ new Set();
    for (const p of fbPages || []) {
      if (donePageIds.has(p.page_id)) continue;
      donePageIds.add(p.page_id);
      const token = decryptSecret(p.page_access_token_encrypted || "");
      if (!token) continue;
      const r = await subscribePageToMetaWebhooks({
        businessId,
        pageId: p.page_id,
        pageAccessToken: token,
        apiVersion: metaCfg.apiVersion
      });
      if (r.ok) subscribedPages.push(p.page_name || p.page_id);
      else failedPages.push({ name: p.page_name || p.page_id, error: r.error || "Subscription failed" });
    }
    for (const ig of igAccounts || []) {
      if (!ig.linked_page_id || donePageIds.has(ig.linked_page_id)) continue;
      donePageIds.add(ig.linked_page_id);
      const token = decryptSecret(ig.access_token_encrypted || "");
      if (!token) continue;
      const r = await subscribePageToMetaWebhooks({
        businessId,
        pageId: ig.linked_page_id,
        pageAccessToken: token,
        apiVersion: metaCfg.apiVersion
      });
      if (r.ok) subscribedPages.push(ig.username || ig.linked_page_id);
      else failedPages.push({ name: ig.username || ig.linked_page_id, error: r.error || "Subscription failed" });
    }
    const doneWabas = /* @__PURE__ */ new Set();
    for (const wa of waAccounts || []) {
      if (!wa.waba_id || doneWabas.has(wa.waba_id)) continue;
      doneWabas.add(wa.waba_id);
      const token = decryptSecret(wa.access_token_encrypted || "");
      if (!token) continue;
      const r = await subscribeWabaToMetaWebhooks({
        businessId,
        wabaId: wa.waba_id,
        accessToken: token,
        apiVersion: metaCfg.apiVersion
      });
      if (r.ok) subscribedPages.push(`WhatsApp (${wa.waba_id})`);
      else failedPages.push({ name: `WhatsApp (${wa.waba_id})`, error: r.error || "Subscription failed" });
    }
    const diagnostics = await getInstantAutoReplyDiagnostics(businessId, `${resolveAppBaseUrl(req)}/api/webhooks/meta`);
    return res.json({ subscribedPages, failedPages, diagnostics });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to subscribe webhooks." });
  }
});
router4.get("/businesses/:businessId/social/oauth/:platform/url", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const platform = req.params.platform;
    if (!["facebook", "instagram", "whatsapp"].includes(platform)) {
      return res.status(400).json({ error: "Unsupported platform." });
    }
    const result = await createMetaOAuthUrl({
      businessId: req.businessId,
      userId: req.user.id,
      platform,
      requestBaseUrl: resolveAppBaseUrl(req)
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to generate OAuth URL." });
  }
});
router4.post("/businesses/:businessId/social/:connectionId/disconnect", requireAuth, requireBusinessAccess("settings"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: conn } = await admin.from("social_connections").select("id, platform, account_id").eq("id", req.params.connectionId).eq("business_id", req.businessId).maybeSingle();
    if (!conn) return res.status(404).json({ error: "Connection not found." });
    await admin.from("social_connections").update({ status: "disconnected", access_token_encrypted: "" }).eq("id", conn.id);
    if (conn.platform === "facebook") {
      await admin.from("facebook_pages").update({ is_active: false }).eq("connection_id", conn.id);
    } else if (conn.platform === "instagram") {
      await admin.from("instagram_accounts").update({ is_active: false }).eq("connection_id", conn.id);
    } else if (conn.platform === "whatsapp") {
      await admin.from("whatsapp_accounts").update({ is_active: false }).eq("connection_id", conn.id);
    }
    await admin.from("social_connection_logs").insert({
      business_id: req.businessId,
      platform: conn.platform,
      event_type: "disconnected",
      status: "info",
      message: `Disconnected ${conn.platform} account ${conn.account_id}`
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Disconnect failed." });
  }
});
router4.get(["/oauth/meta/callback", "/oauth/meta/callback/"], async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.send(`<html><body style="font-family:sans-serif;padding:24px;">
      <h3>Meta Authorization Cancelled</h3>
      <p>${error_description || error}</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(error_description || error)} }, '*');
          setTimeout(() => window.close(), 1200);
        }
      </script>
    </body></html>`);
  }
  try {
    const result = await handleMetaOAuthCallback({ code, state });
    return res.send(`<html><body style="font-family:sans-serif;padding:24px;">
      <h3>Connected Successfully</h3>
      <p>Your ${result.platform} account is now connected to BeXpar Ai.</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', platform: ${JSON.stringify(result.platform)} }, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      </script>
    </body></html>`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback error";
    return res.status(400).send(`<html><body style="font-family:sans-serif;padding:24px;">
      <h3>Connection Failed</h3>
      <p>${msg}</p>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(msg)} }, '*');
        }
      </script>
    </body></html>`);
  }
});
router4.get("/webhooks/meta", async (req, res) => {
  try {
    const mode = String(req.query["hub.mode"] || "").trim();
    const token = String(req.query["hub.verify_token"] || "").trim();
    const challenge = String(req.query["hub.challenge"] || "");
    const metaCfg = await getPlatformMetaConfig();
    if (mode === "subscribe" && token && token === metaCfg.webhookVerifyToken.trim()) {
      return res.status(200).type("text/plain").send(challenge);
    }
    return res.status(403).send("Forbidden");
  } catch (err) {
    return res.status(500).send(err instanceof Error ? err.message : "Webhook verify error");
  }
});
router4.post("/webhooks/meta", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const rawBody = req.rawBody;
    const sigCheck = await verifyMetaWebhookBodyWithFallback({
      rawBody,
      parsedBody: req.body,
      signatureHeader: signature
    });
    if (!sigCheck.valid) {
      return res.status(401).json({ error: sigCheck.reason || "Invalid Meta webhook signature." });
    }
    const payload = req.body;
    const admin = getSupabaseAdmin();
    for (const entry of payload.entry || []) {
      const igChangeMessaging = payload.object === "instagram" && entry.changes ? entry.changes.filter((c) => c.field === "messages" && c.value?.sender?.id && c.value?.message).map((c) => ({
        sender: c.value.sender,
        recipient: c.value.recipient || { id: entry.id },
        timestamp: Number(c.value.timestamp || Date.now()),
        message: c.value.message
      })) : [];
      const messagingList = [
        ...entry.messaging || [],
        ...entry.standby || [],
        ...igChangeMessaging
      ];
      if (messagingList.length > 0) {
        const channel = payload.object === "instagram" ? "instagram" : "facebook";
        for (const msgEvent of messagingList) {
          if (msgEvent.delivery || msgEvent.read) {
            const senderId2 = msgEvent.sender?.id;
            const recipientId2 = msgEvent.recipient?.id;
            const candidateIds = Array.from(new Set([recipientId2, entry.id].filter((v) => Boolean(v))));
            if (senderId2 && candidateIds.length > 0) {
              const { data: matchingConvs } = await admin.from("conversations").select("id, business_id").eq("channel", channel).eq("external_thread_id", senderId2).in("channel_account_id", candidateIds);
              for (const conv of matchingConvs || []) {
                if (msgEvent.delivery?.mids?.length) {
                  await admin.from("messages").update({ delivery_status: "delivered" }).eq("conversation_id", conv.id).in("external_message_id", msgEvent.delivery.mids).eq("delivery_status", "sent");
                } else if (msgEvent.delivery?.watermark) {
                  await admin.from("messages").update({ delivery_status: "delivered" }).eq("conversation_id", conv.id).in("sender_type", ["ai", "staff"]).eq("delivery_status", "sent").lte("created_at", new Date(msgEvent.delivery.watermark).toISOString());
                }
                if (msgEvent.read?.watermark) {
                  await admin.from("messages").update({ delivery_status: "read" }).eq("conversation_id", conv.id).in("sender_type", ["ai", "staff"]).in("delivery_status", ["sent", "delivered"]).lte("created_at", new Date(msgEvent.read.watermark).toISOString());
                }
                broadcastToBusiness(conv.business_id, "message:status", {
                  conversationId: conv.id,
                  status: msgEvent.read ? "read" : "delivered"
                });
              }
            }
            continue;
          }
          if (msgEvent.message?.is_echo) continue;
          const rawAttachments = msgEvent.message?.attachments || [];
          const incomingAtts = rawAttachments.map((a) => {
            const rawUrl = a.payload?.url || "";
            if (!rawUrl.startsWith("https://") && !rawUrl.startsWith("http://")) return null;
            const isImg = a.type === "image";
            return {
              file_url: rawUrl,
              file_type: isImg ? "image" : a.type || "file",
              file_name: isImg ? "Image attachment" : `${a.type || "file"} attachment`,
              file_size: 0
            };
          }).filter((v) => Boolean(v));
          const hasImageAtt = incomingAtts.some((a) => a.file_type === "image");
          const firstNonUrlAttType = rawAttachments.find((a) => !a.payload?.url)?.type;
          const hasSticker = rawAttachments.some((a) => Boolean(a.payload?.sticker_id));
          const fallbackAttSummary = hasImageAtt ? "\u{1F4F7} Photo" : incomingAtts.length > 0 ? "\u{1F4CE} Attachment" : hasSticker ? "\u{1F44D} Sticker" : firstNonUrlAttType ? `[${firstNonUrlAttType}]` : "";
          const rawText = msgEvent.message?.text?.trim() || msgEvent.postback?.title?.trim() || "";
          const previewSummary = rawText || fallbackAttSummary;
          const mid = msgEvent.message?.mid || msgEvent.postback?.mid || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const senderId = msgEvent.sender?.id;
          const recipientId = msgEvent.recipient?.id;
          if (!previewSummary || !senderId || !recipientId && !entry.id) continue;
          const candidateAccountIds = Array.from(new Set([recipientId, entry.id].filter((v) => Boolean(v))));
          if (candidateAccountIds.includes(senderId)) continue;
          let matchedBusinessId = null;
          let matchedAccountId = recipientId || entry.id || "";
          const { data: conn } = await admin.from("social_connections").select("business_id, account_id").eq("platform", channel).in("account_id", candidateAccountIds).eq("status", "connected").limit(1).maybeSingle();
          if (conn) {
            matchedBusinessId = conn.business_id;
            matchedAccountId = conn.account_id;
          } else if (channel === "facebook") {
            const { data: fbPage } = await admin.from("facebook_pages").select("business_id, page_id").in("page_id", candidateAccountIds).eq("is_active", true).limit(1).maybeSingle();
            if (fbPage) {
              matchedBusinessId = fbPage.business_id;
              matchedAccountId = fbPage.page_id;
            }
          } else if (channel === "instagram") {
            const { data: igAcc } = await admin.from("instagram_accounts").select("business_id, ig_account_id, linked_page_id").or(candidateAccountIds.map((id) => `ig_account_id.eq.${id},linked_page_id.eq.${id}`).join(",")).eq("is_active", true).limit(1).maybeSingle();
            if (igAcc) {
              matchedBusinessId = igAcc.business_id;
              matchedAccountId = igAcc.ig_account_id;
            }
          }
          if (!matchedBusinessId) continue;
          const { error: dupErr } = await admin.from("social_webhook_events").insert({
            business_id: matchedBusinessId,
            platform: channel,
            event_id: `${channel}_${mid}`,
            payload: msgEvent
          });
          if (dupErr) continue;
          const { data: existingExternalMsg } = await admin.from("messages").select("id").eq("business_id", matchedBusinessId).eq("external_message_id", mid).limit(1).maybeSingle();
          if (existingExternalMsg) continue;
          try {
            let { data: conv } = await admin.from("conversations").select("*").eq("business_id", matchedBusinessId).eq("channel", channel).eq("external_thread_id", senderId).maybeSingle();
            let senderName = `${channel.toUpperCase()} User ${senderId.slice(-4)}`;
            let senderAvatar = "";
            if (!conv || !conv.customer_avatar || !conv.customer_name || conv.customer_name.startsWith(`${channel.toUpperCase()} User `)) {
              const { token } = await resolveMetaChannelToken({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId
              });
              if (token) {
                const prof = await fetchMetaSenderProfile({ senderId, accessToken: token });
                if (prof.name) senderName = prof.name;
                if (prof.avatar) senderAvatar = prof.avatar;
              }
            }
            if (!conv) {
              const { data: createdConv } = await admin.from("conversations").insert({
                business_id: matchedBusinessId,
                channel,
                external_thread_id: senderId,
                channel_account_id: matchedAccountId,
                customer_name: senderName,
                customer_avatar: senderAvatar,
                last_message: previewSummary,
                last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
                unread_count: 1,
                ai_enabled: true
              }).select("*").single();
              conv = createdConv;
            } else {
              const { data: updatedConv } = await admin.from("conversations").update({
                ...senderName && conv.customer_name.startsWith(`${channel.toUpperCase()} User `) ? { customer_name: senderName } : {},
                ...senderAvatar ? { customer_avatar: senderAvatar } : {},
                channel_account_id: matchedAccountId || conv.channel_account_id,
                last_message: previewSummary,
                last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
                unread_count: (conv.unread_count || 0) + 1
              }).eq("id", conv.id).select("*").single();
              if (updatedConv) conv = updatedConv;
            }
            if (conv) {
              broadcastToBusiness(matchedBusinessId, "conversation:updated", conv);
              const msgType = hasImageAtt ? "image" : incomingAtts.length > 0 ? "attachment" : "text";
              const { data: savedMsg } = await admin.from("messages").insert({
                business_id: matchedBusinessId,
                conversation_id: conv.id,
                external_message_id: mid,
                sender_type: "customer",
                content: rawText,
                message_type: msgType,
                delivery_status: "delivered"
              }).select("*").single();
              if (savedMsg) {
                if (incomingAtts.length > 0) {
                  await admin.from("message_attachments").insert(
                    incomingAtts.map((a) => ({
                      business_id: matchedBusinessId,
                      message_id: savedMsg.id,
                      ...a
                    }))
                  );
                }
                const { data: fullMsg } = await admin.from("messages").select("*, attachments:message_attachments(*)").eq("id", savedMsg.id).single();
                broadcastToBusiness(matchedBusinessId, "message:new", fullMsg || savedMsg);
              }
              void sendMetaSenderAction({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId,
                recipientId: senderId,
                action: "mark_seen"
              });
              void sendMetaSenderAction({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId,
                recipientId: senderId,
                action: "typing_on"
              });
              if (!rawText && savedMsg) {
                await new Promise((r) => setTimeout(r, 900));
                const { data: newerCheck } = await admin.from("messages").select("id").eq("conversation_id", conv.id).gt("created_at", savedMsg.created_at).limit(1).maybeSingle();
                if (newerCheck) {
                  continue;
                }
              }
              if (savedMsg) {
                const { data: alreadyReplied } = await admin.from("messages").select("id").eq("conversation_id", conv.id).eq("sender_type", "ai").gte("created_at", savedMsg.created_at).limit(1).maybeSingle();
                if (alreadyReplied) {
                  continue;
                }
              }
              const aiInputText = rawText || (hasSticker ? "Customer sent a thumbs-up / sticker reaction." : hasImageAtt ? "Customer sent an image." : `Customer sent ${fallbackAttSummary || "an attachment"}.`);
              const aiOut = await processCustomerMessageWithAi({
                businessId: matchedBusinessId,
                conversationId: conv.id,
                customerMessage: aiInputText
              });
              if (aiOut.replied && aiOut.replyText) {
                const dispatch = await dispatchChannelReply({
                  businessId: matchedBusinessId,
                  channel,
                  channelAccountId: matchedAccountId,
                  recipientId: senderId,
                  text: aiOut.replyText
                });
                if (aiOut.messageId) {
                  if (dispatch.delivered && dispatch.externalMessageId) {
                    await admin.from("messages").update({ external_message_id: dispatch.externalMessageId }).eq("id", aiOut.messageId);
                  } else if (!dispatch.delivered) {
                    await admin.from("messages").update({ delivery_status: "failed" }).eq("id", aiOut.messageId);
                    broadcastToBusiness(matchedBusinessId, "message:status", {
                      conversationId: conv.id,
                      messageId: aiOut.messageId,
                      status: "failed"
                    });
                  }
                }
                if (!dispatch.delivered) {
                  const warnMsg = dispatch.error || "Failed to deliver AI reply to Meta.";
                  await admin.from("social_connection_logs").insert({
                    business_id: matchedBusinessId,
                    platform: channel,
                    event_type: "reply_dispatch_failed",
                    status: "error",
                    message: warnMsg
                  });
                  broadcastToBusiness(matchedBusinessId, "ai:warning", {
                    conversationId: conv.id,
                    message: warnMsg
                  });
                }
              } else {
                void sendMetaSenderAction({
                  businessId: matchedBusinessId,
                  channel,
                  channelAccountId: matchedAccountId,
                  recipientId: senderId,
                  action: "typing_off"
                });
                if (aiOut.error) {
                  await admin.from("social_connection_logs").insert({
                    business_id: matchedBusinessId,
                    platform: channel,
                    event_type: "ai_reply_skipped",
                    status: "error",
                    message: aiOut.error
                  });
                  broadcastToBusiness(matchedBusinessId, "ai:warning", {
                    conversationId: conv.id,
                    message: aiOut.error
                  });
                }
              }
            }
          } catch (msgErr) {
            console.error("[Meta Messenger/IG Event Error]", msgErr);
          }
        }
      }
      if (entry.changes) {
        for (const change of entry.changes) {
          const val = change.value;
          const phoneId = val?.metadata?.phone_number_id;
          if (!phoneId) continue;
          const { data: waAcc } = await admin.from("whatsapp_accounts").select("business_id").eq("phone_number_id", phoneId).eq("is_active", true).maybeSingle();
          if (!waAcc) continue;
          if (val?.statuses?.length) {
            for (const st of val.statuses) {
              if (!st.id || !st.status) continue;
              const { data: updated } = await admin.from("messages").update({ delivery_status: st.status }).eq("business_id", waAcc.business_id).eq("external_message_id", st.id).select("id, conversation_id").maybeSingle();
              if (updated) {
                broadcastToBusiness(waAcc.business_id, "message:status", {
                  conversationId: updated.conversation_id,
                  messageId: updated.id,
                  status: st.status
                });
              }
            }
          }
          if (!val?.messages) continue;
          for (const waMsg of val.messages) {
            const text = waMsg.text?.body?.trim() || (waMsg.type && waMsg.type !== "text" ? `[${waMsg.type}]` : "");
            const mid = waMsg.id;
            const from = waMsg.from;
            if (!text || !mid || !from) continue;
            const { error: dupErr } = await admin.from("social_webhook_events").insert({
              business_id: waAcc.business_id,
              platform: "whatsapp",
              event_id: `wa_${mid}`,
              payload: waMsg
            });
            if (dupErr) continue;
            const { data: existingWaMsg } = await admin.from("messages").select("id").eq("business_id", waAcc.business_id).eq("external_message_id", mid).limit(1).maybeSingle();
            if (existingWaMsg) continue;
            try {
              const contactName = val.contacts?.[0]?.profile?.name || `WhatsApp ${from.slice(-4)}`;
              let { data: conv } = await admin.from("conversations").select("*").eq("business_id", waAcc.business_id).eq("channel", "whatsapp").eq("external_thread_id", from).maybeSingle();
              if (!conv) {
                const { data: createdConv } = await admin.from("conversations").insert({
                  business_id: waAcc.business_id,
                  channel: "whatsapp",
                  external_thread_id: from,
                  channel_account_id: phoneId,
                  customer_name: contactName,
                  last_message: text,
                  last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
                  unread_count: 1,
                  ai_enabled: true
                }).select("*").single();
                conv = createdConv;
              } else {
                const { data: updatedConv } = await admin.from("conversations").update({
                  last_message: text,
                  last_message_at: (/* @__PURE__ */ new Date()).toISOString(),
                  unread_count: (conv.unread_count || 0) + 1
                }).eq("id", conv.id).select("*").single();
                if (updatedConv) conv = updatedConv;
              }
              if (conv) {
                broadcastToBusiness(waAcc.business_id, "conversation:updated", conv);
                const { data: savedMsg } = await admin.from("messages").insert({
                  business_id: waAcc.business_id,
                  conversation_id: conv.id,
                  external_message_id: mid,
                  sender_type: "customer",
                  content: text,
                  message_type: "text",
                  delivery_status: "delivered"
                }).select("*").single();
                if (savedMsg) broadcastToBusiness(waAcc.business_id, "message:new", savedMsg);
                const aiOut = await processCustomerMessageWithAi({
                  businessId: waAcc.business_id,
                  conversationId: conv.id,
                  customerMessage: text
                });
                if (aiOut.replied && aiOut.replyText) {
                  const dispatch = await dispatchChannelReply({
                    businessId: waAcc.business_id,
                    channel: "whatsapp",
                    channelAccountId: phoneId,
                    recipientId: from,
                    text: aiOut.replyText
                  });
                  if (aiOut.messageId) {
                    if (dispatch.delivered && dispatch.externalMessageId) {
                      await admin.from("messages").update({ external_message_id: dispatch.externalMessageId }).eq("id", aiOut.messageId);
                    } else if (!dispatch.delivered) {
                      await admin.from("messages").update({ delivery_status: "failed" }).eq("id", aiOut.messageId);
                      broadcastToBusiness(waAcc.business_id, "message:status", {
                        conversationId: conv.id,
                        messageId: aiOut.messageId,
                        status: "failed"
                      });
                    }
                  }
                  if (!dispatch.delivered) {
                    const warnMsg = dispatch.error || "Failed to deliver WhatsApp AI reply.";
                    await admin.from("social_connection_logs").insert({
                      business_id: waAcc.business_id,
                      platform: "whatsapp",
                      event_type: "reply_dispatch_failed",
                      status: "error",
                      message: warnMsg
                    });
                    broadcastToBusiness(waAcc.business_id, "ai:warning", {
                      conversationId: conv.id,
                      message: warnMsg
                    });
                  }
                } else if (aiOut.error) {
                  await admin.from("social_connection_logs").insert({
                    business_id: waAcc.business_id,
                    platform: "whatsapp",
                    event_type: "ai_reply_skipped",
                    status: "error",
                    message: aiOut.error
                  });
                  broadcastToBusiness(waAcc.business_id, "ai:warning", {
                    conversationId: conv.id,
                    message: aiOut.error
                  });
                }
              }
            } catch (waErr) {
              console.error("[Meta WhatsApp Event Error]", waErr);
            }
          }
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[Meta Webhook Error]", err);
    return res.status(200).json({ received: true });
  }
});
router4.get("/businesses/:businessId/capi", requireAuth, requireBusinessAccess("settings"), requireFeature("meta_capi"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: config }, { data: events }] = await Promise.all([
      admin.from("meta_capi_configs").select("id, business_id, pixel_id, access_token_encrypted, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required, updated_at").eq("business_id", req.businessId).maybeSingle(),
      admin.from("meta_capi_events").select("*").eq("business_id", req.businessId).order("created_at", { ascending: false }).limit(30)
    ]);
    const safeConfig = config ? {
      id: config.id,
      business_id: config.business_id,
      pixel_id: config.pixel_id,
      test_event_code: config.test_event_code,
      is_active: config.is_active,
      track_purchase: config.track_purchase,
      track_lead: config.track_lead,
      track_initiate_checkout: config.track_initiate_checkout,
      consent_required: config.consent_required,
      updated_at: config.updated_at,
      has_access_token: Boolean(config.access_token_encrypted)
    } : null;
    return res.json({ config: safeConfig, events: events || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch CAPI config." });
  }
});
router4.put("/businesses/:businessId/capi", requireAuth, requireBusinessAccess("settings"), requireFeature("meta_capi"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { pixel_id, access_token, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required } = req.body;
    const payload = {
      business_id: req.businessId,
      pixel_id: String(pixel_id || "").trim(),
      test_event_code: String(test_event_code || "").trim(),
      is_active: Boolean(is_active),
      track_purchase: track_purchase !== false,
      track_lead: track_lead !== false,
      track_initiate_checkout: track_initiate_checkout !== false,
      consent_required: consent_required !== false,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (access_token && String(access_token).trim()) {
      payload.access_token_encrypted = encryptSecret(String(access_token).trim());
    }
    const { data, error } = await admin.from("meta_capi_configs").upsert(payload, { onConflict: "business_id" }).select("id, business_id, pixel_id, access_token_encrypted, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required").single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({
      config: {
        id: data.id,
        business_id: data.business_id,
        pixel_id: data.pixel_id,
        test_event_code: data.test_event_code,
        is_active: data.is_active,
        track_purchase: data.track_purchase,
        track_lead: data.track_lead,
        track_initiate_checkout: data.track_initiate_checkout,
        consent_required: data.consent_required,
        has_access_token: Boolean(data.access_token_encrypted)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save CAPI settings." });
  }
});
router4.post("/businesses/:businessId/capi/test", requireAuth, requireBusinessAccess("settings"), requireFeature("meta_capi"), async (req, res) => {
  try {
    const result = await sendMetaCapiEvent({
      businessId: req.businessId,
      eventName: "Lead",
      eventId: `test_lead_${Date.now()}`,
      value: 100
    });
    if ("skipped" in result && result.skipped) {
      return res.status(400).json({ error: result.reason });
    }
    if ("ok" in result && !result.ok) {
      const apiMsg = result.response?.error?.message || result.error || "Meta CAPI event dispatch failed.";
      return res.status(400).json({ error: apiMsg, ...result });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "CAPI test failed." });
  }
});
router4.get("/businesses/:businessId/couriers", requireAuth, requireBusinessAccess("orders"), requireFeature("courier"), async (req, res) => {
  try {
    const overview = await getBusinessCourierOverview(req.businessId);
    return res.json(overview);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load couriers." });
  }
});
router4.put("/businesses/:businessId/couriers", requireAuth, requireBusinessAccess("settings"), requireFeature("courier"), async (req, res) => {
  try {
    const result = await saveBusinessCourierAccount(req.businessId, req.body);
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.businessId,
      action: "courier_credentials_saved",
      targetType: "courier_account",
      targetId: result.account.provider,
      details: { is_active: result.account.is_active, is_default: result.account.is_default },
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to save courier account." });
  }
});
router4.post("/businesses/:businessId/couriers/:provider/reveal", requireAuth, requireBusinessAccess("settings"), requireFeature("courier"), async (req, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "steadfast" && provider !== "pathao") {
      return res.status(400).json({ error: "Invalid courier provider." });
    }
    const credentials = await revealBusinessCourierCredentials(req.businessId, provider);
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.businessId,
      action: "courier_credentials_revealed",
      targetType: "courier_account",
      targetId: provider,
      ipAddress: req.ip
    });
    return res.json({ credentials });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : "Unable to load courier credentials." });
  }
});
router4.patch("/businesses/:businessId/couriers/:provider", requireAuth, requireBusinessAccess("settings"), requireFeature("courier"), async (req, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "steadfast" && provider !== "pathao") {
      return res.status(400).json({ error: "Invalid courier provider." });
    }
    const { is_active, is_default } = req.body;
    const result = await updateBusinessCourierState(req.businessId, provider, {
      ...typeof is_active === "boolean" ? { is_active } : {},
      ...typeof is_default === "boolean" ? { is_default } : {}
    });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.businessId,
      action: "courier_state_updated",
      targetType: "courier_account",
      targetId: provider,
      details: { is_active: result.account.is_active, is_default: result.account.is_default },
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to update courier settings." });
  }
});
router4.delete("/businesses/:businessId/couriers/:provider", requireAuth, requireBusinessAccess("settings"), requireFeature("courier"), async (req, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "steadfast" && provider !== "pathao") {
      return res.status(400).json({ error: "Invalid courier provider." });
    }
    const result = await disconnectBusinessCourier(req.businessId, provider);
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.businessId,
      action: "courier_disconnected",
      targetType: "courier_account",
      targetId: provider,
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to disconnect courier." });
  }
});
router4.post("/businesses/:businessId/couriers/:provider/test", requireAuth, requireBusinessAccess("settings"), requireFeature("courier"), async (req, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== "steadfast" && provider !== "pathao") {
      return res.status(400).json({ error: "Invalid courier provider." });
    }
    const result = await testCourierConnection(req.businessId, provider);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Courier connection verification failed." });
  }
});
router4.post("/businesses/:businessId/orders/:orderId/book-courier", requireAuth, requireBusinessAccess("orders"), requireFeature("courier"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { provider, cityId, zoneId, itemWeight, note } = req.body;
    if (provider && provider !== "steadfast" && provider !== "pathao") {
      return res.status(400).json({ error: "Invalid courier provider." });
    }
    const { data: order } = await admin.from("orders").select("*").eq("id", req.params.orderId).eq("business_id", req.businessId).maybeSingle();
    if (!order) return res.status(404).json({ error: "Order not found." });
    const booking = await bookCourierParcel({
      businessId: req.businessId,
      orderId: order.id,
      orderNumber: order.order_number,
      provider,
      recipientName: order.customer_name,
      recipientPhone: order.customer_phone,
      recipientAddress: order.customer_address,
      codAmount: order.payment_status === "paid" ? 0 : Number(order.total_amount),
      note: note || order.notes,
      cityId,
      zoneId,
      itemWeight
    });
    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Parcel booking failed." });
  }
});
router4.post("/businesses/:businessId/shipments/:shipmentId/sync", requireAuth, requireBusinessAccess("orders"), async (req, res) => {
  try {
    const result = await refreshCourierTracking(req.businessId, req.params.shipmentId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Tracking sync failed." });
  }
});
router4.post("/businesses/:businessId/orders/sync-couriers", requireAuth, requireBusinessAccess("orders"), async (req, res) => {
  try {
    const result = await syncActiveShipmentsForBusiness(req.businessId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Courier status sync failed." });
  }
});
router4.post("/businesses/:businessId/orders/:orderId/detect-risk", requireAuth, requireBusinessAccess("orders"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: order } = await admin.from("orders").select("id, customer_phone, total_amount").eq("id", req.params.orderId).eq("business_id", req.businessId).maybeSingle();
    if (!order) return res.status(404).json({ error: "Order not found." });
    const risk = await evaluateOrderRisk({
      businessId: req.businessId,
      customerPhone: order.customer_phone,
      totalAmount: Number(order.total_amount || 0),
      excludeOrderId: order.id
    });
    await admin.from("orders").update({
      risk_level: risk.riskLevel,
      risk_reasons: risk.reasons,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", order.id).eq("business_id", req.businessId);
    return res.json({
      risk_level: risk.riskLevel,
      risk_reasons: risk.reasons,
      courierStats: risk.courierStats || null
    });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Risk auto-detection failed." });
  }
});
router4.get("/businesses/:businessId/couriers/fraud-check", requireAuth, requireBusinessAccess("orders"), async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) return res.status(400).json({ error: "Phone number is required." });
    const stats = await checkSteadfastFraudByPhone(req.businessId, phone);
    return res.json(stats);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Fraud check failed." });
  }
});
router4.get("/businesses/:businessId/wallet", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const [{ data: wallet }, { data: transactions }, { data: aiLogs }, { data: payments }, { data: notifications }] = await Promise.all([
      admin.from("coin_wallets").select("*").eq("business_id", businessId).maybeSingle(),
      admin.from("coin_transactions").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(50),
      admin.from("ai_usage_logs").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(50),
      admin.from("payments").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(50),
      admin.from("notifications").select("*").eq("business_id", businessId).eq("user_id", req.user.id).eq("link", "wallet").order("created_at", { ascending: false }).limit(20)
    ]);
    return res.json({
      wallet: wallet || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      transactions: transactions || [],
      aiLogs: aiLogs || [],
      payments: payments || [],
      notifications: notifications || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load wallet." });
  }
});
router4.post("/businesses/:businessId/wallet/notifications/read", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("notifications").update({ is_read: true }).eq("business_id", req.businessId).eq("user_id", req.user.id).eq("link", "wallet").eq("is_read", false);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to mark notifications read." });
  }
});
router4.post("/businesses/:businessId/payments/submit", requireAuth, requireBusinessAccess(), async (req, res) => {
  try {
    const { gateway_slug, payment_for, reference_id, transaction_id, sender_number, paid_to_number, proof_url } = req.body;
    const payment = await submitManualPayment({
      businessId: req.businessId,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      gateway_slug: gateway_slug || "",
      payment_for,
      reference_id: reference_id || "",
      transaction_id: transaction_id || "",
      sender_number: sender_number || "",
      paid_to_number,
      proof_url,
      ipAddress: req.ip
    });
    return res.status(201).json({ payment });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Payment submission failed." });
  }
});
router4.get("/businesses/:businessId/analytics", requireAuth, requireBusinessAccess("analytics"), requireFeature("analytics"), async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId;
    const days = Number(req.query.days || 30);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [{ data: orders }, { data: items }, { data: customers }, { data: aiLogs }] = await Promise.all([
      admin.from("orders").select("*").eq("business_id", businessId).gte("created_at", since),
      admin.from("order_items").select("*").eq("business_id", businessId).gte("created_at", since),
      admin.from("customers").select("id, total_orders, created_at").eq("business_id", businessId),
      admin.from("ai_usage_logs").select("coins_deducted, provider_cost_usd, total_tokens, status").eq("business_id", businessId).gte("created_at", since)
    ]);
    const orderList = orders || [];
    const delivered = orderList.filter((o) => o.order_status === "delivered");
    const cancelled = orderList.filter((o) => o.order_status === "cancelled");
    const returned = orderList.filter((o) => o.order_status === "returned");
    const activeOrders = orderList.filter((o) => !["cancelled", "returned", "refunded"].includes(o.order_status));
    const revenue = activeOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const deliveryCosts = activeOrders.reduce((s, o) => s + Number(o.delivery_charge || 0), 0);
    const activeOrderIds = new Set(activeOrders.map((o) => o.id));
    const productCosts = (items || []).filter((i) => activeOrderIds.has(i.order_id)).reduce((s, i) => s + Number(i.unit_cost || 0) * Number(i.quantity || 1), 0);
    const estimatedProfit = revenue - productCosts - deliveryCosts;
    const productPerf = /* @__PURE__ */ new Map();
    for (const item of items || []) {
      if (!activeOrderIds.has(item.order_id)) continue;
      const cur = productPerf.get(item.product_name) || { name: item.product_name, quantity: 0, revenue: 0 };
      cur.quantity += Number(item.quantity || 1);
      cur.revenue += Number(item.total_price || 0);
      productPerf.set(item.product_name, cur);
    }
    const totalCust = (customers || []).length;
    const repeatCust = (customers || []).filter((c) => Number(c.total_orders || 0) > 1).length;
    const repeatRate = totalCust > 0 ? Math.round(repeatCust / totalCust * 100) : 0;
    const aiCoinsSpent = (aiLogs || []).reduce((s, l) => s + Number(l.coins_deducted || 0), 0);
    const aiTokens = (aiLogs || []).reduce((s, l) => s + Number(l.total_tokens || 0), 0);
    return res.json({
      summary: {
        totalSales: revenue,
        totalOrders: orderList.length,
        deliveredOrders: delivered.length,
        cancelledOrders: cancelled.length,
        returnedOrders: returned.length,
        revenue,
        productCosts,
        deliveryCosts,
        estimatedProfit,
        repeatCustomerRate: repeatRate,
        totalCustomers: totalCust,
        aiCoinsSpent,
        aiTokens
      },
      bestSellingProducts: Array.from(productPerf.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Analytics error." });
  }
});
var integrationsAndBillingRoutes_default = router4;

// server/routes/adminRoutes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.use(requireAuth, requireSuperAdmin);
var UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidHttpOrRelativeUrl(raw, allowRelative = false) {
  if (raw === void 0 || raw === null || raw === "") return true;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (allowRelative && trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.startsWith("169.254.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function resolveDateRange(query) {
  const range = String(query.range || "30d");
  const now = /* @__PURE__ */ new Date();
  let start = new Date(now);
  let end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (range === "7d") {
    start.setDate(start.getDate() - 6);
  } else if (range === "3m") {
    start.setMonth(start.getMonth() - 3);
  } else if (range === "1y") {
    start.setFullYear(start.getFullYear() - 1);
  } else if (range === "custom" && typeof query.start === "string" && query.start) {
    const parsedStart = new Date(query.start);
    if (!Number.isNaN(parsedStart.getTime())) {
      start = parsedStart;
    } else {
      start.setDate(start.getDate() - 29);
    }
    if (typeof query.end === "string" && query.end) {
      const parsedEnd = new Date(query.end);
      if (!Number.isNaN(parsedEnd.getTime())) {
        end = parsedEnd;
        end.setHours(23, 59, 59, 999);
      }
    }
  } else {
    start.setDate(start.getDate() - 29);
  }
  start.setHours(0, 0, 0, 0);
  if (start > end) {
    const tmp = new Date(start);
    start = new Date(end);
    start.setHours(0, 0, 0, 0);
    end = tmp;
    end.setHours(23, 59, 59, 999);
  }
  const spanMs = Math.max(864e5, end.getTime() - start.getTime());
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  const useMonthlyBuckets = spanMs > 95 * 864e5;
  return { range, start, end, prevStart, prevEnd, useMonthlyBuckets };
}
function formatBucketKey(dateStr, monthly) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (monthly) return `${y}-${m}`;
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function buildBucketSkeleton(start, end, monthly) {
  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), monthly ? 1 : start.getUTCDate()));
  const limit = monthly ? 24 : 400;
  while (cursor <= end && keys.length < limit) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    if (monthly) {
      keys.push(`${y}-${m}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      const day = String(cursor.getUTCDate()).padStart(2, "0");
      keys.push(`${y}-${m}-${day}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return keys;
}
function calcGrowthPct(current, previous) {
  if (previous <= 0) return null;
  return Number(((current - previous) / previous * 100).toFixed(1));
}
router5.get("/dashboard", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { range, start, end, prevStart, prevEnd, useMonthlyBuckets } = resolveDateRange(req.query);
    const [
      { data: profiles },
      { data: businesses },
      { count: ordersCount },
      { data: aiLogs },
      { data: wallets },
      { data: coinTxAll },
      { data: payments },
      { data: recentRegs },
      { data: recentBusinesses },
      { data: recentTx },
      { data: recentAudit },
      schemaStatus
    ] = await Promise.all([
      admin.from("profiles").select("id, status, role, created_at"),
      admin.from("businesses").select("id, status, category, subscription_plan_id, created_at"),
      admin.from("orders").select("id", { count: "exact", head: true }),
      admin.from("ai_usage_logs").select("total_tokens, provider_cost_usd, coins_deducted, status, created_at"),
      admin.from("coin_wallets").select("total_purchased, total_used, balance"),
      admin.from("coin_transactions").select("type, amount, created_at").gte("created_at", prevStart.toISOString()),
      admin.from("payments").select("amount, payment_for, status, created_at"),
      admin.from("profiles").select("id, email, full_name, role, status, created_at").order("created_at", { ascending: false }).limit(6),
      admin.from("businesses").select("id, name, owner_name, email, category, status, subscription_status, created_at, subscription_plan:subscription_plans(name, slug)").order("created_at", { ascending: false }).limit(6),
      admin.from("coin_transactions").select("*, business:businesses(id, name)").order("created_at", { ascending: false }).limit(8),
      admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(10),
      checkSchemaStatus()
    ]);
    const profs = profiles || [];
    const bizList = businesses || [];
    const aiList = aiLogs || [];
    const walletList = wallets || [];
    const payList = payments || [];
    const txList = coinTxAll || [];
    const totalUsers = profs.length;
    const activeUsers = profs.filter((p) => p.status === "active").length;
    const inactiveUsers = profs.filter((p) => p.status === "inactive").length;
    const suspendedUsers = profs.filter((p) => p.status === "suspended").length;
    const totalBusinesses = bizList.length;
    const activeBusinesses = bizList.filter((b) => b.status === "active").length;
    const suspendedBusinesses = bizList.filter((b) => b.status === "suspended").length;
    const inactiveBusinesses = bizList.filter((b) => b.status === "inactive").length;
    const totalAiRequests = aiList.filter((l) => l.status === "success").length;
    const totalTokensUsed = aiList.reduce((s, l) => s + Number(l.total_tokens || 0), 0);
    const estimatedProviderCostUsd = aiList.reduce((s, l) => s + Number(l.provider_cost_usd || 0), 0);
    const totalCoinsSold = walletList.reduce((s, w) => s + Number(w.total_purchased || 0), 0);
    const totalCoinsConsumed = walletList.reduce((s, w) => s + Number(w.total_used || 0), 0);
    const approvedPayments = payList.filter((p) => p.status === "approved");
    const pendingPaymentsCount = payList.filter((p) => p.status === "pending").length;
    const subscriptionRevenue = approvedPayments.filter((p) => p.payment_for === "subscription").reduce((s, p) => s + Number(p.amount || 0), 0);
    const coinPackageRevenue = approvedPayments.filter((p) => p.payment_for === "coin_package").reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalRevenue = subscriptionRevenue + coinPackageRevenue;
    const inCur = (d) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= start.getTime() && t <= end.getTime();
    };
    const inPrev = (d) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= prevStart.getTime() && t <= prevEnd.getTime();
    };
    const usersCur = profs.filter((p) => inCur(p.created_at)).length;
    const usersPrev = profs.filter((p) => inPrev(p.created_at)).length;
    const bizCur = bizList.filter((b) => inCur(b.created_at)).length;
    const bizPrev = bizList.filter((b) => inPrev(b.created_at)).length;
    const revCur = approvedPayments.filter((p) => inCur(p.created_at)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const revPrev = approvedPayments.filter((p) => inPrev(p.created_at)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const coinsCur = txList.filter((t) => t.type === "purchase" && inCur(t.created_at)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const coinsPrev = txList.filter((t) => t.type === "purchase" && inPrev(t.created_at)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const keys = buildBucketSkeleton(start, end, useMonthlyBuckets);
    const bucketMap = new Map(
      keys.map((k) => [
        k,
        { date: k, users: 0, businesses: 0, revenue: 0, coinsSold: 0, subscriptions: 0 }
      ])
    );
    for (const p of profs) {
      if (!inCur(p.created_at)) continue;
      const k = formatBucketKey(p.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.users += 1;
    }
    for (const biz of bizList) {
      if (!inCur(biz.created_at)) continue;
      const k = formatBucketKey(biz.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.businesses += 1;
    }
    for (const pay of approvedPayments) {
      if (!inCur(pay.created_at)) continue;
      const k = formatBucketKey(pay.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) {
        b.revenue += Number(pay.amount || 0);
        if (pay.payment_for === "subscription") {
          b.subscriptions += 1;
        }
      }
    }
    for (const tx of txList) {
      if (tx.type !== "purchase" || !inCur(tx.created_at)) continue;
      const k = formatBucketKey(tx.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.coinsSold += Number(tx.amount || 0);
    }
    return res.json({
      range,
      stats: {
        totalUsers,
        activeUsers,
        inactiveUsers,
        suspendedUsers,
        totalBusinesses,
        activeBusinesses,
        suspendedBusinesses,
        inactiveBusinesses,
        totalOrders: ordersCount || 0,
        totalAiRequests,
        totalTokensUsed,
        totalCoinsSold,
        totalCoinsConsumed,
        estimatedProviderCostUsd,
        subscriptionRevenue,
        coinPackageRevenue,
        totalRevenue,
        pendingPaymentsCount,
        usersGrowthPct: calcGrowthPct(usersCur, usersPrev),
        businessesGrowthPct: calcGrowthPct(bizCur, bizPrev),
        coinsGrowthPct: calcGrowthPct(coinsCur, coinsPrev),
        revenueGrowthPct: calcGrowthPct(revCur, revPrev)
      },
      series: Array.from(bucketMap.values()),
      businessDistribution: {
        active: activeBusinesses,
        suspended: suspendedBusinesses,
        inactive: inactiveBusinesses
      },
      recentRegistrations: recentRegs || [],
      recentBusinesses: recentBusinesses || [],
      recentTransactions: recentTx || [],
      systemActivity: recentAudit || [],
      supabaseHealth: schemaStatus,
      serverMeta: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        checkedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Admin dashboard error." });
  }
});
router5.get("/users", async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profiles }, { data: businesses }, { data: wallets }, { data: orders }, { data: products }] = await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }),
      admin.from("businesses").select("*, subscription_plan:subscription_plans(id, name, slug)").order("created_at", { ascending: false }),
      admin.from("coin_wallets").select("*"),
      admin.from("orders").select("business_id"),
      admin.from("products").select("business_id")
    ]);
    const walletMap = new Map((wallets || []).map((w) => [w.business_id, w]));
    const orderCountMap = /* @__PURE__ */ new Map();
    for (const o of orders || []) {
      orderCountMap.set(o.business_id, (orderCountMap.get(o.business_id) || 0) + 1);
    }
    const productCountMap = /* @__PURE__ */ new Map();
    for (const p of products || []) {
      productCountMap.set(p.business_id, (productCountMap.get(p.business_id) || 0) + 1);
    }
    const enrichedBusinesses = (businesses || []).map((b) => ({
      ...b,
      wallet: walletMap.get(b.id) || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      ordersCount: orderCountMap.get(b.id) || 0,
      productsCount: productCountMap.get(b.id) || 0
    }));
    return res.json({ users: profiles || [], businesses: enrichedBusinesses });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load users." });
  }
});
router5.patch("/users/:userId", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.userId)) {
      return res.status(400).json({ error: "Invalid user identifier." });
    }
    const admin = getSupabaseAdmin();
    const { full_name, phone, status, role, language } = req.body;
    if (req.params.userId === req.user.id && (status && status !== "active" || role && role !== "super_admin")) {
      return res.status(400).json({ error: "You cannot suspend or demote your own active Super Admin account." });
    }
    const payload = {};
    if (full_name !== void 0) payload.full_name = String(full_name).trim();
    if (phone !== void 0) payload.phone = String(phone).trim();
    if (status && ["active", "inactive", "suspended"].includes(status)) payload.status = status;
    if (role && ["super_admin", "business_owner", "business_admin", "business_staff", "support_staff"].includes(role)) {
      payload.role = role;
    }
    if (language && ["bn", "en"].includes(language)) payload.language = language;
    const { data, error } = await admin.from("profiles").update(payload).eq("id", req.params.userId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "user_updated",
      targetType: "profile",
      targetId: req.params.userId,
      details: payload,
      ipAddress: req.ip
    });
    return res.json({ user: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update user." });
  }
});
router5.patch("/users/:userId/status", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.userId)) {
      return res.status(400).json({ error: "Invalid user identifier." });
    }
    const admin = getSupabaseAdmin();
    const { status, role } = req.body;
    if (req.params.userId === req.user.id && (status && status !== "active" || role && role !== "super_admin")) {
      return res.status(400).json({ error: "You cannot suspend or demote your own active Super Admin account." });
    }
    const { data, error } = await admin.from("profiles").update({
      ...status ? { status } : {},
      ...role ? { role } : {}
    }).eq("id", req.params.userId).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "user_status_updated",
      targetType: "profile",
      targetId: req.params.userId,
      details: { status, role },
      ipAddress: req.ip
    });
    return res.json({ user: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update user." });
  }
});
router5.patch("/businesses/:businessId", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.businessId)) {
      return res.status(400).json({ error: "Invalid business identifier." });
    }
    const admin = getSupabaseAdmin();
    const { name, owner_name, email, phone, category, address, status } = req.body;
    const payload = {};
    if (name !== void 0) payload.name = name.trim();
    if (owner_name !== void 0) payload.owner_name = owner_name.trim();
    if (email !== void 0) payload.email = email.trim();
    if (phone !== void 0) payload.phone = phone.trim();
    if (category !== void 0) payload.category = category.trim();
    if (address !== void 0) payload.address = address.trim();
    if (status && ["active", "inactive", "suspended"].includes(status)) payload.status = status;
    const { data, error } = await admin.from("businesses").update(payload).eq("id", req.params.businessId).select("*, subscription_plan:subscription_plans(id, name, slug)").single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.params.businessId,
      action: status ? `business_status_${status}` : "business_updated",
      targetType: "business",
      targetId: req.params.businessId,
      details: payload,
      ipAddress: req.ip
    });
    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update business." });
  }
});
router5.get("/businesses/:businessId/summary", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.businessId)) {
      return res.status(400).json({ error: "Invalid business identifier." });
    }
    const admin = getSupabaseAdmin();
    const bid = req.params.businessId;
    const [
      { count: ordersCount },
      { count: productsCount },
      { count: customersCount },
      { count: aiRequestsCount },
      { data: recentOrders },
      { data: wallet },
      { data: overrides },
      { data: plans }
    ] = await Promise.all([
      admin.from("orders").select("id", { count: "exact", head: true }).eq("business_id", bid),
      admin.from("products").select("id", { count: "exact", head: true }).eq("business_id", bid),
      admin.from("customers").select("id", { count: "exact", head: true }).eq("business_id", bid),
      admin.from("ai_usage_logs").select("id", { count: "exact", head: true }).eq("business_id", bid),
      admin.from("orders").select("id, order_number, customer_name, total_amount, order_status, created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(5),
      admin.from("coin_wallets").select("*").eq("business_id", bid).maybeSingle(),
      admin.from("user_feature_overrides").select("*").eq("business_id", bid),
      admin.from("subscription_plans").select("id, name, slug, duration_days").order("display_order")
    ]);
    return res.json({
      ordersCount: ordersCount || 0,
      productsCount: productsCount || 0,
      customersCount: customersCount || 0,
      aiRequestsCount: aiRequestsCount || 0,
      recentOrders: recentOrders || [],
      wallet: wallet || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      overrides: overrides || [],
      plans: plans || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load business summary." });
  }
});
router5.post("/businesses/:businessId/coins", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.businessId)) {
      return res.status(400).json({ error: "Invalid business identifier." });
    }
    const admin = getSupabaseAdmin();
    const { amount, mode, reason } = req.body;
    const numAmt = Number(amount);
    if (!numAmt || numAmt <= 0) return res.status(400).json({ error: "Positive coin amount is required." });
    let result;
    if (mode === "debit") {
      const { data, error } = await admin.rpc("deduct_ai_coins_atomic", {
        p_business_id: req.params.businessId,
        p_amount: numAmt,
        p_description: reason || "Super Admin Coin Deduction",
        p_reference_id: "admin_adjustment",
        p_user_id: req.user.id
      });
      if (error) return res.status(400).json({ error: error.message });
      result = Array.isArray(data) ? data[0] : data;
    } else {
      const { data, error } = await admin.rpc("credit_ai_coins_atomic", {
        p_business_id: req.params.businessId,
        p_amount: numAmt,
        p_type: "admin_credit",
        p_description: reason || "Super Admin Coin Grant",
        p_reference_id: "admin_adjustment",
        p_user_id: req.user.id
      });
      if (error) return res.status(400).json({ error: error.message });
      result = Array.isArray(data) ? data[0] : data;
    }
    if (!result?.success) return res.status(400).json({ error: result?.message || "Coin adjustment failed." });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.params.businessId,
      action: mode === "debit" ? "admin_coin_deduct" : "admin_coin_credit",
      targetType: "coin_wallet",
      targetId: req.params.businessId,
      details: { amount: numAmt, reason, new_balance: result.new_balance },
      ipAddress: req.ip
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Coin adjustment failed." });
  }
});
router5.post("/businesses/:businessId/subscription", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.businessId)) {
      return res.status(400).json({ error: "Invalid business identifier." });
    }
    const admin = getSupabaseAdmin();
    const { plan_id, extra_days, status } = req.body;
    const { data: biz } = await admin.from("businesses").select("subscription_expires_at").eq("id", req.params.businessId).maybeSingle();
    const baseTime = biz?.subscription_expires_at ? Math.max(Date.now(), new Date(biz.subscription_expires_at).getTime()) : Date.now();
    const newExpiry = new Date(baseTime + Number(extra_days || 30) * 864e5).toISOString();
    const { data, error } = await admin.from("businesses").update({
      ...plan_id ? { subscription_plan_id: plan_id } : {},
      ...status ? { subscription_status: status } : { subscription_status: "active" },
      subscription_expires_at: newExpiry
    }).eq("id", req.params.businessId).select("*, subscription_plan:subscription_plans(*)").single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      businessId: req.params.businessId,
      action: "admin_subscription_updated",
      targetType: "business",
      targetId: req.params.businessId,
      details: { plan_id, extra_days, newExpiry },
      ipAddress: req.ip
    });
    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Subscription update failed." });
  }
});
router5.get("/coin-packages", async (_req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: packages }, { data: transactions }] = await Promise.all([
    admin.from("coin_packages").select("*").order("display_order"),
    admin.from("coin_transactions").select("*, business:businesses(id, name)").order("created_at", { ascending: false }).limit(100)
  ]);
  return res.json({ packages: packages || [], transactions: transactions || [] });
});
router5.post("/coin-packages", async (req, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body;
  const { data, error } = await admin.from("coin_packages").insert(b).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "coin_package_created", targetType: "coin_package", targetId: data.id, details: b });
  return res.status(201).json({ package: data });
});
router5.patch("/coin-packages/:id", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("coin_packages").update(req.body).eq("id", req.params.id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "coin_package_updated", targetType: "coin_package", targetId: req.params.id, details: req.body });
  return res.json({ package: data });
});
router5.delete("/coin-packages/:id", async (req, res) => {
  try {
    if (!UUID_RE2.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid package identifier." });
    }
    const admin = getSupabaseAdmin();
    const { count } = await admin.from("package_purchases").select("id", { count: "exact", head: true }).eq("package_id", req.params.id);
    if ((count || 0) > 0) {
      return res.status(400).json({
        error: "This coin package has recorded purchases and cannot be deleted. Set its status to inactive or archived instead."
      });
    }
    const { error } = await admin.from("coin_packages").delete().eq("id", req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "coin_package_deleted",
      targetType: "coin_package",
      targetId: req.params.id,
      ipAddress: req.ip
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete coin package." });
  }
});
router5.get("/subscription-plans", async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("subscription_plans").select("*").order("display_order");
  return res.json({ plans: data || [] });
});
router5.post("/subscription-plans", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("subscription_plans").insert(req.body).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "subscription_plan_created", targetType: "subscription_plan", targetId: data.id, details: req.body });
  return res.status(201).json({ plan: data });
});
router5.patch("/subscription-plans/:id", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("subscription_plans").update(req.body).eq("id", req.params.id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "subscription_plan_updated", targetType: "subscription_plan", targetId: req.params.id, details: req.body });
  return res.json({ plan: data });
});
router5.get("/ai", async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    await ensureDefaultAiProvidersAndModels();
    const [provRes, modelRes, logRes] = await Promise.all([
      admin.from("ai_providers").select("id, slug, name, provider_type, base_url, api_key_encrypted, is_active, priority, updated_at").order("priority"),
      admin.from("ai_models").select("*, provider:ai_providers(id, slug, name)").order("priority"),
      admin.from("ai_usage_logs").select("*").order("created_at", { ascending: false }).limit(80)
    ]);
    if (provRes.error) return res.status(500).json({ error: provRes.error.message });
    if (modelRes.error) return res.status(500).json({ error: modelRes.error.message });
    const safeProviders = (provRes.data || []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      provider_type: p.provider_type,
      base_url: p.base_url,
      is_active: p.is_active,
      priority: p.priority,
      updated_at: p.updated_at,
      has_api_key: Boolean(p.api_key_encrypted && String(p.api_key_encrypted).trim().length > 0)
    }));
    return res.json({ providers: safeProviders, models: modelRes.data || [], usageLogs: logRes.data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load AI providers." });
  }
});
router5.post("/ai/providers", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { slug, name, provider_type, base_url, api_key, is_active, priority } = req.body;
  const cleanSlug = String(slug || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  const cleanName = String(name || "").trim();
  const cleanBaseUrl = typeof base_url === "string" ? base_url.trim() : "";
  const cleanKey = typeof api_key === "string" ? api_key.trim() : "";
  if (!cleanSlug || !cleanName) {
    return res.status(400).json({ error: "Provider slug and display name are required." });
  }
  if (!isValidHttpOrRelativeUrl(cleanBaseUrl, false)) {
    return res.status(400).json({ error: "Invalid provider Base URL. Must be a public http(s) URL." });
  }
  const { data, error } = await admin.from("ai_providers").insert({
    slug: cleanSlug,
    name: cleanName,
    provider_type: String(provider_type || "custom"),
    base_url: cleanBaseUrl,
    api_key_encrypted: cleanKey ? encryptSecret(cleanKey) : "",
    is_active: is_active !== false,
    priority: Number(priority || 1)
  }).select("id, slug, name, provider_type, base_url, is_active, priority").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "ai_provider_created", targetType: "ai_provider", targetId: data.id, details: { slug: cleanSlug, name: cleanName } });
  return res.status(201).json({ provider: { ...data, has_api_key: Boolean(cleanKey) } });
});
router5.patch("/ai/providers/:id", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, base_url, api_key, is_active, priority } = req.body;
    const cleanBaseUrl = typeof base_url === "string" ? base_url.trim() : void 0;
    const cleanKey = typeof api_key === "string" ? api_key.trim() : "";
    if (cleanBaseUrl !== void 0 && !isValidHttpOrRelativeUrl(cleanBaseUrl, false)) {
      return res.status(400).json({ error: "Invalid provider Base URL. Must be a public http(s) URL." });
    }
    const { data: existing } = await admin.from("ai_providers").select("id, provider_type, name, is_active, api_key_encrypted").eq("id", req.params.id).maybeSingle();
    if (!existing) {
      return res.status(404).json({ error: "AI provider not found." });
    }
    const payload = {
      ...name !== void 0 ? { name: String(name).trim() } : {},
      ...cleanBaseUrl !== void 0 ? { base_url: cleanBaseUrl } : {},
      ...is_active !== void 0 ? { is_active: Boolean(is_active) } : {},
      ...priority !== void 0 ? { priority: Number(priority) } : {}
    };
    if (cleanKey) {
      payload.api_key_encrypted = encryptSecret(cleanKey);
      if (is_active === void 0 && !existing.is_active) {
        payload.is_active = true;
      }
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "Please paste an API key or update a configuration field before saving." });
    }
    payload.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    const { data, error } = await admin.from("ai_providers").update(payload).eq("id", req.params.id).select("id, slug, name, provider_type, base_url, api_key_encrypted, is_active, priority").single();
    if (error) return res.status(400).json({ error: error.message });
    if (cleanKey) {
      await ensureDefaultModelForProvider({
        id: data.id,
        provider_type: data.provider_type,
        name: data.name
      });
    }
    await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "ai_provider_updated", targetType: "ai_provider", targetId: req.params.id, details: { name: data.name, is_active: data.is_active, keyUpdated: Boolean(cleanKey) } });
    return res.json({
      provider: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        provider_type: data.provider_type,
        base_url: data.base_url,
        is_active: data.is_active,
        priority: data.priority,
        has_api_key: Boolean(data.api_key_encrypted && String(data.api_key_encrypted).trim().length > 0)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update AI provider." });
  }
});
router5.post("/ai/providers/:id/test", async (req, res) => {
  const { api_key, base_url, model_id } = req.body || {};
  const result = await testProviderConnection(req.params.id, {
    apiKey: typeof api_key === "string" && api_key.trim() ? api_key.trim() : void 0,
    baseUrl: typeof base_url === "string" && base_url.trim() ? base_url.trim() : void 0,
    modelId: typeof model_id === "string" && model_id.trim() ? model_id.trim() : void 0
  });
  return res.json(result);
});
router5.post("/ai/models", async (req, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body;
  const provider_id = String(b.provider_id || "").trim();
  const model_id = String(b.model_id || "").trim();
  const display_name = String(b.display_name || "").trim();
  if (!provider_id || !model_id || !display_name) {
    return res.status(400).json({ error: "Provider, Model ID, and Display Name are required." });
  }
  const insertPayload = {
    provider_id,
    model_id,
    display_name,
    input_cost_per_1m: Number.isFinite(Number(b.input_cost_per_1m)) ? Number(b.input_cost_per_1m) : 0.15,
    output_cost_per_1m: Number.isFinite(Number(b.output_cost_per_1m)) ? Number(b.output_cost_per_1m) : 0.6,
    coins_per_usd: Number.isFinite(Number(b.coins_per_usd)) ? Number(b.coins_per_usd) : 1e3,
    max_tokens: Number.isFinite(Number(b.max_tokens)) ? Number(b.max_tokens) : 2048,
    min_plan_slug: String(b.min_plan_slug || "free"),
    is_active: b.is_active !== false,
    is_default: Boolean(b.is_default),
    is_fallback: Boolean(b.is_fallback),
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 1
  };
  if (insertPayload.is_default) {
    await admin.from("ai_models").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data, error } = await admin.from("ai_models").insert(insertPayload).select("*, provider:ai_providers(id, slug, name)").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "ai_model_created", targetType: "ai_model", targetId: data.id, details: insertPayload });
  return res.status(201).json({ model: data });
});
router5.patch("/ai/models/:id", async (req, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body;
  if (b.is_default === true) {
    await admin.from("ai_models").update({ is_default: false }).neq("id", req.params.id);
  }
  const { data, error } = await admin.from("ai_models").update(b).eq("id", req.params.id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "ai_model_updated", targetType: "ai_model", targetId: req.params.id, details: b });
  return res.json({ model: data });
});
router5.delete("/ai/models/:id", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("ai_models").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "ai_model_deleted", targetType: "ai_model", targetId: req.params.id });
  return res.json({ success: true });
});
router5.post("/ai/models/:id/test", async (req, res) => {
  const result = await testModelConnection(req.params.id);
  return res.json(result);
});
router5.get("/features", async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("feature_flags").select("*").order("key");
  return res.json({ features: data || [] });
});
router5.patch("/features/:key", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("feature_flags").update(req.body).eq("key", req.params.key).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user.id, actorEmail: req.user.email, actorRole: req.user.role, action: "feature_flag_updated", targetType: "feature_flag", targetId: req.params.key, details: req.body });
  return res.json({ feature: data });
});
router5.get("/payments", async (_req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: gateways }, { data: payments }] = await Promise.all([
    admin.from("payment_gateways").select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").order("slug"),
    admin.from("payments").select("*, business:businesses(id, name, email)").order("created_at", { ascending: false }).limit(200)
  ]);
  return res.json({
    gateways: (gateways || []).map((g) => toSafeGatewayRow(g)),
    payments: payments || []
  });
});
router5.put("/manual-payment-methods/:method", async (req, res) => {
  try {
    const method = String(req.params.method || "").trim().toLowerCase();
    if (method !== "bkash" && method !== "nagad" && method !== "rocket") {
      return res.status(400).json({ error: "Method must be bkash, nagad, or rocket." });
    }
    const { accounts, is_active, instructions, name } = req.body;
    const gateway = await upsertManualGatewayAccounts(
      method,
      { accounts, is_active, instructions, name },
      { id: req.user.id, email: req.user.email, role: req.user.role, ip: req.ip }
    );
    return res.json({ gateway });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Failed to update manual payment method." });
  }
});
router5.post("/payment-gateways", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const body = req.body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : name;
    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    const gateway_type = typeof body.gateway_type === "string" ? body.gateway_type.trim().toLowerCase() : "manual";
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Gateway name must be between 2 and 100 characters." });
    }
    if (!GATEWAY_SLUG_REGEX.test(slug)) {
      return res.status(400).json({ error: "Gateway slug must be 2\u201349 lowercase letters, numbers, hyphens, or underscores." });
    }
    if (!ALLOWED_GATEWAY_TYPES.has(gateway_type)) {
      return res.status(400).json({ error: "Invalid gateway_type. Allowed: manual, bkash, nagad, rocket, sslcommerz, custom." });
    }
    const { data: existing } = await admin.from("payment_gateways").select("id").eq("slug", slug).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: `A payment gateway with slug "${slug}" already exists.` });
    }
    const config_public = sanitizeGatewayConfigPublic(
      {
        ...body.config_public && typeof body.config_public === "object" ? body.config_public : {},
        ...gateway_type === "rocket" ? { manual_method: "rocket" } : {}
      },
      gateway_type || slug
    );
    const credentials_encrypted = buildEncryptedCredentials(body.credentials);
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1e3) : "";
    const insertPayload = {
      slug,
      name,
      gateway_type,
      is_active: body.is_active !== false,
      is_sandbox: body.is_sandbox === true,
      config_public,
      credentials_encrypted,
      instructions,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    let result = await admin.from("payment_gateways").insert(insertPayload).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    if (result.error && gateway_type === "rocket" && result.error.message.toLowerCase().includes("gateway_type")) {
      result = await admin.from("payment_gateways").insert({ ...insertPayload, gateway_type: "manual" }).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    }
    if (result.error) return res.status(400).json({ error: result.error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "payment_gateway_created",
      targetType: "payment_gateway",
      targetId: slug,
      details: { name, gateway_type, is_active: body.is_active !== false, is_sandbox: body.is_sandbox === true },
      ipAddress: req.ip
    });
    return res.status(201).json({ gateway: toSafeGatewayRow(result.data) });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Failed to create payment gateway." });
  }
});
router5.patch("/payment-gateways/:slug", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const {
      name,
      gateway_type,
      is_active,
      is_sandbox,
      config_public,
      credentials,
      clear_credentials,
      instructions
    } = req.body;
    const { data: existingGw } = await admin.from("payment_gateways").select("slug, gateway_type, config_public").eq("slug", req.params.slug).maybeSingle();
    if (!existingGw) {
      return res.status(404).json({ error: "Payment gateway not found." });
    }
    const effectiveType = typeof gateway_type === "string" ? gateway_type.trim().toLowerCase() : String(existingGw.gateway_type || req.params.slug);
    const payload = {
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({ error: "Gateway name must be between 2 and 100 characters." });
      }
      payload.name = trimmed;
    }
    if (typeof gateway_type === "string") {
      const normalizedType = gateway_type.trim().toLowerCase();
      if (!ALLOWED_GATEWAY_TYPES.has(normalizedType)) {
        return res.status(400).json({ error: "Invalid gateway_type." });
      }
      payload.gateway_type = normalizedType;
    }
    if (typeof is_active === "boolean") payload.is_active = is_active;
    if (typeof is_sandbox === "boolean") payload.is_sandbox = is_sandbox;
    if (config_public !== void 0) {
      payload.config_public = sanitizeGatewayConfigPublic(
        {
          ...config_public && typeof config_public === "object" ? config_public : {},
          ...effectiveType === "rocket" ? { manual_method: "rocket" } : {}
        },
        effectiveType
      );
    }
    if (typeof instructions === "string") payload.instructions = instructions.trim().slice(0, 1e3);
    let credentialsUpdated = false;
    const encryptedCreds = buildEncryptedCredentials(credentials);
    if (clear_credentials === true) {
      payload.credentials_encrypted = "";
      credentialsUpdated = true;
    } else if (encryptedCreds) {
      payload.credentials_encrypted = encryptedCreds;
      credentialsUpdated = true;
    }
    let result = await admin.from("payment_gateways").update(payload).eq("slug", req.params.slug).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    if (result.error && payload.gateway_type === "rocket" && result.error.message.toLowerCase().includes("gateway_type")) {
      result = await admin.from("payment_gateways").update({ ...payload, gateway_type: "manual" }).eq("slug", req.params.slug).select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at").single();
    }
    if (result.error) return res.status(400).json({ error: result.error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "payment_gateway_updated",
      targetType: "payment_gateway",
      targetId: req.params.slug,
      details: { is_active, is_sandbox, name: payload.name, gateway_type: payload.gateway_type, credentialsUpdated },
      ipAddress: req.ip
    });
    return res.json({ gateway: toSafeGatewayRow(result.data) });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Failed to update payment gateway." });
  }
});
router5.delete("/payment-gateways/:slug", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const slug = req.params.slug;
    if (slug === "manual" || slug === "bkash" || slug === "nagad" || slug === "rocket") {
      return res.status(400).json({ error: "Built-in payment methods cannot be deleted. You can disable them instead." });
    }
    const { count } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("gateway_slug", slug);
    if ((count || 0) > 0) {
      return res.status(400).json({
        error: `Cannot delete gateway "${slug}" because ${count} payment record(s) reference it. Disable it instead to preserve payment history.`
      });
    }
    const { error } = await admin.from("payment_gateways").delete().eq("slug", slug);
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "payment_gateway_deleted",
      targetType: "payment_gateway",
      targetId: slug,
      ipAddress: req.ip
    });
    return res.json({ deleted: true, slug });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete payment gateway." });
  }
});
router5.post("/payments/:paymentId/review", async (req, res) => {
  try {
    const { decision, admin_notes } = req.body;
    const updated = await reviewManualPayment({
      paymentId: req.params.paymentId,
      decision,
      adminNotes: admin_notes,
      adminUser: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        ip: req.ip
      }
    });
    return res.json({ payment: updated });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : "Payment review failed." });
  }
});
router5.get("/meta-settings", async (req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: settings }, { data: connections }, { data: logs }] = await Promise.all([
    admin.from("application_settings").select("meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode").eq("id", 1).maybeSingle(),
    admin.from("social_connections").select("id, business_id, platform, account_name, status, connected_at"),
    admin.from("social_connection_logs").select("*").order("created_at", { ascending: false }).limit(30)
  ]);
  const baseUrl = resolveAppBaseUrl(req);
  return res.json({
    settings: settings ? {
      meta_app_id: settings.meta_app_id,
      meta_api_version: settings.meta_api_version,
      meta_webhook_verify_token: settings.meta_webhook_verify_token,
      meta_mode: settings.meta_mode,
      has_meta_app_secret: Boolean(settings.meta_app_secret_encrypted)
    } : null,
    oauthRedirectUri: getMetaOAuthRedirectUri(req),
    webhookUrl: `${baseUrl}/api/webhooks/meta`,
    connections: connections || [],
    logs: logs || []
  });
});
router5.patch("/meta-settings", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { meta_app_id, meta_app_secret, meta_api_version, meta_webhook_verify_token, meta_mode } = req.body;
  const payload = {
    ...meta_app_id !== void 0 ? { meta_app_id } : {},
    ...meta_api_version !== void 0 ? { meta_api_version } : {},
    ...meta_webhook_verify_token !== void 0 ? { meta_webhook_verify_token } : {},
    ...meta_mode !== void 0 ? { meta_mode } : {}
  };
  if (meta_app_secret && meta_app_secret.trim()) {
    payload.meta_app_secret_encrypted = encryptSecret(meta_app_secret.trim());
  }
  const { data, error } = await admin.from("application_settings").update(payload).eq("id", 1).select("meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode").single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    action: "meta_platform_settings_updated",
    targetType: "application_settings",
    targetId: "1",
    details: { meta_app_id, meta_mode, secretUpdated: Boolean(meta_app_secret) }
  });
  return res.json({
    settings: {
      meta_app_id: data.meta_app_id,
      meta_api_version: data.meta_api_version,
      meta_webhook_verify_token: data.meta_webhook_verify_token,
      meta_mode: data.meta_mode,
      has_meta_app_secret: Boolean(data.meta_app_secret_encrypted)
    }
  });
});
router5.get("/settings", async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("application_settings").select(
    "id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, updated_at"
  ).eq("id", 1).maybeSingle();
  return res.json({ settings: data });
});
router5.patch("/settings", async (req, res) => {
  const admin = getSupabaseAdmin();
  const allowedKeys = [
    "app_name",
    "logo_url",
    "icon_url",
    "default_theme",
    "primary_color",
    "secondary_color",
    "default_language",
    "maintenance_mode",
    "registration_enabled",
    "support_email",
    "support_phone",
    "terms_url",
    "privacy_url",
    "announcement"
  ];
  const urlKeys = ["logo_url", "icon_url", "terms_url", "privacy_url"];
  const payload = {};
  for (const k of allowedKeys) {
    if (req.body[k] !== void 0) {
      if (urlKeys.includes(k) && !isValidHttpOrRelativeUrl(req.body[k], true)) {
        return res.status(400).json({ error: `Invalid URL provided for ${k}.` });
      }
      payload[k] = req.body[k];
    }
  }
  const { data, error } = await admin.from("application_settings").update(payload).eq("id", 1).select(
    "id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, updated_at"
  ).single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    action: "global_settings_updated",
    targetType: "application_settings",
    targetId: "1",
    details: payload
  });
  return res.json({ settings: data });
});
router5.get("/analytics", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { range, start, end, useMonthlyBuckets } = resolveDateRange(req.query);
    const [
      { data: profiles },
      { data: businesses },
      { data: plans },
      { data: orders },
      { data: payments },
      { data: aiLogs }
    ] = await Promise.all([
      admin.from("profiles").select("id, created_at, status"),
      admin.from("businesses").select("id, name, category, status, subscription_plan_id, created_at"),
      admin.from("subscription_plans").select("id, name, slug"),
      admin.from("orders").select("id, business_id, total_amount, order_status, created_at"),
      admin.from("payments").select("id, business_id, amount, payment_for, status, created_at"),
      admin.from("ai_usage_logs").select("business_id, provider_slug, total_tokens, provider_cost_usd, coins_deducted, status, created_at")
    ]);
    const inCur = (d) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= start.getTime() && t <= end.getTime();
    };
    const keys = buildBucketSkeleton(start, end, useMonthlyBuckets);
    const bucketMap = new Map(
      keys.map((k) => [
        k,
        { date: k, revenue: 0, orders: 0, users: 0, businesses: 0, aiRequests: 0, coinsUsed: 0 }
      ])
    );
    const profs = profiles || [];
    const bizList = businesses || [];
    const orderList = orders || [];
    const payList = (payments || []).filter((p) => p.status === "approved");
    const aiList = aiLogs || [];
    let periodRevenue = 0;
    let periodSubRevenue = 0;
    let periodCoinRevenue = 0;
    let periodOrders = 0;
    let periodGmv = 0;
    let periodAiRequests = 0;
    let periodTokens = 0;
    let periodAiCostUsd = 0;
    let periodCoinsUsed = 0;
    for (const p of profs) {
      if (!inCur(p.created_at)) continue;
      const k = formatBucketKey(p.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.users += 1;
    }
    for (const biz of bizList) {
      if (!inCur(biz.created_at)) continue;
      const k = formatBucketKey(biz.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.businesses += 1;
    }
    for (const o of orderList) {
      if (!inCur(o.created_at)) continue;
      periodOrders += 1;
      periodGmv += Number(o.total_amount || 0);
      const k = formatBucketKey(o.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.orders += 1;
    }
    for (const p of payList) {
      if (!inCur(p.created_at)) continue;
      const amt = Number(p.amount || 0);
      periodRevenue += amt;
      if (p.payment_for === "subscription") periodSubRevenue += amt;
      if (p.payment_for === "coin_package") periodCoinRevenue += amt;
      const k = formatBucketKey(p.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) b.revenue += amt;
    }
    const providerMap = /* @__PURE__ */ new Map();
    const bizAiMap = /* @__PURE__ */ new Map();
    for (const l of aiList) {
      if (!inCur(l.created_at)) continue;
      if (l.status === "success") periodAiRequests += 1;
      const tokens = Number(l.total_tokens || 0);
      const coins = Number(l.coins_deducted || 0);
      const cost = Number(l.provider_cost_usd || 0);
      periodTokens += tokens;
      periodCoinsUsed += coins;
      periodAiCostUsd += cost;
      const k = formatBucketKey(l.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : void 0;
      if (b) {
        if (l.status === "success") b.aiRequests += 1;
        b.coinsUsed += coins;
      }
      const prev = providerMap.get(l.provider_slug) || {
        providerSlug: l.provider_slug,
        requests: 0,
        tokens: 0,
        coinsUsed: 0,
        costUsd: 0
      };
      if (l.status === "success") prev.requests += 1;
      prev.tokens += tokens;
      prev.coinsUsed += coins;
      prev.costUsd += cost;
      providerMap.set(l.provider_slug, prev);
      bizAiMap.set(l.business_id, (bizAiMap.get(l.business_id) || 0) + coins);
    }
    const catCount = /* @__PURE__ */ new Map();
    for (const b of bizList) {
      const cat = b.category || "Uncategorized";
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }
    const planNameMap = new Map((plans || []).map((p) => [p.id, p.name]));
    const planCount = /* @__PURE__ */ new Map();
    for (const b of bizList) {
      const pName = b.subscription_plan_id && planNameMap.get(b.subscription_plan_id) || "Unassigned";
      planCount.set(pName, (planCount.get(pName) || 0) + 1);
    }
    const bizOrderStats = /* @__PURE__ */ new Map();
    for (const o of orderList) {
      if (!inCur(o.created_at)) continue;
      const cur = bizOrderStats.get(o.business_id) || { orders: 0, gmv: 0 };
      cur.orders += 1;
      cur.gmv += Number(o.total_amount || 0);
      bizOrderStats.set(o.business_id, cur);
    }
    const topBusinesses = bizList.map((b) => {
      const os = bizOrderStats.get(b.id) || { orders: 0, gmv: 0 };
      return {
        id: b.id,
        name: b.name,
        category: b.category,
        status: b.status,
        orders: os.orders,
        gmv: os.gmv,
        aiCoinsUsed: Number((bizAiMap.get(b.id) || 0).toFixed(2))
      };
    }).sort((a, b) => b.gmv - a.gmv || b.orders - a.orders).slice(0, 8);
    return res.json({
      range,
      summary: {
        periodRevenue,
        periodSubRevenue,
        periodCoinRevenue,
        periodOrders,
        periodGmv,
        periodAiRequests,
        periodTokens,
        periodAiCostUsd,
        periodCoinsUsed,
        totalBusinesses: bizList.length,
        activeBusinesses: bizList.filter((b) => b.status === "active").length
      },
      timeSeries: Array.from(bucketMap.values()),
      businessByCategory: Array.from(catCount.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      planDistribution: Array.from(planCount.entries()).map(([planName, count]) => ({ planName, count })).sort((a, b) => b.count - a.count),
      aiProviderUsage: Array.from(providerMap.values()).sort((a, b) => b.requests - a.requests),
      topBusinesses
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Analytics error." });
  }
});
router5.get("/audit-logs", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: auditLogs }, { data: aiErrors }, { data: socialLogs }] = await Promise.all([
      admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200),
      admin.from("ai_usage_logs").select("id, business_id, provider_slug, model_id, status, error_message, coins_deducted, total_tokens, created_at").order("created_at", { ascending: false }).limit(100),
      admin.from("social_connection_logs").select("*").order("created_at", { ascending: false }).limit(100)
    ]);
    return res.json({
      logs: auditLogs || [],
      aiLogs: aiErrors || [],
      socialLogs: socialLogs || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load logs." });
  }
});
router5.get("/notifications", async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: notifications }, { data: pendingPayments }, { data: businesses }, { data: settings }] = await Promise.all([
      admin.from("notifications").select("*, business:businesses(id, name)").order("created_at", { ascending: false }).limit(80),
      admin.from("payments").select("id, business_id, payment_for, amount, currency, gateway_slug, created_at, business:businesses(name)").eq("status", "pending").order("created_at", { ascending: false }),
      admin.from("businesses").select("id, name, owner_id, status").order("name"),
      admin.from("application_settings").select("announcement").eq("id", 1).maybeSingle()
    ]);
    return res.json({
      notifications: notifications || [],
      pendingPayments: pendingPayments || [],
      businesses: businesses || [],
      announcement: settings?.announcement || ""
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load notifications." });
  }
});
router5.post("/notifications/broadcast", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { title, body, type, targetBusinessId } = req.body;
    if (!title?.trim()) {
      return res.status(400).json({ error: "Notification title is required." });
    }
    const safeType = type && ["info", "success", "warning", "error"].includes(type) ? type : "info";
    if (targetBusinessId && targetBusinessId !== "all") {
      if (!UUID_RE2.test(targetBusinessId)) {
        return res.status(400).json({ error: "Invalid target business ID." });
      }
      const { data: biz } = await admin.from("businesses").select("id, owner_id").eq("id", targetBusinessId).maybeSingle();
      if (!biz) return res.status(404).json({ error: "Target business not found." });
      await createNotification({
        businessId: biz.id,
        userId: biz.owner_id,
        title: title.trim(),
        body: (body || "").trim(),
        type: safeType
      });
      await writeAuditLog({
        actorId: req.user.id,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        businessId: biz.id,
        action: "admin_notification_sent",
        targetType: "notification",
        targetId: biz.id,
        details: { title: title.trim(), type: safeType }
      });
      return res.status(201).json({ sentCount: 1 });
    }
    const { data: allBiz } = await admin.from("businesses").select("id, owner_id").eq("status", "active");
    const targets = allBiz || [];
    if (targets.length > 0) {
      await admin.from("notifications").insert(
        targets.map((b) => ({
          business_id: b.id,
          user_id: b.owner_id,
          title: title.trim(),
          body: (body || "").trim(),
          type: safeType
        }))
      );
    }
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "admin_notification_broadcast",
      targetType: "notification",
      targetId: "all",
      details: { title: title.trim(), type: safeType, sentCount: targets.length }
    });
    return res.status(201).json({ sentCount: targets.length });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send notification." });
  }
});
router5.patch("/profile", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { full_name, phone, language, timezone } = req.body;
    const payload = {};
    if (full_name !== void 0) payload.full_name = String(full_name).trim();
    if (phone !== void 0) payload.phone = String(phone).trim();
    if (language && ["bn", "en"].includes(language)) payload.language = language;
    if (timezone !== void 0) payload.timezone = String(timezone).trim();
    const { data, error } = await admin.from("profiles").update(payload).eq("id", req.user.id).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "admin_profile_updated",
      targetType: "profile",
      targetId: req.user.id,
      details: payload,
      ipAddress: req.ip
    });
    return res.json({ profile: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Profile update failed." });
  }
});
router5.get("/security", async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profiles }, { data: securityLogs }] = await Promise.all([
      admin.from("profiles").select("id, email, full_name, role, status, created_at").order("created_at", { ascending: false }),
      admin.from("audit_logs").select("*").in("action", [
        "super_admin_bootstrap",
        "user_status_updated",
        "user_updated",
        "ai_provider_created",
        "ai_provider_updated",
        "meta_platform_settings_updated",
        "payment_gateway_updated",
        "global_settings_updated",
        "admin_profile_updated"
      ]).order("created_at", { ascending: false }).limit(50)
    ]);
    const roleCounts = {};
    for (const p of profiles || []) {
      roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    }
    return res.json({
      admins: (profiles || []).filter((p) => p.role === "super_admin"),
      roleCounts,
      securityLogs: securityLogs || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load security overview." });
  }
});
router5.get("/backup/status", async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [
      schemaStatus,
      { count: profilesCount },
      { count: businessesCount },
      { count: productsCount },
      { count: ordersCount },
      { count: customersCount },
      { count: messagesCount },
      { count: paymentsCount },
      { count: auditLogsCount }
    ] = await Promise.all([
      checkSchemaStatus(),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("businesses").select("id", { count: "exact", head: true }),
      admin.from("products").select("id", { count: "exact", head: true }),
      admin.from("orders").select("id", { count: "exact", head: true }),
      admin.from("customers").select("id", { count: "exact", head: true }),
      admin.from("messages").select("id", { count: "exact", head: true }),
      admin.from("payments").select("id", { count: "exact", head: true }),
      admin.from("audit_logs").select("id", { count: "exact", head: true })
    ]);
    return res.json({
      schemaStatus,
      tableCounts: {
        profiles: profilesCount || 0,
        businesses: businessesCount || 0,
        products: productsCount || 0,
        orders: ordersCount || 0,
        customers: customersCount || 0,
        messages: messagesCount || 0,
        payments: paymentsCount || 0,
        audit_logs: auditLogsCount || 0
      },
      automatedBackupSupported: false,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to inspect database health." });
  }
});
router5.get("/backup/export-config", async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [
      { data: appSettings },
      { data: subscriptionPlans },
      { data: coinPackages },
      { data: featureFlags },
      { data: aiProviders },
      { data: aiModels },
      { data: paymentGateways }
    ] = await Promise.all([
      admin.from("application_settings").select(
        "id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, meta_api_version, meta_mode, updated_at"
      ).eq("id", 1).maybeSingle(),
      admin.from("subscription_plans").select("*").order("display_order"),
      admin.from("coin_packages").select("*").order("display_order"),
      admin.from("feature_flags").select("*").order("key"),
      admin.from("ai_providers").select("id, slug, name, provider_type, base_url, is_active, priority").order("priority"),
      admin.from("ai_models").select("*").order("priority"),
      admin.from("payment_gateways").select("id, slug, name, gateway_type, is_active, is_sandbox, config_public, instructions").order("slug")
    ]);
    await writeAuditLog({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: "platform_config_exported",
      targetType: "system",
      targetId: "config_json",
      ipAddress: req.ip
    });
    return res.json({
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      exportedBy: req.user.email,
      note: "Secrets, encrypted API keys, and customer PII are intentionally excluded from this configuration export.",
      application_settings: appSettings,
      subscription_plans: subscriptionPlans || [],
      coin_packages: coinPackages || [],
      feature_flags: featureFlags || [],
      ai_providers: aiProviders || [],
      ai_models: aiModels || [],
      payment_gateways: paymentGateways || []
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to export configuration." });
  }
});
var adminRoutes_default = router5;

// server/app.ts
function createApp() {
  const app2 = express();
  app2.set("trust proxy", 1);
  app2.use(
    express.json({
      limit: "15mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: true }));
  app2.use("/api/system", systemRoutes_default);
  app2.use("/api", businessRoutes_default);
  app2.use("/api", inboxAndAiRoutes_default);
  app2.use("/api", integrationsAndBillingRoutes_default);
  app2.use("/api/admin", adminRoutes_default);
  app2.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "BeXpar Ai", supabaseConfigured: Boolean(loadSupabaseConfig()) });
  });
  return app2;
}

// server/vercel.ts
var app = createApp();
function handler(req, res) {
  return app(req, res);
}
export {
  handler as default
};
