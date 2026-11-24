import crypto from 'crypto';
import { decryptSecret, encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';

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
    instagram: 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement',
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
              access_token_encrypted: encryptSecret(page.access_token || finalToken),
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
            page_access_token_encrypted: encryptSecret(page.access_token || finalToken),
            is_active: true,
            permissions,
          },
          { onConflict: 'business_id,page_id' }
        );
      }
    }

    if (platform === 'instagram') {
      for (const page of pages) {
        const ig = page.instagram_business_account;
        if (!ig) continue;
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
              access_token_encrypted: encryptSecret(page.access_token || finalToken),
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
            access_token_encrypted: encryptSecret(page.access_token || finalToken),
            is_active: true,
          },
          { onConflict: 'business_id,ig_account_id' }
        );
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

    for (const b of bizJson.data || []) {
      for (const waba of b.owned_whatsapp_business_accounts?.data || []) {
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
    message: `${platform} OAuth authorization completed successfully.`,
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

export async function dispatchChannelReply(params: {
  businessId: string;
  channel: 'facebook' | 'instagram' | 'whatsapp' | 'web_test';
  channelAccountId: string;
  recipientId: string;
  text: string;
}): Promise<{ delivered: boolean; externalMessageId?: string; error?: string }> {
  if (params.channel === 'web_test') {
    return { delivered: true };
  }

  const admin = getSupabaseAdmin();
  const metaCfg = await getPlatformMetaConfig();

  if (params.channel === 'facebook' || params.channel === 'instagram') {
    const { data: conn } = await admin
      .from('social_connections')
      .select('access_token_encrypted')
      .eq('business_id', params.businessId)
      .eq('platform', params.channel)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle();

    const token = decryptSecret(conn?.access_token_encrypted || '');
    if (!token) return { delivered: false, error: 'No active Meta Page/IG access token.' };

    const res = await fetch(
      `https://graph.facebook.com/${metaCfg.apiVersion}/me/messages?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: params.recipientId },
          message: { text: params.text },
        }),
      }
    );
    const json = (await res.json()) as { message_id?: string; error?: { message?: string } };
    if (!res.ok) return { delivered: false, error: json.error?.message || 'Meta Send API error' };
    return { delivered: true, externalMessageId: json.message_id };
  }

  if (params.channel === 'whatsapp') {
    const { data: wa } = await admin
      .from('whatsapp_accounts')
      .select('phone_number_id, access_token_encrypted')
      .eq('business_id', params.businessId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const token = decryptSecret(wa?.access_token_encrypted || '');
    const phoneId = params.channelAccountId || wa?.phone_number_id;
    if (!token || !phoneId) return { delivered: false, error: 'No active WhatsApp Business token.' };

    const res = await fetch(`https://graph.facebook.com/${metaCfg.apiVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.recipientId,
        type: 'text',
        text: { body: params.text },
      }),
    });
    const json = (await res.json()) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) return { delivered: false, error: json.error?.message || 'WhatsApp Cloud API error' };
    return { delivered: true, externalMessageId: json.messages?.[0]?.id };
  }

  return { delivered: false, error: 'Unsupported channel' };
}
