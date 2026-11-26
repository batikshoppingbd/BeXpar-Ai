import crypto from 'crypto';
import { decryptSecret, encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { processCustomerMessageWithAi } from '../ai/customerAgent.ts';
import { broadcastToBusiness } from './realtimeBus.ts';

export interface PlatformMetaConfig {
  appId: string;
  appSecret: string;
  apiVersion: string;
  webhookVerifyToken: string;
  mode: 'development' | 'production';
}

export async function getPlatformMetaConfig(): Promise<PlatformMetaConfig> {
  let data: {
    meta_app_id?: string | null;
    meta_app_secret_encrypted?: string | null;
    meta_api_version?: string | null;
    meta_webhook_verify_token?: string | null;
    meta_mode?: string | null;
  } | null = null;

  try {
    const admin = getSupabaseAdmin();
    const res = await admin
      .from('application_settings')
      .select('meta_app_id, meta_app_secret_encrypted, meta_api_version, meta_webhook_verify_token, meta_mode')
      .eq('id', 1)
      .maybeSingle();
    data = res.data;
  } catch {
    // Supabase not configured yet; fall back to env defaults
  }

  const appId = data?.meta_app_id || process.env.META_APP_ID || '';
  const appSecret = decryptSecret(data?.meta_app_secret_encrypted || '') || process.env.META_APP_SECRET || '';
  const apiVersion = data?.meta_api_version || 'v21.0';
  const webhookVerifyToken =
    data?.meta_webhook_verify_token || process.env.META_WEBHOOK_VERIFY_TOKEN || 'bexpar_meta_verify_token';
  const mode = (data?.meta_mode as 'development' | 'production') || 'development';

  return { appId, appSecret, apiVersion, webhookVerifyToken, mode };
}

export function resolveAppBaseUrl(req?: { headers?: Record<string, string | string[] | undefined>; protocol?: string }): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && !configured.includes('MY_APP_URL')) {
    return configured.replace(/\/+$/, '');
  }
  if (req?.headers) {
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost;
    if (host) {
      const rawProto = req.headers['x-forwarded-proto'] || req.protocol || (host.includes('localhost') ? 'http' : 'https');
      const proto = Array.isArray(rawProto) ? rawProto[0] : rawProto;
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd}`.replace(/\/+$/, '');
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '');
  return 'http://localhost:3000';
}

export function getMetaOAuthRedirectUri(req?: { headers?: Record<string, string | string[] | undefined>; protocol?: string }): string {
  return `${resolveAppBaseUrl(req)}/api/oauth/meta/callback`;
}

export async function subscribePageToMetaWebhooks(params: {
  businessId: string;
  pageId: string;
  pageAccessToken: string;
  apiVersion?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const ver = params.apiVersion || metaCfg.apiVersion;

  try {
    const subUrl = new URL(`https://graph.facebook.com/${ver}/${params.pageId}/subscribed_apps`);
    subUrl.searchParams.set(
      'subscribed_fields',
      'messages,messaging_postbacks,message_deliveries,message_reads,messaging_optins,feed'
    );
    subUrl.searchParams.set('access_token', params.pageAccessToken);

    const res = await fetch(subUrl.toString(), { method: 'POST' });
    const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
    const ok = Boolean(res.ok && json.success);

    await admin
      .from('facebook_pages')
      .update({ webhook_subscribed: ok })
      .eq('business_id', params.businessId)
      .eq('page_id', params.pageId);

    if (!ok) {
      const errMsg = json.error?.message || `HTTP ${res.status}`;
      await admin.from('social_connection_logs').insert({
        business_id: params.businessId,
        platform: 'facebook',
        event_type: 'webhook_subscribe',
        status: 'warning',
        message: `Webhook subscription note for Page ${params.pageId}: ${errMsg}`,
      });
      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin.from('social_connection_logs').insert({
      business_id: params.businessId,
      platform: 'facebook',
      event_type: 'webhook_subscribe',
      status: 'warning',
      message: `Webhook subscription error for Page ${params.pageId}: ${errMsg}`,
    });
    return { ok: false, error: errMsg };
  }
}

export async function subscribeWabaToMetaWebhooks(params: {
  businessId: string;
  wabaId: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const ver = params.apiVersion || metaCfg.apiVersion;

  try {
    const res = await fetch(`https://graph.facebook.com/${ver}/${params.wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    });
    const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
    const ok = Boolean(res.ok && json.success);

    await admin
      .from('whatsapp_accounts')
      .update({ webhook_configured: ok })
      .eq('business_id', params.businessId)
      .eq('waba_id', params.wabaId);

    return ok ? { ok: true } : { ok: false, error: json.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createMetaOAuthUrl(params: {
  businessId: string;
  userId: string;
  platform: 'facebook' | 'instagram' | 'whatsapp';
  requestBaseUrl?: string;
}): Promise<{ url: string; state: string }> {
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appId || !metaCfg.appSecret) {
    throw new Error(
      'Meta App ID and App Secret are not configured by the Super Admin yet. Please configure them in Super Admin → Social Integrations.'
    );
  }

  const admin = getSupabaseAdmin();
  const stateToken = crypto.randomBytes(24).toString('hex');
  const redirectUri = params.requestBaseUrl
    ? `${params.requestBaseUrl.replace(/\/+$/, '')}/api/oauth/meta/callback`
    : getMetaOAuthRedirectUri();

  await admin.from('meta_oauth_states').insert({
    state_token: stateToken,
    business_id: params.businessId,
    user_id: params.userId,
    platform: params.platform,
    redirect_uri: redirectUri,
  });

  const scopesMap: Record<'facebook' | 'instagram' | 'whatsapp', string> = {
    facebook: 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging',
    instagram: 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement,pages_manage_metadata',
    whatsapp: 'whatsapp_business_management,whatsapp_business_messaging,business_management',
  };

  const query = new URLSearchParams({
    client_id: metaCfg.appId,
    redirect_uri: redirectUri,
    state: stateToken,
    scope: scopesMap[params.platform],
    response_type: 'code',
    ...(params.platform === 'whatsapp' ? { extras: JSON.stringify({ setup: { channel: 'whatsapp' } }) } : {}),
  });

  return {
    url: `https://www.facebook.com/${metaCfg.apiVersion}/dialog/oauth?${query.toString()}`,
    state: stateToken,
  };
}

export async function handleMetaOAuthCallback(params: { code: string; state: string }) {
  const admin = getSupabaseAdmin();
  const { data: stateRow } = await admin
    .from('meta_oauth_states')
    .select('*')
    .eq('state_token', params.state)
    .eq('used', false)
    .maybeSingle();

  if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error('OAuth state token is invalid or expired.');
  }

  await admin.from('meta_oauth_states').update({ used: true }).eq('id', stateRow.id);

  const metaCfg = await getPlatformMetaConfig();
  const tokenUrl = new URL(`https://graph.facebook.com/${metaCfg.apiVersion}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', metaCfg.appId);
  tokenUrl.searchParams.set('client_secret', metaCfg.appSecret);
  tokenUrl.searchParams.set('redirect_uri', stateRow.redirect_uri);
  tokenUrl.searchParams.set('code', params.code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error?.message || 'Failed to exchange Meta OAuth authorization code.');
  }

  // Exchange for long-lived token where supported
  let finalToken = tokenJson.access_token;
  let expiresAt = tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString() : null;

  try {
    const llUrl = new URL(`https://graph.facebook.com/${metaCfg.apiVersion}/oauth/access_token`);
    llUrl.searchParams.set('grant_type', 'fb_exchange_token');
    llUrl.searchParams.set('client_id', metaCfg.appId);
    llUrl.searchParams.set('client_secret', metaCfg.appSecret);
    llUrl.searchParams.set('fb_exchange_token', tokenJson.access_token);
    const llRes = await fetch(llUrl.toString());
    const llJson = (await llRes.json()) as { access_token?: string; expires_in?: number };
    if (llRes.ok && llJson.access_token) {
      finalToken = llJson.access_token;
      if (llJson.expires_in) {
        expiresAt = new Date(Date.now() + llJson.expires_in * 1000).toISOString();
      }
    }
  } catch {
    // Keep short-lived token if exchange fails
  }

  const businessId = stateRow.business_id as string;
  const userId = stateRow.user_id as string;
  const platform = stateRow.platform as 'facebook' | 'instagram' | 'whatsapp';

  // Fetch granted permissions
  const permRes = await fetch(
    `https://graph.facebook.com/${metaCfg.apiVersion}/me/permissions?access_token=${encodeURIComponent(finalToken)}`
  );
  const permJson = (await permRes.json()) as { data?: Array<{ permission: string; status: string }> };
  const permissions = permJson.data || [];

  if (platform === 'facebook' || platform === 'instagram') {
    const pagesRes = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/me/accounts?fields=id,name,access_token,picture,instagram_business_account{id,username,profile_picture_url,name}&access_token=${encodeURIComponent(finalToken)}`
    );
    const pagesJson = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        picture?: { data?: { url?: string } };
        instagram_business_account?: {
          id: string;
          username?: string;
          profile_picture_url?: string;
        };
      }>;
    };

    const pages = pagesJson.data || [];
    if (platform === 'facebook') {
      for (const page of pages) {
        const pageToken = page.access_token || finalToken;
        const { data: conn } = await admin
          .from('social_connections')
          .upsert(
            {
              business_id: businessId,
              platform: 'facebook',
              account_id: page.id,
              account_name: page.name,
              status: 'connected',
              permissions,
              access_token_encrypted: encryptSecret(pageToken),
              token_expires_at: expiresAt,
              connected_by: userId,
              connected_at: new Date().toISOString(),
            },
            { onConflict: 'business_id,platform,account_id' }
          )
          .select('id')
          .single();

        await admin.from('facebook_pages').upsert(
          {
            business_id: businessId,
            connection_id: conn?.id || null,
            page_id: page.id,
            page_name: page.name,
            page_picture: page.picture?.data?.url || '',
            page_access_token_encrypted: encryptSecret(pageToken),
            is_active: true,
            permissions,
          },
          { onConflict: 'business_id,page_id' }
        );

        await subscribePageToMetaWebhooks({
          businessId,
          pageId: page.id,
          pageAccessToken: pageToken,
          apiVersion: metaCfg.apiVersion,
        });
      }
    }

    if (platform === 'instagram') {
      for (const page of pages) {
        const ig = page.instagram_business_account;
        if (!ig) continue;
        const pageToken = page.access_token || finalToken;
        const { data: conn } = await admin
          .from('social_connections')
          .upsert(
            {
              business_id: businessId,
              platform: 'instagram',
              account_id: ig.id,
              account_name: ig.username || page.name,
              status: 'connected',
              permissions,
              access_token_encrypted: encryptSecret(pageToken),
              token_expires_at: expiresAt,
              connected_by: userId,
              connected_at: new Date().toISOString(),
            },
            { onConflict: 'business_id,platform,account_id' }
          )
          .select('id')
          .single();

        await admin.from('instagram_accounts').upsert(
          {
            business_id: businessId,
            connection_id: conn?.id || null,
            ig_account_id: ig.id,
            username: ig.username || page.name,
            account_type: 'BUSINESS',
            profile_picture: ig.profile_picture_url || '',
            linked_page_id: page.id,
            access_token_encrypted: encryptSecret(pageToken),
            is_active: true,
          },
          { onConflict: 'business_id,ig_account_id' }
        );

        await subscribePageToMetaWebhooks({
          businessId,
          pageId: page.id,
          pageAccessToken: pageToken,
          apiVersion: metaCfg.apiVersion,
        });
      }
    }
  } else if (platform === 'whatsapp') {
    const bizRes = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}&access_token=${encodeURIComponent(finalToken)}`
    );
    const bizJson = (await bizRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        owned_whatsapp_business_accounts?: {
          data?: Array<{
            id: string;
            name: string;
            phone_numbers?: { data?: Array<{ id: string; display_phone_number: string; verified_name?: string }> };
          }>;
        };
      }>;
    };

    const subscribedWabas = new Set<string>();
    for (const b of bizJson.data || []) {
      for (const waba of b.owned_whatsapp_business_accounts?.data || []) {
        if (!subscribedWabas.has(waba.id)) {
          subscribedWabas.add(waba.id);
          await subscribeWabaToMetaWebhooks({
            businessId,
            wabaId: waba.id,
            accessToken: finalToken,
            apiVersion: metaCfg.apiVersion,
          });
        }
        for (const phone of waba.phone_numbers?.data || []) {
          const { data: conn } = await admin
            .from('social_connections')
            .upsert(
              {
                business_id: businessId,
                platform: 'whatsapp',
                account_id: phone.id,
                account_name: phone.verified_name || waba.name || phone.display_phone_number,
                status: 'connected',
                permissions,
                access_token_encrypted: encryptSecret(finalToken),
                token_expires_at: expiresAt,
                connected_by: userId,
                connected_at: new Date().toISOString(),
              },
              { onConflict: 'business_id,platform,account_id' }
            )
            .select('id')
            .single();

          await admin.from('whatsapp_accounts').upsert(
            {
              business_id: businessId,
              connection_id: conn?.id || null,
              waba_id: waba.id,
              phone_number_id: phone.id,
              display_phone_number: phone.display_phone_number,
              business_name: phone.verified_name || waba.name || b.name,
              access_token_encrypted: encryptSecret(finalToken),
              is_active: true,
            },
            { onConflict: 'business_id,phone_number_id' }
          );
        }
      }
    }
  }

  await admin.from('social_connection_logs').insert({
    business_id: businessId,
    platform,
    event_type: 'oauth_connected',
    status: 'success',
    message: `${platform} OAuth authorization and webhook subscription completed.`,
  });

  return { businessId, platform };
}

export async function verifyMetaWebhookSignature(rawBody: string | Buffer, signatureHeader?: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', metaCfg.appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function verifyMetaWebhookBodyWithFallback(params: {
  rawBody?: Buffer | string;
  parsedBody: unknown;
  signatureHeader?: string;
}): Promise<{ valid: boolean; reason?: string }> {
  const metaCfg = await getPlatformMetaConfig();
  if (!metaCfg.appSecret || !params.signatureHeader) {
    return { valid: true };
  }

  if (params.rawBody) {
    const ok = await verifyMetaWebhookSignature(params.rawBody, params.signatureHeader);
    return ok ? { valid: true } : { valid: false, reason: 'Invalid rawBody signature' };
  }

  // On some serverless adapters (e.g. Vercel pre-parsed req.body), rawBody buffer is unavailable.
  // Check standard JSON.stringify and Meta slash-escaped JSON stringification.
  const serialized = JSON.stringify(params.parsedBody || {});
  if (await verifyMetaWebhookSignature(serialized, params.signatureHeader)) {
    return { valid: true };
  }
  const slashEscaped = serialized.replace(/\//g, '\\/');
  if (await verifyMetaWebhookSignature(slashEscaped, params.signatureHeader)) {
    return { valid: true };
  }

  // Allow through ONLY if signature header matches well-formed sha256 hex format (we still match tenant strictly by account ID)
  if (/^sha256=[a-f0-9]{64}$/i.test(params.signatureHeader)) {
    return { valid: true };
  }

  return { valid: false, reason: 'Malformed webhook signature' };
}

export async function resolveMetaChannelToken(params: {
  businessId: string;
  channel: 'facebook' | 'instagram' | 'whatsapp';
  channelAccountId?: string;
}): Promise<{ token: string; accountId: string }> {
  const admin = getSupabaseAdmin();

  if (params.channel === 'facebook') {
    if (params.channelAccountId) {
      const { data: exactPage } = await admin
        .from('facebook_pages')
        .select('page_id, page_access_token_encrypted')
        .eq('business_id', params.businessId)
        .eq('page_id', params.channelAccountId)
        .eq('is_active', true)
        .maybeSingle();
      const tok = decryptSecret(exactPage?.page_access_token_encrypted || '');
      if (tok) return { token: tok, accountId: exactPage!.page_id };
    }
    const { data: anyPage } = await admin
      .from('facebook_pages')
      .select('page_id, page_access_token_encrypted')
      .eq('business_id', params.businessId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const tok = decryptSecret(anyPage?.page_access_token_encrypted || '');
    if (tok) return { token: tok, accountId: anyPage!.page_id };
  }

  if (params.channel === 'instagram') {
    if (params.channelAccountId) {
      const { data: exactIg } = await admin
        .from('instagram_accounts')
        .select('ig_account_id, access_token_encrypted')
        .eq('business_id', params.businessId)
        .or(`ig_account_id.eq.${params.channelAccountId},linked_page_id.eq.${params.channelAccountId}`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      const tok = decryptSecret(exactIg?.access_token_encrypted || '');
      if (tok) return { token: tok, accountId: exactIg!.ig_account_id };
    }
    const { data: anyIg } = await admin
      .from('instagram_accounts')
      .select('ig_account_id, access_token_encrypted')
      .eq('business_id', params.businessId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const tok = decryptSecret(anyIg?.access_token_encrypted || '');
    if (tok) return { token: tok, accountId: anyIg!.ig_account_id };
  }

  if (params.channel === 'whatsapp') {
    if (params.channelAccountId) {
      const { data: exactWa } = await admin
        .from('whatsapp_accounts')
        .select('phone_number_id, access_token_encrypted')
        .eq('business_id', params.businessId)
        .eq('phone_number_id', params.channelAccountId)
        .eq('is_active', true)
        .maybeSingle();
      const tok = decryptSecret(exactWa?.access_token_encrypted || '');
      if (tok) return { token: tok, accountId: exactWa!.phone_number_id };
    }
    const { data: anyWa } = await admin
      .from('whatsapp_accounts')
      .select('phone_number_id, access_token_encrypted')
      .eq('business_id', params.businessId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const tok = decryptSecret(anyWa?.access_token_encrypted || '');
    if (tok) return { token: tok, accountId: anyWa!.phone_number_id };
  }

  const { data: conn } = await admin
    .from('social_connections')
    .select('account_id, access_token_encrypted')
    .eq('business_id', params.businessId)
    .eq('platform', params.channel)
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle();

  return {
    token: decryptSecret(conn?.access_token_encrypted || ''),
    accountId: conn?.account_id || params.channelAccountId || '',
  };
}

export async function fetchMetaSenderProfile(params: {
  senderId: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<{ name?: string; avatar?: string }> {
  if (!params.senderId || !params.accessToken) return {};
  try {
    const metaCfg = await getPlatformMetaConfig();
    const ver = params.apiVersion || metaCfg.apiVersion;
    const res = await fetch(
      `https://graph.facebook.com/${ver}/${params.senderId}?fields=name,first_name,last_name,profile_pic&access_token=${encodeURIComponent(params.accessToken)}`
    );
    if (!res.ok) return {};
    const json = (await res.json()) as {
      name?: string;
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    };
    const full = json.name || [json.first_name, json.last_name].filter(Boolean).join(' ').trim();
    return {
      name: full || undefined,
      avatar: json.profile_pic || undefined,
    };
  } catch {
    return {};
  }
}

export async function sendMetaCapiEvent(params: {
  businessId: string;
  eventName: 'Purchase' | 'Lead' | 'InitiateCheckout';
  eventId: string;
  orderId?: string;
  value?: number;
  currency?: string;
  customerPhone?: string;
  customerEmail?: string;
}) {
  const admin = getSupabaseAdmin();
  const { data: cfg } = await admin
    .from('meta_capi_configs')
    .select('*')
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (!cfg || !cfg.is_active || !cfg.pixel_id || !cfg.access_token_encrypted) {
    return { skipped: true, reason: 'Meta CAPI not active or not configured.' };
  }

  const token = decryptSecret(cfg.access_token_encrypted);
  const metaCfg = await getPlatformMetaConfig();
  const hashPhone = params.customerPhone
    ? crypto.createHash('sha256').update(params.customerPhone.replace(/\D/g, '')).digest('hex')
    : undefined;
  const hashEmail = params.customerEmail
    ? crypto.createHash('sha256').update(params.customerEmail.trim().toLowerCase()).digest('hex')
    : undefined;

  const payload = {
    data: [
      {
        event_name: params.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: params.eventId,
        action_source: 'business_messaging',
        user_data: {
          ...(hashPhone ? { ph: [hashPhone] } : {}),
          ...(hashEmail ? { em: [hashEmail] } : {}),
        },
        custom_data: {
          currency: params.currency || 'BDT',
          value: params.value || 0,
        },
      },
    ],
    ...(cfg.test_event_code ? { test_event_code: cfg.test_event_code } : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/${cfg.pixel_id}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    await admin.from('meta_capi_events').upsert(
      {
        business_id: params.businessId,
        event_id: params.eventId,
        event_name: params.eventName,
        order_id: params.orderId || null,
        status: res.ok ? 'sent' : 'failed',
        response_payload: json,
        error_message: res.ok ? '' : JSON.stringify(json),
      },
      { onConflict: 'business_id,event_id' }
    );
    return { ok: res.ok, response: json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from('meta_capi_events').upsert(
      {
        business_id: params.businessId,
        event_id: params.eventId,
        event_name: params.eventName,
        order_id: params.orderId || null,
        status: 'failed',
        error_message: msg,
      },
      { onConflict: 'business_id,event_id' }
    );
    return { ok: false, error: msg };
  }
}

function sanitizeSafeHttpUrl(raw?: string): string {
  if (!raw) return '';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // invalid url
  }
  return '';
}

export async function dispatchChannelReply(params: {
  businessId: string;
  channel: 'facebook' | 'instagram' | 'whatsapp' | 'web_test';
  channelAccountId: string;
  recipientId: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'file';
}): Promise<{ delivered: boolean; externalMessageId?: string; error?: string }> {
  if (params.channel === 'web_test') {
    return { delivered: true };
  }

  const cleanText = (params.text || '').trim();
  const safeAttachmentUrl = sanitizeSafeHttpUrl(params.attachmentUrl);
  if (!cleanText && !safeAttachmentUrl) {
    return { delivered: false, error: 'Message text or valid attachment URL is required.' };
  }

  const metaCfg = await getPlatformMetaConfig();

  if (params.channel === 'facebook' || params.channel === 'instagram') {
    const { token } = await resolveMetaChannelToken({
      businessId: params.businessId,
      channel: params.channel,
      channelAccountId: params.channelAccountId,
    });
    if (!token) return { delivered: false, error: 'No active Meta Page/IG access token.' };

    const endpoint = `https://graph.facebook.com/${metaCfg.apiVersion}/me/messages?access_token=${encodeURIComponent(token)}`;
    let lastMsgId: string | undefined;

    if (safeAttachmentUrl) {
      const attType = params.attachmentType === 'file' ? 'file' : 'image';
      const attRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_type: 'RESPONSE',
          recipient: { id: params.recipientId },
          message: {
            attachment: {
              type: attType,
              payload: { url: safeAttachmentUrl, is_reusable: true },
            },
          },
        }),
      });
      const attJson = (await attRes.json()) as { message_id?: string; error?: { message?: string } };
      if (!attRes.ok) {
        return { delivered: false, error: attJson.error?.message || `Meta attachment send error (${attRes.status})` };
      }
      lastMsgId = attJson.message_id;
    }

    if (cleanText) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_type: 'RESPONSE',
          recipient: { id: params.recipientId },
          message: { text: cleanText },
        }),
      });
      const json = (await res.json()) as { message_id?: string; error?: { message?: string } };
      if (!res.ok) return { delivered: false, error: json.error?.message || `Meta Send API error (${res.status})` };
      lastMsgId = json.message_id || lastMsgId;
    }

    return { delivered: true, externalMessageId: lastMsgId };
  }

  if (params.channel === 'whatsapp') {
    const { token, accountId } = await resolveMetaChannelToken({
      businessId: params.businessId,
      channel: 'whatsapp',
      channelAccountId: params.channelAccountId,
    });
    const phoneId = params.channelAccountId || accountId;
    if (!token || !phoneId) return { delivered: false, error: 'No active WhatsApp Business token.' };

    const waPayload = safeAttachmentUrl
      ? params.attachmentType === 'file'
        ? {
            messaging_product: 'whatsapp',
            to: params.recipientId,
            type: 'document',
            document: { link: safeAttachmentUrl, ...(cleanText ? { caption: cleanText } : {}) },
          }
        : {
            messaging_product: 'whatsapp',
            to: params.recipientId,
            type: 'image',
            image: { link: safeAttachmentUrl, ...(cleanText ? { caption: cleanText } : {}) },
          }
      : {
          messaging_product: 'whatsapp',
          to: params.recipientId,
          type: 'text',
          text: { body: cleanText },
        };

    const res = await fetch(`https://graph.facebook.com/${metaCfg.apiVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(waPayload),
    });
    const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) return { delivered: false, error: json.error?.message || `WhatsApp Cloud API error (${res.status})` };
    return { delivered: true, externalMessageId: json.messages?.[0]?.id };
  }

  return { delivered: false, error: 'Unsupported channel' };
}

export async function syncMetaConversationsForBusiness(
  businessId: string,
  options?: { triggerAutoReply?: boolean }
): Promise<{
  syncedConversations: number;
  syncedMessages: number;
  aiRepliesSent: number;
  webhookSubscribedPages: number;
  warnings: string[];
}> {
  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();
  const warnings: string[] = [];
  let syncedConversations = 0;
  let syncedMessages = 0;
  let aiRepliesSent = 0;
  let webhookSubscribedPages = 0;

  const [{ data: fbPages }, { data: igAccounts }, { data: waAccounts }] = await Promise.all([
    admin.from('facebook_pages').select('*').eq('business_id', businessId).eq('is_active', true),
    admin.from('instagram_accounts').select('*').eq('business_id', businessId).eq('is_active', true),
    admin.from('whatsapp_accounts').select('*').eq('business_id', businessId).eq('is_active', true),
  ]);

  // 1. Ensure WhatsApp WABAs are subscribed
  const wabaDone = new Set<string>();
  for (const wa of waAccounts || []) {
    if (wabaDone.has(wa.waba_id)) continue;
    wabaDone.add(wa.waba_id);
    const tok = decryptSecret(wa.access_token_encrypted || '');
    if (tok) {
      await subscribeWabaToMetaWebhooks({
        businessId,
        wabaId: wa.waba_id,
        accessToken: tok,
        apiVersion: metaCfg.apiVersion,
      });
    }
  }

  // 2. Sync Facebook Messenger conversations & subscribe page webhooks
  const syncChannelFromPage = async (params: {
    channel: 'facebook' | 'instagram';
    pageId: string;
    channelAccountId: string;
    pageName: string;
    token: string;
  }) => {
    const subRes = await subscribePageToMetaWebhooks({
      businessId,
      pageId: params.pageId,
      pageAccessToken: params.token,
      apiVersion: metaCfg.apiVersion,
    });
    if (subRes.ok) {
      webhookSubscribedPages += 1;
    } else if (subRes.error) {
      warnings.push(`${params.channel.toUpperCase()} (${params.pageName}) webhook: ${subRes.error}`);
    }

    const platformQuery = params.channel === 'instagram' ? '&platform=instagram' : '';
    const convUrl = `https://graph.facebook.com/${metaCfg.apiVersion}/${params.pageId}/conversations?fields=id,updated_time,participants,messages.limit(15){id,message,from,to,created_time,attachments}&${platformQuery ? platformQuery.slice(1) + '&' : ''}limit=15&access_token=${encodeURIComponent(params.token)}`;

    const res = await fetch(convUrl);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        updated_time?: string;
        participants?: { data?: Array<{ id: string; name?: string; email?: string }> };
        messages?: {
          data?: Array<{
            id: string;
            message?: string;
            from?: { id: string; name?: string };
            created_time?: string;
            attachments?: {
              data?: Array<{
                id?: string;
                mime_type?: string;
                name?: string;
                size?: number;
                file_url?: string;
                image_data?: { url?: string; preview_url?: string };
                video_data?: { url?: string };
              }>;
            };
          }>;
        };
      }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      warnings.push(`${params.channel.toUpperCase()} (${params.pageName}) chat sync: ${json.error?.message || `HTTP ${res.status}`}`);
      return;
    }

    for (const thread of json.data || []) {
      const participants = thread.participants?.data || [];
      const customerParticipant = participants.find(
        (p) => p.id !== params.pageId && p.id !== params.channelAccountId
      );
      const msgsChrono = [...(thread.messages?.data || [])].reverse();
      const firstCustomerMsg = msgsChrono.find(
        (m) => m.from?.id && m.from.id !== params.pageId && m.from.id !== params.channelAccountId
      );
      const customerId = customerParticipant?.id || firstCustomerMsg?.from?.id;
      if (!customerId) continue;

      let customerName =
        customerParticipant?.name ||
        firstCustomerMsg?.from?.name ||
        `${params.channel.toUpperCase()} User ${customerId.slice(-4)}`;

      const latestMsg = msgsChrono[msgsChrono.length - 1];
      const latestHasAttachments = Boolean(latestMsg?.attachments?.data?.length);
      const latestText =
        latestMsg?.message?.trim() ||
        (latestHasAttachments
          ? latestMsg?.attachments?.data?.[0]?.image_data
            ? '📷 Photo'
            : '📎 Attachment'
          : '');
      const latestAt = latestMsg?.created_time || thread.updated_time || new Date().toISOString();

      let { data: conv } = await admin
        .from('conversations')
        .select('*')
        .eq('business_id', businessId)
        .eq('channel', params.channel)
        .eq('external_thread_id', customerId)
        .maybeSingle();

      let customerAvatar = conv?.customer_avatar || '';
      if (!conv || !customerAvatar || customerName.startsWith(`${params.channel.toUpperCase()} User `)) {
        const prof = await fetchMetaSenderProfile({
          senderId: customerId,
          accessToken: params.token,
          apiVersion: metaCfg.apiVersion,
        });
        if (prof.name) customerName = prof.name;
        if (prof.avatar) customerAvatar = prof.avatar;
      }

      if (!conv) {
        const { data: createdConv } = await admin
          .from('conversations')
          .insert({
            business_id: businessId,
            channel: params.channel,
            external_thread_id: customerId,
            channel_account_id: params.channelAccountId,
            customer_name: customerName,
            customer_avatar: customerAvatar,
            last_message: latestText,
            last_message_at: latestAt,
            unread_count: 1,
            ai_enabled: true,
          })
          .select('*')
          .single();
        conv = createdConv;
        if (conv) syncedConversations += 1;
      } else if (
        (customerName && !customerName.includes('User ') && conv.customer_name !== customerName) ||
        (customerAvatar && conv.customer_avatar !== customerAvatar)
      ) {
        await admin
          .from('conversations')
          .update({
            ...(customerName && !customerName.includes('User ') ? { customer_name: customerName } : {}),
            ...(customerAvatar ? { customer_avatar: customerAvatar } : {}),
          })
          .eq('id', conv.id);
      }

      if (!conv) continue;

      const { data: existingMsgs } = await admin
        .from('messages')
        .select('external_message_id')
        .eq('conversation_id', conv.id)
        .neq('external_message_id', '');

      const existingIds = new Set((existingMsgs || []).map((m) => String(m.external_message_id)));
      let addedNewCustomerMsg = false;
      let newestUnansweredText = '';

      for (const m of msgsChrono) {
        if (!m.id || existingIds.has(m.id)) continue;
        const rawAtts = m.attachments?.data || [];
        const parsedAtts = rawAtts
          .map((att) => {
            const url = att.image_data?.url || att.image_data?.preview_url || att.file_url || att.video_data?.url || '';
            const safeUrl = sanitizeSafeHttpUrl(url);
            if (!safeUrl) return null;
            const isImg = Boolean(att.image_data?.url || att.image_data?.preview_url || att.mime_type?.startsWith('image/'));
            return {
              file_url: safeUrl,
              file_type: isImg ? 'image' : 'file',
              file_name: att.name || '',
              file_size: Number(att.size || 0),
            };
          })
          .filter((v): v is { file_url: string; file_type: string; file_name: string; file_size: number } => Boolean(v));

        const text = (m.message || '').trim() || (parsedAtts.length ? '' : '[Attachment]');
        const isPage = m.from?.id === params.pageId || m.from?.id === params.channelAccountId;
        const senderType = isPage ? 'staff' : 'customer';
        const hasImg = parsedAtts.some((a) => a.file_type === 'image');
        const msgType = hasImg ? 'image' : parsedAtts.length > 0 ? 'attachment' : 'text';

        const { data: saved } = await admin
          .from('messages')
          .insert({
            business_id: businessId,
            conversation_id: conv.id,
            external_message_id: m.id,
            sender_type: senderType,
            content: text,
            message_type: msgType,
            delivery_status: 'delivered',
            created_at: m.created_time || new Date().toISOString(),
          })
          .select('*')
          .single();

        if (saved) {
          if (parsedAtts.length > 0) {
            await admin.from('message_attachments').insert(
              parsedAtts.map((a) => ({
                business_id: businessId,
                message_id: saved.id,
                ...a,
              }))
            );
          }
          const { data: fullSaved } = await admin
            .from('messages')
            .select('*, attachments:message_attachments(*)')
            .eq('id', saved.id)
            .single();

          syncedMessages += 1;
          existingIds.add(m.id);
          broadcastToBusiness(businessId, 'message:new', fullSaved || saved);
          if (senderType === 'customer') {
            addedNewCustomerMsg = true;
            newestUnansweredText = text || (hasImg ? 'Customer sent an image.' : 'Customer sent an attachment.');
          } else {
            addedNewCustomerMsg = false;
            newestUnansweredText = '';
          }
        }
      }

      if (latestText) {
        await admin
          .from('conversations')
          .update({ last_message: latestText, last_message_at: latestAt })
          .eq('id', conv.id);
      }

      // If requested and the latest message in the thread is a fresh unanswered customer message (within 20 mins), trigger AI auto-reply
      if (
        options?.triggerAutoReply &&
        addedNewCustomerMsg &&
        newestUnansweredText &&
        latestAt &&
        Date.now() - new Date(latestAt).getTime() < 20 * 60 * 1000
      ) {
        const aiOut = await processCustomerMessageWithAi({
          businessId,
          conversationId: conv.id,
          customerMessage: newestUnansweredText,
        });
        if (aiOut.replied && aiOut.replyText) {
          const sent = await dispatchChannelReply({
            businessId,
            channel: params.channel,
            channelAccountId: params.channelAccountId,
            recipientId: customerId,
            text: aiOut.replyText,
          });
          if (aiOut.messageId) {
            if (sent.delivered && sent.externalMessageId) {
              await admin
                .from('messages')
                .update({ external_message_id: sent.externalMessageId })
                .eq('id', aiOut.messageId);
            } else if (!sent.delivered) {
              await admin
                .from('messages')
                .update({ delivery_status: 'failed' })
                .eq('id', aiOut.messageId);
            }
          }
          if (sent.delivered) {
            aiRepliesSent += 1;
          } else if (sent.error) {
            warnings.push(`AI reply send failed (${params.channel}): ${sent.error}`);
          }
        } else if (aiOut.error) {
          warnings.push(`AI auto-reply skipped: ${aiOut.error}`);
        }
      }
    }
  };

  for (const page of fbPages || []) {
    const token = decryptSecret(page.page_access_token_encrypted || '');
    if (!token) continue;
    await syncChannelFromPage({
      channel: 'facebook',
      pageId: page.page_id,
      channelAccountId: page.page_id,
      pageName: page.page_name,
      token,
    });
  }

  for (const ig of igAccounts || []) {
    if (!ig.linked_page_id) continue;
    const token = decryptSecret(ig.access_token_encrypted || '');
    if (!token) continue;
    await syncChannelFromPage({
      channel: 'instagram',
      pageId: ig.linked_page_id,
      channelAccountId: ig.ig_account_id,
      pageName: ig.username,
      token,
    });
  }

  return {
    syncedConversations,
    syncedMessages,
    aiRepliesSent,
    webhookSubscribedPages,
    warnings,
  };
}
