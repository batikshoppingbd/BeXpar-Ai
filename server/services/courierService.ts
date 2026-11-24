import { decryptSecret, encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';

export type CourierProvider = 'steadfast' | 'pathao';

export interface SafeCourierAccount {
  id: string;
  provider: CourierProvider;
  label: string;
  client_id: string;
  username: string;
  store_id: string;
  is_sandbox: boolean;
  is_active: boolean;
  is_default: boolean;
  updated_at: string;
  has_api_key: boolean;
  has_secret_key: boolean;
  has_client_secret: boolean;
  has_password: boolean;
}

export interface RevealedCourierCredentials {
  provider: CourierProvider;
  api_key?: string;
  secret_key?: string;
  client_id?: string;
  client_secret?: string;
  username?: string;
  password?: string;
  store_id?: string;
  is_sandbox?: boolean;
  is_active: boolean;
  is_default: boolean;
  updated_at: string;
}

function isMissingIsDefaultColumn(err: { message?: string; code?: string } | null | undefined): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('is_default') && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('column'));
}

async function getFallbackDefaultCourier(businessId: string): Promise<CourierProvider | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('ai_settings')
      .select('order_collection_rules')
      .eq('business_id', businessId)
      .maybeSingle();
    const rules = (data?.order_collection_rules && typeof data.order_collection_rules === 'object'
      ? data.order_collection_rules
      : {}) as Record<string, unknown>;
    const val = String(rules.default_courier || '');
    return val === 'steadfast' || val === 'pathao' ? val : null;
  } catch {
    return null;
  }
}

async function setFallbackDefaultCourier(businessId: string, provider: CourierProvider | null): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('ai_settings')
      .select('order_collection_rules')
      .eq('business_id', businessId)
      .maybeSingle();
    if (!data) return;
    const rules = (data.order_collection_rules && typeof data.order_collection_rules === 'object'
      ? data.order_collection_rules
      : {}) as Record<string, unknown>;
    await admin
      .from('ai_settings')
      .update({
        order_collection_rules: {
          ...rules,
          default_courier: provider || '',
        },
        updated_at: new Date().toISOString(),
      })
      .eq('business_id', businessId);
  } catch {
    // Non-fatal fallback
  }
}

function toSafeCourierAccount(row: Record<string, unknown>, fallbackDefault?: CourierProvider | null): SafeCourierAccount {
  const provider = String(row.provider) as CourierProvider;
  const isDefault = row.is_default !== undefined ? Boolean(row.is_default) : fallbackDefault === provider;
  return {
    id: String(row.id),
    provider,
    label: String(row.label || provider.toUpperCase()),
    client_id: String(row.client_id || ''),
    username: String(row.username || ''),
    store_id: String(row.store_id || ''),
    is_sandbox: Boolean(row.is_sandbox),
    is_active: Boolean(row.is_active),
    is_default: isDefault,
    updated_at: String(row.updated_at || ''),
    has_api_key: Boolean(row.api_key_encrypted),
    has_secret_key: Boolean(row.secret_key_encrypted),
    has_client_secret: Boolean(row.client_secret_encrypted),
    has_password: Boolean(row.password_encrypted),
  };
}

export async function getBusinessCourierOverview(businessId: string): Promise<{
  accounts: SafeCourierAccount[];
  defaultProvider: CourierProvider | null;
  shipments: Array<Record<string, unknown>>;
}> {
  const admin = getSupabaseAdmin();

  let accountsData: Array<Record<string, unknown>> = [];
  let usingFallbackDefault = false;
  const accRes = await admin
    .from('courier_accounts')
    .select('id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, is_default, updated_at')
    .eq('business_id', businessId);

  if (accRes.error && isMissingIsDefaultColumn(accRes.error)) {
    usingFallbackDefault = true;
    const legacyRes = await admin
      .from('courier_accounts')
      .select('id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, updated_at')
      .eq('business_id', businessId);
    if (legacyRes.error) throw new Error(legacyRes.error.message);
    accountsData = (legacyRes.data || []) as Array<Record<string, unknown>>;
  } else if (accRes.error) {
    throw new Error(accRes.error.message);
  } else {
    accountsData = (accRes.data || []) as Array<Record<string, unknown>>;
  }

  const { data: shipments, error: shipErr } = await admin
    .from('courier_shipments')
    .select('*, events:courier_tracking_events(*)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (shipErr) throw new Error(shipErr.message);

  const fallbackDefault = usingFallbackDefault ? await getFallbackDefaultCourier(businessId) : null;
  const safeAccounts = accountsData.map((row) => toSafeCourierAccount(row, fallbackDefault));

  const explicitDefault = safeAccounts.find((a) => a.is_default && a.is_active)?.provider
    || safeAccounts.find((a) => a.is_default)?.provider
    || safeAccounts.find((a) => a.is_active)?.provider
    || null;

  return {
    accounts: safeAccounts,
    defaultProvider: explicitDefault,
    shipments: (shipments || []) as Array<Record<string, unknown>>,
  };
}

export async function saveBusinessCourierAccount(
  businessId: string,
  input: Record<string, unknown>
): Promise<{ account: SafeCourierAccount; defaultProvider: CourierProvider | null }> {
  const admin = getSupabaseAdmin();
  const prov = String(input.provider || '').trim() as CourierProvider;
  if (prov !== 'steadfast' && prov !== 'pathao') {
    throw new Error('Valid courier provider (steadfast or pathao) is required.');
  }

  const { data: existing } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', prov)
    .maybeSingle();

  const { data: allExisting } = await admin
    .from('courier_accounts')
    .select('id, provider, is_active')
    .eq('business_id', businessId);

  if (prov === 'steadfast') {
    const hasKey = Boolean(String(input.api_key || '').trim() || existing?.api_key_encrypted);
    const hasSec = Boolean(String(input.secret_key || '').trim() || existing?.secret_key_encrypted);
    if (!hasKey || !hasSec) {
      throw new Error('Steadfast API Key and Secret Key are required.');
    }
  } else {
    const cid = input.client_id !== undefined ? String(input.client_id || '').trim() : String(existing?.client_id || '');
    const csec = Boolean(String(input.client_secret || '').trim() || existing?.client_secret_encrypted);
    const user = input.username !== undefined ? String(input.username || '').trim() : String(existing?.username || '');
    const pass = Boolean(String(input.password || '').trim() || existing?.password_encrypted);
    const store = input.store_id !== undefined ? String(input.store_id || '').trim() : String(existing?.store_id || '');
    if (!cid || !csec || !user || !pass || !store) {
      throw new Error('Pathao Client ID, Client Secret, Username, Password, and Store ID are required.');
    }
  }

  const nextActive = input.is_active !== undefined ? Boolean(input.is_active) : existing ? Boolean(existing.is_active) : true;
  const shouldBeDefault =
    input.is_default === true ||
    (!existing && (allExisting || []).length === 0 && nextActive);

  const nowIso = new Date().toISOString();
  const basePayload: Record<string, unknown> = {
    business_id: businessId,
    provider: prov,
    label: input.label ? String(input.label).trim() : prov === 'steadfast' ? 'Steadfast Courier' : 'Pathao Courier',
    is_sandbox: input.is_sandbox !== undefined ? Boolean(input.is_sandbox) : Boolean(existing?.is_sandbox),
    is_active: nextActive,
    updated_at: nowIso,
  };

  if (typeof input.api_key === 'string' && input.api_key.trim()) {
    basePayload.api_key_encrypted = encryptSecret(input.api_key.trim());
  } else if (existing?.api_key_encrypted) {
    basePayload.api_key_encrypted = existing.api_key_encrypted;
  }

  if (typeof input.secret_key === 'string' && input.secret_key.trim()) {
    basePayload.secret_key_encrypted = encryptSecret(input.secret_key.trim());
  } else if (existing?.secret_key_encrypted) {
    basePayload.secret_key_encrypted = existing.secret_key_encrypted;
  }

  if (input.client_id !== undefined) basePayload.client_id = String(input.client_id || '').trim();
  else if (existing?.client_id) basePayload.client_id = existing.client_id;

  if (typeof input.client_secret === 'string' && input.client_secret.trim()) {
    basePayload.client_secret_encrypted = encryptSecret(input.client_secret.trim());
  } else if (existing?.client_secret_encrypted) {
    basePayload.client_secret_encrypted = existing.client_secret_encrypted;
  }

  if (input.username !== undefined) basePayload.username = String(input.username || '').trim();
  else if (existing?.username) basePayload.username = existing.username;

  if (typeof input.password === 'string' && input.password.trim()) {
    basePayload.password_encrypted = encryptSecret(input.password.trim());
  } else if (existing?.password_encrypted) {
    basePayload.password_encrypted = existing.password_encrypted;
  }

  if (input.store_id !== undefined) basePayload.store_id = String(input.store_id || '').trim();
  else if (existing?.store_id) basePayload.store_id = existing.store_id;

  if (shouldBeDefault) {
    await admin
      .from('courier_accounts')
      .update({ is_default: false, updated_at: nowIso })
      .eq('business_id', businessId)
      .neq('provider', prov);
  }

  const payloadWithDefault = {
    ...basePayload,
    ...(input.is_default !== undefined || shouldBeDefault ? { is_default: shouldBeDefault } : {}),
  };

  let savedRow: Record<string, unknown> | null = null;
  const upsertRes = await admin
    .from('courier_accounts')
    .upsert(payloadWithDefault, { onConflict: 'business_id,provider' })
    .select('*')
    .single();

  if (upsertRes.error && isMissingIsDefaultColumn(upsertRes.error)) {
    const legacyUpsert = await admin
      .from('courier_accounts')
      .upsert(basePayload, { onConflict: 'business_id,provider' })
      .select('*')
      .single();
    if (legacyUpsert.error) throw new Error(legacyUpsert.error.message);
    savedRow = legacyUpsert.data as Record<string, unknown>;
    if (shouldBeDefault) await setFallbackDefaultCourier(businessId, prov);
  } else if (upsertRes.error) {
    throw new Error(upsertRes.error.message);
  } else {
    savedRow = upsertRes.data as Record<string, unknown>;
    if (shouldBeDefault) await setFallbackDefaultCourier(businessId, prov);
  }

  const overview = await getBusinessCourierOverview(businessId);
  const safe = overview.accounts.find((a) => a.provider === prov) || toSafeCourierAccount(savedRow);
  return { account: safe, defaultProvider: overview.defaultProvider };
}

export async function revealBusinessCourierCredentials(
  businessId: string,
  provider: CourierProvider
): Promise<RevealedCourierCredentials> {
  const admin = getSupabaseAdmin();
  const { data: account, error } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle();

  if (error || !account) {
    throw new Error(`No saved ${provider} credentials found.`);
  }

  const fallbackDefault = account.is_default === undefined ? await getFallbackDefaultCourier(businessId) : null;
  const isDefault = account.is_default !== undefined ? Boolean(account.is_default) : fallbackDefault === provider;

  if (provider === 'steadfast') {
    return {
      provider: 'steadfast',
      api_key: decryptSecret(String(account.api_key_encrypted || '')),
      secret_key: decryptSecret(String(account.secret_key_encrypted || '')),
      is_active: Boolean(account.is_active),
      is_default: isDefault,
      updated_at: String(account.updated_at || ''),
    };
  }

  return {
    provider: 'pathao',
    client_id: String(account.client_id || ''),
    client_secret: decryptSecret(String(account.client_secret_encrypted || '')),
    username: String(account.username || ''),
    password: decryptSecret(String(account.password_encrypted || '')),
    store_id: String(account.store_id || ''),
    is_sandbox: Boolean(account.is_sandbox),
    is_active: Boolean(account.is_active),
    is_default: isDefault,
    updated_at: String(account.updated_at || ''),
  };
}

export async function updateBusinessCourierState(
  businessId: string,
  provider: CourierProvider,
  patch: { is_active?: boolean; is_default?: boolean }
): Promise<{ account: SafeCourierAccount; defaultProvider: CourierProvider | null }> {
  const admin = getSupabaseAdmin();
  const { data: existing, error } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle();

  if (error || !existing) {
    throw new Error(`No ${provider} courier configuration found. Save API credentials first.`);
  }

  const nowIso = new Date().toISOString();
  const nextActive = patch.is_active !== undefined ? Boolean(patch.is_active) : Boolean(existing.is_active);
  if (patch.is_default === true && !nextActive) {
    throw new Error('Activate this courier before setting it as Default Courier.');
  }

  const updatePayload: Record<string, unknown> = { updated_at: nowIso };
  if (patch.is_active !== undefined) updatePayload.is_active = nextActive;
  if (patch.is_default === true) {
    await admin
      .from('courier_accounts')
      .update({ is_default: false, updated_at: nowIso })
      .eq('business_id', businessId)
      .neq('provider', provider);
    updatePayload.is_default = true;
  } else if (patch.is_default === false || (patch.is_active === false && existing.is_default)) {
    updatePayload.is_default = false;
  }

  const updRes = await admin
    .from('courier_accounts')
    .update(updatePayload)
    .eq('id', existing.id)
    .eq('business_id', businessId)
    .select('*')
    .single();

  if (updRes.error && isMissingIsDefaultColumn(updRes.error)) {
    const legacyPatch: Record<string, unknown> = { updated_at: nowIso };
    if (patch.is_active !== undefined) legacyPatch.is_active = nextActive;
    const legacyUpd = await admin
      .from('courier_accounts')
      .update(legacyPatch)
      .eq('id', existing.id)
      .eq('business_id', businessId);
    if (legacyUpd.error) throw new Error(legacyUpd.error.message);
  } else if (updRes.error) {
    throw new Error(updRes.error.message);
  }

  if (patch.is_default === true) {
    await setFallbackDefaultCourier(businessId, provider);
  } else if (patch.is_default === false || (patch.is_active === false)) {
    const currentFallback = await getFallbackDefaultCourier(businessId);
    if (currentFallback === provider) {
      await setFallbackDefaultCourier(businessId, null);
    }
  }

  const overview = await getBusinessCourierOverview(businessId);
  const safe = overview.accounts.find((a) => a.provider === provider);
  if (!safe) throw new Error('Courier account not found after update.');
  return { account: safe, defaultProvider: overview.defaultProvider };
}

export async function disconnectBusinessCourier(
  businessId: string,
  provider: CourierProvider
): Promise<{ disconnected: CourierProvider; defaultProvider: CourierProvider | null }> {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('courier_accounts')
    .select('id')
    .eq('business_id', businessId)
    .eq('provider', provider)
    .maybeSingle();

  if (!existing) {
    throw new Error(`${provider} courier is not connected.`);
  }

  const { error } = await admin
    .from('courier_accounts')
    .delete()
    .eq('id', existing.id)
    .eq('business_id', businessId);

  if (error) throw new Error(error.message);

  const fallback = await getFallbackDefaultCourier(businessId);
  if (fallback === provider) {
    await setFallbackDefaultCourier(businessId, null);
  }

  const overview = await getBusinessCourierOverview(businessId);
  if (!overview.accounts.some((a) => a.is_default) && overview.accounts.some((a) => a.is_active)) {
    const promote = overview.accounts.find((a) => a.is_active)!;
    await updateBusinessCourierState(businessId, promote.provider, { is_default: true }).catch(() => {});
  }

  const updated = await getBusinessCourierOverview(businessId);
  return { disconnected: provider, defaultProvider: updated.defaultProvider };
}

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
  provider?: 'steadfast' | 'pathao';
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  codAmount: number;
  note?: string;
  cityId?: number;
  zoneId?: number;
  itemWeight?: number;
}): Promise<{ trackingId: string; consignmentId: string; status: string; provider: 'steadfast' | 'pathao'; shipment: unknown; raw: unknown }> {
  const admin = getSupabaseAdmin();

  let targetProvider = params.provider;
  if (!targetProvider) {
    const overview = await getBusinessCourierOverview(params.businessId);
    targetProvider = overview.defaultProvider || undefined;
  }
  if (!targetProvider) {
    throw new Error('No active courier account configured. Please connect Steadfast or Pathao in Courier Settings.');
  }

  const { data: account, error: accErr } = await admin
    .from('courier_accounts')
    .select('*')
    .eq('business_id', params.businessId)
    .eq('provider', targetProvider)
    .maybeSingle();

  if (accErr || !account) {
    throw new Error(`No ${targetProvider} courier account configured. Please configure credentials in Courier Settings.`);
  }
  if (!account.is_active) {
    throw new Error(`${targetProvider.toUpperCase()} courier is currently inactive. Activate it in Courier Settings or choose another courier.`);
  }

  let trackingId = '';
  let consignmentId = '';
  let parcelStatus = 'created';
  let rawResponse: Record<string, unknown> = {};

  if (targetProvider === 'steadfast') {
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
  } else if (targetProvider === 'pathao') {
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
      provider: targetProvider,
      tracking_id: trackingId,
      consignment_id: consignmentId,
      parcel_status: parcelStatus,
      cod_amount: params.codAmount,
      raw_response: rawResponse,
    })
    .select('*')
    .single();

  if (shipErr) {
    throw new Error(`Booked on ${targetProvider} (Parcel ID: ${consignmentId || trackingId}) but failed to save shipment: ${shipErr.message}`);
  }

  if (shipment) {
    await admin.from('courier_tracking_events').insert({
      business_id: params.businessId,
      shipment_id: shipment.id,
      status: parcelStatus,
      description: `Booked parcel via ${targetProvider.toUpperCase()} (Parcel ID: ${consignmentId || trackingId})`,
      raw_payload: rawResponse,
    });
  }

  await admin
    .from('orders')
    .update({
      courier_name: targetProvider,
      tracking_id: trackingId,
      order_status: 'shipped',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.orderId)
    .eq('business_id', params.businessId);

  return { trackingId, consignmentId, status: parcelStatus, provider: targetProvider, shipment, raw: rawResponse };
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
