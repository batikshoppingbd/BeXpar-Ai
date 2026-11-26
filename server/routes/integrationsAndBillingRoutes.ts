import { Router } from 'express';
import { decryptSecret, encryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';
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
  fetchMetaSenderProfile,
  getInstantAutoReplyDiagnostics,
  getPlatformMetaConfig,
  handleMetaOAuthCallback,
  resolveAppBaseUrl,
  resolveMetaChannelToken,
  sendMetaCapiEvent,
  sendMetaSenderAction,
  subscribePageToMetaWebhooks,
  subscribeWabaToMetaWebhooks,
  syncMetaConversationsForBusiness,
  verifyMetaWebhookBodyWithFallback,
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
      webhookUrl: `${resolveAppBaseUrl(req)}/api/webhooks/meta`,
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

router.post('/businesses/:businessId/social/sync-inbox', requireAuth, requireBusinessAccess('inbox'), async (req: AuthedRequest, res) => {
  try {
    const triggerAutoReply = Boolean((req.body as { triggerAutoReply?: boolean } | undefined)?.triggerAutoReply);
    const result = await syncMetaConversationsForBusiness(req.businessId!, { triggerAutoReply });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to sync Meta inbox.' });
  }
});

router.get('/businesses/:businessId/social/webhook-status', requireAuth, requireBusinessAccess('inbox'), async (req: AuthedRequest, res) => {
  try {
    const webhookUrl = `${resolveAppBaseUrl(req)}/api/webhooks/meta`;
    const diagnostics = await getInstantAutoReplyDiagnostics(req.businessId!, webhookUrl);
    return res.json(diagnostics);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect webhook status.' });
  }
});

router.post('/businesses/:businessId/social/webhook-subscribe', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const metaCfg = await getPlatformMetaConfig();
    const [{ data: fbPages }, { data: igAccounts }, { data: waAccounts }] = await Promise.all([
      admin.from('facebook_pages').select('page_id, page_name, page_access_token_encrypted').eq('business_id', businessId).eq('is_active', true),
      admin.from('instagram_accounts').select('linked_page_id, username, access_token_encrypted').eq('business_id', businessId).eq('is_active', true),
      admin.from('whatsapp_accounts').select('waba_id, access_token_encrypted').eq('business_id', businessId).eq('is_active', true),
    ]);

    const subscribedPages: string[] = [];
    const failedPages: Array<{ name: string; error: string }> = [];
    const donePageIds = new Set<string>();

    for (const p of fbPages || []) {
      if (donePageIds.has(p.page_id)) continue;
      donePageIds.add(p.page_id);
      const token = decryptSecret(p.page_access_token_encrypted || '');
      if (!token) continue;
      const r = await subscribePageToMetaWebhooks({
        businessId,
        pageId: p.page_id,
        pageAccessToken: token,
        apiVersion: metaCfg.apiVersion,
      });
      if (r.ok) subscribedPages.push(p.page_name || p.page_id);
      else failedPages.push({ name: p.page_name || p.page_id, error: r.error || 'Subscription failed' });
    }

    for (const ig of igAccounts || []) {
      if (!ig.linked_page_id || donePageIds.has(ig.linked_page_id)) continue;
      donePageIds.add(ig.linked_page_id);
      const token = decryptSecret(ig.access_token_encrypted || '');
      if (!token) continue;
      const r = await subscribePageToMetaWebhooks({
        businessId,
        pageId: ig.linked_page_id,
        pageAccessToken: token,
        apiVersion: metaCfg.apiVersion,
      });
      if (r.ok) subscribedPages.push(ig.username || ig.linked_page_id);
      else failedPages.push({ name: ig.username || ig.linked_page_id, error: r.error || 'Subscription failed' });
    }

    const doneWabas = new Set<string>();
    for (const wa of waAccounts || []) {
      if (!wa.waba_id || doneWabas.has(wa.waba_id)) continue;
      doneWabas.add(wa.waba_id);
      const token = decryptSecret(wa.access_token_encrypted || '');
      if (!token) continue;
      const r = await subscribeWabaToMetaWebhooks({
        businessId,
        wabaId: wa.waba_id,
        accessToken: token,
        apiVersion: metaCfg.apiVersion,
      });
      if (r.ok) subscribedPages.push(`WhatsApp (${wa.waba_id})`);
      else failedPages.push({ name: `WhatsApp (${wa.waba_id})`, error: r.error || 'Subscription failed' });
    }

    const diagnostics = await getInstantAutoReplyDiagnostics(businessId, `${resolveAppBaseUrl(req)}/api/webhooks/meta`);
    return res.json({ subscribedPages, failedPages, diagnostics });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to subscribe webhooks.' });
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
    const mode = String(req.query['hub.mode'] || '').trim();
    const token = String(req.query['hub.verify_token'] || '').trim();
    const challenge = String(req.query['hub.challenge'] || '');

    const metaCfg = await getPlatformMetaConfig();
    if (mode === 'subscribe' && token && token === metaCfg.webhookVerifyToken.trim()) {
      return res.status(200).type('text/plain').send(challenge);
    }
    return res.status(403).send('Forbidden');
  } catch (err) {
    return res.status(500).send(err instanceof Error ? err.message : 'Webhook verify error');
  }
});

router.post('/webhooks/meta', async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const sigCheck = await verifyMetaWebhookBodyWithFallback({
      rawBody,
      parsedBody: req.body,
      signatureHeader: signature,
    });

    if (!sigCheck.valid) {
      return res.status(401).json({ error: sigCheck.reason || 'Invalid Meta webhook signature.' });
    }

    type MetaMessagingEvent = {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      delivery?: { mids?: string[]; watermark?: number };
      read?: { watermark?: number };
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: Array<{ type?: string; payload?: { url?: string; sticker_id?: number } }>;
      };
      postback?: { mid?: string; title?: string; payload?: string };
    };

    const payload = req.body as {
      object?: string;
      entry?: Array<{
        id?: string;
        messaging?: MetaMessagingEvent[];
        standby?: MetaMessagingEvent[];
        changes?: Array<{
          field?: string;
          value?: {
            sender?: { id?: string };
            recipient?: { id?: string };
            timestamp?: string | number;
            message?: MetaMessagingEvent['message'];
            metadata?: { phone_number_id?: string };
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
            messages?: Array<{ id?: string; from?: string; type?: string; text?: { body?: string } }>;
            statuses?: Array<{ id?: string; status?: 'sent' | 'delivered' | 'read' | 'failed'; recipient_id?: string }>;
          };
        }>;
      }>;
    };

    const admin = getSupabaseAdmin();

    for (const entry of payload.entry || []) {
      // Normalize Messenger, Handover standby, and Instagram (messaging + changes.messages) into messaging events
      const igChangeMessaging: MetaMessagingEvent[] =
        payload.object === 'instagram' && entry.changes
          ? entry.changes
              .filter((c) => c.field === 'messages' && c.value?.sender?.id && c.value?.message)
              .map((c) => ({
                sender: c.value!.sender,
                recipient: c.value!.recipient || { id: entry.id },
                timestamp: Number(c.value!.timestamp || Date.now()),
                message: c.value!.message,
              }))
          : [];

      const messagingList: MetaMessagingEvent[] = [
        ...(entry.messaging || []),
        ...(entry.standby || []),
        ...igChangeMessaging,
      ];

      // Messenger or Instagram Messaging
      if (messagingList.length > 0) {
        const channel = payload.object === 'instagram' ? 'instagram' : 'facebook';
        for (const msgEvent of messagingList) {
          // Handle delivery & read receipts from Meta
          if (msgEvent.delivery || msgEvent.read) {
            const senderId = msgEvent.sender?.id;
            const recipientId = msgEvent.recipient?.id;
            const candidateIds = Array.from(new Set([recipientId, entry.id].filter((v): v is string => Boolean(v))));
            if (senderId && candidateIds.length > 0) {
              const { data: matchingConvs } = await admin
                .from('conversations')
                .select('id, business_id')
                .eq('channel', channel)
                .eq('external_thread_id', senderId)
                .in('channel_account_id', candidateIds);

              for (const conv of matchingConvs || []) {
                if (msgEvent.delivery?.mids?.length) {
                  await admin
                    .from('messages')
                    .update({ delivery_status: 'delivered' })
                    .eq('conversation_id', conv.id)
                    .in('external_message_id', msgEvent.delivery.mids)
                    .eq('delivery_status', 'sent');
                } else if (msgEvent.delivery?.watermark) {
                  await admin
                    .from('messages')
                    .update({ delivery_status: 'delivered' })
                    .eq('conversation_id', conv.id)
                    .in('sender_type', ['ai', 'staff'])
                    .eq('delivery_status', 'sent')
                    .lte('created_at', new Date(msgEvent.delivery.watermark).toISOString());
                }

                if (msgEvent.read?.watermark) {
                  await admin
                    .from('messages')
                    .update({ delivery_status: 'read' })
                    .eq('conversation_id', conv.id)
                    .in('sender_type', ['ai', 'staff'])
                    .in('delivery_status', ['sent', 'delivered'])
                    .lte('created_at', new Date(msgEvent.read.watermark).toISOString());
                }

                broadcastToBusiness(conv.business_id, 'message:status', {
                  conversationId: conv.id,
                  status: msgEvent.read ? 'read' : 'delivered',
                });
              }
            }
            continue;
          }

          if (msgEvent.message?.is_echo) continue;

          const rawAttachments = msgEvent.message?.attachments || [];
          const incomingAtts = rawAttachments
            .map((a) => {
              const rawUrl = a.payload?.url || '';
              if (!rawUrl.startsWith('https://') && !rawUrl.startsWith('http://')) return null;
              const isImg = a.type === 'image';
              return {
                file_url: rawUrl,
                file_type: isImg ? 'image' : a.type || 'file',
                file_name: isImg ? 'Image attachment' : `${a.type || 'file'} attachment`,
                file_size: 0,
              };
            })
            .filter((v): v is { file_url: string; file_type: string; file_name: string; file_size: number } => Boolean(v));

          const hasImageAtt = incomingAtts.some((a) => a.file_type === 'image');
          const firstNonUrlAttType = rawAttachments.find((a) => !a.payload?.url)?.type;
          const hasSticker = rawAttachments.some((a) => Boolean(a.payload?.sticker_id));
          const fallbackAttSummary = hasImageAtt
            ? '📷 Photo'
            : incomingAtts.length > 0
            ? '📎 Attachment'
            : hasSticker
            ? '👍 Sticker'
            : firstNonUrlAttType
            ? `[${firstNonUrlAttType}]`
            : '';

          const rawText = msgEvent.message?.text?.trim() || msgEvent.postback?.title?.trim() || '';
          const previewSummary = rawText || fallbackAttSummary;
          const mid = msgEvent.message?.mid || msgEvent.postback?.mid || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const senderId = msgEvent.sender?.id;
          const recipientId = msgEvent.recipient?.id;
          if (!previewSummary || !senderId || (!recipientId && !entry.id)) continue;

          const candidateAccountIds = Array.from(new Set([recipientId, entry.id].filter((v): v is string => Boolean(v))));
          if (candidateAccountIds.includes(senderId)) continue;

          // Match business connection via social_connections, facebook_pages, or instagram_accounts
          let matchedBusinessId: string | null = null;
          let matchedAccountId = recipientId || entry.id || '';

          const { data: conn } = await admin
            .from('social_connections')
            .select('business_id, account_id')
            .eq('platform', channel)
            .in('account_id', candidateAccountIds)
            .eq('status', 'connected')
            .limit(1)
            .maybeSingle();

          if (conn) {
            matchedBusinessId = conn.business_id;
            matchedAccountId = conn.account_id;
          } else if (channel === 'facebook') {
            const { data: fbPage } = await admin
              .from('facebook_pages')
              .select('business_id, page_id')
              .in('page_id', candidateAccountIds)
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();
            if (fbPage) {
              matchedBusinessId = fbPage.business_id;
              matchedAccountId = fbPage.page_id;
            }
          } else if (channel === 'instagram') {
            const { data: igAcc } = await admin
              .from('instagram_accounts')
              .select('business_id, ig_account_id, linked_page_id')
              .or(candidateAccountIds.map((id) => `ig_account_id.eq.${id},linked_page_id.eq.${id}`).join(','))
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();
            if (igAcc) {
              matchedBusinessId = igAcc.business_id;
              matchedAccountId = igAcc.ig_account_id;
            }
          }

          if (!matchedBusinessId) continue;

          // Event Deduplication
          const { error: dupErr } = await admin.from('social_webhook_events').insert({
            business_id: matchedBusinessId,
            platform: channel,
            event_id: `${channel}_${mid}`,
            payload: msgEvent,
          });
          if (dupErr) continue;

          // Also guard against messages already imported by background inbox sync
          const { data: existingExternalMsg } = await admin
            .from('messages')
            .select('id')
            .eq('business_id', matchedBusinessId)
            .eq('external_message_id', mid)
            .limit(1)
            .maybeSingle();
          if (existingExternalMsg) continue;

          try {
            let { data: conv } = await admin
              .from('conversations')
              .select('*')
              .eq('business_id', matchedBusinessId)
              .eq('channel', channel)
              .eq('external_thread_id', senderId)
              .maybeSingle();

            let senderName = `${channel.toUpperCase()} User ${senderId.slice(-4)}`;
            let senderAvatar = '';

            if (!conv || !conv.customer_avatar || !conv.customer_name || conv.customer_name.startsWith(`${channel.toUpperCase()} User `)) {
              const { token } = await resolveMetaChannelToken({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId,
              });
              if (token) {
                const prof = await fetchMetaSenderProfile({ senderId, accessToken: token });
                if (prof.name) senderName = prof.name;
                if (prof.avatar) senderAvatar = prof.avatar;
              }
            }

            if (!conv) {
              const { data: createdConv } = await admin
                .from('conversations')
                .insert({
                  business_id: matchedBusinessId,
                  channel,
                  external_thread_id: senderId,
                  channel_account_id: matchedAccountId,
                  customer_name: senderName,
                  customer_avatar: senderAvatar,
                  last_message: previewSummary,
                  last_message_at: new Date().toISOString(),
                  unread_count: 1,
                  ai_enabled: true,
                })
                .select('*')
                .single();
              conv = createdConv;
            } else {
              const { data: updatedConv } = await admin
                .from('conversations')
                .update({
                  ...(senderName && conv.customer_name.startsWith(`${channel.toUpperCase()} User `)
                    ? { customer_name: senderName }
                    : {}),
                  ...(senderAvatar ? { customer_avatar: senderAvatar } : {}),
                  channel_account_id: matchedAccountId || conv.channel_account_id,
                  last_message: previewSummary,
                  last_message_at: new Date().toISOString(),
                  unread_count: (conv.unread_count || 0) + 1,
                })
                .eq('id', conv.id)
                .select('*')
                .single();
              if (updatedConv) conv = updatedConv;
            }

            if (conv) {
              broadcastToBusiness(matchedBusinessId, 'conversation:updated', conv);

              const msgType = hasImageAtt ? 'image' : incomingAtts.length > 0 ? 'attachment' : 'text';
              const { data: savedMsg } = await admin
                .from('messages')
                .insert({
                  business_id: matchedBusinessId,
                  conversation_id: conv.id,
                  external_message_id: mid,
                  sender_type: 'customer',
                  content: rawText,
                  message_type: msgType,
                  delivery_status: 'delivered',
                })
                .select('*')
                .single();

              if (savedMsg) {
                if (incomingAtts.length > 0) {
                  await admin.from('message_attachments').insert(
                    incomingAtts.map((a) => ({
                      business_id: matchedBusinessId!,
                      message_id: savedMsg.id,
                      ...a,
                    }))
                  );
                }
                const { data: fullMsg } = await admin
                  .from('messages')
                  .select('*, attachments:message_attachments(*)')
                  .eq('id', savedMsg.id)
                  .single();
                broadcastToBusiness(matchedBusinessId, 'message:new', fullMsg || savedMsg);
              }

              // Immediately show "Seen" & typing dots to the customer while AI generates the instant reply
              void sendMetaSenderAction({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId,
                recipientId: senderId,
                action: 'mark_seen',
              });
              void sendMetaSenderAction({
                businessId: matchedBusinessId,
                channel,
                channelAccountId: matchedAccountId,
                recipientId: senderId,
                action: 'typing_on',
              });

              // If customer sent a quick sticker/image without text, wait 900ms so an immediately-following question coalesces cleanly
              if (!rawText && savedMsg) {
                await new Promise((r) => setTimeout(r, 900));
                const { data: newerCheck } = await admin
                  .from('messages')
                  .select('id')
                  .eq('conversation_id', conv.id)
                  .gt('created_at', savedMsg.created_at)
                  .limit(1)
                  .maybeSingle();
                if (newerCheck) {
                  continue;
                }
              }

              // Ensure another concurrent webhook hasn't already generated an AI reply for this customer turn
              if (savedMsg) {
                const { data: alreadyReplied } = await admin
                  .from('messages')
                  .select('id')
                  .eq('conversation_id', conv.id)
                  .eq('sender_type', 'ai')
                  .gte('created_at', savedMsg.created_at)
                  .limit(1)
                  .maybeSingle();
                if (alreadyReplied) {
                  continue;
                }
              }

              const aiInputText =
                rawText ||
                (hasSticker
                  ? 'Customer sent a thumbs-up / sticker reaction.'
                  : hasImageAtt
                  ? 'Customer sent an image.'
                  : `Customer sent ${fallbackAttSummary || 'an attachment'}.`);
              const aiOut = await processCustomerMessageWithAi({
                businessId: matchedBusinessId,
                conversationId: conv.id,
                customerMessage: aiInputText,
              });

              if (aiOut.replied && aiOut.replyText) {
                const dispatch = await dispatchChannelReply({
                  businessId: matchedBusinessId,
                  channel,
                  channelAccountId: matchedAccountId,
                  recipientId: senderId,
                  text: aiOut.replyText,
                });
                if (aiOut.messageId) {
                  if (dispatch.delivered && dispatch.externalMessageId) {
                    await admin
                      .from('messages')
                      .update({ external_message_id: dispatch.externalMessageId })
                      .eq('id', aiOut.messageId);
                  } else if (!dispatch.delivered) {
                    await admin
                      .from('messages')
                      .update({ delivery_status: 'failed' })
                      .eq('id', aiOut.messageId);
                    broadcastToBusiness(matchedBusinessId, 'message:status', {
                      conversationId: conv.id,
                      messageId: aiOut.messageId,
                      status: 'failed',
                    });
                  }
                }
                if (!dispatch.delivered) {
                  const warnMsg = dispatch.error || 'Failed to deliver AI reply to Meta.';
                  await admin.from('social_connection_logs').insert({
                    business_id: matchedBusinessId,
                    platform: channel,
                    event_type: 'reply_dispatch_failed',
                    status: 'error',
                    message: warnMsg,
                  });
                  broadcastToBusiness(matchedBusinessId, 'ai:warning', {
                    conversationId: conv.id,
                    message: warnMsg,
                  });
                }
              } else {
                void sendMetaSenderAction({
                  businessId: matchedBusinessId,
                  channel,
                  channelAccountId: matchedAccountId,
                  recipientId: senderId,
                  action: 'typing_off',
                });
                if (aiOut.error) {
                  await admin.from('social_connection_logs').insert({
                    business_id: matchedBusinessId,
                    platform: channel,
                    event_type: 'ai_reply_skipped',
                    status: 'error',
                    message: aiOut.error,
                  });
                  broadcastToBusiness(matchedBusinessId, 'ai:warning', {
                    conversationId: conv.id,
                    message: aiOut.error,
                  });
                }
              }
            }
          } catch (msgErr) {
            console.error('[Meta Messenger/IG Event Error]', msgErr);
          }
        }
      }

      // WhatsApp Cloud API Changes
      if (entry.changes) {
        for (const change of entry.changes) {
          const val = change.value;
          const phoneId = val?.metadata?.phone_number_id;
          if (!phoneId) continue;

          const { data: waAcc } = await admin
            .from('whatsapp_accounts')
            .select('business_id')
            .eq('phone_number_id', phoneId)
            .eq('is_active', true)
            .maybeSingle();

          if (!waAcc) continue;

          if (val?.statuses?.length) {
            for (const st of val.statuses) {
              if (!st.id || !st.status) continue;
              const { data: updated } = await admin
                .from('messages')
                .update({ delivery_status: st.status })
                .eq('business_id', waAcc.business_id)
                .eq('external_message_id', st.id)
                .select('id, conversation_id')
                .maybeSingle();
              if (updated) {
                broadcastToBusiness(waAcc.business_id, 'message:status', {
                  conversationId: updated.conversation_id,
                  messageId: updated.id,
                  status: st.status,
                });
              }
            }
          }

          if (!val?.messages) continue;

          for (const waMsg of val.messages) {
            const text = waMsg.text?.body?.trim() || (waMsg.type && waMsg.type !== 'text' ? `[${waMsg.type}]` : '');
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

            const { data: existingWaMsg } = await admin
              .from('messages')
              .select('id')
              .eq('business_id', waAcc.business_id)
              .eq('external_message_id', mid)
              .limit(1)
              .maybeSingle();
            if (existingWaMsg) continue;

            try {
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
                const { data: updatedConv } = await admin
                  .from('conversations')
                  .update({
                    last_message: text,
                    last_message_at: new Date().toISOString(),
                    unread_count: (conv.unread_count || 0) + 1,
                  })
                  .eq('id', conv.id)
                  .select('*')
                  .single();
                if (updatedConv) conv = updatedConv;
              }

              if (conv) {
                broadcastToBusiness(waAcc.business_id, 'conversation:updated', conv);

                const { data: savedMsg } = await admin
                  .from('messages')
                  .insert({
                    business_id: waAcc.business_id,
                    conversation_id: conv.id,
                    external_message_id: mid,
                    sender_type: 'customer',
                    content: text,
                    message_type: 'text',
                    delivery_status: 'delivered',
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
                  const dispatch = await dispatchChannelReply({
                    businessId: waAcc.business_id,
                    channel: 'whatsapp',
                    channelAccountId: phoneId,
                    recipientId: from,
                    text: aiOut.replyText,
                  });
                  if (aiOut.messageId) {
                    if (dispatch.delivered && dispatch.externalMessageId) {
                      await admin
                        .from('messages')
                        .update({ external_message_id: dispatch.externalMessageId })
                        .eq('id', aiOut.messageId);
                    } else if (!dispatch.delivered) {
                      await admin
                        .from('messages')
                        .update({ delivery_status: 'failed' })
                        .eq('id', aiOut.messageId);
                      broadcastToBusiness(waAcc.business_id, 'message:status', {
                        conversationId: conv.id,
                        messageId: aiOut.messageId,
                        status: 'failed',
                      });
                    }
                  }
                  if (!dispatch.delivered) {
                    const warnMsg = dispatch.error || 'Failed to deliver WhatsApp AI reply.';
                    await admin.from('social_connection_logs').insert({
                      business_id: waAcc.business_id,
                      platform: 'whatsapp',
                      event_type: 'reply_dispatch_failed',
                      status: 'error',
                      message: warnMsg,
                    });
                    broadcastToBusiness(waAcc.business_id, 'ai:warning', {
                      conversationId: conv.id,
                      message: warnMsg,
                    });
                  }
                } else if (aiOut.error) {
                  await admin.from('social_connection_logs').insert({
                    business_id: waAcc.business_id,
                    platform: 'whatsapp',
                    event_type: 'ai_reply_skipped',
                    status: 'error',
                    message: aiOut.error,
                  });
                  broadcastToBusiness(waAcc.business_id, 'ai:warning', {
                    conversationId: conv.id,
                    message: aiOut.error,
                  });
                }
              }
            } catch (waErr) {
              console.error('[Meta WhatsApp Event Error]', waErr);
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
