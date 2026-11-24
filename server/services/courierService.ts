import { decryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';

export async function bookCourierParcel(params: {
  businessId: string;
  orderId: string;
  provider: 'steadfast' | 'pathao';
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
  cityId?: number;
  zoneId?: number;
  itemWeight?: number;
}): Promise<{ trackingId: string; consignmentId: string; status: string; raw: unknown }> {
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

    const res = await fetch('https://portal.packzy.com/api/v1/create_order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
      },
      body: JSON.stringify({
        invoice: params.orderId.slice(0, 20),
        recipient_name: params.recipientName,
        recipient_phone: params.recipientPhone,
        recipient_address: params.recipientAddress,
        cod_amount: Math.round(params.codAmount),
        note: params.note || '',
      }),
    });

    const data = (await res.json()) as {
      status?: number;
      message?: string;
      consignment?: { consignment_id?: number | string; tracking_code?: string; status?: string };
    };

    if (!res.ok || data.status !== 200 || !data.consignment?.tracking_code) {
      throw new Error(data.message || `Steadfast booking failed (HTTP ${res.status}).`);
    }

    trackingId = String(data.consignment.tracking_code);
    consignmentId = String(data.consignment.consignment_id || '');
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
    const tokenJson = (await tokenRes.json()) as { access_token?: string; message?: string };
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
        merchant_order_id: params.orderId.slice(0, 30),
        recipient_name: params.recipientName,
        recipient_phone: params.recipientPhone,
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

    const orderJson = (await orderRes.json()) as {
      code?: number;
      message?: string;
      data?: { consignment_id?: string; order_status?: string; delivery_fee?: number };
    };
    if (!orderRes.ok || !orderJson.data?.consignment_id) {
      throw new Error(orderJson.message || `Pathao booking failed (HTTP ${orderRes.status}).`);
    }

    trackingId = orderJson.data.consignment_id;
    consignmentId = orderJson.data.consignment_id;
    parcelStatus = orderJson.data.order_status || 'Pending';
    rawResponse = orderJson as unknown as Record<string, unknown>;
  }

  const { data: shipment } = await admin
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

  if (shipment) {
    await admin.from('courier_tracking_events').insert({
      business_id: params.businessId,
      shipment_id: shipment.id,
      status: parcelStatus,
      description: `Booked parcel via ${params.provider.toUpperCase()}`,
      raw_payload: rawResponse,
    });
  }

  await admin
    .from('orders')
    .update({
      courier_name: params.provider,
      tracking_id: trackingId,
      order_status: 'shipped',
    })
    .eq('id', params.orderId)
    .eq('business_id', params.businessId);

  return { trackingId, consignmentId, status: parcelStatus, raw: rawResponse };
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
  let latestStatus = shipment.parcel_status;
  let rawPayload: Record<string, unknown> = {};

  if (shipment.provider === 'steadfast') {
    const apiKey = decryptSecret(String(acc.api_key_encrypted || ''));
    const secretKey = decryptSecret(String(acc.secret_key_encrypted || ''));
    const res = await fetch(`https://portal.packzy.com/api/v1/status_by_trackingcode/${shipment.tracking_id}`, {
      headers: { 'Api-Key': apiKey, 'Secret-Key': secretKey },
    });
    const data = (await res.json()) as { delivery_status?: string };
    if (res.ok && data.delivery_status) {
      latestStatus = data.delivery_status;
      rawPayload = data as unknown as Record<string, unknown>;
    }
  } else if (shipment.provider === 'pathao') {
    const baseUrl = acc.is_sandbox ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com';
    const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: acc.client_id,
        client_secret: decryptSecret(String(acc.client_secret_encrypted || '')),
        username: acc.username,
        password: decryptSecret(String(acc.password_encrypted || '')),
        grant_type: 'password',
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (tokenJson.access_token) {
      const infoRes = await fetch(`${baseUrl}/aladdin/api/v1/orders/${shipment.consignment_id}/info`, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const infoJson = (await infoRes.json()) as { data?: { order_status?: string } };
      if (infoRes.ok && infoJson.data?.order_status) {
        latestStatus = infoJson.data.order_status;
        rawPayload = infoJson as unknown as Record<string, unknown>;
      }
    }
  }

  await admin.from('courier_shipments').update({ parcel_status: latestStatus }).eq('id', shipmentId);
  await admin.from('courier_tracking_events').insert({
    business_id: businessId,
    shipment_id: shipmentId,
    status: latestStatus,
    description: `Synced status from ${shipment.provider}: ${latestStatus}`,
    raw_payload: rawPayload,
  });

  return { status: latestStatus, raw: rawPayload };
}
