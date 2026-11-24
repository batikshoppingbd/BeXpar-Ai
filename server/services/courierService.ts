import { decryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';

export interface CourierFraudStats {
  checked: boolean;
  provider?: 'steadfast';
  phone?: string;
  totalParcels: number;
  totalDelivered: number;
  totalCancelled: number;
  successRate: number | null;
  error?: string;
}

export function normalizeBdPhone(phone: string): string {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.startsWith('8801') && digits.length === 13) {
    return digits.slice(2);
  }
  if (digits.startsWith('01') && digits.length === 11) {
    return digits;
  }
  return digits;
}

function mapCourierStatusToOrderStatus(parcelStatus: string): string | null {
  const s = String(parcelStatus || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'delivered' || s === 'partial_delivered' || s === 'delivered_approval_pending') {
    return 'delivered';
  }
  if (s === 'cancelled' || s === 'cancelled_approval_pending') {
    return 'cancelled';
  }
  if (s === 'returned' || s === 'return' || s === 'pickup_cancelled') {
    return 'returned';
  }
  if (['in_review', 'pending', 'hold', 'in_transit', 'picked_up', 'assigned_for_delivery', 'unknown'].includes(s)) {
    return 'shipped';
  }
  return null;
}

export async function checkSteadfastFraudByPhone(businessId: string, phone: string): Promise<CourierFraudStats> {
  const normalized = normalizeBdPhone(phone);
  if (!normalized || normalized.length < 10) {
    return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: account } = await admin
      .from('courier_accounts')
      .select('api_key_encrypted, secret_key_encrypted, is_active')
      .eq('business_id', businessId)
      .eq('provider', 'steadfast')
      .eq('is_active', true)
      .maybeSingle();

    if (!account) {
      return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
    }

    const apiKey = decryptSecret(String(account.api_key_encrypted || ''));
    const secretKey = decryptSecret(String(account.secret_key_encrypted || ''));
    if (!apiKey || !secretKey) {
      return { checked: false, totalParcels: 0, totalDelivered: 0, totalCancelled: 0, successRate: null };
    }

    const res = await fetch(`https://portal.packzy.com/api/v1/fraud_check/${encodeURIComponent(normalized)}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4500),
    });

    const data = (await res.json().catch(() => ({}))) as {
      status?: number;
      total_parcels?: number | string;
      total_delivered?: number | string;
      total_cancelled?: number | string;
      message?: string;
    };

    if (!res.ok && data.total_parcels === undefined) {
      return {
        checked: false,
        provider: 'steadfast',
        phone: normalized,
        totalParcels: 0,
        totalDelivered: 0,
        totalCancelled: 0,
        successRate: null,
        error: data.message || `HTTP ${res.status}`,
      };
    }

    const totalParcels = Math.max(0, Number(data.total_parcels ?? 0));
    const totalDelivered = Math.max(0, Number(data.total_delivered ?? 0));
    const totalCancelled = Math.max(0, Number(data.total_cancelled ?? 0));
    const completed = totalDelivered + totalCancelled;
    const denom = completed > 0 ? completed : totalParcels;
    const successRate = denom > 0 ? Math.round((totalDelivered / denom) * 100) : null;

    return {
      checked: true,
      provider: 'steadfast',
      phone: normalized,
      totalParcels,
      totalDelivered,
      totalCancelled,
      successRate,
    };
  } catch (err) {
    return {
      checked: false,
      provider: 'steadfast',
      phone: normalized,
      totalParcels: 0,
      totalDelivered: 0,
      totalCancelled: 0,
      successRate: null,
      error: err instanceof Error ? err.message : 'Fraud check unavailable',
    };
  }
}

export async function bookCourierParcel(params: {
  businessId: string;
  orderId: string;
  orderNumber?: string;
  provider: 'steadfast' | 'pathao';
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
  cityId?: number;
  zoneId?: number;
  itemWeight?: number;
}): Promise<{ trackingId: string; consignmentId: string; status: string; shipment: unknown; raw: unknown }> {
  const admin = getSupabaseAdmin();

  const { data: account, error: accErr } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', params.businessId)
    .eq('provider', params.provider)
    .eq('is_active', true)
    .maybeSingle();

  if (accErr || !account) {
    throw new Error(`No active ${params.provider} courier account configured. Please configure credentials in Courier Settings.`);
  }

  let trackingId = '';
  let consignmentId = '';
  let parcelStatus = 'created';
  let rawResponse: Record<string, unknown> = {};

  if (params.provider === 'steadfast') {
    const apiKey = decryptSecret(account.api_key_encrypted || '');
    const secretKey = decryptSecret(account.secret_key_encrypted || '');
    if (!apiKey || !secretKey) {
      throw new Error('Steadfast API Key and Secret Key are required.');
    }

    const invoiceRef = (params.orderNumber || params.orderId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
    const res = await fetch('https://portal.packzy.com/api/v1/create_order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
      },
      body: JSON.stringify({
        invoice: invoiceRef,
        recipient_name: params.recipientName,
        recipient_phone: normalizeBdPhone(params.recipientPhone) || params.recipientPhone,
        recipient_address: params.recipientAddress,
        cod_amount: Math.round(params.codAmount),
        note: params.note || '',
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      errors?: Record<string, string[]>;
      consignment?: { consignment_id?: number | string; tracking_code?: string; status?: string };
    };

    if (!res.ok || data.status !== 200 || (!data.consignment?.tracking_code && !data.consignment?.consignment_id)) {
      const firstFieldErr = data.errors ? Object.values(data.errors).flat()[0] : undefined;
      throw new Error(firstFieldErr || data.message || `Steadfast booking failed (HTTP ${res.status}).`);
    }

    consignmentId = data.consignment.consignment_id !== undefined && data.consignment.consignment_id !== null
      ? String(data.consignment.consignment_id)
      : '';
    trackingId = String(data.consignment.tracking_code || consignmentId);
    parcelStatus = data.consignment.status || 'in_review';
    rawResponse = data as unknown as Record<string, unknown>;
  } else if (params.provider === 'pathao') {
    const clientId = account.client_id || '';
    const clientSecret = decryptSecret(account.client_secret_encrypted || '');
    const username = account.username || '';
    const password = decryptSecret(account.password_encrypted || '');
    const storeId = Number(account.store_id || 0);

    if (!clientId || !clientSecret || !username || !password || !storeId) {
      throw new Error('Pathao Client ID, Client Secret, Username, Password, and Store ID are required.');
    }

    const baseUrl = account.is_sandbox
      ? 'https://courier-api-sandbox.pathao.com'
      : 'https://api-hermes.pathao.com';

    const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: 'password',
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; message?: string };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.message || 'Pathao authentication failed.');
    }

    const orderRes = await fetch(`${baseUrl}/aladdin/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${tokenJson.access_token}`,
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
        special_instruction: params.note || '',
      }),
    });

    const orderJson = (await orderRes.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { consignment_id?: string; order_status?: string; delivery_fee?: number };
    };
    if (!orderRes.ok || !orderJson.data?.consignment_id) {
      throw new Error(orderJson.message || `Pathao booking failed (HTTP ${orderRes.status}).`);
    }

    trackingId = String(orderJson.data.consignment_id);
    consignmentId = String(orderJson.data.consignment_id);
    parcelStatus = orderJson.data.order_status || 'Pending';
    rawResponse = orderJson as unknown as Record<string, unknown>;
  }

  const { data: shipment, error: shipErr } = await admin
    .from('courier_shipments')
    .insert({
      business_id: params.businessId,
      order_id: params.orderId,
      courier_account_id: account.id,
      provider: params.provider,
      tracking_id: trackingId,
      consignment_id: consignmentId,
      parcel_status: parcelStatus,
      cod_amount: params.codAmount,
      raw_response: rawResponse,
    })
    .select('*')
    .single();

  if (shipErr) {
    throw new Error(`Booked on ${params.provider} (Parcel ID: ${consignmentId || trackingId}) but failed to save shipment: ${shipErr.message}`);
  }

  if (shipment) {
    await admin.from('courier_tracking_events').insert({
      business_id: params.businessId,
      shipment_id: shipment.id,
      status: parcelStatus,
      description: `Booked parcel via ${params.provider.toUpperCase()} (Parcel ID: ${consignmentId || trackingId})`,
      raw_payload: rawResponse,
    });
  }

  await admin
    .from('orders')
    .update({
      courier_name: params.provider,
      tracking_id: trackingId,
      order_status: 'shipped',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.orderId)
    .eq('business_id', params.businessId);

  return { trackingId, consignmentId, status: parcelStatus, shipment, raw: rawResponse };
}

export async function refreshCourierTracking(businessId: string, shipmentId: string) {
  const admin = getSupabaseAdmin();
  const { data: shipment } = await admin
    .from('courier_shipments')
    .select('*, account:courier_accounts(*)')
    .eq('id', shipmentId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!shipment || !shipment.account) {
    throw new Error('Shipment or courier account not found.');
  }

  const acc = shipment.account as Record<string, unknown>;
  let latestStatus = String(shipment.parcel_status || 'in_review');
  let rawPayload: Record<string, unknown> = {};
  let resolvedConsignmentId = String(shipment.consignment_id || '');

  if (shipment.provider === 'steadfast') {
    const apiKey = decryptSecret(String(acc.api_key_encrypted || ''));
    const secretKey = decryptSecret(String(acc.secret_key_encrypted || ''));

    // Prefer status_by_cid when consignment_id is stored, fallback to status_by_trackingcode
    const endpoint = resolvedConsignmentId
      ? `https://portal.packzy.com/api/v1/status_by_cid/${encodeURIComponent(resolvedConsignmentId)}`
      : `https://portal.packzy.com/api/v1/status_by_trackingcode/${encodeURIComponent(String(shipment.tracking_id))}`;

    const res = await fetch(endpoint, {
      headers: { 'Api-Key': apiKey, 'Secret-Key': secretKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: number;
      delivery_status?: string;
      consignment_id?: string | number;
    };
    if (res.ok && data.delivery_status) {
      latestStatus = data.delivery_status;
      if (!resolvedConsignmentId && data.consignment_id) {
        resolvedConsignmentId = String(data.consignment_id);
      }
      rawPayload = data as unknown as Record<string, unknown>;
    }
  } else if (shipment.provider === 'pathao') {
    const baseUrl = acc.is_sandbox ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com';
    const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: acc.client_id,
        client_secret: decryptSecret(String(acc.client_secret_encrypted || '')),
        username: acc.username,
        password: decryptSecret(String(acc.password_encrypted || '')),
        grant_type: 'password',
      }),
      signal: AbortSignal.timeout(5000),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (tokenJson.access_token) {
      const infoRes = await fetch(`${baseUrl}/aladdin/api/v1/orders/${shipment.consignment_id}/info`, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        signal: AbortSignal.timeout(5000),
      });
      const infoJson = (await infoRes.json().catch(() => ({}))) as { data?: { order_status?: string } };
      if (infoRes.ok && infoJson.data?.order_status) {
        latestStatus = infoJson.data.order_status;
        rawPayload = infoJson as unknown as Record<string, unknown>;
      }
    }
  }

  const nowIso = new Date().toISOString();
  await admin
    .from('courier_shipments')
    .update({
      parcel_status: latestStatus,
      ...(resolvedConsignmentId ? { consignment_id: resolvedConsignmentId } : {}),
      updated_at: nowIso,
    })
    .eq('id', shipmentId);

  if (latestStatus !== shipment.parcel_status) {
    await admin.from('courier_tracking_events').insert({
      business_id: businessId,
      shipment_id: shipmentId,
      status: latestStatus,
      description: `Synced status from ${shipment.provider}: ${latestStatus}`,
      raw_payload: rawPayload,
    });
  }

  // Auto-sync linked order status on terminal courier updates
  const mappedOrderStatus = mapCourierStatusToOrderStatus(latestStatus);
  if (mappedOrderStatus && shipment.order_id) {
    const { data: ord } = await admin
      .from('orders')
      .select('id, order_status')
      .eq('id', shipment.order_id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (ord && ord.order_status !== mappedOrderStatus) {
      await admin
        .from('orders')
        .update({ order_status: mappedOrderStatus, updated_at: nowIso })
        .eq('id', ord.id)
        .eq('business_id', businessId);

      await admin.from('order_status_history').insert({
        business_id: businessId,
        order_id: ord.id,
        old_status: ord.order_status,
        new_status: mappedOrderStatus,
        note: `Auto-detected from ${String(shipment.provider).toUpperCase()} (${latestStatus})`,
      });
    }
  }

  return {
    status: latestStatus,
    consignmentId: resolvedConsignmentId,
    mappedOrderStatus,
    raw: rawPayload,
  };
}

export async function syncActiveShipmentsForBusiness(businessId: string) {
  const admin = getSupabaseAdmin();
  const { data: shipments } = await admin
    .from('courier_shipments')
    .select('id, parcel_status')
    .eq('business_id', businessId)
    .not('parcel_status', 'in', '("delivered","cancelled","returned","partial_delivered")')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!shipments || shipments.length === 0) {
    return { synced: 0, results: [] as Array<{ shipmentId: string; status: string }> };
  }

  const settled = await Promise.allSettled(
    shipments.map(async (s) => {
      const r = await refreshCourierTracking(businessId, s.id);
      return { shipmentId: s.id, status: r.status };
    })
  );

  const results = settled
    .filter((r): r is PromiseFulfilledResult<{ shipmentId: string; status: string }> => r.status === 'fulfilled')
    .map((r) => r.value);

  return { synced: results.length, results };
}

export async function testCourierConnection(businessId: string, provider: 'steadfast' | 'pathao') {
  const admin = getSupabaseAdmin();
  const { data: account, error } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle();

  if (error || !account) {
    throw new Error(`No ${provider} credentials saved yet. Please save your credentials first.`);
  }

  if (provider === 'steadfast') {
    const apiKey = decryptSecret(String(account.api_key_encrypted || ''));
    const secretKey = decryptSecret(String(account.secret_key_encrypted || ''));
    if (!apiKey || !secretKey) {
      throw new Error('Steadfast Api-Key and Secret-Key are required.');
    }

    const res = await fetch('https://portal.packzy.com/api/v1/get_balance', {
      headers: { 'Api-Key': apiKey, 'Secret-Key': secretKey },
    });
    const text = await res.text();
    let json: { status?: number; current_balance?: number; message?: string } = {};
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new Error(`Unexpected Steadfast response (HTTP ${res.status}).`);
    }
    if (!res.ok || json.status !== 200) {
      throw new Error(json.message || `Steadfast verification failed (HTTP ${res.status}).`);
    }
    return {
      ok: true,
      provider: 'steadfast',
      message: `Connected! Current balance: ৳${Number(json.current_balance ?? 0)}`,
      balance: json.current_balance ?? 0,
    };
  }

  const clientId = String(account.client_id || '');
  const clientSecret = decryptSecret(String(account.client_secret_encrypted || ''));
  const username = String(account.username || '');
  const password = decryptSecret(String(account.password_encrypted || ''));
  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Pathao Client ID, Client Secret, Username, and Password are required.');
  }

  const baseUrl = account.is_sandbox ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com';
  const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
      grant_type: 'password',
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; message?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.message || `Pathao authentication failed (HTTP ${tokenRes.status}).`);
  }
  return {
    ok: true,
    provider: 'pathao',
    message: `Pathao ${account.is_sandbox ? 'Sandbox' : 'Live'} token verified successfully!`,
  };
}
