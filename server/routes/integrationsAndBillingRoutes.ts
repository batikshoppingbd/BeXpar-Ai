import { Router } from 'express';
import { encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { processCustomerMessageWithAi } from '../ai/customerAgent.ts';
import { requireAuth, requireBusinessAccess, requireFeature, type AuthedRequest } from '../middleware/auth.ts';
import { bookCourierParcel, refreshCourierTracking, testCourierConnection } from '../services/courierService.ts';
import {
  createMetaOAuthUrl,
  dispatchChannelReply,
  getPlatformMetaConfig,
  handleMetaOAuthCallback,
  resolveAppBaseUrl,
  sendMetaCapiEvent,
  verifyMetaWebhookSignature,
} from '../services/metaService.ts';
import { broadcastToBusiness } from '../services/realtimeBus.ts';

const router = Router();

// Public Catalogs (Plans, Packages, Payment Gateways)
router.get('/catalog/plans', requireAuth, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from('subscription_plans').select('*').eq('is_active', true).order('display_order');
    return res.json({ plans: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load plans.' });
  }
});

router.get('/catalog/packages', requireAuth, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin.from('coin_packages').select('*').eq('status', 'active').order('display_order');
    return res.json({ packages: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load packages.' });
  }
});

router.get('/catalog/gateways', requireAuth, async (_req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('payment_gateways')
      .select('id, slug, name, gateway_type, is_active, is_sandbox, config_public, instructions')
      .eq('is_active', true);
    return res.json({ gateways: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load gateways.' });
  }
});

// Social Media Integrations
router.get('/businesses/:businessId/social', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const metaCfg = await getPlatformMetaConfig();

    const [{ data: connections }, { data: fbPages }, { data: igAccounts }, { data: waAccounts }, { data: logs }] =
      await Promise.all([
        admin
          .from('social_connections')
          .select('id, business_id, platform, account_id, account_name, status, permissions, token_expires_at, metadata, connected_at, updated_at')
          .eq('business_id', businessId),
        admin
          .from('facebook_pages')
          .select('id, page_id, page_name, page_picture, is_active, permissions, webhook_subscribed, connected_at')
          .eq('business_id', businessId),
        admin
          .from('instagram_accounts')
          .select('id, ig_account_id, username, account_type, profile_picture, linked_page_id, is_active, connected_at')
          .eq('business_id', businessId),
        admin
          .from('whatsapp_accounts')
          .select('id, waba_id, phone_number_id, display_phone_number, business_name, webhook_configured, is_active, connected_at')
          .eq('business_id', businessId),
        admin
          .from('social_connection_logs')
          .select('*')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

    return res.json({
      metaConfigured: Boolean(metaCfg.appId && metaCfg.appSecret),
      metaMode: metaCfg.mode,
      metaApiVersion: metaCfg.apiVersion,
      connections: connections || [],
      facebookPages: fbPages || [],
      instagramAccounts: igAccounts || [],
      whatsappAccounts: waAccounts || [],
      logs: logs || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load social connections.' });
  }
});

router.get('/businesses/:businessId/social/oauth/:platform/url', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const platform = req.params.platform as 'facebook' | 'instagram' | 'whatsapp';
    if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) {
      return res.status(400).json({ error: 'Unsupported platform.' });
    }
    const result = await createMetaOAuthUrl({
      businessId: req.businessId!,
      userId: req.user!.id,
      platform,
      requestBaseUrl: resolveAppBaseUrl(req),
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate OAuth URL.' });
  }
});

router.post('/businesses/:businessId/social/:connectionId/disconnect', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: conn } = await admin
      .from('social_connections')
      .select('id, platform, account_id')
      .eq('id', req.params.connectionId)
      .eq('business_id', req.businessId!)
      .maybeSingle();

    if (!conn) return res.status(404).json({ error: 'Connection not found.' });

    await admin
      .from('social_connections')
      .update({ status: 'disconnected', access_token_encrypted: '' })
      .eq('id', conn.id);

    if (conn.platform === 'facebook') {
      await admin.from('facebook_pages').update({ is_active: false }).eq('connection_id', conn.id);
    } else if (conn.platform === 'instagram') {
      await admin.from('instagram_accounts').update({ is_active: false }).eq('connection_id', conn.id);
    } else if (conn.platform === 'whatsapp') {
      await admin.from('whatsapp_accounts').update({ is_active: false }).eq('connection_id', conn.id);
    }

    await admin.from('social_connection_logs').insert({
      business_id: req.businessId!,
      platform: conn.platform,
      event_type: 'disconnected',
      status: 'info',
      message: `Disconnected ${conn.platform} account ${conn.account_id}`,
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Disconnect failed.' });
  }
});

// Meta OAuth Popup Callback (handles both with and without trailing slash)
router.get(['/oauth/meta/callback', '/oauth/meta/callback/'], async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
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
    const msg = err instanceof Error ? err.message : 'OAuth callback error';
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

// Meta Webhooks Verification & Ingestion (Facebook Messenger, Instagram DM, WhatsApp Cloud API)
router.get('/webhooks/meta', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const metaCfg = await getPlatformMetaConfig();
    if (mode === 'subscribe' && token === metaCfg.webhookVerifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  } catch (err) {
    return res.status(500).send(err instanceof Error ? err.message : 'Webhook verify error');
  }
});

router.post('/webhooks/meta', async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody || JSON.stringify(req.body);
    const sigValid = await verifyMetaWebhookSignature(rawBody, signature);
    const metaCfg = await getPlatformMetaConfig();

    if (metaCfg.appSecret && signature && !sigValid) {
      return res.status(401).json({ error: 'Invalid Meta webhook signature.' });
    }

    const payload = req.body as {
      object?: string;
      entry?: Array<{
        id?: string;
        messaging?: Array<{
          sender?: { id?: string };
          recipient?: { id?: string };
          timestamp?: number;
          message?: { mid?: string; text?: string };
        }>;
        changes?: Array<{
          field?: string;
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
            messages?: Array<{ id?: string; from?: string; type?: string; text?: { body?: string } }>;
          };
        }>;
      }>;
    };

    const admin = getSupabaseAdmin();

    for (const entry of payload.entry || []) {
      // Messenger or Instagram Messaging
      if (entry.messaging) {
        const channel = payload.object === 'instagram' ? 'instagram' : 'facebook';
        for (const msgEvent of entry.messaging) {
          const text = msgEvent.message?.text;
          const mid = msgEvent.message?.mid;
          const senderId = msgEvent.sender?.id;
          const recipientId = msgEvent.recipient?.id;
          if (!text || !mid || !senderId || !recipientId) continue;

          // Event Deduplication
          const { error: dupErr } = await admin.from('social_webhook_events').insert({
            platform: channel,
            event_id: `${channel}_${mid}`,
            payload: msgEvent,
          });
          if (dupErr) continue;

          const { data: conn } = await admin
            .from('social_connections')
            .select('business_id')
            .eq('platform', channel)
            .eq('account_id', recipientId)
            .eq('status', 'connected')
            .maybeSingle();

          if (!conn) continue;

          let { data: conv } = await admin
            .from('conversations')
            .select('*')
            .eq('business_id', conn.business_id)
            .eq('channel', channel)
            .eq('external_thread_id', senderId)
            .maybeSingle();

          if (!conv) {
            const { data: createdConv } = await admin
              .from('conversations')
              .insert({
                business_id: conn.business_id,
                channel,
                external_thread_id: senderId,
                channel_account_id: recipientId,
                customer_name: `${channel.toUpperCase()} User ${senderId.slice(-4)}`,
                last_message: text,
                last_message_at: new Date().toISOString(),
                unread_count: 1,
                ai_enabled: true,
              })
              .select('*')
              .single();
            conv = createdConv;
          } else {
            await admin
              .from('conversations')
              .update({
                last_message: text,
                last_message_at: new Date().toISOString(),
                unread_count: (conv.unread_count || 0) + 1,
              })
              .eq('id', conv.id);
          }

          if (conv) {
            const { data: savedMsg } = await admin
              .from('messages')
              .insert({
                business_id: conn.business_id,
                conversation_id: conv.id,
                external_message_id: mid,
                sender_type: 'customer',
                content: text,
                message_type: 'text',
              })
              .select('*')
              .single();

            if (savedMsg) broadcastToBusiness(conn.business_id, 'message:new', savedMsg);

            const aiOut = await processCustomerMessageWithAi({
              businessId: conn.business_id,
              conversationId: conv.id,
              customerMessage: text,
            });
            if (aiOut.replied && aiOut.replyText) {
              await dispatchChannelReply({
                businessId: conn.business_id,
                channel,
                channelAccountId: recipientId,
                recipientId: senderId,
                text: aiOut.replyText,
              });
            }
          }
        }
      }

      // WhatsApp Cloud API Changes
      if (entry.changes) {
        for (const change of entry.changes) {
          const val = change.value;
          const phoneId = val?.metadata?.phone_number_id;
          if (!phoneId || !val?.messages) continue;

          const { data: waAcc } = await admin
            .from('whatsapp_accounts')
            .select('business_id')
            .eq('phone_number_id', phoneId)
            .eq('is_active', true)
            .maybeSingle();

          if (!waAcc) continue;

          for (const waMsg of val.messages) {
            const text = waMsg.text?.body;
            const mid = waMsg.id;
            const from = waMsg.from;
            if (!text || !mid || !from) continue;

            const { error: dupErr } = await admin.from('social_webhook_events').insert({
              business_id: waAcc.business_id,
              platform: 'whatsapp',
              event_id: `wa_${mid}`,
              payload: waMsg,
            });
            if (dupErr) continue;

            const contactName = val.contacts?.[0]?.profile?.name || `WhatsApp ${from.slice(-4)}`;
            let { data: conv } = await admin
              .from('conversations')
              .select('*')
              .eq('business_id', waAcc.business_id)
              .eq('channel', 'whatsapp')
              .eq('external_thread_id', from)
              .maybeSingle();

            if (!conv) {
              const { data: createdConv } = await admin
                .from('conversations')
                .insert({
                  business_id: waAcc.business_id,
                  channel: 'whatsapp',
                  external_thread_id: from,
                  channel_account_id: phoneId,
                  customer_name: contactName,
                  last_message: text,
                  last_message_at: new Date().toISOString(),
                  unread_count: 1,
                  ai_enabled: true,
                })
                .select('*')
                .single();
              conv = createdConv;
            } else {
              await admin
                .from('conversations')
                .update({
                  last_message: text,
                  last_message_at: new Date().toISOString(),
                  unread_count: (conv.unread_count || 0) + 1,
                })
                .eq('id', conv.id);
            }

            if (conv) {
              const { data: savedMsg } = await admin
                .from('messages')
                .insert({
                  business_id: waAcc.business_id,
                  conversation_id: conv.id,
                  external_message_id: mid,
                  sender_type: 'customer',
                  content: text,
                  message_type: 'text',
                })
                .select('*')
                .single();

              if (savedMsg) broadcastToBusiness(waAcc.business_id, 'message:new', savedMsg);

              const aiOut = await processCustomerMessageWithAi({
                businessId: waAcc.business_id,
                conversationId: conv.id,
                customerMessage: text,
              });
              if (aiOut.replied && aiOut.replyText) {
                await dispatchChannelReply({
                  businessId: waAcc.business_id,
                  channel: 'whatsapp',
                  channelAccountId: phoneId,
                  recipientId: from,
                  text: aiOut.replyText,
                });
              }
            }
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Meta Webhook Error]', err);
    return res.status(200).json({ received: true });
  }
});

// Meta Conversions API (CAPI) Settings & Logs
router.get('/businesses/:businessId/capi', requireAuth, requireBusinessAccess('settings'), requireFeature('meta_capi'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: config }, { data: events }] = await Promise.all([
      admin
        .from('meta_capi_configs')
        .select('id, business_id, pixel_id, access_token_encrypted, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required, updated_at')
        .eq('business_id', req.businessId!)
        .maybeSingle(),
      admin
        .from('meta_capi_events')
        .select('*')
        .eq('business_id', req.businessId!)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    const safeConfig = config
      ? {
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
          has_access_token: Boolean(config.access_token_encrypted),
        }
      : null;
    return res.json({ config: safeConfig, events: events || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch CAPI config.' });
  }
});

router.put('/businesses/:businessId/capi', requireAuth, requireBusinessAccess('settings'), requireFeature('meta_capi'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { pixel_id, access_token, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required } =
      req.body as Record<string, unknown>;

    const payload: Record<string, unknown> = {
      business_id: req.businessId!,
      pixel_id: String(pixel_id || '').trim(),
      test_event_code: String(test_event_code || '').trim(),
      is_active: Boolean(is_active),
      track_purchase: track_purchase !== false,
      track_lead: track_lead !== false,
      track_initiate_checkout: track_initiate_checkout !== false,
      consent_required: consent_required !== false,
      updated_at: new Date().toISOString(),
    };
    if (access_token && String(access_token).trim()) {
      payload.access_token_encrypted = encryptSecret(String(access_token).trim());
    }

    const { data, error } = await admin
      .from('meta_capi_configs')
      .upsert(payload, { onConflict: 'business_id' })
      .select('id, business_id, pixel_id, access_token_encrypted, test_event_code, is_active, track_purchase, track_lead, track_initiate_checkout, consent_required')
      .single();

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
        has_access_token: Boolean(data.access_token_encrypted),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save CAPI settings.' });
  }
});

router.post('/businesses/:businessId/capi/test', requireAuth, requireBusinessAccess('settings'), requireFeature('meta_capi'), async (req: AuthedRequest, res) => {
  try {
    const result = await sendMetaCapiEvent({
      businessId: req.businessId!,
      eventName: 'Lead',
      eventId: `test_lead_${Date.now()}`,
      value: 100,
    });
    if ('skipped' in result && result.skipped) {
      return res.status(400).json({ error: result.reason });
    }
    if ('ok' in result && !result.ok) {
      const apiMsg =
        (result as { response?: { error?: { message?: string } }; error?: string }).response?.error?.message ||
        (result as { error?: string }).error ||
        'Meta CAPI event dispatch failed.';
      return res.status(400).json({ error: apiMsg, ...result });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'CAPI test failed.' });
  }
});

// Courier Management (Steadfast & Pathao)
router.get('/businesses/:businessId/couriers', requireAuth, requireBusinessAccess('orders'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: accounts }, { data: shipments }] = await Promise.all([
      admin
        .from('courier_accounts')
        .select('id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, updated_at')
        .eq('business_id', req.businessId!),
      admin
        .from('courier_shipments')
        .select('*, events:courier_tracking_events(*)')
        .eq('business_id', req.businessId!)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    const safeAccounts = (accounts || []).map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      client_id: a.client_id,
      username: a.username,
      store_id: a.store_id,
      is_sandbox: a.is_sandbox,
      is_active: a.is_active,
      updated_at: a.updated_at,
      has_api_key: Boolean(a.api_key_encrypted),
      has_secret_key: Boolean(a.secret_key_encrypted),
      has_client_secret: Boolean(a.client_secret_encrypted),
      has_password: Boolean(a.password_encrypted),
    }));
    return res.json({ accounts: safeAccounts, shipments: shipments || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load couriers.' });
  }
});

router.put('/businesses/:businessId/couriers', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { provider, label, api_key, secret_key, client_id, client_secret, username, password, store_id, is_sandbox, is_active } =
      req.body as Record<string, unknown>;

    const prov = String(provider || '').trim();
    if (!['steadfast', 'pathao'].includes(prov)) {
      return res.status(400).json({ error: 'Valid courier provider (steadfast or pathao) is required.' });
    }

    const { data: existing } = await admin
      .from('courier_accounts')
      .select('id, api_key_encrypted, secret_key_encrypted, client_secret_encrypted, password_encrypted')
      .eq('business_id', req.businessId!)
      .eq('provider', prov)
      .maybeSingle();

    if (prov === 'steadfast') {
      const hasKey = Boolean(String(api_key || '').trim() || existing?.api_key_encrypted);
      const hasSec = Boolean(String(secret_key || '').trim() || existing?.secret_key_encrypted);
      if (!hasKey || !hasSec) {
        return res.status(400).json({ error: 'Steadfast Api-Key and Secret-Key are required.' });
      }
    } else {
      const hasCid = Boolean(String(client_id || '').trim());
      const hasCsec = Boolean(String(client_secret || '').trim() || existing?.client_secret_encrypted);
      const hasUser = Boolean(String(username || '').trim());
      const hasPass = Boolean(String(password || '').trim() || existing?.password_encrypted);
      const hasStore = Boolean(String(store_id || '').trim());
      if (!hasCid || !hasCsec || !hasUser || !hasPass || !hasStore) {
        return res.status(400).json({ error: 'Pathao Client ID, Client Secret, Username, Password, and Store ID are required.' });
      }
    }

    const payload: Record<string, unknown> = {
      business_id: req.businessId!,
      provider: prov,
      label: label ? String(label).trim() : prov.toUpperCase(),
      is_sandbox: Boolean(is_sandbox),
      is_active: is_active !== false,
      updated_at: new Date().toISOString(),
    };
    if (typeof api_key === 'string' && api_key.trim()) payload.api_key_encrypted = encryptSecret(api_key.trim());
    if (typeof secret_key === 'string' && secret_key.trim()) payload.secret_key_encrypted = encryptSecret(secret_key.trim());
    if (client_id !== undefined) payload.client_id = String(client_id || '').trim();
    if (typeof client_secret === 'string' && client_secret.trim()) payload.client_secret_encrypted = encryptSecret(client_secret.trim());
    if (username !== undefined) payload.username = String(username || '').trim();
    if (typeof password === 'string' && password.trim()) payload.password_encrypted = encryptSecret(password.trim());
    if (store_id !== undefined) payload.store_id = String(store_id || '').trim();

    const { data, error } = await admin
      .from('courier_accounts')
      .upsert(payload, { onConflict: 'business_id,provider' })
      .select('id, provider, label, api_key_encrypted, secret_key_encrypted, client_id, client_secret_encrypted, username, password_encrypted, store_id, is_sandbox, is_active, updated_at')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({
      account: {
        id: data.id,
        provider: data.provider,
        label: data.label,
        client_id: data.client_id,
        username: data.username,
        store_id: data.store_id,
        is_sandbox: data.is_sandbox,
        is_active: data.is_active,
        updated_at: data.updated_at,
        has_api_key: Boolean(data.api_key_encrypted),
        has_secret_key: Boolean(data.secret_key_encrypted),
        has_client_secret: Boolean(data.client_secret_encrypted),
        has_password: Boolean(data.password_encrypted),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save courier account.' });
  }
});

router.post('/businesses/:businessId/couriers/:provider/test', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== 'steadfast' && provider !== 'pathao') {
      return res.status(400).json({ error: 'Invalid courier provider.' });
    }
    const result = await testCourierConnection(req.businessId!, provider);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Courier connection verification failed.' });
  }
});

router.post('/businesses/:businessId/orders/:orderId/book-courier', requireAuth, requireBusinessAccess('orders'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { provider, cityId, zoneId, itemWeight, note } = req.body as {
      provider?: 'steadfast' | 'pathao';
      cityId?: number;
      zoneId?: number;
      itemWeight?: number;
      note?: string;
    };
    if (!provider) return res.status(400).json({ error: 'Courier provider is required.' });

    const { data: order } = await admin
      .from('orders')
      .select('*')
      .eq('id', req.params.orderId)
      .eq('business_id', req.businessId!)
      .maybeSingle();

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const booking = await bookCourierParcel({
      businessId: req.businessId!,
      orderId: order.id,
      provider,
      recipientName: order.customer_name,
      recipientPhone: order.customer_phone,
      recipientAddress: order.customer_address,
      codAmount: order.payment_status === 'paid' ? 0 : Number(order.total_amount),
      note: note || order.notes,
      cityId,
      zoneId,
      itemWeight,
    });

    return res.json(booking);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Parcel booking failed.' });
  }
});

router.post('/businesses/:businessId/shipments/:shipmentId/sync', requireAuth, requireBusinessAccess('orders'), async (req: AuthedRequest, res) => {
  try {
    const result = await refreshCourierTracking(req.businessId!, req.params.shipmentId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Tracking sync failed.' });
  }
});

// Coin Wallet & Payment Submission
router.get('/businesses/:businessId/wallet', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const [{ data: wallet }, { data: transactions }, { data: aiLogs }, { data: payments }] = await Promise.all([
      admin.from('coin_wallets').select('*').eq('business_id', businessId).maybeSingle(),
      admin.from('coin_transactions').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      admin.from('ai_usage_logs').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      admin.from('payments').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(30),
    ]);

    return res.json({
      wallet: wallet || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      transactions: transactions || [],
      aiLogs: aiLogs || [],
      payments: payments || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load wallet.' });
  }
});

router.post('/businesses/:businessId/payments/submit', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { gateway_slug, payment_for, reference_id, transaction_id, sender_number, proof_url } = req.body as {
      gateway_slug?: string;
      payment_for?: 'coin_package' | 'subscription';
      reference_id?: string;
      transaction_id?: string;
      sender_number?: string;
      proof_url?: string;
    };

    if (!gateway_slug || !payment_for || !reference_id || !transaction_id) {
      return res.status(400).json({ error: 'Gateway, payment target, reference ID, and Transaction ID are required.' });
    }

    let amount = 0;
    let currency = 'BDT';
    if (payment_for === 'coin_package') {
      const { data: pkg } = await admin.from('coin_packages').select('price, currency').eq('id', reference_id).maybeSingle();
      if (!pkg) return res.status(404).json({ error: 'Coin package not found.' });
      amount = Number(pkg.price);
      currency = pkg.currency;
    } else {
      const { data: plan } = await admin.from('subscription_plans').select('monthly_price, currency').eq('id', reference_id).maybeSingle();
      if (!plan) return res.status(404).json({ error: 'Subscription plan not found.' });
      amount = Number(plan.monthly_price);
      currency = plan.currency;
    }

    const { data: payment, error } = await admin
      .from('payments')
      .insert({
        business_id: req.businessId!,
        user_id: req.user!.id,
        gateway_slug,
        payment_for,
        reference_id,
        amount,
        currency,
        transaction_id: transaction_id.trim(),
        sender_number: sender_number || '',
        proof_url: proof_url || '',
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ payment });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Payment submission failed.' });
  }
});

// Business Analytics
router.get('/businesses/:businessId/analytics', requireAuth, requireBusinessAccess('analytics'), requireFeature('analytics'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const days = Number(req.query.days || 30);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [{ data: orders }, { data: items }, { data: customers }, { data: aiLogs }] = await Promise.all([
      admin.from('orders').select('*').eq('business_id', businessId).gte('created_at', since),
      admin.from('order_items').select('*').eq('business_id', businessId).gte('created_at', since),
      admin.from('customers').select('id, total_orders, created_at').eq('business_id', businessId),
      admin.from('ai_usage_logs').select('coins_deducted, provider_cost_usd, total_tokens, status').eq('business_id', businessId).gte('created_at', since),
    ]);

    const orderList = orders || [];
    const delivered = orderList.filter((o) => o.order_status === 'delivered');
    const cancelled = orderList.filter((o) => o.order_status === 'cancelled');
    const returned = orderList.filter((o) => o.order_status === 'returned');
    const activeOrders = orderList.filter((o) => !['cancelled', 'returned', 'refunded'].includes(o.order_status));

    const revenue = activeOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const deliveryCosts = activeOrders.reduce((s, o) => s + Number(o.delivery_charge || 0), 0);
    const activeOrderIds = new Set(activeOrders.map((o) => o.id));
    const productCosts = (items || [])
      .filter((i) => activeOrderIds.has(i.order_id))
      .reduce((s, i) => s + Number(i.unit_cost || 0) * Number(i.quantity || 1), 0);
    const estimatedProfit = revenue - productCosts - deliveryCosts;

    // Best selling products
    const productPerf = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const item of items || []) {
      if (!activeOrderIds.has(item.order_id)) continue;
      const cur = productPerf.get(item.product_name) || { name: item.product_name, quantity: 0, revenue: 0 };
      cur.quantity += Number(item.quantity || 1);
      cur.revenue += Number(item.total_price || 0);
      productPerf.set(item.product_name, cur);
    }

    const totalCust = (customers || []).length;
    const repeatCust = (customers || []).filter((c) => Number(c.total_orders || 0) > 1).length;
    const repeatRate = totalCust > 0 ? Math.round((repeatCust / totalCust) * 100) : 0;

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
        aiTokens,
      },
      bestSellingProducts: Array.from(productPerf.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Analytics error.' });
  }
});

export default router;
