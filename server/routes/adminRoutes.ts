import { Router } from 'express';
import { encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
import {
  ensureDefaultAiProvidersAndModels,
  ensureDefaultModelForProvider,
  testModelConnection,
  testProviderConnection,
} from '../ai/providerRouter.ts';
import { checkSchemaStatus } from '../db/migrator.ts';
import { createNotification, writeAuditLog } from '../db/repository.ts';
import { requireAuth, requireSuperAdmin, type AuthedRequest } from '../middleware/auth.ts';
import { getMetaOAuthRedirectUri, resolveAppBaseUrl } from '../services/metaService.ts';
import {
  ALLOWED_GATEWAY_TYPES,
  buildEncryptedCredentials,
  GATEWAY_SLUG_REGEX,
  ManualPaymentError,
  reviewManualPayment,
  sanitizeGatewayConfigPublic,
  toSafeGatewayRow,
  upsertManualGatewayAccounts,
} from '../services/manualPaymentService.ts';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidHttpOrRelativeUrl(raw: unknown, allowRelative = false): boolean {
  if (raw === undefined || raw === null || raw === '') return true;
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolveDateRange(query: Record<string, unknown>) {
  const range = String(query.range || '30d');
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === '7d') {
    start.setDate(start.getDate() - 6);
  } else if (range === '3m') {
    start.setMonth(start.getMonth() - 3);
  } else if (range === '1y') {
    start.setFullYear(start.getFullYear() - 1);
  } else if (range === 'custom' && typeof query.start === 'string' && query.start) {
    const parsedStart = new Date(query.start);
    if (!Number.isNaN(parsedStart.getTime())) {
      start = parsedStart;
    } else {
      start.setDate(start.getDate() - 29);
    }
    if (typeof query.end === 'string' && query.end) {
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

  const spanMs = Math.max(86400000, end.getTime() - start.getTime());
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  const useMonthlyBuckets = spanMs > 95 * 86400000;

  return { range, start, end, prevStart, prevEnd, useMonthlyBuckets };
}

function formatBucketKey(dateStr: string | null | undefined, monthly: boolean): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (monthly) return `${y}-${m}`;
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildBucketSkeleton(start: Date, end: Date, monthly: boolean): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), monthly ? 1 : start.getUTCDate()));
  const limit = monthly ? 24 : 400;
  while (cursor <= end && keys.length < limit) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    if (monthly) {
      keys.push(`${y}-${m}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      const day = String(cursor.getUTCDate()).padStart(2, '0');
      keys.push(`${y}-${m}-${day}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return keys;
}

function calcGrowthPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

// Super Admin Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { range, start, end, prevStart, prevEnd, useMonthlyBuckets } = resolveDateRange(req.query as Record<string, unknown>);

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
      schemaStatus,
    ] = await Promise.all([
      admin.from('profiles').select('id, status, role, created_at'),
      admin.from('businesses').select('id, status, category, subscription_plan_id, created_at'),
      admin.from('orders').select('id', { count: 'exact', head: true }),
      admin.from('ai_usage_logs').select('total_tokens, provider_cost_usd, coins_deducted, status, created_at'),
      admin.from('coin_wallets').select('total_purchased, total_used, balance'),
      admin.from('coin_transactions').select('type, amount, created_at').gte('created_at', prevStart.toISOString()),
      admin.from('payments').select('amount, payment_for, status, created_at'),
      admin
        .from('profiles')
        .select('id, email, full_name, role, status, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      admin
        .from('businesses')
        .select('id, name, owner_name, email, category, status, subscription_status, created_at, subscription_plan:subscription_plans(name, slug)')
        .order('created_at', { ascending: false })
        .limit(6),
      admin
        .from('coin_transactions')
        .select('*, business:businesses(id, name)')
        .order('created_at', { ascending: false })
        .limit(8),
      admin
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
      checkSchemaStatus(),
    ]);

    const profs = profiles || [];
    const bizList = businesses || [];
    const aiList = aiLogs || [];
    const walletList = wallets || [];
    const payList = payments || [];
    const txList = coinTxAll || [];

    const totalUsers = profs.length;
    const activeUsers = profs.filter((p) => p.status === 'active').length;
    const inactiveUsers = profs.filter((p) => p.status === 'inactive').length;
    const suspendedUsers = profs.filter((p) => p.status === 'suspended').length;

    const totalBusinesses = bizList.length;
    const activeBusinesses = bizList.filter((b) => b.status === 'active').length;
    const suspendedBusinesses = bizList.filter((b) => b.status === 'suspended').length;
    const inactiveBusinesses = bizList.filter((b) => b.status === 'inactive').length;

    const totalAiRequests = aiList.filter((l) => l.status === 'success').length;
    const totalTokensUsed = aiList.reduce((s, l) => s + Number(l.total_tokens || 0), 0);
    const estimatedProviderCostUsd = aiList.reduce((s, l) => s + Number(l.provider_cost_usd || 0), 0);

    const totalCoinsSold = walletList.reduce((s, w) => s + Number(w.total_purchased || 0), 0);
    const totalCoinsConsumed = walletList.reduce((s, w) => s + Number(w.total_used || 0), 0);

    const approvedPayments = payList.filter((p) => p.status === 'approved');
    const pendingPaymentsCount = payList.filter((p) => p.status === 'pending').length;
    const subscriptionRevenue = approvedPayments
      .filter((p) => p.payment_for === 'subscription')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const coinPackageRevenue = approvedPayments
      .filter((p) => p.payment_for === 'coin_package')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalRevenue = subscriptionRevenue + coinPackageRevenue;

    // Period-over-period comparisons within [start, end] vs [prevStart, prevEnd]
    const inCur = (d?: string) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= start.getTime() && t <= end.getTime();
    };
    const inPrev = (d?: string) => {
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
    const coinsCur = txList
      .filter((t) => t.type === 'purchase' && inCur(t.created_at))
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const coinsPrev = txList
      .filter((t) => t.type === 'purchase' && inPrev(t.created_at))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    // Build time-series buckets
    const keys = buildBucketSkeleton(start, end, useMonthlyBuckets);
    const bucketMap = new Map(
      keys.map((k) => [
        k,
        { date: k, users: 0, businesses: 0, revenue: 0, coinsSold: 0, subscriptions: 0 },
      ])
    );

    for (const p of profs) {
      if (!inCur(p.created_at)) continue;
      const k = formatBucketKey(p.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.users += 1;
    }
    for (const biz of bizList) {
      if (!inCur(biz.created_at)) continue;
      const k = formatBucketKey(biz.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.businesses += 1;
    }
    for (const pay of approvedPayments) {
      if (!inCur(pay.created_at)) continue;
      const k = formatBucketKey(pay.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) {
        b.revenue += Number(pay.amount || 0);
        if (pay.payment_for === 'subscription') {
          b.subscriptions += 1;
        }
      }
    }
    for (const tx of txList) {
      if (tx.type !== 'purchase' || !inCur(tx.created_at)) continue;
      const k = formatBucketKey(tx.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
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
        revenueGrowthPct: calcGrowthPct(revCur, revPrev),
      },
      series: Array.from(bucketMap.values()),
      businessDistribution: {
        active: activeBusinesses,
        suspended: suspendedBusinesses,
        inactive: inactiveBusinesses,
      },
      recentRegistrations: recentRegs || [],
      recentBusinesses: recentBusinesses || [],
      recentTransactions: recentTx || [],
      systemActivity: recentAudit || [],
      supabaseHealth: schemaStatus,
      serverMeta: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Admin dashboard error.' });
  }
});

// User & Business Management
router.get('/users', async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profiles }, { data: businesses }, { data: wallets }, { data: orders }, { data: products }] =
      await Promise.all([
        admin.from('profiles').select('*').order('created_at', { ascending: false }),
        admin
          .from('businesses')
          .select('*, subscription_plan:subscription_plans(id, name, slug)')
          .order('created_at', { ascending: false }),
        admin.from('coin_wallets').select('*'),
        admin.from('orders').select('business_id'),
        admin.from('products').select('business_id'),
      ]);

    const walletMap = new Map((wallets || []).map((w) => [w.business_id, w]));
    const orderCountMap = new Map<string, number>();
    for (const o of orders || []) {
      orderCountMap.set(o.business_id, (orderCountMap.get(o.business_id) || 0) + 1);
    }
    const productCountMap = new Map<string, number>();
    for (const p of products || []) {
      productCountMap.set(p.business_id, (productCountMap.get(p.business_id) || 0) + 1);
    }

    const enrichedBusinesses = (businesses || []).map((b) => ({
      ...b,
      wallet: walletMap.get(b.id) || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      ordersCount: orderCountMap.get(b.id) || 0,
      productsCount: productCountMap.get(b.id) || 0,
    }));

    return res.json({ users: profiles || [], businesses: enrichedBusinesses });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load users.' });
  }
});

router.patch('/users/:userId', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { full_name, phone, status, role, language } = req.body as {
      full_name?: string;
      phone?: string;
      status?: string;
      role?: string;
      language?: string;
    };

    if (req.params.userId === req.user!.id && ((status && status !== 'active') || (role && role !== 'super_admin'))) {
      return res.status(400).json({ error: 'You cannot suspend or demote your own active Super Admin account.' });
    }

    const payload: Record<string, unknown> = {};
    if (full_name !== undefined) payload.full_name = String(full_name).trim();
    if (phone !== undefined) payload.phone = String(phone).trim();
    if (status && ['active', 'inactive', 'suspended'].includes(status)) payload.status = status;
    if (role && ['super_admin', 'business_owner', 'business_admin', 'business_staff', 'support_staff'].includes(role)) {
      payload.role = role;
    }
    if (language && ['bn', 'en'].includes(language)) payload.language = language;

    const { data, error } = await admin.from('profiles').update(payload).eq('id', req.params.userId).select('*').single();
    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'user_updated',
      targetType: 'profile',
      targetId: req.params.userId,
      details: payload,
      ipAddress: req.ip,
    });

    return res.json({ user: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update user.' });
  }
});

router.patch('/users/:userId/status', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { status, role } = req.body as { status?: string; role?: string };

    if (req.params.userId === req.user!.id && ((status && status !== 'active') || (role && role !== 'super_admin'))) {
      return res.status(400).json({ error: 'You cannot suspend or demote your own active Super Admin account.' });
    }

    const { data, error } = await admin
      .from('profiles')
      .update({
        ...(status ? { status } : {}),
        ...(role ? { role } : {}),
      })
      .eq('id', req.params.userId)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'user_status_updated',
      targetType: 'profile',
      targetId: req.params.userId,
      details: { status, role },
      ipAddress: req.ip,
    });

    return res.json({ user: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update user.' });
  }
});

router.patch('/businesses/:businessId', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.businessId)) {
      return res.status(400).json({ error: 'Invalid business identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { name, owner_name, email, phone, category, address, status } = req.body as Record<string, string | undefined>;
    const payload: Record<string, unknown> = {};
    if (name !== undefined) payload.name = name.trim();
    if (owner_name !== undefined) payload.owner_name = owner_name.trim();
    if (email !== undefined) payload.email = email.trim();
    if (phone !== undefined) payload.phone = phone.trim();
    if (category !== undefined) payload.category = category.trim();
    if (address !== undefined) payload.address = address.trim();
    if (status && ['active', 'inactive', 'suspended'].includes(status)) payload.status = status;

    const { data, error } = await admin
      .from('businesses')
      .update(payload)
      .eq('id', req.params.businessId)
      .select('*, subscription_plan:subscription_plans(id, name, slug)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.params.businessId,
      action: status ? `business_status_${status}` : 'business_updated',
      targetType: 'business',
      targetId: req.params.businessId,
      details: payload,
      ipAddress: req.ip,
    });

    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update business.' });
  }
});

router.get('/businesses/:businessId/summary', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.businessId)) {
      return res.status(400).json({ error: 'Invalid business identifier.' });
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
      { data: plans },
    ] = await Promise.all([
      admin.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      admin.from('products').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      admin.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      admin.from('ai_usage_logs').select('id', { count: 'exact', head: true }).eq('business_id', bid),
      admin
        .from('orders')
        .select('id, order_number, customer_name, total_amount, order_status, created_at')
        .eq('business_id', bid)
        .order('created_at', { ascending: false })
        .limit(5),
      admin.from('coin_wallets').select('*').eq('business_id', bid).maybeSingle(),
      admin.from('user_feature_overrides').select('*').eq('business_id', bid),
      admin.from('subscription_plans').select('id, name, slug, duration_days').order('display_order'),
    ]);

    return res.json({
      ordersCount: ordersCount || 0,
      productsCount: productsCount || 0,
      customersCount: customersCount || 0,
      aiRequestsCount: aiRequestsCount || 0,
      recentOrders: recentOrders || [],
      wallet: wallet || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      overrides: overrides || [],
      plans: plans || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load business summary.' });
  }
});

router.post('/businesses/:businessId/coins', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.businessId)) {
      return res.status(400).json({ error: 'Invalid business identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { amount, mode, reason } = req.body as { amount: number; mode: 'credit' | 'debit'; reason?: string };
    const numAmt = Number(amount);
    if (!numAmt || numAmt <= 0) return res.status(400).json({ error: 'Positive coin amount is required.' });

    let result;
    if (mode === 'debit') {
      const { data, error } = await admin.rpc('deduct_ai_coins_atomic', {
        p_business_id: req.params.businessId,
        p_amount: numAmt,
        p_description: reason || 'Super Admin Coin Deduction',
        p_reference_id: 'admin_adjustment',
        p_user_id: req.user!.id,
      });
      if (error) return res.status(400).json({ error: error.message });
      result = Array.isArray(data) ? data[0] : data;
    } else {
      const { data, error } = await admin.rpc('credit_ai_coins_atomic', {
        p_business_id: req.params.businessId,
        p_amount: numAmt,
        p_type: 'admin_credit',
        p_description: reason || 'Super Admin Coin Grant',
        p_reference_id: 'admin_adjustment',
        p_user_id: req.user!.id,
      });
      if (error) return res.status(400).json({ error: error.message });
      result = Array.isArray(data) ? data[0] : data;
    }

    if (!result?.success) return res.status(400).json({ error: result?.message || 'Coin adjustment failed.' });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.params.businessId,
      action: mode === 'debit' ? 'admin_coin_deduct' : 'admin_coin_credit',
      targetType: 'coin_wallet',
      targetId: req.params.businessId,
      details: { amount: numAmt, reason, new_balance: result.new_balance },
      ipAddress: req.ip,
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Coin adjustment failed.' });
  }
});

router.post('/businesses/:businessId/subscription', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.businessId)) {
      return res.status(400).json({ error: 'Invalid business identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { plan_id, extra_days, status } = req.body as { plan_id?: string; extra_days?: number; status?: string };

    const { data: biz } = await admin.from('businesses').select('subscription_expires_at').eq('id', req.params.businessId).maybeSingle();
    const baseTime = biz?.subscription_expires_at ? Math.max(Date.now(), new Date(biz.subscription_expires_at).getTime()) : Date.now();
    const newExpiry = new Date(baseTime + Number(extra_days || 30) * 86400000).toISOString();

    const { data, error } = await admin
      .from('businesses')
      .update({
        ...(plan_id ? { subscription_plan_id: plan_id } : {}),
        ...(status ? { subscription_status: status } : { subscription_status: 'active' }),
        subscription_expires_at: newExpiry,
      })
      .eq('id', req.params.businessId)
      .select('*, subscription_plan:subscription_plans(*)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.params.businessId,
      action: 'admin_subscription_updated',
      targetType: 'business',
      targetId: req.params.businessId,
      details: { plan_id, extra_days, newExpiry },
      ipAddress: req.ip,
    });

    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Subscription update failed.' });
  }
});

// Coin Packages CRUD & Transactions
router.get('/coin-packages', async (_req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: packages }, { data: transactions }] = await Promise.all([
    admin.from('coin_packages').select('*').order('display_order'),
    admin
      .from('coin_transactions')
      .select('*, business:businesses(id, name)')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  return res.json({ packages: packages || [], transactions: transactions || [] });
});

router.post('/coin-packages', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body as Record<string, unknown>;
  const { data, error } = await admin.from('coin_packages').insert(b).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'coin_package_created', targetType: 'coin_package', targetId: data.id, details: b });
  return res.status(201).json({ package: data });
});

router.patch('/coin-packages/:id', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('coin_packages').update(req.body).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'coin_package_updated', targetType: 'coin_package', targetId: req.params.id, details: req.body });
  return res.json({ package: data });
});

router.delete('/coin-packages/:id', async (req: AuthedRequest, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid package identifier.' });
    }
    const admin = getSupabaseAdmin();
    const { count } = await admin
      .from('package_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('package_id', req.params.id);

    if ((count || 0) > 0) {
      return res.status(400).json({
        error: 'This coin package has recorded purchases and cannot be deleted. Set its status to inactive or archived instead.',
      });
    }

    const { error } = await admin.from('coin_packages').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'coin_package_deleted',
      targetType: 'coin_package',
      targetId: req.params.id,
      ipAddress: req.ip,
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete coin package.' });
  }
});

// Subscription Plans CRUD
router.get('/subscription-plans', async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('subscription_plans').select('*').order('display_order');
  return res.json({ plans: data || [] });
});

router.post('/subscription-plans', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('subscription_plans').insert(req.body).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'subscription_plan_created', targetType: 'subscription_plan', targetId: data.id, details: req.body });
  return res.status(201).json({ plan: data });
});

router.patch('/subscription-plans/:id', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('subscription_plans').update(req.body).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'subscription_plan_updated', targetType: 'subscription_plan', targetId: req.params.id, details: req.body });
  return res.json({ plan: data });
});

// AI Providers & Models Management
router.get('/ai', async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    await ensureDefaultAiProvidersAndModels();

    const [provRes, modelRes, logRes] = await Promise.all([
      admin
        .from('ai_providers')
        .select('id, slug, name, provider_type, base_url, api_key_encrypted, is_active, priority, updated_at')
        .order('priority'),
      admin.from('ai_models').select('*, provider:ai_providers(id, slug, name)').order('priority'),
      admin.from('ai_usage_logs').select('*').order('created_at', { ascending: false }).limit(80),
    ]);

    if (provRes.error) return res.status(500).json({ error: provRes.error.message });
    if (modelRes.error) return res.status(500).json({ error: modelRes.error.message });

    // Never send encrypted or raw API keys to the browser; only expose boolean has_api_key
    const safeProviders = (provRes.data || []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      provider_type: p.provider_type,
      base_url: p.base_url,
      is_active: p.is_active,
      priority: p.priority,
      updated_at: p.updated_at,
      has_api_key: Boolean(p.api_key_encrypted && String(p.api_key_encrypted).trim().length > 0),
    }));

    return res.json({ providers: safeProviders, models: modelRes.data || [], usageLogs: logRes.data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load AI providers.' });
  }
});

router.post('/ai/providers', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { slug, name, provider_type, base_url, api_key, is_active, priority } = req.body as Record<string, unknown>;
  const cleanSlug = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');
  const cleanName = String(name || '').trim();
  const cleanBaseUrl = typeof base_url === 'string' ? base_url.trim() : '';
  const cleanKey = typeof api_key === 'string' ? api_key.trim() : '';

  if (!cleanSlug || !cleanName) {
    return res.status(400).json({ error: 'Provider slug and display name are required.' });
  }
  if (!isValidHttpOrRelativeUrl(cleanBaseUrl, false)) {
    return res.status(400).json({ error: 'Invalid provider Base URL. Must be a public http(s) URL.' });
  }

  const { data, error } = await admin
    .from('ai_providers')
    .insert({
      slug: cleanSlug,
      name: cleanName,
      provider_type: String(provider_type || 'custom'),
      base_url: cleanBaseUrl,
      api_key_encrypted: cleanKey ? encryptSecret(cleanKey) : '',
      is_active: is_active !== false,
      priority: Number(priority || 1),
    })
    .select('id, slug, name, provider_type, base_url, is_active, priority')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'ai_provider_created', targetType: 'ai_provider', targetId: data.id, details: { slug: cleanSlug, name: cleanName } });
  return res.status(201).json({ provider: { ...data, has_api_key: Boolean(cleanKey) } });
});

router.patch('/ai/providers/:id', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, base_url, api_key, is_active, priority } = req.body as Record<string, unknown>;
    const cleanBaseUrl = typeof base_url === 'string' ? base_url.trim() : undefined;
    const cleanKey = typeof api_key === 'string' ? api_key.trim() : '';

    if (cleanBaseUrl !== undefined && !isValidHttpOrRelativeUrl(cleanBaseUrl, false)) {
      return res.status(400).json({ error: 'Invalid provider Base URL. Must be a public http(s) URL.' });
    }

    const { data: existing } = await admin
      .from('ai_providers')
      .select('id, provider_type, name, is_active, api_key_encrypted')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: 'AI provider not found.' });
    }

    const payload: Record<string, unknown> = {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(cleanBaseUrl !== undefined ? { base_url: cleanBaseUrl } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {}),
      ...(priority !== undefined ? { priority: Number(priority) } : {}),
    };

    if (cleanKey) {
      payload.api_key_encrypted = encryptSecret(cleanKey);
      if (is_active === undefined && !existing.is_active) {
        payload.is_active = true;
      }
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'Please paste an API key or update a configuration field before saving.' });
    }

    payload.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from('ai_providers')
      .update(payload)
      .eq('id', req.params.id)
      .select('id, slug, name, provider_type, base_url, api_key_encrypted, is_active, priority')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (cleanKey) {
      await ensureDefaultModelForProvider({
        id: data.id,
        provider_type: data.provider_type as 'gemini' | 'openai' | 'deepseek' | 'custom',
        name: data.name,
      });
    }

    await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'ai_provider_updated', targetType: 'ai_provider', targetId: req.params.id, details: { name: data.name, is_active: data.is_active, keyUpdated: Boolean(cleanKey) } });
    return res.json({
      provider: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        provider_type: data.provider_type,
        base_url: data.base_url,
        is_active: data.is_active,
        priority: data.priority,
        has_api_key: Boolean(data.api_key_encrypted && String(data.api_key_encrypted).trim().length > 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update AI provider.' });
  }
});

router.post('/ai/providers/:id/test', async (req, res) => {
  const { api_key, base_url, model_id } = (req.body || {}) as {
    api_key?: string;
    base_url?: string;
    model_id?: string;
  };
  const result = await testProviderConnection(req.params.id, {
    apiKey: typeof api_key === 'string' && api_key.trim() ? api_key.trim() : undefined,
    baseUrl: typeof base_url === 'string' && base_url.trim() ? base_url.trim() : undefined,
    modelId: typeof model_id === 'string' && model_id.trim() ? model_id.trim() : undefined,
  });
  return res.json(result);
});

router.post('/ai/models', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body as Record<string, unknown>;
  const provider_id = String(b.provider_id || '').trim();
  const model_id = String(b.model_id || '').trim();
  const display_name = String(b.display_name || '').trim();

  if (!provider_id || !model_id || !display_name) {
    return res.status(400).json({ error: 'Provider, Model ID, and Display Name are required.' });
  }

  const insertPayload = {
    provider_id,
    model_id,
    display_name,
    input_cost_per_1m: Number.isFinite(Number(b.input_cost_per_1m)) ? Number(b.input_cost_per_1m) : 0.15,
    output_cost_per_1m: Number.isFinite(Number(b.output_cost_per_1m)) ? Number(b.output_cost_per_1m) : 0.6,
    coins_per_usd: Number.isFinite(Number(b.coins_per_usd)) ? Number(b.coins_per_usd) : 1000,
    max_tokens: Number.isFinite(Number(b.max_tokens)) ? Number(b.max_tokens) : 2048,
    min_plan_slug: String(b.min_plan_slug || 'free'),
    is_active: b.is_active !== false,
    is_default: Boolean(b.is_default),
    is_fallback: Boolean(b.is_fallback),
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 1,
  };

  if (insertPayload.is_default) {
    await admin.from('ai_models').update({ is_default: false }).neq('id', '00000000-0000-0000-0000-000000000000');
  }
  const { data, error } = await admin.from('ai_models').insert(insertPayload).select('*, provider:ai_providers(id, slug, name)').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'ai_model_created', targetType: 'ai_model', targetId: data.id, details: insertPayload });
  return res.status(201).json({ model: data });
});

router.patch('/ai/models/:id', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const b = req.body as Record<string, unknown>;
  if (b.is_default === true) {
    await admin.from('ai_models').update({ is_default: false }).neq('id', req.params.id);
  }
  const { data, error } = await admin.from('ai_models').update(b).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'ai_model_updated', targetType: 'ai_model', targetId: req.params.id, details: b });
  return res.json({ model: data });
});

router.delete('/ai/models/:id', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('ai_models').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'ai_model_deleted', targetType: 'ai_model', targetId: req.params.id });
  return res.json({ success: true });
});

router.post('/ai/models/:id/test', async (req, res) => {
  const result = await testModelConnection(req.params.id);
  return res.json(result);
});

// Global Feature Flags
router.get('/features', async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('feature_flags').select('*').order('key');
  return res.json({ features: data || [] });
});

router.patch('/features/:key', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('feature_flags').update(req.body).eq('key', req.params.key).select('*').single();
  if (error) return res.status(400).json({ error: error.message });
  await writeAuditLog({ actorId: req.user!.id, actorEmail: req.user!.email, actorRole: req.user!.role, action: 'feature_flag_updated', targetType: 'feature_flag', targetId: req.params.key, details: req.body });
  return res.json({ feature: data });
});

// Payment Gateways & Manual Payment Review
router.get('/payments', async (_req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: gateways }, { data: payments }] = await Promise.all([
    admin
      .from('payment_gateways')
      .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
      .order('slug'),
    admin.from('payments').select('*, business:businesses(id, name, email)').order('created_at', { ascending: false }).limit(200),
  ]);
  return res.json({
    gateways: (gateways || []).map((g) => toSafeGatewayRow(g as Record<string, unknown>)),
    payments: payments || [],
  });
});

router.put('/manual-payment-methods/:method', async (req: AuthedRequest, res) => {
  try {
    const method = String(req.params.method || '').trim().toLowerCase();
    if (method !== 'bkash' && method !== 'nagad' && method !== 'rocket') {
      return res.status(400).json({ error: 'Method must be bkash, nagad, or rocket.' });
    }
    const { accounts, is_active, instructions, name } = req.body as {
      accounts?: unknown[];
      is_active?: boolean;
      instructions?: string;
      name?: string;
    };

    const gateway = await upsertManualGatewayAccounts(
      method,
      { accounts, is_active, instructions, name },
      { id: req.user!.id, email: req.user!.email, role: req.user!.role, ip: req.ip }
    );
    return res.json({ gateway });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update manual payment method.' });
  }
});

router.post('/payment-gateways', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : name;
    const slug = rawSlug
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    const gateway_type = typeof body.gateway_type === 'string' ? body.gateway_type.trim().toLowerCase() : 'manual';

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Gateway name must be between 2 and 100 characters.' });
    }
    if (!GATEWAY_SLUG_REGEX.test(slug)) {
      return res.status(400).json({ error: 'Gateway slug must be 2–49 lowercase letters, numbers, hyphens, or underscores.' });
    }
    if (!ALLOWED_GATEWAY_TYPES.has(gateway_type)) {
      return res.status(400).json({ error: 'Invalid gateway_type. Allowed: manual, bkash, nagad, rocket, sslcommerz, custom.' });
    }

    const { data: existing } = await admin.from('payment_gateways').select('id').eq('slug', slug).maybeSingle();
    if (existing) {
      return res.status(409).json({ error: `A payment gateway with slug "${slug}" already exists.` });
    }

    const config_public = sanitizeGatewayConfigPublic(
      {
        ...(body.config_public && typeof body.config_public === 'object' ? (body.config_public as Record<string, unknown>) : {}),
        ...(gateway_type === 'rocket' ? { manual_method: 'rocket' } : {}),
      },
      gateway_type || slug
    );
    const credentials_encrypted = buildEncryptedCredentials(body.credentials);
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 1000) : '';

    const insertPayload = {
      slug,
      name,
      gateway_type,
      is_active: body.is_active !== false,
      is_sandbox: body.is_sandbox === true,
      config_public,
      credentials_encrypted,
      instructions,
      updated_at: new Date().toISOString(),
    };

    let result = await admin
      .from('payment_gateways')
      .insert(insertPayload)
      .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
      .single();

    if (result.error && gateway_type === 'rocket' && result.error.message.toLowerCase().includes('gateway_type')) {
      result = await admin
        .from('payment_gateways')
        .insert({ ...insertPayload, gateway_type: 'manual' })
        .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
        .single();
    }

    if (result.error) return res.status(400).json({ error: result.error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'payment_gateway_created',
      targetType: 'payment_gateway',
      targetId: slug,
      details: { name, gateway_type, is_active: body.is_active !== false, is_sandbox: body.is_sandbox === true },
      ipAddress: req.ip,
    });

    return res.status(201).json({ gateway: toSafeGatewayRow(result.data as Record<string, unknown>) });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to create payment gateway.' });
  }
});

router.patch('/payment-gateways/:slug', async (req: AuthedRequest, res) => {
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
      instructions,
    } = req.body as Record<string, unknown>;

    const { data: existingGw } = await admin
      .from('payment_gateways')
      .select('slug, gateway_type, config_public')
      .eq('slug', req.params.slug)
      .maybeSingle();

    if (!existingGw) {
      return res.status(404).json({ error: 'Payment gateway not found.' });
    }

    const effectiveType = typeof gateway_type === 'string'
      ? gateway_type.trim().toLowerCase()
      : String(existingGw.gateway_type || req.params.slug);

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({ error: 'Gateway name must be between 2 and 100 characters.' });
      }
      payload.name = trimmed;
    }
    if (typeof gateway_type === 'string') {
      const normalizedType = gateway_type.trim().toLowerCase();
      if (!ALLOWED_GATEWAY_TYPES.has(normalizedType)) {
        return res.status(400).json({ error: 'Invalid gateway_type.' });
      }
      payload.gateway_type = normalizedType;
    }
    if (typeof is_active === 'boolean') payload.is_active = is_active;
    if (typeof is_sandbox === 'boolean') payload.is_sandbox = is_sandbox;
    if (config_public !== undefined) {
      payload.config_public = sanitizeGatewayConfigPublic(
        {
          ...(config_public && typeof config_public === 'object' ? (config_public as Record<string, unknown>) : {}),
          ...(effectiveType === 'rocket' ? { manual_method: 'rocket' } : {}),
        },
        effectiveType
      );
    }
    if (typeof instructions === 'string') payload.instructions = instructions.trim().slice(0, 1000);

    let credentialsUpdated = false;
    const encryptedCreds = buildEncryptedCredentials(credentials);
    if (clear_credentials === true) {
      payload.credentials_encrypted = '';
      credentialsUpdated = true;
    } else if (encryptedCreds) {
      payload.credentials_encrypted = encryptedCreds;
      credentialsUpdated = true;
    }

    let result = await admin
      .from('payment_gateways')
      .update(payload)
      .eq('slug', req.params.slug)
      .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
      .single();

    if (result.error && payload.gateway_type === 'rocket' && result.error.message.toLowerCase().includes('gateway_type')) {
      result = await admin
        .from('payment_gateways')
        .update({ ...payload, gateway_type: 'manual' })
        .eq('slug', req.params.slug)
        .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
        .single();
    }

    if (result.error) return res.status(400).json({ error: result.error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'payment_gateway_updated',
      targetType: 'payment_gateway',
      targetId: req.params.slug,
      details: { is_active, is_sandbox, name: payload.name, gateway_type: payload.gateway_type, credentialsUpdated },
      ipAddress: req.ip,
    });

    return res.json({ gateway: toSafeGatewayRow(result.data as Record<string, unknown>) });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update payment gateway.' });
  }
});

router.delete('/payment-gateways/:slug', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const slug = req.params.slug;
    if (slug === 'manual' || slug === 'bkash' || slug === 'nagad' || slug === 'rocket') {
      return res.status(400).json({ error: 'Built-in payment methods cannot be deleted. You can disable them instead.' });
    }

    const { count } = await admin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('gateway_slug', slug);

    if ((count || 0) > 0) {
      return res.status(400).json({
        error: `Cannot delete gateway "${slug}" because ${count} payment record(s) reference it. Disable it instead to preserve payment history.`,
      });
    }

    const { error } = await admin.from('payment_gateways').delete().eq('slug', slug);
    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'payment_gateway_deleted',
      targetType: 'payment_gateway',
      targetId: slug,
      ipAddress: req.ip,
    });

    return res.json({ deleted: true, slug });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete payment gateway.' });
  }
});

router.post('/payments/:paymentId/review', async (req: AuthedRequest, res) => {
  try {
    const { decision, admin_notes } = req.body as { decision: 'approved' | 'rejected'; admin_notes?: string };
    const updated = await reviewManualPayment({
      paymentId: req.params.paymentId,
      decision,
      adminNotes: admin_notes,
      adminUser: {
        id: req.user!.id,
        email: req.user!.email,
        role: req.user!.role,
        ip: req.ip,
      },
    });
    return res.json({ payment: updated });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Payment review failed.' });
  }
});

// Meta Platform Settings & Social Overview
router.get('/meta-settings', async (req, res) => {
  const admin = getSupabaseAdmin();
  const [{ data: settings }, { data: connections }, { data: logs }] = await Promise.all([
    admin
      .from('application_settings')
      .select('meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode')
      .eq('id', 1)
      .maybeSingle(),
    admin.from('social_connections').select('id, business_id, platform, account_name, status, connected_at'),
    admin.from('social_connection_logs').select('*').order('created_at', { ascending: false }).limit(30),
  ]);

  const baseUrl = resolveAppBaseUrl(req);
  return res.json({
    settings: settings
      ? {
          meta_app_id: settings.meta_app_id,
          meta_api_version: settings.meta_api_version,
          meta_webhook_verify_token: settings.meta_webhook_verify_token,
          meta_mode: settings.meta_mode,
          has_meta_app_secret: Boolean(settings.meta_app_secret_encrypted),
        }
      : null,
    oauthRedirectUri: getMetaOAuthRedirectUri(req),
    webhookUrl: `${baseUrl}/api/webhooks/meta`,
    connections: connections || [],
    logs: logs || [],
  });
});

router.patch('/meta-settings', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const { meta_app_id, meta_app_secret, meta_api_version, meta_webhook_verify_token, meta_mode } =
    req.body as Record<string, string>;

  const payload: Record<string, unknown> = {
    ...(meta_app_id !== undefined ? { meta_app_id } : {}),
    ...(meta_api_version !== undefined ? { meta_api_version } : {}),
    ...(meta_webhook_verify_token !== undefined ? { meta_webhook_verify_token } : {}),
    ...(meta_mode !== undefined ? { meta_mode } : {}),
  };
  if (meta_app_secret && meta_app_secret.trim()) {
    payload.meta_app_secret_encrypted = encryptSecret(meta_app_secret.trim());
  }

  const { data, error } = await admin
    .from('application_settings')
    .update(payload)
    .eq('id', 1)
    .select('meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode')
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: 'meta_platform_settings_updated',
    targetType: 'application_settings',
    targetId: '1',
    details: { meta_app_id, meta_mode, secretUpdated: Boolean(meta_app_secret) },
  });

  return res.json({
    settings: {
      meta_app_id: data.meta_app_id,
      meta_api_version: data.meta_api_version,
      meta_webhook_verify_token: data.meta_webhook_verify_token,
      meta_mode: data.meta_mode,
      has_meta_app_secret: Boolean(data.meta_app_secret_encrypted),
    },
  });
});

// Global Application Settings & App Customization
router.get('/settings', async (_req, res) => {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('application_settings')
    .select(
      'id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, updated_at'
    )
    .eq('id', 1)
    .maybeSingle();
  return res.json({ settings: data });
});

router.patch('/settings', async (req: AuthedRequest, res) => {
  const admin = getSupabaseAdmin();
  const allowedKeys = [
    'app_name',
    'logo_url',
    'icon_url',
    'default_theme',
    'primary_color',
    'secondary_color',
    'default_language',
    'maintenance_mode',
    'registration_enabled',
    'support_email',
    'support_phone',
    'terms_url',
    'privacy_url',
    'announcement',
  ];
  const urlKeys = ['logo_url', 'icon_url', 'terms_url', 'privacy_url'];
  const payload: Record<string, unknown> = {};
  for (const k of allowedKeys) {
    if (req.body[k] !== undefined) {
      if (urlKeys.includes(k) && !isValidHttpOrRelativeUrl(req.body[k], true)) {
        return res.status(400).json({ error: `Invalid URL provided for ${k}.` });
      }
      payload[k] = req.body[k];
    }
  }
  const { data, error } = await admin
    .from('application_settings')
    .update(payload)
    .eq('id', 1)
    .select(
      'id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, updated_at'
    )
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: 'global_settings_updated',
    targetType: 'application_settings',
    targetId: '1',
    details: payload,
  });

  return res.json({ settings: data });
});

// Analytics & Reports
router.get('/analytics', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { range, start, end, useMonthlyBuckets } = resolveDateRange(req.query as Record<string, unknown>);

    const [
      { data: profiles },
      { data: businesses },
      { data: plans },
      { data: orders },
      { data: payments },
      { data: aiLogs },
    ] = await Promise.all([
      admin.from('profiles').select('id, created_at, status'),
      admin.from('businesses').select('id, name, category, status, subscription_plan_id, created_at'),
      admin.from('subscription_plans').select('id, name, slug'),
      admin.from('orders').select('id, business_id, total_amount, order_status, created_at'),
      admin.from('payments').select('id, business_id, amount, payment_for, status, created_at'),
      admin.from('ai_usage_logs').select('business_id, provider_slug, total_tokens, provider_cost_usd, coins_deducted, status, created_at'),
    ]);

    const inCur = (d?: string) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= start.getTime() && t <= end.getTime();
    };

    const keys = buildBucketSkeleton(start, end, useMonthlyBuckets);
    const bucketMap = new Map(
      keys.map((k) => [
        k,
        { date: k, revenue: 0, orders: 0, users: 0, businesses: 0, aiRequests: 0, coinsUsed: 0 },
      ])
    );

    const profs = profiles || [];
    const bizList = businesses || [];
    const orderList = orders || [];
    const payList = (payments || []).filter((p) => p.status === 'approved');
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
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.users += 1;
    }

    for (const biz of bizList) {
      if (!inCur(biz.created_at)) continue;
      const k = formatBucketKey(biz.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.businesses += 1;
    }

    for (const o of orderList) {
      if (!inCur(o.created_at)) continue;
      periodOrders += 1;
      periodGmv += Number(o.total_amount || 0);
      const k = formatBucketKey(o.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.orders += 1;
    }

    for (const p of payList) {
      if (!inCur(p.created_at)) continue;
      const amt = Number(p.amount || 0);
      periodRevenue += amt;
      if (p.payment_for === 'subscription') periodSubRevenue += amt;
      if (p.payment_for === 'coin_package') periodCoinRevenue += amt;
      const k = formatBucketKey(p.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) b.revenue += amt;
    }

    const providerMap = new Map<string, { providerSlug: string; requests: number; tokens: number; coinsUsed: number; costUsd: number }>();
    const bizAiMap = new Map<string, number>();

    for (const l of aiList) {
      if (!inCur(l.created_at)) continue;
      if (l.status === 'success') periodAiRequests += 1;
      const tokens = Number(l.total_tokens || 0);
      const coins = Number(l.coins_deducted || 0);
      const cost = Number(l.provider_cost_usd || 0);
      periodTokens += tokens;
      periodCoinsUsed += coins;
      periodAiCostUsd += cost;

      const k = formatBucketKey(l.created_at, useMonthlyBuckets);
      const b = k ? bucketMap.get(k) : undefined;
      if (b) {
        if (l.status === 'success') b.aiRequests += 1;
        b.coinsUsed += coins;
      }

      const prev = providerMap.get(l.provider_slug) || {
        providerSlug: l.provider_slug,
        requests: 0,
        tokens: 0,
        coinsUsed: 0,
        costUsd: 0,
      };
      if (l.status === 'success') prev.requests += 1;
      prev.tokens += tokens;
      prev.coinsUsed += coins;
      prev.costUsd += cost;
      providerMap.set(l.provider_slug, prev);

      bizAiMap.set(l.business_id, (bizAiMap.get(l.business_id) || 0) + coins);
    }

    // Category breakdown
    const catCount = new Map<string, number>();
    for (const b of bizList) {
      const cat = b.category || 'Uncategorized';
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }

    // Plan distribution
    const planNameMap = new Map((plans || []).map((p) => [p.id, p.name]));
    const planCount = new Map<string, number>();
    for (const b of bizList) {
      const pName = (b.subscription_plan_id && planNameMap.get(b.subscription_plan_id)) || 'Unassigned';
      planCount.set(pName, (planCount.get(pName) || 0) + 1);
    }

    // Top businesses by orders & GMV
    const bizOrderStats = new Map<string, { orders: number; gmv: number }>();
    for (const o of orderList) {
      if (!inCur(o.created_at)) continue;
      const cur = bizOrderStats.get(o.business_id) || { orders: 0, gmv: 0 };
      cur.orders += 1;
      cur.gmv += Number(o.total_amount || 0);
      bizOrderStats.set(o.business_id, cur);
    }
    const topBusinesses = bizList
      .map((b) => {
        const os = bizOrderStats.get(b.id) || { orders: 0, gmv: 0 };
        return {
          id: b.id,
          name: b.name,
          category: b.category,
          status: b.status,
          orders: os.orders,
          gmv: os.gmv,
          aiCoinsUsed: Number((bizAiMap.get(b.id) || 0).toFixed(2)),
        };
      })
      .sort((a, b) => b.gmv - a.gmv || b.orders - a.orders)
      .slice(0, 8);

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
        activeBusinesses: bizList.filter((b) => b.status === 'active').length,
      },
      timeSeries: Array.from(bucketMap.values()),
      businessByCategory: Array.from(catCount.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      planDistribution: Array.from(planCount.entries())
        .map(([planName, count]) => ({ planName, count }))
        .sort((a, b) => b.count - a.count),
      aiProviderUsage: Array.from(providerMap.values()).sort((a, b) => b.requests - a.requests),
      topBusinesses,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Analytics error.' });
  }
});

// System Logs (Audit Logs, AI Logs, Social Logs)
router.get('/audit-logs', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: auditLogs }, { data: aiErrors }, { data: socialLogs }] = await Promise.all([
      admin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
      admin
        .from('ai_usage_logs')
        .select('id, business_id, provider_slug, model_id, status, error_message, coins_deducted, total_tokens, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      admin
        .from('social_connection_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    return res.json({
      logs: auditLogs || [],
      aiLogs: aiErrors || [],
      socialLogs: socialLogs || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load logs.' });
  }
});

// Platform Notifications & Announcements
router.get('/notifications', async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: notifications }, { data: pendingPayments }, { data: businesses }, { data: settings }] =
      await Promise.all([
        admin
          .from('notifications')
          .select('*, business:businesses(id, name)')
          .order('created_at', { ascending: false })
          .limit(80),
        admin
          .from('payments')
          .select('id, business_id, payment_for, amount, currency, gateway_slug, created_at, business:businesses(name)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        admin.from('businesses').select('id, name, owner_id, status').order('name'),
        admin.from('application_settings').select('announcement').eq('id', 1).maybeSingle(),
      ]);

    return res.json({
      notifications: notifications || [],
      pendingPayments: pendingPayments || [],
      businesses: businesses || [],
      announcement: settings?.announcement || '',
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load notifications.' });
  }
});

router.post('/notifications/broadcast', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { title, body, type, targetBusinessId } = req.body as {
      title?: string;
      body?: string;
      type?: string;
      targetBusinessId?: string;
    };

    if (!title?.trim()) {
      return res.status(400).json({ error: 'Notification title is required.' });
    }

    const safeType = type && ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';

    if (targetBusinessId && targetBusinessId !== 'all') {
      if (!UUID_RE.test(targetBusinessId)) {
        return res.status(400).json({ error: 'Invalid target business ID.' });
      }
      const { data: biz } = await admin.from('businesses').select('id, owner_id').eq('id', targetBusinessId).maybeSingle();
      if (!biz) return res.status(404).json({ error: 'Target business not found.' });

      await createNotification({
        businessId: biz.id,
        userId: biz.owner_id,
        title: title.trim(),
        body: (body || '').trim(),
        type: safeType,
      });

      await writeAuditLog({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        businessId: biz.id,
        action: 'admin_notification_sent',
        targetType: 'notification',
        targetId: biz.id,
        details: { title: title.trim(), type: safeType },
      });

      return res.status(201).json({ sentCount: 1 });
    }

    const { data: allBiz } = await admin.from('businesses').select('id, owner_id').eq('status', 'active');
    const targets = allBiz || [];
    if (targets.length > 0) {
      await admin.from('notifications').insert(
        targets.map((b) => ({
          business_id: b.id,
          user_id: b.owner_id,
          title: title.trim(),
          body: (body || '').trim(),
          type: safeType,
        }))
      );
    }

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'admin_notification_broadcast',
      targetType: 'notification',
      targetId: 'all',
      details: { title: title.trim(), type: safeType, sentCount: targets.length },
    });

    return res.status(201).json({ sentCount: targets.length });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send notification.' });
  }
});

// Security & Admin Self-Profile
router.patch('/profile', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { full_name, phone, language, timezone } = req.body as {
      full_name?: string;
      phone?: string;
      language?: string;
      timezone?: string;
    };
    const payload: Record<string, unknown> = {};
    if (full_name !== undefined) payload.full_name = String(full_name).trim();
    if (phone !== undefined) payload.phone = String(phone).trim();
    if (language && ['bn', 'en'].includes(language)) payload.language = language;
    if (timezone !== undefined) payload.timezone = String(timezone).trim();

    const { data, error } = await admin.from('profiles').update(payload).eq('id', req.user!.id).select('*').single();
    if (error) return res.status(400).json({ error: error.message });

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'admin_profile_updated',
      targetType: 'profile',
      targetId: req.user!.id,
      details: payload,
      ipAddress: req.ip,
    });

    return res.json({ profile: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Profile update failed.' });
  }
});

router.get('/security', async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profiles }, { data: securityLogs }] = await Promise.all([
      admin.from('profiles').select('id, email, full_name, role, status, created_at').order('created_at', { ascending: false }),
      admin
        .from('audit_logs')
        .select('*')
        .in('action', [
          'super_admin_bootstrap',
          'user_status_updated',
          'user_updated',
          'ai_provider_created',
          'ai_provider_updated',
          'meta_platform_settings_updated',
          'payment_gateway_updated',
          'global_settings_updated',
          'admin_profile_updated',
        ])
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const roleCounts: Record<string, number> = {};
    for (const p of profiles || []) {
      roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    }

    return res.json({
      admins: (profiles || []).filter((p) => p.role === 'super_admin'),
      roleCounts,
      securityLogs: securityLogs || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load security overview.' });
  }
});

// Backup & Health Overview + Safe Non-Secret Config Export
router.get('/backup/status', async (_req, res) => {
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
      { count: auditLogsCount },
    ] = await Promise.all([
      checkSchemaStatus(),
      admin.from('profiles').select('id', { count: 'exact', head: true }),
      admin.from('businesses').select('id', { count: 'exact', head: true }),
      admin.from('products').select('id', { count: 'exact', head: true }),
      admin.from('orders').select('id', { count: 'exact', head: true }),
      admin.from('customers').select('id', { count: 'exact', head: true }),
      admin.from('messages').select('id', { count: 'exact', head: true }),
      admin.from('payments').select('id', { count: 'exact', head: true }),
      admin.from('audit_logs').select('id', { count: 'exact', head: true }),
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
        audit_logs: auditLogsCount || 0,
      },
      automatedBackupSupported: false,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect database health.' });
  }
});

router.get('/backup/export-config', async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [
      { data: appSettings },
      { data: subscriptionPlans },
      { data: coinPackages },
      { data: featureFlags },
      { data: aiProviders },
      { data: aiModels },
      { data: paymentGateways },
    ] = await Promise.all([
      admin
        .from('application_settings')
        .select(
          'id, app_name, logo_url, icon_url, default_theme, primary_color, secondary_color, default_language, maintenance_mode, registration_enabled, support_email, support_phone, terms_url, privacy_url, announcement, meta_api_version, meta_mode, updated_at'
        )
        .eq('id', 1)
        .maybeSingle(),
      admin.from('subscription_plans').select('*').order('display_order'),
      admin.from('coin_packages').select('*').order('display_order'),
      admin.from('feature_flags').select('*').order('key'),
      admin.from('ai_providers').select('id, slug, name, provider_type, base_url, is_active, priority').order('priority'),
      admin.from('ai_models').select('*').order('priority'),
      admin.from('payment_gateways').select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, instructions').order('slug'),
    ]);

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'platform_config_exported',
      targetType: 'system',
      targetId: 'config_json',
      ipAddress: req.ip,
    });

    return res.json({
      exportedAt: new Date().toISOString(),
      exportedBy: req.user!.email,
      note: 'Secrets, encrypted API keys, and customer PII are intentionally excluded from this configuration export.',
      application_settings: appSettings,
      subscription_plans: subscriptionPlans || [],
      coin_packages: coinPackages || [],
      feature_flags: featureFlags || [],
      ai_providers: aiProviders || [],
      ai_models: aiModels || [],
      payment_gateways: paymentGateways || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export configuration.' });
  }
});

export default router;
