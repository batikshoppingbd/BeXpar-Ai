import { getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { generateWithRouter } from './providerRouter.ts';
import { evaluateOrderRisk } from '../services/orderRisk.ts';
import { broadcastToBusiness } from '../services/realtimeBus.ts';
import { createNotification } from '../db/repository.ts';

interface StructuredAgentReply {
  reply_text: string;
  intent: string;
  should_handover: boolean;
  extracted_order?: {
    ready_to_create?: boolean;
    customer_name?: string;
    customer_phone?: string;
    customer_address?: string;
    items?: Array<{
      product_id?: string;
      product_name?: string;
      quantity?: number;
      color?: string;
      size?: string;
    }>;
  };
}

export async function processCustomerMessageWithAi(params: {
  businessId: string;
  conversationId: string;
  customerMessage: string;
  userId?: string | null;
}): Promise<{
  replied: boolean;
  messageId?: string;
  replyText?: string;
  orderCreatedId?: string;
  error?: string;
  insufficientCoins?: boolean;
}> {
  const admin = getSupabaseAdmin();

  // 1. Check conversation & AI settings
  const { data: conv } = await admin
    .from('conversations')
    .select('*')
    .eq('id', params.conversationId)
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (!conv) return { replied: false, error: 'Conversation not found.' };
  if (!conv.ai_enabled) return { replied: false };
  if (conv.ai_paused_until && new Date(conv.ai_paused_until).getTime() > Date.now()) {
    return { replied: false };
  }

  const { data: aiSettings } = await admin
    .from('ai_settings')
    .select('*')
    .eq('business_id', params.businessId)
    .maybeSingle();

  if (aiSettings && (!aiSettings.is_available || !aiSettings.auto_reply_enabled)) {
    return { replied: false };
  }

  // 2. Check Coin Wallet before making paid AI call
  const { data: wallet } = await admin
    .from('coin_wallets')
    .select('balance')
    .eq('business_id', params.businessId)
    .maybeSingle();

  const currentBalance = Number(wallet?.balance || 0);
  if (currentBalance <= 0) {
    await admin.from('ai_usage_logs').insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: 'system',
      model_id: 'none',
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      provider_cost_usd: 0,
      coins_deducted: 0,
      status: 'blocked_insufficient_coins',
      error_message: 'Insufficient AI coin balance. Please recharge coins.',
    });

    await createNotification({
      businessId: params.businessId,
      title: 'AI Coins Exhausted',
      body: 'AI auto-reply was paused because your coin wallet balance reached 0. Recharge coins to resume.',
      type: 'warning',
      link: 'wallet',
    });

    return {
      replied: false,
      insufficientCoins: true,
      error: 'Insufficient AI coins. Please recharge your coin wallet.',
    };
  }

  // 3. Load real business catalog, knowledge base, and recent messages
  const [{ data: business }, { data: products }, { data: kbEntries }, { data: history }] = await Promise.all([
    admin.from('businesses').select('name, category, phone, address').eq('id', params.businessId).maybeSingle(),
    admin
      .from('products')
      .select('id, name, sku, description, regular_price, discount_price, stock_quantity, colors, sizes, status, category_name')
      .eq('business_id', params.businessId)
      .neq('status', 'draft')
      .limit(100),
    admin
      .from('ai_knowledge_base')
      .select('category, title, content')
      .eq('business_id', params.businessId)
      .eq('is_enabled', true)
      .limit(50),
    admin
      .from('messages')
      .select('sender_type, content, created_at')
      .eq('conversation_id', params.conversationId)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const orderedHistory = (history || []).reverse();
  const trailingCustomerMsgs: string[] = [];
  for (let i = orderedHistory.length - 1; i >= 0; i--) {
    if (orderedHistory[i].sender_type === 'customer') {
      const txt = String(orderedHistory[i].content || '').trim();
      if (txt) trailingCustomerMsgs.unshift(txt);
    } else {
      break;
    }
  }
  const combinedLatestCustomerMsg =
    trailingCustomerMsgs.length > 1
      ? trailingCustomerMsgs.join('\n')
      : params.customerMessage;
  const defaultDelivery = Number(aiSettings?.order_collection_rules?.default_delivery_charge ?? 60);

  const systemInstruction = `You are "${aiSettings?.agent_name || 'BeXpar Assistant'}", the official AI Customer Service & Sales Agent for "${business?.name || 'our store'}" (${business?.category || ''}) on channel: ${conv.channel}.

LANGUAGE & TONE:
- Understand and reply fluently in Bangla, Banglish (Romanized Bengali), or English—always matching the customer's language naturally.
- Configured tone: ${aiSettings?.reply_tone || 'friendly_professional'}. Language preference: ${aiSettings?.language || 'bn-en'}.
- Answer ONLY what the customer asks, clearly and concisely, without unnecessary sales pitches or repeating already-answered questions.

STRICT ACCURACY & GROUNDING RULES (NEVER VIOLATE):
1. Retrieve prices, discounts, stock, colors, sizes, and policies ONLY from the ACTUAL DATABASE RECORDS below.
2. NEVER invent product prices, discount prices, stock availability, colors, sizes, delivery charges, or policies.
3. If the requested information or product is not found in the records below, honestly inform the customer that a human team member will confirm shortly, and set "should_handover": true.
4. For orders: collect missing required fields (Customer Name, Phone Number, Full Delivery Address, Product, Quantity, Color/Size if product has variants). Ask ONLY for missing information.
5. Set "extracted_order.ready_to_create": true ONLY when you have Customer Name, valid Phone Number, Full Delivery Address, and at least one matched product_id from the catalog with stock > 0, and the customer has confirmed or clearly placed the order.
6. Standard default delivery charge (unless specified in Knowledge Base): ${defaultDelivery} BDT.

STORE CONTACT & LOCATION:
- Store Name: ${business?.name || 'Our Store'}
- Category: ${business?.category || 'General'}
- Phone: ${business?.phone || 'Not provided'}
- Address / Location: ${business?.address || 'Not provided'}

CUSTOM BUSINESS INSTRUCTIONS:
${aiSettings?.system_instructions || 'Be helpful, polite, and accurate.'}
${aiSettings?.business_rules ? `BUSINESS RULES:\n${aiSettings.business_rules}` : ''}

ACTUAL PRODUCT CATALOG (JSON):
${JSON.stringify(products || [])}

KNOWLEDGE BASE & POLICIES (JSON):
${JSON.stringify(kbEntries || [])}

RETURN STRICT JSON ONLY matching this schema:
{
  "reply_text": "string",
  "intent": "general_inquiry | product_question | order_intent | order_confirmation | human_handover",
  "should_handover": boolean,
  "extracted_order": {
    "ready_to_create": boolean,
    "customer_name": "string",
    "customer_phone": "string",
    "customer_address": "string",
    "items": [{ "product_id": "uuid", "product_name": "string", "quantity": number, "color": "string", "size": "string" }]
  }
}`;

  const prompt = `CONVERSATION HISTORY:\n${orderedHistory
    .map((m) => `[${m.sender_type.toUpperCase()}]: ${m.content}`)
    .join('\n')}\n\nLATEST CUSTOMER MESSAGE:\n${combinedLatestCustomerMsg}`;

  let genResult;
  try {
    genResult = await generateWithRouter({
      systemInstruction,
      prompt,
      expectJson: true,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin.from('ai_usage_logs').insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: 'router',
      model_id: 'none',
      status: 'error',
      error_message: errMsg,
    });
    return { replied: false, error: errMsg };
  }

  // 4. Deduct coins atomically
  const { data: deductRows, error: deductErr } = await admin.rpc('deduct_ai_coins_atomic', {
    p_business_id: params.businessId,
    p_amount: genResult.coinsRequired,
    p_description: `AI reply (${genResult.modelId}) - ${genResult.totalTokens} tokens`,
    p_reference_id: params.conversationId,
    p_user_id: params.userId || null,
  });

  const deductRes = Array.isArray(deductRows) ? deductRows[0] : deductRows;
  if (deductErr || !deductRes?.success) {
    await admin.from('ai_usage_logs').insert({
      business_id: params.businessId,
      user_id: params.userId || null,
      conversation_id: params.conversationId,
      provider_slug: genResult.providerSlug,
      model_id: genResult.modelId,
      input_tokens: genResult.inputTokens,
      output_tokens: genResult.outputTokens,
      total_tokens: genResult.totalTokens,
      provider_cost_usd: genResult.providerCostUsd,
      coins_deducted: 0,
      status: 'blocked_insufficient_coins',
      error_message: deductRes?.message || deductErr?.message || 'Insufficient coins',
    });
    return {
      replied: false,
      insufficientCoins: true,
      error: deductRes?.message || 'Insufficient AI coins.',
    };
  }

  // Record successful AI usage log
  await admin.from('ai_usage_logs').insert({
    business_id: params.businessId,
    user_id: params.userId || null,
    conversation_id: params.conversationId,
    provider_slug: genResult.providerSlug,
    model_id: genResult.modelId,
    input_tokens: genResult.inputTokens,
    output_tokens: genResult.outputTokens,
    total_tokens: genResult.totalTokens,
    provider_cost_usd: genResult.providerCostUsd,
    coins_deducted: genResult.coinsRequired,
    status: 'success',
  });

  broadcastToBusiness(params.businessId, 'wallet:updated', { balance: deductRes.new_balance });

  // 5. Parse structured AI JSON
  let parsed: StructuredAgentReply = {
    reply_text: genResult.text,
    intent: 'general_inquiry',
    should_handover: false,
  };
  try {
    const cleaned = genResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned) as StructuredAgentReply;
  } catch {
    parsed = {
      reply_text: genResult.text,
      intent: 'general_inquiry',
      should_handover: false,
    };
  }

  // 6. Save AI reply message
  const { data: savedAiMsg } = await admin
    .from('messages')
    .insert({
      business_id: params.businessId,
      conversation_id: params.conversationId,
      sender_type: 'ai',
      content: parsed.reply_text,
      message_type: 'text',
      delivery_status: 'sent',
      metadata: {
        model_id: genResult.modelId,
        provider: genResult.providerSlug,
        tokens: genResult.totalTokens,
        coins_deducted: genResult.coinsRequired,
        intent: parsed.intent,
      },
    })
    .select('*')
    .single();

  const shouldPauseAi = Boolean(
    parsed.should_handover &&
      parsed.intent === 'human_handover' &&
      aiSettings?.human_handover_enabled
  );

  const { data: updatedConv } = await admin
    .from('conversations')
    .update({
      last_message: parsed.reply_text,
      last_message_at: new Date().toISOString(),
      ...(shouldPauseAi ? { ai_enabled: false } : {}),
    })
    .eq('id', params.conversationId)
    .select('*, customer:customers(*)')
    .single();

  if (savedAiMsg) {
    broadcastToBusiness(params.businessId, 'message:new', savedAiMsg);
  }
  if (updatedConv) {
    broadcastToBusiness(params.businessId, 'conversation:updated', updatedConv);
  }

  // 7. Automatic Order Creation if ready_to_create & valid
  let orderCreatedId: string | undefined;
  const orderData = parsed.extracted_order;
  if (
    aiSettings?.order_collection_enabled !== false &&
    orderData?.ready_to_create &&
    orderData.customer_name &&
    orderData.customer_phone &&
    orderData.customer_address &&
    Array.isArray(orderData.items) &&
    orderData.items.length > 0
  ) {
    // Prevent duplicate order creation within 3 minutes from same conversation
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: existingDup } = await admin
      .from('orders')
      .select('id')
      .eq('business_id', params.businessId)
      .eq('conversation_id', params.conversationId)
      .gte('created_at', threeMinAgo)
      .limit(1);

    if (!existingDup || existingDup.length === 0) {
      const catalogMap = new Map((products || []).map((p) => [p.id, p]));
      const validItems: Array<{
        product_id: string;
        product_name: string;
        sku: string;
        variant_color: string;
        variant_size: string;
        quantity: number;
        unit_price: number;
        unit_cost: number;
        total_price: number;
      }> = [];

      let subtotal = 0;
      for (const item of orderData.items) {
        const prod =
          (item.product_id ? catalogMap.get(item.product_id) : undefined) ||
          (products || []).find((p) => p.name.toLowerCase() === (item.product_name || '').toLowerCase());
        if (!prod) continue;
        const qty = Math.max(1, Number(item.quantity || 1));
        const unitPrice = Number(prod.discount_price ?? prod.regular_price ?? 0);
        const totalPrice = unitPrice * qty;
        subtotal += totalPrice;
        validItems.push({
          product_id: prod.id,
          product_name: prod.name,
          sku: prod.sku || '',
          variant_color: item.color || '',
          variant_size: item.size || '',
          quantity: qty,
          unit_price: unitPrice,
          unit_cost: 0,
          total_price: totalPrice,
        });
      }

      if (validItems.length > 0) {
        // Upsert customer
        let customerId = conv.customer_id as string | null;
        if (!customerId) {
          const { data: existingCust } = await admin
            .from('customers')
            .select('id')
            .eq('business_id', params.businessId)
            .eq('phone', orderData.customer_phone)
            .maybeSingle();

          if (existingCust) {
            customerId = existingCust.id;
          } else {
            const { data: newCust } = await admin
              .from('customers')
              .insert({
                business_id: params.businessId,
                name: orderData.customer_name,
                phone: orderData.customer_phone,
                address: orderData.customer_address,
              })
              .select('id')
              .single();
            customerId = newCust?.id || null;
          }
        }

        const totalAmount = subtotal + defaultDelivery;
        const risk = await evaluateOrderRisk({
          businessId: params.businessId,
          customerPhone: orderData.customer_phone,
          totalAmount,
        });

        const orderNumber = `BX-${Date.now().toString().slice(-6)}`;
        const { data: createdOrder } = await admin
          .from('orders')
          .insert({
            business_id: params.businessId,
            order_number: orderNumber,
            customer_id: customerId,
            conversation_id: params.conversationId,
            customer_name: orderData.customer_name,
            customer_phone: orderData.customer_phone,
            customer_address: orderData.customer_address,
            subtotal,
            discount: 0,
            delivery_charge: defaultDelivery,
            total_amount: totalAmount,
            payment_method: 'cod',
            payment_status: 'unpaid',
            order_status: 'pending',
            order_source: 'ai_agent',
            risk_level: risk.riskLevel,
            risk_reasons: risk.reasons,
          })
          .select('*')
          .single();

        if (createdOrder) {
          orderCreatedId = createdOrder.id;
          await admin.from('order_items').insert(
            validItems.map((it) => ({
              business_id: params.businessId,
              order_id: createdOrder.id,
              ...it,
            }))
          );
          await admin.from('order_status_history').insert({
            business_id: params.businessId,
            order_id: createdOrder.id,
            old_status: '',
            new_status: 'pending',
            note: 'Automatically collected by BeXpar Ai Agent',
          });
          if (customerId) {
            await admin
              .from('conversations')
              .update({ customer_id: customerId })
              .eq('id', params.conversationId);
          }
          broadcastToBusiness(params.businessId, 'order:created', createdOrder);
        }
      }
    }
  }

  return {
    replied: true,
    messageId: savedAiMsg?.id,
    replyText: parsed.reply_text,
    orderCreatedId,
  };
}
