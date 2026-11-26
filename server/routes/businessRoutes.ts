import crypto from 'crypto';
import { Router } from 'express';
import { getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { createNotification, writeAuditLog } from '../db/repository.ts';
import { requireAuth, requireBusinessAccess, requireFeature, type AuthedRequest } from '../middleware/auth.ts';
import { evaluateOrderRisk } from '../services/orderRisk.ts';
import { sendMetaCapiEvent } from '../services/metaService.ts';
import { broadcastToBusiness } from '../services/realtimeBus.ts';

const router = Router();

// Current User Profile + Businesses + Notifications
router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const userId = req.user!.id;

    const [{ data: ownedBusinesses }, { data: memberships }, { data: notifications }] = await Promise.all([
      admin
        .from('businesses')
        .select('*, subscription_plan:subscription_plans(*)')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true }),
      admin
        .from('business_members')
        .select('role, permissions, status, business:businesses(*, subscription_plan:subscription_plans(*))')
        .eq('user_id', userId)
        .eq('status', 'active'),
      admin
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const bizMap = new Map<string, Record<string, unknown>>();
    for (const b of ownedBusinesses || []) {
      bizMap.set(b.id, { ...b, memberRole: 'business_owner', memberPermissions: { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true } });
    }
    for (const m of memberships || []) {
      const biz = m.business as unknown as Record<string, unknown> | null;
      if (biz && !bizMap.has(String(biz.id))) {
        bizMap.set(String(biz.id), { ...biz, memberRole: m.role, memberPermissions: m.permissions });
      }
    }

    return res.json({
      profile: req.user,
      businesses: Array.from(bizMap.values()),
      notifications: notifications || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load account.' });
  }
});

router.patch('/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { full_name, phone, language, timezone, avatar_url } = req.body as Record<string, string>;
    const { data, error } = await admin
      .from('profiles')
      .update({
        ...(full_name !== undefined ? { full_name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        ...(avatar_url !== undefined ? { avatar_url } : {}),
      })
      .eq('id', req.user!.id)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ profile: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update profile.' });
  }
});

// Business Setup Wizard
router.post('/businesses', requireAuth, async (req: AuthedRequest, res) => {
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
      whatsapp_info,
    } = req.body as Record<string, unknown>;

    if (!name || !owner_name || !email) {
      return res.status(400).json({ error: 'Business Name, Owner Name, and Email are required.' });
    }

    const { data: freePlan } = await admin
      .from('subscription_plans')
      .select('id, coin_allocation, duration_days')
      .eq('slug', 'free')
      .maybeSingle();

    const expiresAt = new Date(Date.now() + (freePlan?.duration_days || 30) * 86400000).toISOString();

    const { data: business, error } = await admin
      .from('businesses')
      .insert({
        owner_id: req.user!.id,
        name,
        owner_name,
        email,
        phone: phone || '',
        category: category || 'Retail & E-Commerce',
        address: address || '',
        logo_url: logo_url || '',
        facebook_info: facebook_info || {},
        instagram_info: instagram_info || {},
        whatsapp_info: whatsapp_info || {},
        subscription_plan_id: freePlan?.id || null,
        subscription_status: 'active',
        subscription_expires_at: expiresAt,
      })
      .select('*, subscription_plan:subscription_plans(*)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await Promise.all([
      admin.from('business_members').insert({
        business_id: business.id,
        user_id: req.user!.id,
        role: 'business_owner',
        permissions: { inbox: true, orders: true, products: true, customers: true, analytics: true, settings: true },
        status: 'active',
      }),
      admin.from('ai_settings').insert({
        business_id: business.id,
        agent_name: `${String(name)} Assistant`,
      }),
      admin.rpc('credit_ai_coins_atomic', {
        p_business_id: business.id,
        p_amount: freePlan?.coin_allocation || 100,
        p_type: 'subscription_grant',
        p_description: 'Initial Free Plan welcome AI coin allocation',
        p_reference_id: business.id,
        p_user_id: req.user!.id,
      }),
    ]);

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: business.id,
      action: 'business_created',
      targetType: 'business',
      targetId: business.id,
      details: { name },
    });

    return res.status(201).json({ business });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create business.' });
  }
});

router.patch('/businesses/:businessId', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, owner_name, email, phone, category, address, logo_url, facebook_info, instagram_info, whatsapp_info } =
      req.body as Record<string, unknown>;

    const { data, error } = await admin
      .from('businesses')
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(owner_name !== undefined ? { owner_name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(logo_url !== undefined ? { logo_url } : {}),
        ...(facebook_info !== undefined ? { facebook_info } : {}),
        ...(instagram_info !== undefined ? { instagram_info } : {}),
        ...(whatsapp_info !== undefined ? { whatsapp_info } : {}),
      })
      .eq('id', req.businessId!)
      .select('*, subscription_plan:subscription_plans(*)')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ business: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

// Storage Upload (Product images, business logos, payment proofs, KB files)
router.post('/businesses/:businessId/upload', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const { bucket, fileName, base64Data, contentType } = req.body as {
      bucket?: string;
      fileName?: string;
      base64Data?: string;
      contentType?: string;
    };

    const allowedBuckets = new Set(['product-images', 'business-logos', 'chat-attachments', 'knowledge-docs', 'payment-proofs']);
    const targetBucket = bucket && allowedBuckets.has(bucket) ? bucket : 'product-images';
    if (!base64Data || !fileName) {
      return res.status(400).json({ error: 'fileName and base64Data are required.' });
    }

    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds 8MB upload limit.' });
    }

    const blockedMimePrefixes = ['text/html', 'application/javascript', 'text/javascript', 'image/svg+xml'];
    const normalizedType = (contentType || 'application/octet-stream').toLowerCase();
    if (blockedMimePrefixes.some((b) => normalizedType.includes(b))) {
      return res.status(400).json({ error: 'Unsupported or unsafe file type.' });
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${req.businessId}/${Date.now()}_${safeName}`;
    const admin = getSupabaseAdmin();

    const { error } = await admin.storage.from(targetBucket).upload(storagePath, buffer, {
      contentType: normalizedType,
      upsert: false,
    });

    if (error) return res.status(400).json({ error: error.message });

    const { data: pubUrl } = admin.storage.from(targetBucket).getPublicUrl(storagePath);
    return res.json({ url: pubUrl.publicUrl, path: storagePath, bucket: targetBucket });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed.' });
  }
});

// Dashboard Stats (Real Supabase Records + Date Filters)
router.get('/businesses/:businessId/dashboard', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const range = (req.query.range as string) || '30d';
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    const now = new Date();
    let startDate = new Date(now.getTime() - 30 * 86400000);
    let endDate = now;

    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === '7d') {
      startDate = new Date(now.getTime() - 7 * 86400000);
    } else if (range === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === 'custom' && startParam) {
      startDate = new Date(startParam);
      if (endParam) endDate = new Date(`${endParam}T23:59:59.999Z`);
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
      { data: recentOrders },
    ] = await Promise.all([
      admin
        .from('orders')
        .select('id, total_amount, discount, delivery_charge, order_status, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startIso)
        .lte('created_at', endIso),
      admin
        .from('order_items')
        .select('order_id, quantity, unit_cost, total_price')
        .eq('business_id', businessId)
        .gte('created_at', startIso)
        .lte('created_at', endIso),
      admin
        .from('products')
        .select('id, stock_quantity, low_stock_threshold, status')
        .eq('business_id', businessId),
      admin.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      admin.from('coin_wallets').select('*').eq('business_id', businessId).maybeSingle(),
      admin
        .from('ai_usage_logs')
        .select('total_tokens, coins_deducted, status, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startIso)
        .lte('created_at', endIso),
      admin
        .from('social_connections')
        .select('id, platform, account_name, status')
        .eq('business_id', businessId)
        .eq('status', 'connected'),
      admin
        .from('conversations')
        .select('id, channel, customer_name, last_message, last_message_at, unread_count, status')
        .eq('business_id', businessId)
        .order('last_message_at', { ascending: false })
        .limit(6),
      admin
        .from('orders')
        .select('id, order_number, customer_name, customer_phone, total_amount, order_status, order_source, created_at')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(6),
    ]);

    const orderList = orders || [];
    const todayOrders = orderList.filter((o) => o.created_at >= todayIso).length;
    const byStatus = (s: string) => orderList.filter((o) => o.order_status === s).length;
    const validSalesOrders = orderList.filter((o) => !['cancelled', 'returned', 'refunded'].includes(o.order_status));
    const totalSales = validSalesOrders.reduce((acc, o) => acc + Number(o.total_amount || 0), 0);
    const totalDelivery = validSalesOrders.reduce((acc, o) => acc + Number(o.delivery_charge || 0), 0);

    const validOrderIds = new Set(validSalesOrders.map((o) => o.id));
    const totalProductCost = (orderItems || [])
      .filter((it) => validOrderIds.has(it.order_id))
      .reduce((acc, it) => acc + Number(it.unit_cost || 0) * Number(it.quantity || 1), 0);

    const estimatedProfit = totalSales - totalProductCost - totalDelivery;

    const prodList = products || [];
    const lowStockProducts = prodList.filter(
      (p) => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 5)
    ).length;

    const aiList = aiLogs || [];
    const aiRequests = aiList.filter((l) => l.status === 'success').length;
    const aiTokens = aiList.reduce((acc, l) => acc + Number(l.total_tokens || 0), 0);
    const aiCoinsUsed = aiList.reduce((acc, l) => acc + Number(l.coins_deducted || 0), 0);

    // Daily chart series
    const chartMap = new Map<string, { date: string; sales: number; orders: number }>();
    for (const o of orderList) {
      const day = o.created_at.slice(0, 10);
      const curr = chartMap.get(day) || { date: day, sales: 0, orders: 0 };
      curr.orders += 1;
      if (!['cancelled', 'returned', 'refunded'].includes(o.order_status)) {
        curr.sales += Number(o.total_amount || 0);
      }
      chartMap.set(day, curr);
    }
    const chartSeries = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return res.json({
      stats: {
        totalOrders: orderList.length,
        todayOrders,
        pendingOrders: byStatus('pending'),
        confirmedOrders: byStatus('confirmed'),
        processingOrders: byStatus('processing'),
        deliveredOrders: byStatus('delivered'),
        cancelledOrders: byStatus('cancelled'),
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
        connectedChannelsCount: (socialConns || []).length,
      },
      connectedChannels: socialConns || [],
      recentConversations: recentConversations || [],
      recentOrders: recentOrders || [],
      chartSeries,
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load dashboard.' });
  }
});

// Products & Inventory CRUD
router.get('/businesses/:businessId/products', requireAuth, requireBusinessAccess('products'), requireFeature('products'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('products')
      .select('*, images:product_images(*), variants:product_variants(*)')
      .eq('business_id', req.businessId!)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ products: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch products.' });
  }
});

router.post('/businesses/:businessId/products', requireAuth, requireBusinessAccess('products'), requireFeature('products'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body as Record<string, unknown>;
    if (!b.name) return res.status(400).json({ error: 'Product name is required.' });

    const stockQty = Number(b.stock_quantity || 0);
    const derivedStatus = stockQty <= 0 && b.status !== 'draft' ? 'out_of_stock' : (b.status as string) || 'active';

    const images = Array.isArray(b.images) ? (b.images as string[]) : [];
    const primaryImg = (b.primary_image_url as string) || images[0] || '';

    const { data: product, error } = await admin
      .from('products')
      .insert({
        business_id: req.businessId!,
        name: b.name,
        sku: b.sku || `SKU-${Date.now().toString().slice(-6)}`,
        description: b.description || '',
        regular_price: Number(b.regular_price || 0),
        discount_price: b.discount_price !== undefined && b.discount_price !== '' ? Number(b.discount_price) : null,
        purchase_cost: Number(b.purchase_cost || 0),
        stock_quantity: stockQty,
        low_stock_threshold: Number(b.low_stock_threshold || 5),
        category_name: b.category_name || 'General',
        colors: Array.isArray(b.colors) ? b.colors : [],
        sizes: Array.isArray(b.sizes) ? b.sizes : [],
        status: derivedStatus,
        is_featured: Boolean(b.is_featured),
        primary_image_url: primaryImg,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (images.length > 0) {
      await admin.from('product_images').insert(
        images.map((url, idx) => ({
          business_id: req.businessId!,
          product_id: product.id,
          image_url: url,
          display_order: idx,
        }))
      );
    }

    return res.status(201).json({ product });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create product.' });
  }
});

router.patch('/businesses/:businessId/products/:productId', requireAuth, requireBusinessAccess('products'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body as Record<string, unknown>;
    const stockQty = b.stock_quantity !== undefined ? Number(b.stock_quantity) : undefined;
    let status = b.status as string | undefined;
    if (stockQty !== undefined && stockQty <= 0 && status === 'active') {
      status = 'out_of_stock';
    }

    const images = Array.isArray(b.images) ? (b.images as string[]) : undefined;
    const primaryImg = (b.primary_image_url as string | undefined) || (images && images[0]);

    const { data: product, error } = await admin
      .from('products')
      .update({
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.sku !== undefined ? { sku: b.sku } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.regular_price !== undefined ? { regular_price: Number(b.regular_price) } : {}),
        ...(b.discount_price !== undefined
          ? { discount_price: b.discount_price === '' || b.discount_price === null ? null : Number(b.discount_price) }
          : {}),
        ...(b.purchase_cost !== undefined ? { purchase_cost: Number(b.purchase_cost) } : {}),
        ...(stockQty !== undefined ? { stock_quantity: stockQty } : {}),
        ...(b.low_stock_threshold !== undefined ? { low_stock_threshold: Number(b.low_stock_threshold) } : {}),
        ...(b.category_name !== undefined ? { category_name: b.category_name } : {}),
        ...(b.colors !== undefined ? { colors: b.colors } : {}),
        ...(b.sizes !== undefined ? { sizes: b.sizes } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(b.is_featured !== undefined ? { is_featured: Boolean(b.is_featured) } : {}),
        ...(primaryImg !== undefined ? { primary_image_url: primaryImg } : {}),
      })
      .eq('id', req.params.productId)
      .eq('business_id', req.businessId!)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (images) {
      await admin.from('product_images').delete().eq('product_id', req.params.productId);
      if (images.length > 0) {
        await admin.from('product_images').insert(
          images.map((url, idx) => ({
            business_id: req.businessId!,
            product_id: req.params.productId,
            image_url: url,
            display_order: idx,
          }))
        );
      }
    }

    return res.json({ product });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update product.' });
  }
});

router.delete('/businesses/:businessId/products/:productId', requireAuth, requireBusinessAccess('products'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('products')
      .delete()
      .eq('id', req.params.productId)
      .eq('business_id', req.businessId!);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete product.' });
  }
});

// Customers CRM
router.get('/businesses/:businessId/customers', requireAuth, requireBusinessAccess('customers'), requireFeature('crm'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('customers')
      .select('*')
      .eq('business_id', req.businessId!)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ customers: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch customers.' });
  }
});

router.post('/businesses/:businessId/customers', requireAuth, requireBusinessAccess('customers'), requireFeature('crm'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, phone, email, address, tags, notes, segment } = req.body as Record<string, unknown>;
    if (!name) return res.status(400).json({ error: 'Customer name is required.' });

    const { data, error } = await admin
      .from('customers')
      .insert({
        business_id: req.businessId!,
        name,
        phone: phone || '',
        email: email || '',
        address: address || '',
        tags: Array.isArray(tags) ? tags : [],
        notes: notes || '',
        segment: segment || 'standard',
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ customer: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create customer.' });
  }
});

router.patch('/businesses/:businessId/customers/:customerId', requireAuth, requireBusinessAccess('customers'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { name, phone, email, address, tags, notes, segment } = req.body as Record<string, unknown>;
    const { data, error } = await admin
      .from('customers')
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(segment !== undefined ? { segment } : {}),
      })
      .eq('id', req.params.customerId)
      .eq('business_id', req.businessId!)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ customer: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update customer.' });
  }
});

router.get('/businesses/:businessId/customers/:customerId/history', requireAuth, requireBusinessAccess('customers'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: orders }, { data: conversations }] = await Promise.all([
      admin
        .from('orders')
        .select('*, items:order_items(*)')
        .eq('business_id', req.businessId!)
        .eq('customer_id', req.params.customerId)
        .order('created_at', { ascending: false }),
      admin
        .from('conversations')
        .select('id, channel, last_message, last_message_at, status')
        .eq('business_id', req.businessId!)
        .eq('customer_id', req.params.customerId)
        .order('last_message_at', { ascending: false }),
    ]);

    return res.json({ orders: orders || [], conversations: conversations || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load history.' });
  }
});

// Orders Management
router.get('/businesses/:businessId/orders', requireAuth, requireBusinessAccess('orders'), requireFeature('orders'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('orders')
      .select('*, items:order_items(*), history:order_status_history(*), shipments:courier_shipments(*)')
      .eq('business_id', req.businessId!)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    const orders = (data || []).map((ord) => ({
      ...ord,
      shipments: Array.isArray(ord.shipments)
        ? [...ord.shipments].sort(
            (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          )
        : [],
    }));
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch orders.' });
  }
});

router.post('/businesses/:businessId/orders', requireAuth, requireBusinessAccess('orders'), requireFeature('orders'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
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
      confirm_now,
    } = req.body as {
      customer_name?: string;
      customer_phone?: string;
      customer_address?: string;
      items?: Array<{ product_id?: string; product_name?: string; quantity: number; unit_price?: number; variant_color?: string; variant_size?: string }>;
      discount?: number;
      delivery_charge?: number;
      payment_method?: string;
      order_source?: string;
      notes?: string;
      conversation_id?: string;
      confirm_now?: boolean;
    };

    if (!customer_name || !customer_phone || !customer_address || !items?.length) {
      return res.status(400).json({ error: 'Customer name, phone, address, and at least one item are required.' });
    }

    // Match/upsert customer
    let customerId: string | null = null;
    const { data: existingCust } = await admin
      .from('customers')
      .select('id, total_orders, total_spent')
      .eq('business_id', businessId)
      .eq('phone', customer_phone)
      .maybeSingle();

    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const { data: newCust } = await admin
        .from('customers')
        .insert({ business_id: businessId, name: customer_name, phone: customer_phone, address: customer_address })
        .select('id')
        .single();
      customerId = newCust?.id || null;
    }

    const productIds = items.map((i) => i.product_id).filter(Boolean) as string[];
    const { data: dbProducts } = productIds.length
      ? await admin.from('products').select('*').eq('business_id', businessId).in('id', productIds)
      : { data: [] };
    const prodMap = new Map((dbProducts || []).map((p) => [p.id, p]));

    let subtotal = 0;
    const resolvedItems = items.map((i) => {
      const p = i.product_id ? prodMap.get(i.product_id) : undefined;
      const unitPrice = i.unit_price !== undefined ? Number(i.unit_price) : Number(p?.discount_price ?? p?.regular_price ?? 0);
      const unitCost = Number(p?.purchase_cost || 0);
      const qty = Math.max(1, Number(i.quantity || 1));
      const total = unitPrice * qty;
      subtotal += total;
      return {
        business_id: businessId,
        product_id: p?.id || null,
        product_name: p?.name || i.product_name || 'Custom Product',
        sku: p?.sku || '',
        variant_color: i.variant_color || '',
        variant_size: i.variant_size || '',
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_price: total,
      };
    });

    const disc = Number(discount || 0);
    const deliv = Number(delivery_charge || 0);
    const totalAmount = Math.max(0, subtotal - disc + deliv);
    const risk = await evaluateOrderRisk({ businessId, customerPhone: customer_phone, totalAmount });
    const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
    const initialStatus = confirm_now ? 'confirmed' : 'pending';

    const { data: order, error } = await admin
      .from('orders')
      .insert({
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
        payment_method: payment_method || 'cod',
        payment_status: 'unpaid',
        order_status: initialStatus,
        order_source: order_source || 'manual',
        risk_level: risk.riskLevel,
        risk_reasons: risk.reasons,
        notes: notes || '',
        created_by: req.user!.id,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await admin.from('order_items').insert(resolvedItems.map((it) => ({ ...it, order_id: order.id })));
    await admin.from('order_status_history').insert({
      business_id: businessId,
      order_id: order.id,
      old_status: '',
      new_status: initialStatus,
      note: confirm_now ? 'Order created and confirmed from Mini Store POS' : 'Order created',
      changed_by: req.user!.id,
    });

    if (confirm_now) {
      for (const item of resolvedItems) {
        if (!item.product_id) continue;
        const p = prodMap.get(item.product_id);
        if (p) {
          const nextStock = Math.max(0, Number(p.stock_quantity || 0) - Number(item.quantity));
          await admin
            .from('products')
            .update({ stock_quantity: nextStock, ...(nextStock === 0 ? { status: 'out_of_stock' } : {}) })
            .eq('id', item.product_id);
        }
      }
      void sendMetaCapiEvent({
        businessId,
        eventName: 'Purchase',
        eventId: `order_${order.id}_confirmed`,
        orderId: order.id,
        value: totalAmount,
        customerPhone: customer_phone,
      });
    }

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

    broadcastToBusiness(businessId, 'order:created', order);
    return res.status(201).json({ order });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create order.' });
  }
});

router.patch('/businesses/:businessId/orders/:orderId/status', requireAuth, requireBusinessAccess('orders'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const { order_status, payment_status, note, risk_notes } = req.body as {
      order_status?: string;
      payment_status?: string;
      note?: string;
      risk_notes?: string;
    };

    const { data: existing } = await admin
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', req.params.orderId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Order not found.' });

    const oldStatus = existing.order_status;
    const newStatus = order_status || oldStatus;

    // Safe inventory transition: deduct on pending -> confirmed, restore if cancelled/returned after being confirmed
    const deductedStates = new Set(['confirmed', 'processing', 'ready_to_ship', 'shipped', 'delivered']);
    const wasDeducted = deductedStates.has(oldStatus);
    const willBeDeducted = deductedStates.has(newStatus);

    if (!wasDeducted && willBeDeducted) {
      for (const item of existing.items || []) {
        if (!item.product_id) continue;
        const { data: prod } = await admin.from('products').select('stock_quantity').eq('id', item.product_id).maybeSingle();
        if (prod) {
          const nextStock = Math.max(0, Number(prod.stock_quantity) - Number(item.quantity));
          await admin
            .from('products')
            .update({ stock_quantity: nextStock, ...(nextStock === 0 ? { status: 'out_of_stock' } : {}) })
            .eq('id', item.product_id);
        }
      }
    } else if (wasDeducted && (newStatus === 'cancelled' || newStatus === 'returned')) {
      for (const item of existing.items || []) {
        if (!item.product_id) continue;
        const { data: prod } = await admin.from('products').select('stock_quantity, status').eq('id', item.product_id).maybeSingle();
        if (prod) {
          const nextStock = Number(prod.stock_quantity) + Number(item.quantity);
          await admin
            .from('products')
            .update({ stock_quantity: nextStock, ...(prod.status === 'out_of_stock' ? { status: 'active' } : {}) })
            .eq('id', item.product_id);
        }
      }
    }

    const { data: updated, error } = await admin
      .from('orders')
      .update({
        ...(order_status ? { order_status } : {}),
        ...(payment_status ? { payment_status } : {}),
        ...(risk_notes !== undefined ? { risk_notes } : {}),
      })
      .eq('id', req.params.orderId)
      .eq('business_id', businessId)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (order_status && order_status !== oldStatus) {
      await admin.from('order_status_history').insert({
        business_id: businessId,
        order_id: existing.id,
        old_status: oldStatus,
        new_status: order_status,
        note: note || '',
        changed_by: req.user!.id,
      });

      if (order_status === 'confirmed' || order_status === 'delivered') {
        void sendMetaCapiEvent({
          businessId,
          eventName: 'Purchase',
          eventId: `order_${existing.id}_${order_status}`,
          orderId: existing.id,
          value: Number(existing.total_amount),
          customerPhone: existing.customer_phone,
        });
      }
    }

    return res.json({ order: updated });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update order.' });
  }
});

// Staff Management
router.get('/businesses/:businessId/staff', requireAuth, requireBusinessAccess('settings'), requireFeature('staff_accounts'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: members }, { data: invitations }] = await Promise.all([
      admin
        .from('business_members')
        .select('*, profile:profiles(id, email, full_name, phone, status)')
        .eq('business_id', req.businessId!),
      admin
        .from('staff_invitations')
        .select('*')
        .eq('business_id', req.businessId!)
        .order('created_at', { ascending: false }),
    ]);
    return res.json({ members: members || [], invitations: invitations || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load staff.' });
  }
});

router.post('/businesses/:businessId/staff/invite', requireAuth, requireBusinessAccess('settings'), requireFeature('staff_accounts'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { email, role, permissions } = req.body as {
      email?: string;
      role?: string;
      permissions?: Record<string, boolean>;
    };
    if (!email) return res.status(400).json({ error: 'Staff email is required.' });

    // If user already exists in profiles, attach directly to business_members
    const { data: existingProfile } = await admin.from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
    if (existingProfile) {
      await admin.from('business_members').upsert(
        {
          business_id: req.businessId!,
          user_id: existingProfile.id,
          role: role || 'business_staff',
          permissions: permissions || { inbox: true, orders: true, products: true, customers: true, analytics: false, settings: false },
          status: 'active',
        },
        { onConflict: 'business_id,user_id' }
      );
      await createNotification({
        businessId: req.businessId!,
        userId: existingProfile.id,
        title: 'Added to Business Team',
        body: `You were added as ${role || 'business_staff'}.`,
      });
      return res.json({ addedDirectly: true });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const { data: inv, error } = await admin
      .from('staff_invitations')
      .insert({
        business_id: req.businessId!,
        email: email.trim().toLowerCase(),
        role: role || 'business_staff',
        permissions: permissions || { inbox: true, orders: true, products: true, customers: true, analytics: false, settings: false },
        token,
        invited_by: req.user!.id,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ invitation: inv });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Invite failed.' });
  }
});

router.patch('/businesses/:businessId/staff/:memberId', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { role, permissions, status } = req.body as Record<string, unknown>;
    const { data, error } = await admin
      .from('business_members')
      .update({
        ...(role !== undefined ? { role } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
        ...(status !== undefined ? { status } : {}),
      })
      .eq('id', req.params.memberId)
      .eq('business_id', req.businessId!)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ member: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed.' });
  }
});

export default router;
