import { Router } from 'express';
import { getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { processCustomerMessageWithAi } from '../ai/customerAgent.ts';
import { rateLimit, requireAuth, requireBusinessAccess, requireFeature, type AuthedRequest } from '../middleware/auth.ts';
import { dispatchChannelReply } from '../services/metaService.ts';
import { broadcastToBusiness } from '../services/realtimeBus.ts';

const router = Router();

// AI Settings
router.get('/businesses/:businessId/ai-settings', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    let { data } = await admin.from('ai_settings').select('*').eq('business_id', req.businessId!).maybeSingle();
    if (!data) {
      const { data: created } = await admin
        .from('ai_settings')
        .insert({ business_id: req.businessId! })
        .select('*')
        .single();
      data = created;
    }
    return res.json({ settings: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch AI settings.' });
  }
});

router.put('/businesses/:businessId/ai-settings', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const b = req.body as Record<string, unknown>;
    const { data, error } = await admin
      .from('ai_settings')
      .upsert(
        {
          business_id: req.businessId!,
          agent_name: b.agent_name,
          welcome_message: b.welcome_message,
          language: b.language,
          reply_tone: b.reply_tone,
          system_instructions: b.system_instructions,
          business_rules: b.business_rules,
          working_hours: b.working_hours,
          auto_reply_enabled: b.auto_reply_enabled,
          human_handover_enabled: b.human_handover_enabled,
          order_collection_enabled: b.order_collection_enabled,
          order_collection_rules: b.order_collection_rules,
          is_available: b.is_available,
        },
        { onConflict: 'business_id' }
      )
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ settings: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update AI settings.' });
  }
});

// Knowledge Base CRUD
router.get('/businesses/:businessId/knowledge-base', requireAuth, requireBusinessAccess(), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('ai_knowledge_base')
      .select('*')
      .eq('business_id', req.businessId!)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch knowledge base.' });
  }
});

router.post('/businesses/:businessId/knowledge-base', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { category, title, content, file_url, is_enabled } = req.body as Record<string, unknown>;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });

    const { data, error } = await admin
      .from('ai_knowledge_base')
      .insert({
        business_id: req.businessId!,
        category: category || 'faq',
        title,
        content,
        file_url: file_url || '',
        is_enabled: is_enabled !== false,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ item: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create knowledge entry.' });
  }
});

router.patch('/businesses/:businessId/knowledge-base/:itemId', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { category, title, content, file_url, is_enabled } = req.body as Record<string, unknown>;
    const { data, error } = await admin
      .from('ai_knowledge_base')
      .update({
        ...(category !== undefined ? { category } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(file_url !== undefined ? { file_url } : {}),
        ...(is_enabled !== undefined ? { is_enabled } : {}),
      })
      .eq('id', req.params.itemId)
      .eq('business_id', req.businessId!)
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ item: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update knowledge entry.' });
  }
});

router.delete('/businesses/:businessId/knowledge-base/:itemId', requireAuth, requireBusinessAccess('settings'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('ai_knowledge_base')
      .delete()
      .eq('id', req.params.itemId)
      .eq('business_id', req.businessId!);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed.' });
  }
});

// Unified Omnichannel Conversations
router.get('/businesses/:businessId/conversations', requireAuth, requireBusinessAccess('inbox'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('conversations')
      .select('*, customer:customers(*)')
      .eq('business_id', req.businessId!)
      .order('last_message_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ conversations: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load conversations.' });
  }
});

router.get('/businesses/:businessId/conversations/:conversationId/messages', requireAuth, requireBusinessAccess('inbox'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('messages')
      .select('*, attachments:message_attachments(*)')
      .eq('conversation_id', req.params.conversationId)
      .eq('business_id', req.businessId!)
      .order('created_at', { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    await admin
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', req.params.conversationId)
      .eq('business_id', req.businessId!);

    return res.json({ messages: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load messages.' });
  }
});

// Update conversation (AI pause/resume, takeover, staff assignment, tags, internal notes, status)
router.patch('/businesses/:businessId/conversations/:conversationId', requireAuth, requireBusinessAccess('inbox'), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { ai_enabled, status, assigned_staff_id, tags, internal_notes } = req.body as Record<string, unknown>;

    const { data, error } = await admin
      .from('conversations')
      .update({
        ...(ai_enabled !== undefined ? { ai_enabled: Boolean(ai_enabled) } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(assigned_staff_id !== undefined ? { assigned_staff_id: assigned_staff_id || null } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(internal_notes !== undefined ? { internal_notes } : {}),
      })
      .eq('id', req.params.conversationId)
      .eq('business_id', req.businessId!)
      .select('*, customer:customers(*)')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (assigned_staff_id) {
      await admin.from('conversation_assignments').insert({
        business_id: req.businessId!,
        conversation_id: req.params.conversationId,
        staff_id: assigned_staff_id,
        assigned_by: req.user!.id,
      });
    }

    broadcastToBusiness(req.businessId!, 'conversation:updated', data);
    return res.json({ conversation: data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed.' });
  }
});

// Send Manual Staff Reply OR Trigger AI Reply
router.post('/businesses/:businessId/conversations/:conversationId/reply', requireAuth, requireBusinessAccess('inbox'), rateLimit(60, 60000), async (req: AuthedRequest, res) => {
  try {
    const admin = getSupabaseAdmin();
    const businessId = req.businessId!;
    const conversationId = req.params.conversationId;
    const { content, mode, attachmentUrl } = req.body as {
      content?: string;
      mode?: 'staff' | 'ai';
      attachmentUrl?: string;
    };

    const { data: conv } = await admin
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    if (mode === 'ai') {
      const { data: lastCustMsg } = await admin
        .from('messages')
        .select('content')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const aiOutcome = await processCustomerMessageWithAi({
        businessId,
        conversationId,
        customerMessage: content || lastCustMsg?.content || 'Hello',
        userId: req.user!.id,
      });

      if (!aiOutcome.replied) {
        return res.status(aiOutcome.insufficientCoins ? 402 : 400).json({
          error: aiOutcome.error || 'AI could not generate a reply.',
          insufficientCoins: aiOutcome.insufficientCoins,
        });
      }

      if (conv.channel !== 'web_test' && aiOutcome.replyText) {
        await dispatchChannelReply({
          businessId,
          channel: conv.channel,
          channelAccountId: conv.channel_account_id || '',
          recipientId: conv.external_thread_id,
          text: aiOutcome.replyText,
        });
      }

      return res.json(aiOutcome);
    }

    if (!content?.trim() && !attachmentUrl) {
      return res.status(400).json({ error: 'Message content is required.' });
    }

    let deliveryStatus = 'sent';
    let externalMsgId = '';
    if (conv.channel !== 'web_test' && content?.trim()) {
      const dispatch = await dispatchChannelReply({
        businessId,
        channel: conv.channel,
        channelAccountId: conv.channel_account_id || '',
        recipientId: conv.external_thread_id,
        text: content.trim(),
      });
      if (!dispatch.delivered) {
        deliveryStatus = 'failed';
      } else if (dispatch.externalMessageId) {
        externalMsgId = dispatch.externalMessageId;
      }
    }

    const { data: msg, error } = await admin
      .from('messages')
      .insert({
        business_id: businessId,
        conversation_id: conversationId,
        external_message_id: externalMsgId,
        sender_type: 'staff',
        sender_id: req.user!.id,
        content: content?.trim() || '',
        message_type: attachmentUrl ? 'image' : 'text',
        delivery_status: deliveryStatus,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (attachmentUrl) {
      await admin.from('message_attachments').insert({
        business_id: businessId,
        message_id: msg.id,
        file_url: attachmentUrl,
        file_type: 'image',
      });
    }

    await admin
      .from('conversations')
      .update({
        last_message: content?.trim() || '[Attachment]',
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    broadcastToBusiness(businessId, 'message:new', msg);
    return res.status(201).json({ message: msg });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send reply.' });
  }
});

// Live AI Customer Conversation Sandbox (Tests real Supabase products, KB, Bangla/Banglish AI, coin deduction & order creation)
router.post(
  '/businesses/:businessId/conversations/test-customer-message',
  requireAuth,
  requireBusinessAccess('inbox'),
  requireFeature('ai_chat'),
  rateLimit(40, 60000),
  async (req: AuthedRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      const businessId = req.businessId!;
      const { conversationId, customerName, channel, message } = req.body as {
        conversationId?: string;
        customerName?: string;
        channel?: 'facebook' | 'instagram' | 'whatsapp' | 'web_test';
        message?: string;
      };

      if (!message?.trim()) {
        return res.status(400).json({ error: 'Customer message text is required.' });
      }

      let targetConvId = conversationId;
      if (!targetConvId) {
        const { data: createdConv, error: convErr } = await admin
          .from('conversations')
          .insert({
            business_id: businessId,
            channel: channel || 'web_test',
            external_thread_id: `test_${Date.now()}`,
            customer_name: customerName?.trim() || 'Test Customer',
            last_message: message.trim(),
            last_message_at: new Date().toISOString(),
            unread_count: 1,
            ai_enabled: true,
          })
          .select('*')
          .single();
        if (convErr) return res.status(400).json({ error: convErr.message });
        targetConvId = createdConv.id;
        broadcastToBusiness(businessId, 'conversation:updated', createdConv);
      } else {
        await admin
          .from('conversations')
          .update({
            last_message: message.trim(),
            last_message_at: new Date().toISOString(),
          })
          .eq('id', targetConvId)
          .eq('business_id', businessId);
      }

      const { data: custMsg } = await admin
        .from('messages')
        .insert({
          business_id: businessId,
          conversation_id: targetConvId,
          sender_type: 'customer',
          content: message.trim(),
          message_type: 'text',
          delivery_status: 'delivered',
        })
        .select('*')
        .single();

      if (custMsg) {
        broadcastToBusiness(businessId, 'message:new', custMsg);
      }

      const aiResult = await processCustomerMessageWithAi({
        businessId,
        conversationId: targetConvId!,
        customerMessage: message.trim(),
        userId: req.user!.id,
      });

      return res.json({
        conversationId: targetConvId,
        customerMessage: custMsg,
        aiResult,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Test message failed.' });
    }
  }
);

export default router;
