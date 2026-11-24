import crypto from 'crypto';
import { encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { createNotification, writeAuditLog } from '../db/repository.ts';

export class ManualPaymentError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface ManualPaymentAccount {
  id: string;
  number: string;
  account_type: string;
  label: string;
  instructions: string;
  is_active: boolean;
}

export const ALLOWED_GATEWAY_TYPES = new Set(['manual', 'bkash', 'nagad', 'rocket', 'sslcommerz', 'custom']);
export const GATEWAY_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,48}$/;
export const BKASH_MAX_NUMBERS = 9;
export const MULTI_MFS_MAX_NUMBERS = 50;

export function resolveEffectiveGatewayType(row: Record<string, unknown>): string {
  const cfg = (row.config_public && typeof row.config_public === 'object' ? row.config_public : {}) as Record<string, unknown>;
  const explicitMethod = typeof cfg.manual_method === 'string' ? cfg.manual_method.trim().toLowerCase() : '';
  const slug = String(row.slug || '').trim().toLowerCase();
  const rawType = String(row.gateway_type || 'manual').trim().toLowerCase();
  if (explicitMethod === 'rocket' || (slug === 'rocket' && rawType === 'manual')) {
    return 'rocket';
  }
  return rawType;
}

export function normalizePaymentNumber(raw: string): string {
  return String(raw || '').replace(/[\s()-]+/g, '').trim();
}

export function normalizeTransactionId(raw: string): string {
  return String(raw || '').trim().toUpperCase();
}

export function parseAccountsFromConfigPublic(configPublic: unknown): ManualPaymentAccount[] {
  if (!configPublic || typeof configPublic !== 'object' || Array.isArray(configPublic)) {
    return [];
  }
  const obj = configPublic as Record<string, unknown>;
  if (Array.isArray(obj.accounts)) {
    return obj.accounts
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `acc_${idx + 1}`,
        number: normalizePaymentNumber(String(item.number || '')),
        account_type: typeof item.account_type === 'string' && item.account_type.trim() ? item.account_type.trim().slice(0, 40) : 'Personal',
        label: typeof item.label === 'string' ? item.label.trim().slice(0, 80) : '',
        instructions: typeof item.instructions === 'string' ? item.instructions.trim().slice(0, 400) : '',
        is_active: item.is_active !== false,
      }))
      .filter((acc) => Boolean(acc.number));
  }

  const legacyNumber = typeof obj.account_number === 'string' ? normalizePaymentNumber(obj.account_number) : '';
  if (legacyNumber) {
    return [
      {
        id: 'primary',
        number: legacyNumber,
        account_type: typeof obj.account_type === 'string' && obj.account_type.trim() ? obj.account_type.trim().slice(0, 40) : 'Personal',
        label: typeof obj.display_note === 'string' ? obj.display_note.trim().slice(0, 80) : '',
        instructions: '',
        is_active: true,
      },
    ];
  }
  return [];
}

export function validateAndNormalizeAccounts(
  gatewayTypeOrSlug: string,
  rawAccounts: unknown[]
): ManualPaymentAccount[] {
  const normalizedType = gatewayTypeOrSlug.trim().toLowerCase();
  const isBkash = normalizedType === 'bkash';
  const maxAllowed = isBkash ? BKASH_MAX_NUMBERS : MULTI_MFS_MAX_NUMBERS;

  if (rawAccounts.length > maxAllowed) {
    throw new ManualPaymentError(
      400,
      isBkash
        ? `bKash supports a maximum of ${BKASH_MAX_NUMBERS} payment numbers.`
        : `Maximum ${MULTI_MFS_MAX_NUMBERS} numbers allowed per method.`
    );
  }

  const seenDigits = new Set<string>();
  const cleaned: ManualPaymentAccount[] = [];

  for (const item of rawAccounts) {
    if (!item || typeof item !== 'object') {
      throw new ManualPaymentError(400, 'Invalid payment number entry.');
    }
    const obj = item as Record<string, unknown>;
    const number = normalizePaymentNumber(String(obj.number || ''));
    const digits = number.replace(/[^\d]/g, '');
    if (!/^\+?[0-9]+$/.test(number) || digits.length < 10 || digits.length > 15) {
      throw new ManualPaymentError(400, `Invalid payment number "${String(obj.number || '')}". Enter a valid 10–15 digit number.`);
    }
    if (seenDigits.has(digits)) {
      throw new ManualPaymentError(400, `Duplicate payment number "${number}" in the same payment method.`);
    }
    seenDigits.add(digits);

    cleaned.push({
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim().slice(0, 64) : crypto.randomUUID().slice(0, 12),
      number,
      account_type:
        typeof obj.account_type === 'string' && obj.account_type.trim()
          ? obj.account_type.trim().slice(0, 40)
          : 'Personal',
      label: typeof obj.label === 'string' ? obj.label.trim().slice(0, 80) : '',
      instructions: typeof obj.instructions === 'string' ? obj.instructions.trim().slice(0, 400) : '',
      is_active: obj.is_active !== false,
    });
  }

  return cleaned;
}

export function sanitizeGatewayConfigPublic(
  raw: unknown,
  gatewayTypeOrSlug = 'manual'
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const safe: Record<string, unknown> = {};

  const allowedStringKeys = ['account_number', 'account_type', 'merchant_id', 'bank_name', 'routing_number', 'display_note', 'manual_method'];
  for (const key of allowedStringKeys) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
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
  } else if (typeof safe.account_number === 'string') {
    safe.accounts = [
      {
        id: 'primary',
        number: normalizePaymentNumber(safe.account_number),
        account_type: typeof safe.account_type === 'string' ? safe.account_type : 'Personal',
        label: '',
        instructions: '',
        is_active: true,
      },
    ];
  }

  return safe;
}

export function sanitizeGatewayCredentials(raw: unknown): Record<string, string> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? { api_token: trimmed } : null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const cleaned: Record<string, string> = {};
  const allowedCredKeys = ['merchant_id', 'api_key', 'api_secret', 'username', 'password', 'webhook_secret'];
  for (const key of allowedCredKeys) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
      cleaned[key] = obj[key].trim();
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function toSafeGatewayRow(row: Record<string, unknown>) {
  const { credentials_encrypted, ...rest } = row;
  const effectiveType = resolveEffectiveGatewayType(row);
  const accounts = parseAccountsFromConfigPublic(row.config_public);
  return {
    ...rest,
    gateway_type: effectiveType,
    accounts,
    active_accounts: accounts.filter((a) => a.is_active),
    max_numbers: effectiveType === 'bkash' ? BKASH_MAX_NUMBERS : MULTI_MFS_MAX_NUMBERS,
    has_credentials: Boolean(typeof credentials_encrypted === 'string' && credentials_encrypted.trim().length > 0),
  };
}

export async function listActiveCatalogGateways() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('payment_gateways')
    .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, instructions, updated_at')
    .eq('is_active', true)
    .order('slug');

  if (error) throw new ManualPaymentError(500, error.message);

  return (data || []).map((row) => {
    const record = row as Record<string, unknown>;
    const effectiveType = resolveEffectiveGatewayType(record);
    const allAccounts = parseAccountsFromConfigPublic(record.config_public);
    const activeAccounts = allAccounts.filter((a) => a.is_active);
    return {
      ...record,
      gateway_type: effectiveType,
      config_public: {
        ...(record.config_public && typeof record.config_public === 'object' ? (record.config_public as Record<string, unknown>) : {}),
        accounts: activeAccounts,
      },
      active_accounts: activeAccounts,
    };
  });
}

export async function upsertManualGatewayAccounts(
  slugOrMethod: 'bkash' | 'nagad' | 'rocket',
  params: {
    accounts?: unknown[];
    is_active?: boolean;
    instructions?: string;
    name?: string;
  },
  actor: { id: string; email: string; role: string; ip?: string }
) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('payment_gateways')
    .select('*')
    .eq('slug', slugOrMethod)
    .maybeSingle();

  const existingCfg =
    existing?.config_public && typeof existing.config_public === 'object'
      ? (existing.config_public as Record<string, unknown>)
      : {};

  const nextConfigPublic = sanitizeGatewayConfigPublic(
    {
      ...existingCfg,
      manual_method: slugOrMethod,
      ...(params.accounts !== undefined ? { accounts: params.accounts } : {}),
    },
    slugOrMethod
  );

  const defaults: Record<'bkash' | 'nagad' | 'rocket', { name: string; instructions: string }> = {
    bkash: {
      name: 'bKash',
      instructions: 'Open bKash app -> Send Money to any active number below -> Copy TrxID and submit here.',
    },
    nagad: {
      name: 'Nagad',
      instructions: 'Open Nagad app -> Send Money to any active number below -> Copy TrxID and submit here.',
    },
    rocket: {
      name: 'Rocket',
      instructions: 'Open Rocket app -> Send Money to any active number below -> Copy TrxID and submit here.',
    },
  };

  const nowIso = new Date().toISOString();
  if (!existing) {
    const insertPayload = {
      slug: slugOrMethod,
      name: params.name?.trim() || defaults[slugOrMethod].name,
      gateway_type: slugOrMethod,
      is_active: params.is_active !== undefined ? params.is_active : true,
      is_sandbox: false,
      config_public: nextConfigPublic,
      credentials_encrypted: '',
      instructions:
        typeof params.instructions === 'string'
          ? params.instructions.trim().slice(0, 1000)
          : defaults[slugOrMethod].instructions,
      updated_at: nowIso,
    };

    let created = await admin
      .from('payment_gateways')
      .insert(insertPayload)
      .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
      .single();

    if (created.error && created.error.message.toLowerCase().includes('gateway_type')) {
      created = await admin
        .from('payment_gateways')
        .insert({ ...insertPayload, gateway_type: 'manual' })
        .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
        .single();
    }
    if (created.error) throw new ManualPaymentError(400, created.error.message);

    await writeAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'manual_payment_method_created',
      targetType: 'payment_gateway',
      targetId: slugOrMethod,
      details: { count: parseAccountsFromConfigPublic(nextConfigPublic).length, is_active: insertPayload.is_active },
      ipAddress: actor.ip,
    });
    return toSafeGatewayRow(created.data as Record<string, unknown>);
  }

  const updatePayload: Record<string, unknown> = {
    config_public: nextConfigPublic,
    is_sandbox: false,
    updated_at: nowIso,
  };
  if (typeof params.is_active === 'boolean') updatePayload.is_active = params.is_active;
  if (typeof params.instructions === 'string') updatePayload.instructions = params.instructions.trim().slice(0, 1000);
  if (typeof params.name === 'string' && params.name.trim()) updatePayload.name = params.name.trim().slice(0, 100);

  const { data: updated, error } = await admin
    .from('payment_gateways')
    .update(updatePayload)
    .eq('slug', slugOrMethod)
    .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, credentials_encrypted, instructions, updated_at')
    .single();

  if (error) throw new ManualPaymentError(400, error.message);

  await writeAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'manual_payment_method_updated',
    targetType: 'payment_gateway',
    targetId: slugOrMethod,
    details: {
      count: parseAccountsFromConfigPublic(nextConfigPublic).length,
      is_active: updated.is_active,
    },
    ipAddress: actor.ip,
  });

  return toSafeGatewayRow(updated as Record<string, unknown>);
}

export async function submitManualPayment(params: {
  businessId: string;
  userId: string;
  userEmail: string;
  userRole: string;
  gateway_slug: string;
  payment_for: 'coin_package' | 'subscription';
  reference_id: string;
  transaction_id: string;
  sender_number: string;
  paid_to_number?: string;
  proof_url?: string;
  ipAddress?: string;
}) {
  const admin = getSupabaseAdmin();
  const slug = String(params.gateway_slug || '').trim().toLowerCase();
  const trxId = normalizeTransactionId(params.transaction_id || '');
  const senderNumber = normalizePaymentNumber(params.sender_number || '');
  let paidToNumber = normalizePaymentNumber(params.paid_to_number || '');

  if (!slug || !params.payment_for || !params.reference_id || !trxId) {
    throw new ManualPaymentError(400, 'Payment method, package/plan, and Transaction ID are required.');
  }
  if (!['coin_package', 'subscription'].includes(params.payment_for)) {
    throw new ManualPaymentError(400, 'Invalid payment target type.');
  }
  if (trxId.length < 5 || trxId.length > 80 || !/^[A-Z0-9_-]+$/.test(trxId)) {
    throw new ManualPaymentError(400, 'Please enter a valid Transaction ID (5–80 alphanumeric characters).');
  }
  const senderDigits = senderNumber.replace(/[^\d]/g, '');
  if (!senderNumber || senderDigits.length < 8 || senderDigits.length > 15) {
    throw new ManualPaymentError(400, 'Please enter a valid sender mobile/account number.');
  }

  // Verify active payment method
  const { data: gateway } = await admin
    .from('payment_gateways')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!gateway || !gateway.is_active) {
    throw new ManualPaymentError(400, 'Selected payment method is unavailable or inactive.');
  }

  const accounts = parseAccountsFromConfigPublic(gateway.config_public);
  const activeAccounts = accounts.filter((a) => a.is_active);
  if (accounts.length > 0 && activeAccounts.length === 0) {
    throw new ManualPaymentError(400, 'No active receiving payment numbers are currently configured for this method.');
  }
  if (activeAccounts.length > 0) {
    if (!paidToNumber) {
      paidToNumber = activeAccounts[0].number;
    } else {
      const matched = activeAccounts.find((a) => a.number.replace(/[^\d]/g, '') === paidToNumber.replace(/[^\d]/g, ''));
      if (!matched) {
        throw new ManualPaymentError(400, 'Selected receiving payment number is invalid or inactive.');
      }
      paidToNumber = matched.number;
    }
  }

  // Prevent duplicate Transaction ID reuse (case-insensitive across all submissions)
  const { data: existingTrx } = await admin
    .from('payments')
    .select('id, status')
    .ilike('transaction_id', trxId)
    .limit(1);

  if (existingTrx && existingTrx.length > 0) {
    throw new ManualPaymentError(409, 'This Transaction ID has already been used. Duplicate Transaction IDs are not allowed.');
  }

  // Authoritative server-side amount & target lookup
  let amount = 0;
  let currency = 'BDT';
  let targetTitle = '';
  if (params.payment_for === 'coin_package') {
    const { data: pkg } = await admin
      .from('coin_packages')
      .select('id, name, price, currency, status')
      .eq('id', params.reference_id)
      .maybeSingle();
    if (!pkg || pkg.status !== 'active') {
      throw new ManualPaymentError(404, 'Selected coin package is unavailable.');
    }
    amount = Number(pkg.price);
    currency = pkg.currency || 'BDT';
    targetTitle = String(pkg.name || 'Coin Package');
  } else {
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('id, name, monthly_price, currency, is_active')
      .eq('id', params.reference_id)
      .maybeSingle();
    if (!plan || !plan.is_active) {
      throw new ManualPaymentError(404, 'Selected subscription plan is unavailable.');
    }
    amount = Number(plan.monthly_price);
    currency = plan.currency || 'BDT';
    targetTitle = `${String(plan.name || 'Subscription')} Plan`;
  }

  if (amount <= 0) {
    throw new ManualPaymentError(400, 'Manual payment is only applicable for paid packages or plans.');
  }

  const effectiveType = resolveEffectiveGatewayType(gateway as Record<string, unknown>);
  const { data: payment, error } = await admin
    .from('payments')
    .insert({
      business_id: params.businessId,
      user_id: params.userId,
      gateway_slug: slug,
      payment_for: params.payment_for,
      reference_id: params.reference_id,
      amount,
      currency,
      transaction_id: trxId,
      sender_number: senderNumber,
      proof_url: params.proof_url || '',
      status: 'pending',
      gateway_response: {
        gateway_name: gateway.name,
        gateway_type: effectiveType,
        paid_to_number: paidToNumber,
        target_title: targetTitle,
      },
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
      throw new ManualPaymentError(409, 'This Transaction ID has already been used. Duplicate Transaction IDs are not allowed.');
    }
    throw new ManualPaymentError(400, error.message);
  }

  // Notify Super Admins about the new pending payment verification request
  const { data: superAdmins } = await admin.from('profiles').select('id').eq('role', 'super_admin').eq('status', 'active');
  for (const sa of superAdmins || []) {
    await createNotification({
      businessId: params.businessId,
      userId: sa.id,
      title: `New Manual Payment: ${gateway.name} (${amount} ${currency})`,
      body: `TrxID ${trxId} submitted for ${targetTitle}. Verify in Admin Payment Queue.`,
      type: 'info',
      link: 'payments',
    });
  }

  await writeAuditLog({
    actorId: params.userId,
    actorEmail: params.userEmail,
    actorRole: params.userRole,
    businessId: params.businessId,
    action: 'manual_payment_submitted',
    targetType: 'payment',
    targetId: payment.id,
    details: { gateway_slug: slug, transaction_id: trxId, paid_to_number: paidToNumber, amount, payment_for: params.payment_for },
    ipAddress: params.ipAddress,
  });

  return payment;
}

export async function reviewManualPayment(params: {
  paymentId: string;
  decision: 'approved' | 'rejected';
  adminNotes?: string;
  adminUser: { id: string; email: string; role: string; ip?: string };
}) {
  const admin = getSupabaseAdmin();
  const cleanNotes = String(params.adminNotes || '').trim().slice(0, 500);

  if (params.decision !== 'approved' && params.decision !== 'rejected') {
    throw new ManualPaymentError(400, 'Decision must be either approved or rejected.');
  }
  if (params.decision === 'rejected' && cleanNotes.length < 3) {
    throw new ManualPaymentError(400, 'Please enter a rejection reason for the customer.');
  }

  const nowIso = new Date().toISOString();

  // Atomically claim ONLY if current status is 'pending' so concurrent/double approval is impossible
  const { data: claimed, error: claimErr } = await admin
    .from('payments')
    .update({
      status: params.decision,
      admin_notes: cleanNotes,
      reviewed_by: params.adminUser.id,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', params.paymentId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (claimErr) {
    throw new ManualPaymentError(400, claimErr.message);
  }

  if (!claimed) {
    const { data: existing } = await admin.from('payments').select('id, status').eq('id', params.paymentId).maybeSingle();
    if (!existing) {
      throw new ManualPaymentError(404, 'Payment request not found.');
    }
    throw new ManualPaymentError(
      409,
      `Payment is already ${existing.status}. A payment request can only be reviewed once.`
    );
  }

  let fulfillmentNote = '';
  if (params.decision === 'approved') {
    try {
      if (claimed.payment_for === 'coin_package' && claimed.reference_id) {
        const { data: pkg, error: pkgErr } = await admin
          .from('coin_packages')
          .select('*')
          .eq('id', claimed.reference_id)
          .maybeSingle();
        if (pkgErr || !pkg) {
          throw new Error('Referenced coin package not found.');
        }
        const totalCoins = Number(pkg.coin_amount) + Number(pkg.bonus_coins || 0);
        const { error: creditErr } = await admin.rpc('credit_ai_coins_atomic', {
          p_business_id: claimed.business_id,
          p_amount: totalCoins,
          p_type: 'purchase',
          p_description: `Manual Payment Approved (${claimed.transaction_id}): ${pkg.name} (${totalCoins} coins)`,
          p_reference_id: claimed.id,
          p_user_id: params.adminUser.id,
        });
        if (creditErr) throw new Error(creditErr.message);

        await admin.from('package_purchases').insert({
          business_id: claimed.business_id,
          user_id: claimed.user_id,
          package_id: pkg.id,
          coins_granted: totalCoins,
          amount: claimed.amount,
          currency: claimed.currency,
          payment_id: claimed.id,
          status: 'completed',
        });
        fulfillmentNote = `${totalCoins.toLocaleString()} AI Coins added to your wallet for ${pkg.name}.`;
      } else if (claimed.payment_for === 'subscription' && claimed.reference_id) {
        const { data: plan, error: planErr } = await admin
          .from('subscription_plans')
          .select('*')
          .eq('id', claimed.reference_id)
          .maybeSingle();
        if (planErr || !plan) {
          throw new Error('Referenced subscription plan not found.');
        }
        const durationDays = Number(plan.duration_days || 30);
        const expiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

        const { error: bizErr } = await admin
          .from('businesses')
          .update({
            subscription_plan_id: plan.id,
            subscription_status: 'active',
            subscription_expires_at: expiresAt,
            updated_at: nowIso,
          })
          .eq('id', claimed.business_id);
        if (bizErr) throw new Error(bizErr.message);

        await admin.from('subscriptions').insert({
          business_id: claimed.business_id,
          plan_id: plan.id,
          billing_cycle: durationDays >= 360 ? 'yearly' : 'monthly',
          status: 'active',
          starts_at: nowIso,
          expires_at: expiresAt,
          amount_paid: claimed.amount,
          payment_id: claimed.id,
        });

        if (Number(plan.coin_allocation || 0) > 0) {
          const { error: creditErr } = await admin.rpc('credit_ai_coins_atomic', {
            p_business_id: claimed.business_id,
            p_amount: Number(plan.coin_allocation),
            p_type: 'subscription_grant',
            p_description: `${plan.name} subscription activated (TrxID: ${claimed.transaction_id})`,
            p_reference_id: claimed.id,
            p_user_id: params.adminUser.id,
          });
          if (creditErr) throw new Error(creditErr.message);
        }
        fulfillmentNote = `${plan.name} subscription activated${Number(plan.coin_allocation || 0) > 0 ? ` with ${Number(plan.coin_allocation).toLocaleString()} AI Coins` : ''}.`;
      }
    } catch (fulfillErr) {
      // Roll back claimed status to pending if credit/activation failed
      await admin
        .from('payments')
        .update({
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', claimed.id);
      throw new ManualPaymentError(
        500,
        `Payment fulfillment failed and was rolled back safely: ${fulfillErr instanceof Error ? fulfillErr.message : String(fulfillErr)}`
      );
    }
  }

  // Send Notification to submitting user & business owner (if distinct)
  const gwMeta =
    claimed.gateway_response && typeof claimed.gateway_response === 'object'
      ? (claimed.gateway_response as Record<string, unknown>)
      : {};
  const targetTitle = String(gwMeta.target_title || claimed.payment_for.replace('_', ' '));
  const notifTitle =
    params.decision === 'approved'
      ? `Payment Approved: ${targetTitle}`
      : `Payment Rejected: ${targetTitle}`;
  const notifBody =
    params.decision === 'approved'
      ? `TrxID ${claimed.transaction_id} (${claimed.amount} ${claimed.currency}) verified. ${fulfillmentNote}`.trim()
      : `TrxID ${claimed.transaction_id} (${claimed.amount} ${claimed.currency}) was rejected. Reason: ${cleanNotes}`;

  const recipientIds = new Set<string>();
  if (claimed.user_id) recipientIds.add(String(claimed.user_id));

  const { data: biz } = await admin.from('businesses').select('owner_id').eq('id', claimed.business_id).maybeSingle();
  if (biz?.owner_id) recipientIds.add(String(biz.owner_id));

  for (const uid of recipientIds) {
    await createNotification({
      businessId: claimed.business_id,
      userId: uid,
      title: notifTitle,
      body: notifBody,
      type: params.decision === 'approved' ? 'success' : 'error',
      link: 'wallet',
    });
  }

  await writeAuditLog({
    actorId: params.adminUser.id,
    actorEmail: params.adminUser.email,
    actorRole: params.adminUser.role,
    businessId: claimed.business_id,
    action: `payment_${params.decision}`,
    targetType: 'payment',
    targetId: claimed.id,
    details: {
      amount: claimed.amount,
      payment_for: claimed.payment_for,
      transaction_id: claimed.transaction_id,
      admin_notes: cleanNotes,
    },
    ipAddress: params.adminUser.ip,
  });

  return claimed;
}

export function buildEncryptedCredentials(raw: unknown): string {
  const parsed = sanitizeGatewayCredentials(raw);
  return parsed ? encryptSecret(JSON.stringify(parsed)) : '';
}
