import { Router } from 'express';
import {
  clearSupabaseConfig,
  getOrGenerateBootstrapCode,
  getPublicSupabaseConfig,
  getSupabaseAdmin,
  loadSupabaseConfig,
  saveSupabaseConfig,
} from '../config/supabaseConfig.ts';
import {
  checkSchemaStatus,
  getConsolidatedMigrationSql,
  runDatabaseMigrations,
} from '../db/migrator.ts';
import { createNotification, writeAuditLog } from '../db/repository.ts';
import { requireAuth, type AuthedRequest } from '../middleware/auth.ts';
import { evaluateOrderRisk } from '../services/orderRisk.ts';
import { broadcastToBusiness } from '../services/realtimeBus.ts';
import {
  createSupabaseProjectAuto,
  fetchProjectApiKeysAuto,
  listSupabaseProjectsAndOrgs,
} from '../services/supabaseManagement.ts';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/status', async (_req, res) => {
  const pubCfg = getPublicSupabaseConfig();
  if (!pubCfg.configured) {
    return res.json({
      supabaseConnected: false,
      schemaReady: false,
      appliedMigrations: [],
      bootstrapNeeded: false,
      supabase: pubCfg,
      appSettings: {
        app_name: 'BeXpar Ai',
        default_theme: 'light',
        primary_color: '#4F46E5',
        secondary_color: '#7C3AED',
        default_language: 'bn',
        maintenance_mode: false,
        registration_enabled: true,
      },
    });
  }

  const schema = await checkSchemaStatus();
  let bootstrapNeeded = false;
  let appSettings: Record<string, unknown> = {
    app_name: 'BeXpar Ai',
    default_theme: 'light',
    primary_color: '#4F46E5',
    secondary_color: '#7C3AED',
    default_language: 'bn',
    maintenance_mode: false,
    registration_enabled: true,
  };

  if (schema.schemaReady) {
    try {
      const admin = getSupabaseAdmin();
      const [{ count }, { data: settings }] = await Promise.all([
        admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'super_admin'),
        admin
          .from('application_settings')
          .select(
            'app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement'
          )
          .eq('id', 1)
          .maybeSingle(),
      ]);

      bootstrapNeeded = (count || 0) === 0;
      if (bootstrapNeeded) {
        getOrGenerateBootstrapCode();
      }
      if (settings) {
        appSettings = settings;
      }
    } catch {
      // ignore if partial schema
    }
  }

  return res.json({
    supabaseConnected: schema.connected,
    schemaReady: schema.schemaReady,
    appliedMigrations: schema.appliedMigrations,
    schemaError: schema.error,
    bootstrapNeeded,
    supabase: pubCfg,
    appSettings,
  });
});

router.get('/public-catalog', async (_req, res) => {
  try {
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.json({ plans: [], packages: [] });
    }
    const admin = getSupabaseAdmin();
    const [{ data: plans }, { data: packages }] = await Promise.all([
      admin
        .from('subscription_plans')
        .select('id, slug, name, description, monthly_price, yearly_price, coin_allocation, max_products, max_staff, max_channels, allowed_features, duration_days, display_order')
        .eq('is_active', true)
        .order('display_order'),
      admin
        .from('coin_packages')
        .select('id, name, coin_amount, bonus_coins, price, currency, validity_days, description, display_order')
        .eq('status', 'active')
        .order('display_order'),
    ]);
    return res.json({ plans: plans || [], packages: packages || [] });
  } catch {
    return res.json({ plans: [], packages: [] });
  }
});

router.get('/public-store/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!UUID_RE.test(businessId)) {
      return res.status(400).json({ error: 'Invalid store identifier.' });
    }
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.status(503).json({ error: 'Store service is currently unavailable.' });
    }

    const admin = getSupabaseAdmin();
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .select('id, name, category, address, phone, logo_url, status')
      .eq('id', businessId)
      .maybeSingle();

    if (bizErr) return res.status(400).json({ error: bizErr.message });
    if (!biz || biz.status !== 'active') {
      return res.status(404).json({ error: 'Store not found or currently inactive.' });
    }

    const [{ data: products, error: prodErr }, { data: aiSettings }] = await Promise.all([
      admin
        .from('products')
        .select(
          'id, business_id, name, sku, description, regular_price, discount_price, stock_quantity, category_name, colors, sizes, status, is_featured, primary_image_url, created_at, images:product_images(id, image_url, display_order)'
        )
        .eq('business_id', businessId)
        .eq('status', 'active')
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false }),
      admin
        .from('ai_settings')
        .select('order_collection_rules')
        .eq('business_id', businessId)
        .maybeSingle(),
    ]);

    if (prodErr) return res.status(400).json({ error: prodErr.message });

    const rules = (aiSettings?.order_collection_rules || {}) as Record<string, unknown>;
    const deliveryCharge = Number(rules.default_delivery_charge ?? 60);

    return res.json({
      business: biz,
      products: products || [],
      deliveryCharge: Number.isFinite(deliveryCharge) && deliveryCharge >= 0 ? deliveryCharge : 60,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load store.' });
  }
});

router.post('/public-store/:businessId/orders', async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!UUID_RE.test(businessId)) {
      return res.status(400).json({ error: 'Invalid store identifier.' });
    }
    const pubCfg = getPublicSupabaseConfig();
    if (!pubCfg.configured) {
      return res.status(503).json({ error: 'Store service is currently unavailable.' });
    }

    const { customer_name, customer_phone, customer_address, items, payment_method, notes } = req.body as {
      customer_name?: string;
      customer_phone?: string;
      customer_address?: string;
      items?: Array<{ product_id?: string; quantity?: number; variant_color?: string; variant_size?: string }>;
      payment_method?: string;
      notes?: string;
    };

    const nameClean = (customer_name || '').trim();
    const phoneClean = (customer_phone || '').trim();
    const addressClean = (customer_address || '').trim();

    if (!nameClean || !phoneClean || !addressClean || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Customer name, phone, delivery address, and at least one product are required.' });
    }

    const admin = getSupabaseAdmin();
    const { data: biz } = await admin
      .from('businesses')
      .select('id, owner_id, name, status')
      .eq('id', businessId)
      .maybeSingle();

    if (!biz || biz.status !== 'active') {
      return res.status(404).json({ error: 'Store not found or currently inactive.' });
    }

    const productIds = Array.from(new Set(items.map((i) => i.product_id).filter((id): id is string => Boolean(id && UUID_RE.test(id)))));
    if (productIds.length === 0) {
      return res.status(400).json({ error: 'Valid products are required.' });
    }

    const [{ data: dbProducts }, { data: aiSettings }] = await Promise.all([
      admin.from('products').select('*').eq('business_id', businessId).eq('status', 'active').in('id', productIds),
      admin.from('ai_settings').select('order_collection_rules').eq('business_id', businessId).maybeSingle(),
    ]);

    const prodMap = new Map((dbProducts || []).map((p) => [p.id, p]));
    let subtotal = 0;
    const resolvedItems: Array<{
      business_id: string;
      product_id: string;
      product_name: string;
      sku: string;
      variant_color: string;
      variant_size: string;
      quantity: number;
      unit_price: number;
      unit_cost: number;
      total_price: number;
    }> = [];

    for (const reqItem of items) {
      if (!reqItem.product_id) continue;
      const p = prodMap.get(reqItem.product_id);
      if (!p) {
        return res.status(400).json({ error: 'One or more selected products are no longer available.' });
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
        sku: p.sku || '',
        variant_color: (reqItem.variant_color || '').trim(),
        variant_size: (reqItem.variant_size || '').trim(),
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_price: total,
      });
    }

    if (resolvedItems.length === 0) {
      return res.status(400).json({ error: 'At least one valid product is required.' });
    }

    const rules = (aiSettings?.order_collection_rules || {}) as Record<string, unknown>;
    const rawDeliv = Number(rules.default_delivery_charge ?? 60);
    const deliv = Number.isFinite(rawDeliv) && rawDeliv >= 0 ? rawDeliv : 60;
    const totalAmount = Math.max(0, subtotal + deliv);

    // Upsert customer record
    let customerId: string | null = null;
    const { data: existingCust } = await admin
      .from('customers')
      .select('id, total_orders, total_spent')
      .eq('business_id', businessId)
      .eq('phone', phoneClean)
      .maybeSingle();

    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const { data: newCust } = await admin
        .from('customers')
        .insert({ business_id: businessId, name: nameClean, phone: phoneClean, address: addressClean })
        .select('id')
        .single();
      customerId = newCust?.id || null;
    }

    const risk = await evaluateOrderRisk({ businessId, customerPhone: phoneClean, totalAmount });
    const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
    const safeMethod = payment_method && ['cod', 'bkash', 'nagad'].includes(payment_method) ? payment_method : 'cod';
    const noteText = [notes?.trim(), 'Mini Storefront Order'].filter(Boolean).join(' · ');

    const { data: order, error: ordErr } = await admin
      .from('orders')
      .insert({
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
        payment_status: 'unpaid',
        order_status: 'pending',
        order_source: 'manual',
        risk_level: risk.riskLevel,
        risk_reasons: risk.reasons,
        notes: noteText,
      })
      .select('id, order_number, customer_name, customer_phone, customer_address, subtotal, delivery_charge, total_amount, payment_method, order_status, created_at')
      .single();

    if (ordErr) return res.status(400).json({ error: ordErr.message });

    await admin.from('order_items').insert(resolvedItems.map((it) => ({ ...it, order_id: order.id })));
    await admin.from('order_status_history').insert({
      business_id: businessId,
      order_id: order.id,
      old_status: '',
      new_status: 'pending',
      note: 'Order placed via public Mini Storefront',
    });

    if (customerId) {
      await admin
        .from('customers')
        .update({
          total_orders: (existingCust?.total_orders || 0) + 1,
          total_spent: Number(existingCust?.total_spent || 0) + totalAmount,
          last_order_at: new Date().toISOString(),
        })
        .eq('id', customerId);
    }

    if (biz.owner_id) {
      await createNotification({
        businessId,
        userId: biz.owner_id,
        title: `New Storefront Order #${order.order_number}`,
        body: `${nameClean} placed an order of ${totalAmount} BDT via Mini Store.`,
        type: 'order',
      });
    }

    broadcastToBusiness(businessId, 'order:created', order);
    return res.status(201).json({ order, items: resolvedItems });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to submit storefront order.' });
  }
});

router.post('/supabase/connect', async (req, res) => {
  try {
    const existing = loadSupabaseConfig();
    // If already configured and schema ready, require Super Admin auth to overwrite credentials
    if (existing) {
      const schema = await checkSchemaStatus();
      if (schema.schemaReady) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return res.status(403).json({ error: 'Only an authenticated Super Admin can modify an active Supabase connection.' });
        }
        const admin = getSupabaseAdmin();
        const { data: u } = await admin.auth.getUser(authHeader.slice(7));
        if (!u?.user) return res.status(401).json({ error: 'Unauthorized' });
        const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
        if (prof?.role !== 'super_admin') {
          return res.status(403).json({ error: 'Super Admin role required.' });
        }
      }
    }

    const { url, anonKey, serviceRoleKey, dbUrl } = req.body as {
      url?: string;
      anonKey?: string;
      serviceRoleKey?: string;
      dbUrl?: string;
    };

    if (!url || !anonKey || !serviceRoleKey) {
      return res.status(400).json({ error: 'Supabase Project URL, Publishable/Anon Key, and Service Role Secret Key are required.' });
    }

    saveSupabaseConfig({ url, anonKey, serviceRoleKey, dbUrl });
    const migrationResult = await runDatabaseMigrations(dbUrl);

    if (!existing && !migrationResult.success && migrationResult.error?.startsWith('Supabase Auth connection failed')) {
      clearSupabaseConfig();
    }

    return res.json({
      ...migrationResult,
      consolidatedSql: migrationResult.schemaReady ? undefined : getConsolidatedMigrationSql(),
      supabase: getPublicSupabaseConfig(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to connect Supabase.' });
  }
});

async function assertCanConfigureSupabase(authHeader?: string): Promise<string | null> {
  const existing = loadSupabaseConfig();
  if (!existing) return null;
  const schema = await checkSchemaStatus();
  if (!schema.schemaReady) return null;
  if (!authHeader?.startsWith('Bearer ')) {
    return 'Only an authenticated Super Admin can modify an active Supabase connection.';
  }
  const admin = getSupabaseAdmin();
  const { data: u } = await admin.auth.getUser(authHeader.slice(7));
  if (!u?.user) return 'Unauthorized';
  const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (prof?.role !== 'super_admin') return 'Super Admin role required.';
  return null;
}

router.post('/supabase/discover', async (req, res) => {
  try {
    const authErr = await assertCanConfigureSupabase(req.headers.authorization);
    if (authErr) return res.status(403).json({ error: authErr });

    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken?.trim()) {
      return res.status(400).json({ error: 'Supabase Personal Access Token (sbp_...) is required.' });
    }

    const result = await listSupabaseProjectsAndOrgs(accessToken);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load Supabase projects.' });
  }
});

router.post('/supabase/auto-connect', async (req, res) => {
  try {
    const authErr = await assertCanConfigureSupabase(req.headers.authorization);
    if (authErr) return res.status(403).json({ error: authErr });

    const { accessToken, projectRef, createNew, projectName, organizationId, region } = req.body as {
      accessToken?: string;
      projectRef?: string;
      createNew?: boolean;
      projectName?: string;
      organizationId?: string;
      region?: string;
    };

    if (!accessToken?.trim()) {
      return res.status(400).json({ error: 'Supabase Personal Access Token is required.' });
    }

    let targetRef = projectRef?.trim() || '';
    let dbUrl: string | undefined;

    if (createNew) {
      if (!organizationId) {
        return res.status(400).json({ error: 'Organization is required to create a new Supabase project.' });
      }
      const created = await createSupabaseProjectAuto(accessToken, {
        name: projectName || 'bexpar-ai',
        organizationId,
        region: region || 'ap-southeast-1',
      });
      targetRef = created.project.id;
      dbUrl = created.dbUrl;
    }

    if (!targetRef) {
      return res.status(400).json({ error: 'Please select a Supabase project or create a new one.' });
    }

    const keys = await fetchProjectApiKeysAuto(accessToken, targetRef);
    saveSupabaseConfig({
      url: keys.url,
      anonKey: keys.anonKey,
      serviceRoleKey: keys.serviceRoleKey,
      dbUrl,
    });

    const migrationResult = await runDatabaseMigrations(dbUrl, {
      accessToken: accessToken.trim(),
      projectRef: targetRef,
    });

    return res.json({
      ...migrationResult,
      projectRef: targetRef,
      consolidatedSql: migrationResult.schemaReady ? undefined : getConsolidatedMigrationSql(),
      supabase: getPublicSupabaseConfig(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Automatic Supabase connection failed.' });
  }
});

router.post('/supabase/verify', async (req, res) => {
  try {
    const { dbUrl } = (req.body || {}) as { dbUrl?: string };
    if (dbUrl) {
      const existing = loadSupabaseConfig();
      if (existing) {
        saveSupabaseConfig({ ...existing, dbUrl });
      }
    }
    const result = await runDatabaseMigrations(dbUrl);
    return res.json({
      ...result,
      consolidatedSql: result.schemaReady ? undefined : getConsolidatedMigrationSql(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Verification failed.' });
  }
});

router.get('/supabase/sql', async (_req, res) => {
  const schema = await checkSchemaStatus();
  if (schema.schemaReady) {
    return res.status(403).json({ error: 'Schema is already initialized.' });
  }
  return res.json({ sql: getConsolidatedMigrationSql() });
});

const handleBootstrapAdmin = async (req: AuthedRequest, res: any) => {
  try {
    const admin = getSupabaseAdmin();
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'super_admin');

    if ((count || 0) > 0) {
      return res.status(403).json({ error: 'Super Admin already exists. Bootstrap is permanently locked.' });
    }

    const { verificationCode } = req.body as { verificationCode?: string };
    const expectedCode = getOrGenerateBootstrapCode();
    const submitted = (verificationCode || '').trim().toUpperCase();
    const shortSuffix = expectedCode.replace(/^BEXPAR-ADMIN-/i, '').toUpperCase();

    if (!submitted || (submitted !== expectedCode.toUpperCase() && submitted !== shortSuffix)) {
      return res.status(403).json({ error: 'Invalid Super Admin verification code.' });
    }

    const { data: updated, error } = await admin
      .from('profiles')
      .update({ role: 'super_admin', status: 'active' })
      .eq('id', req.user!.id)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: 'super_admin',
      action: 'super_admin_bootstrap',
      targetType: 'profile',
      targetId: req.user!.id,
      details: { email: req.user!.email },
      ipAddress: req.ip,
    });

    return res.json({ success: true, profile: updated });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Bootstrap failed' });
  }
};

router.post('/bootstrap-admin', requireAuth, handleBootstrapAdmin);
router.post('/claim-owner', requireAuth, handleBootstrapAdmin);

export default router;
