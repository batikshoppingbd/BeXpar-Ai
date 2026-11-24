import { Router } from 'express';
import { encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { writeAuditLog } from '../db/repository.ts';
import { processCustomerMessageWithAi } from '../ai/customerAgent.ts';
import { requireAuth, requireBusinessAccess, requireFeature, type AuthedRequest } from '../middleware/auth.ts';
import {
  bookCourierParcel,
  checkSteadfastFraudByPhone,
  disconnectBusinessCourier,
  getBusinessCourierOverview,
  refreshCourierTracking,
  revealBusinessCourierCredentials,
  saveBusinessCourierAccount,
  syncActiveShipmentsForBusiness,
  testCourierConnection,
  updateBusinessCourierState,
} from '../services/courierService.ts';
import { evaluateOrderRisk } from '../services/orderRisk.ts';
import {
  listActiveCatalogGateways,
  ManualPaymentError,
  submitManualPayment,
} from '../services/manualPaymentService.ts';
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
    const gateways = await listActiveCatalogGateways();
    return res.json({ gateways });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to load gateways.' });
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
    const overview = await getBusinessCourierOverview(req.businessId!);
    return res.json(overview);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load couriers.' });
  }
});

router.put('/businesses/:businessId/couriers', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const result = await saveBusinessCourierAccount(req.businessId!, req.body as Record<string, unknown>);
    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.businessId!,
      action: 'courier_credentials_saved',
      targetType: 'courier_account',
      targetId: result.account.provider,
      details: { is_active: result.account.is_active, is_default: result.account.is_default },
      ipAddress: req.ip,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save courier account.' });
  }
});

router.post('/businesses/:businessId/couriers/:provider/reveal', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== 'steadfast' && provider !== 'pathao') {
      return res.status(400).json({ error: 'Invalid courier provider.' });
    }
    const credentials = await revealBusinessCourierCredentials(req.businessId!, provider);
    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.businessId!,
      action: 'courier_credentials_revealed',
      targetType: 'courier_account',
      targetId: provider,
      ipAddress: req.ip,
    });
    return res.json({ credentials });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'Unable to load courier credentials.' });
  }
});

router.patch('/businesses/:businessId/couriers/:provider', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== 'steadfast' && provider !== 'pathao') {
      return res.status(400).json({ error: 'Invalid courier provider.' });
    }
    const { is_active, is_default } = req.body as { is_active?: boolean; is_default?: boolean };
    const result = await updateBusinessCourierState(req.businessId!, provider, {
      ...(typeof is_active === 'boolean' ? { is_active } : {}),
      ...(typeof is_default === 'boolean' ? { is_default } : {}),
    });
    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.businessId!,
      action: 'courier_state_updated',
      targetType: 'courier_account',
      targetId: provider,
      details: { is_active: result.account.is_active, is_default: result.account.is_default },
      ipAddress: req.ip,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update courier settings.' });
  }
});

router.delete('/businesses/:businessId/couriers/:provider', requireAuth, requireBusinessAccess('settings'), requireFeature('courier'), async (req: AuthedRequest, res) => {
  try {
    const provider = req.params.provider;
    if (provider !== 'steadfast' && provider !== 'pathao') {
      return res.status(400).json({ error: 'Invalid courier provider.' });
    }
    const result = await disconnectBusinessCourier(req.businessId!, provider);
    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      businessId: req.businessId!,
      action: 'courier_disconnected',
      targetType: 'courier_account',
      targetId: provider,
      ipAddress: req.ip,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to disconnect courier.' });
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
    if (provider && provider !== 'steadfast' && provider !== 'pathao') {
      return res.status(400).json({ error: 'Invalid courier provider.' });
    }

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
      orderNumber: order.order_number,
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

router.post('/businesses/:businessId/orders/sync-couriers', requireAuth, requireBusinessAccess('orders'), async (req: AuthedRequest, res) => {
  try {
    const result = await syncActiveShipmentsForBusiness(req.businessId!);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Courier status sync failed.' });
  }
});

router.post('/businesses/:businessId/orders/:orderId/detect-risk', requireAuth, requireBusinessAccess('orders'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: order } = await admin
      .from('orders')
      .select('id, customer_phone, total_amount')
      .eq('id', req.params.orderId)
      .eq('business_id', req.businessId!)
      .maybeSingle();

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const risk = await evaluateOrderRisk({
      businessId: req.businessId!,
      customerPhone: order.customer_phone,
      totalAmount: Number(order.total_amount || 0),
      excludeOrderId: order.id,
    });

    await admin
      .from('orders')
      .update({
        risk_level: risk.riskLevel,
        risk_reasons: risk.reasons,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('business_id', req.businessId!);

    return res.json({
      risk_level: risk.riskLevel,
      risk_reasons: risk.reasons,
      courierStats: risk.courierStats || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Risk auto-detection failed.' });
  }
});

router.get('/businesses/:businessId/couriers/fraud-check', requireAuth, requireBusinessAccess('orders'), async (req: AuthedRequest, res) => {
  try {
    const phone = String(req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone number is required.' });
    const stats = await checkSteadfastFraudByPhone(req.businessId!, phone);
    return res.json(stats);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Fraud check failed.' });
  }
});

// Coin Wallet & Payment Submission
router.get('/businesses/:businessId/wallet', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const [{ data: wallet }, { data: transactions }, { data: aiLogs }, { data: payments }, { data: notifications }] = await Promise.all([
      admin.from('coin_wallets').select('*').eq('business_id', businessId).maybeSingle(),
      admin.from('coin_transactions').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      admin.from('ai_usage_logs').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      admin.from('payments').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
      admin
        .from('notifications')
        .select('*')
        .eq('business_id', businessId)
        .eq('user_id', req.user!.id)
        .eq('link', 'wallet')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    return res.json({
      wallet: wallet || { balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 },
      transactions: transactions || [],
      aiLogs: aiLogs || [],
      payments: payments || [],
      notifications: notifications || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load wallet.' });
  }
});

router.post('/businesses/:businessId/wallet/notifications/read', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    await admin
      .from('notifications')
      .update({ is_read: true })
      .eq('business_id', req.businessId!)
      .eq('user_id', req.user!.id)
      .eq('link', 'wallet')
      .eq('is_read', false);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to mark notifications read.' });
  }
});

router.post('/businesses/:businessId/payments/submit', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const { gateway_slug, payment_for, reference_id, transaction_id, sender_number, paid_to_number, proof_url } = req.body as {
      gateway_slug?: string;
      payment_for?: 'coin_package' | 'subscription';
      reference_id?: string;
      transaction_id?: string;
      sender_number?: string;
      paid_to_number?: string;
      proof_url?: string;
    };

    const payment = await submitManualPayment({
      businessId: req.businessId!,
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      gateway_slug: gateway_slug || '',
      payment_for: payment_for as 'coin_package' | 'subscription',
      reference_id: reference_id || '',
      transaction_id: transaction_id || '',
      sender_number: sender_number || '',
      paid_to_number,
      proof_url,
      ipAddress: req.ip,
    });

    return res.status(201).json({ payment });
  } catch (err) {
    const status = err instanceof ManualPaymentError ? err.statusCode : 500;
    return res.status(status).json({ error: err instanceof Error ? err.message : 'Payment submission failed.' });
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
