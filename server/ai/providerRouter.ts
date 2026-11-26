import { GoogleGenAI, Type } from '@google/genai';
import { decryptSecret, getSupabaseAdmin } from '../config/supabaseConfig.ts';

export interface AiModelConfig {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  is_fallback: boolean;
  priority: number;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  coins_per_usd: number;
  max_tokens: number;
  min_plan_slug: string;
  provider: {
    id: string;
    slug: string;
    name: string;
    provider_type: 'gemini' | 'openai' | 'deepseek' | 'custom';
    base_url: string;
    api_key_encrypted: string;
    is_active: boolean;
  };
}

export interface AiGenerationResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerSlug: string;
  modelId: string;
  providerCostUsd: number;
  coinsRequired: number;
}

const DEFAULT_PROVIDER_ROWS = [
  { slug: 'gemini', name: 'Google Gemini', provider_type: 'gemini', base_url: '', is_active: true, priority: 1 },
  {
    slug: 'openai',
    name: 'OpenAI GPT',
    provider_type: 'openai',
    base_url: 'https://api.openai.com/v1',
    is_active: false,
    priority: 2,
  },
  {
    slug: 'deepseek',
    name: 'DeepSeek AI',
    provider_type: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    is_active: false,
    priority: 3,
  },
] as const;

const DEFAULT_MODEL_BY_TYPE: Record<
  'gemini' | 'openai' | 'deepseek' | 'custom',
  Array<{
    model_id: string;
    display_name: string;
    is_default: boolean;
    is_fallback: boolean;
    priority: number;
    input_cost_per_1m: number;
    output_cost_per_1m: number;
    max_tokens: number;
  }>
> = {
  gemini: [
    {
      model_id: 'gemini-2.5-flash',
      display_name: 'Gemini 2.5 Flash (Fast & Bilingual)',
      is_default: true,
      is_fallback: false,
      priority: 1,
      input_cost_per_1m: 0.15,
      output_cost_per_1m: 0.6,
      max_tokens: 2048,
    },
    {
      model_id: 'gemini-2.5-pro',
      display_name: 'Gemini 2.5 Pro (Advanced Reasoning)',
      is_default: false,
      is_fallback: true,
      priority: 2,
      input_cost_per_1m: 1.25,
      output_cost_per_1m: 5.0,
      max_tokens: 4096,
    },
  ],
  openai: [
    {
      model_id: 'gpt-4o-mini',
      display_name: 'GPT-4o Mini',
      is_default: false,
      is_fallback: false,
      priority: 3,
      input_cost_per_1m: 0.15,
      output_cost_per_1m: 0.6,
      max_tokens: 2048,
    },
  ],
  deepseek: [
    {
      model_id: 'deepseek-chat',
      display_name: 'DeepSeek V3 Chat',
      is_default: false,
      is_fallback: false,
      priority: 4,
      input_cost_per_1m: 0.27,
      output_cost_per_1m: 1.1,
      max_tokens: 2048,
    },
  ],
  custom: [],
};

export async function ensureDefaultAiProvidersAndModels(): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: existingProviders } = await admin.from('ai_providers').select('id, slug, provider_type, is_active');
  let providers = existingProviders || [];

  if (providers.length === 0) {
    await admin.from('ai_providers').upsert([...DEFAULT_PROVIDER_ROWS], { onConflict: 'slug', ignoreDuplicates: true });
    const refreshed = await admin.from('ai_providers').select('id, slug, provider_type, is_active');
    providers = refreshed.data || [];
  }

  const { data: existingModels } = await admin.from('ai_models').select('id, provider_id, model_id, is_default');
  const models = existingModels || [];

  // Auto-seed default models if table is empty OR if Gemini only has legacy non-public model IDs
  const hasAnyDefault = models.some((m) => m.is_default);
  if (models.length === 0) {
    const toInsert: Array<Record<string, unknown>> = [];
    for (const p of providers) {
      const pType = p.provider_type as 'gemini' | 'openai' | 'deepseek' | 'custom';
      const templates = DEFAULT_MODEL_BY_TYPE[pType] || [];
      for (const tpl of templates) {
        toInsert.push({
          provider_id: p.id,
          model_id: tpl.model_id,
          display_name: tpl.display_name,
          is_active: true,
          is_default: tpl.is_default && !hasAnyDefault,
          is_fallback: tpl.is_fallback,
          priority: tpl.priority,
          input_cost_per_1m: tpl.input_cost_per_1m,
          output_cost_per_1m: tpl.output_cost_per_1m,
          coins_per_usd: 1000,
          max_tokens: tpl.max_tokens,
          min_plan_slug: 'free',
        });
      }
    }
    if (toInsert.length > 0) {
      await admin.from('ai_models').upsert(toInsert, { onConflict: 'provider_id,model_id', ignoreDuplicates: true });
    }
  } else {
    // If Gemini provider exists and only has legacy gemini-4-* model IDs, ensure gemini-2.5-flash exists
    const geminiProv = providers.find((p) => p.provider_type === 'gemini');
    if (geminiProv) {
      const geminiModels = models.filter((m) => m.provider_id === geminiProv.id);
      const onlyLegacy =
        geminiModels.length > 0 && geminiModels.every((m) => String(m.model_id).startsWith('gemini-4-'));
      if (geminiModels.length === 0 || onlyLegacy) {
        const flashTpl = DEFAULT_MODEL_BY_TYPE.gemini[0];
        await admin.from('ai_models').upsert(
          {
            provider_id: geminiProv.id,
            model_id: flashTpl.model_id,
            display_name: flashTpl.display_name,
            is_active: true,
            is_default: !hasAnyDefault || onlyLegacy,
            is_fallback: false,
            priority: 1,
            input_cost_per_1m: flashTpl.input_cost_per_1m,
            output_cost_per_1m: flashTpl.output_cost_per_1m,
            coins_per_usd: 1000,
            max_tokens: flashTpl.max_tokens,
            min_plan_slug: 'free',
          },
          { onConflict: 'provider_id,model_id', ignoreDuplicates: true }
        );
        if (onlyLegacy) {
          await admin
            .from('ai_models')
            .update({ is_default: false })
            .eq('provider_id', geminiProv.id)
            .neq('model_id', 'gemini-2.5-flash');
          await admin
            .from('ai_models')
            .update({ is_default: true })
            .eq('provider_id', geminiProv.id)
            .eq('model_id', 'gemini-2.5-flash');
        }
      }
    }
  }
}

export async function ensureDefaultModelForProvider(provider: {
  id: string;
  provider_type: 'gemini' | 'openai' | 'deepseek' | 'custom';
  name: string;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: existingForProv } = await admin.from('ai_models').select('id').eq('provider_id', provider.id).limit(1);
  if (existingForProv && existingForProv.length > 0) return;

  const { data: anyDefault } = await admin.from('ai_models').select('id').eq('is_default', true).limit(1);
  const templates = DEFAULT_MODEL_BY_TYPE[provider.provider_type] || [];
  if (templates.length === 0) return;

  const first = templates[0];
  await admin.from('ai_models').upsert(
    {
      provider_id: provider.id,
      model_id: first.model_id,
      display_name: first.display_name,
      is_active: true,
      is_default: !anyDefault || anyDefault.length === 0,
      is_fallback: first.is_fallback,
      priority: first.priority,
      input_cost_per_1m: first.input_cost_per_1m,
      output_cost_per_1m: first.output_cost_per_1m,
      coins_per_usd: 1000,
      max_tokens: first.max_tokens,
      min_plan_slug: 'free',
    },
    { onConflict: 'provider_id,model_id', ignoreDuplicates: true }
  );
}

export async function getOrderedActiveModels(): Promise<AiModelConfig[]> {
  const admin = getSupabaseAdmin();
  const queryModels = async () =>
    admin
      .from('ai_models')
      .select('*, provider:ai_providers!inner(*)')
      .eq('is_active', true)
      .eq('provider.is_active', true)
      .order('is_default', { ascending: false })
      .order('priority', { ascending: true });

  let { data, error } = await queryModels();
  if (!error && (!data || data.length === 0)) {
    await ensureDefaultAiProvidersAndModels();
    const retry = await queryModels();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) return [];
  return data as unknown as AiModelConfig[];
}

function getProviderApiKey(model: AiModelConfig): string {
  const decrypted = decryptSecret(model.provider.api_key_encrypted || '');
  if (decrypted) return decrypted;
  if (model.provider.provider_type === 'gemini') {
    return process.env.GEMINI_API_KEY || '';
  }
  return '';
}

async function callSingleModel(
  model: AiModelConfig,
  params: {
    systemInstruction: string;
    prompt: string;
    expectJson?: boolean;
    overrideApiKey?: string;
    overrideBaseUrl?: string;
  }
): Promise<AiGenerationResult> {
  const apiKey = params.overrideApiKey?.trim() || getProviderApiKey(model);
  if (!apiKey) {
    throw new Error(`No API key configured for provider ${model.provider.name}.`);
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (model.provider.provider_type === 'gemini') {
    const ai = new GoogleGenAI({ apiKey });

    const runGemini = async (withSchema: boolean) =>
      ai.models.generateContent({
        model: model.model_id,
        contents: params.prompt,
        config: {
          systemInstruction: params.systemInstruction,
          ...(withSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    reply_text: { type: Type.STRING },
                    intent: { type: Type.STRING },
                    should_handover: { type: Type.BOOLEAN },
                    extracted_order: {
                      type: Type.OBJECT,
                      properties: {
                        ready_to_create: { type: Type.BOOLEAN },
                        customer_name: { type: Type.STRING },
                        customer_phone: { type: Type.STRING },
                        customer_address: { type: Type.STRING },
                        items: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              product_id: { type: Type.STRING },
                              product_name: { type: Type.STRING },
                              quantity: { type: Type.INTEGER },
                              color: { type: Type.STRING },
                              size: { type: Type.STRING },
                            },
                          },
                        },
                      },
                    },
                  },
                  required: ['reply_text', 'intent', 'should_handover'],
                },
              }
            : {}),
        },
      });

    let response;
    try {
      response = await runGemini(Boolean(params.expectJson));
    } catch (err) {
      if (params.expectJson) {
        // Retry without strict responseSchema in case the model doesn't support structured schema
        response = await runGemini(false);
      } else {
        throw err;
      }
    }

    text = response.text || '';
    inputTokens = response.usageMetadata?.promptTokenCount || 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
  } else {
    // OpenAI / DeepSeek / Custom OpenAI-compatible API
    const rawBase = params.overrideBaseUrl?.trim() || model.provider.base_url || '';
    const baseUrl =
      rawBase.replace(/\/+$/, '') ||
      (model.provider.provider_type === 'deepseek'
        ? 'https://api.deepseek.com/v1'
        : 'https://api.openai.com/v1');

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.model_id,
        messages: [
          { role: 'system', content: params.systemInstruction },
          { role: 'user', content: params.prompt },
        ],
        max_tokens: model.max_tokens || 2048,
        ...(params.expectJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${model.provider.name} API error (${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    text = json.choices?.[0]?.message?.content || '';
    inputTokens = json.usage?.prompt_tokens || 0;
    outputTokens = json.usage?.completion_tokens || 0;
  }

  const totalTokens = inputTokens + outputTokens;
  const providerCostUsd =
    (inputTokens * Number(model.input_cost_per_1m)) / 1_000_000 +
    (outputTokens * Number(model.output_cost_per_1m)) / 1_000_000;
  const coinsRequired = Math.max(0.01, Number((providerCostUsd * Number(model.coins_per_usd)).toFixed(4)));

  return {
    text,
    inputTokens,
    outputTokens,
    totalTokens,
    providerSlug: model.provider.slug,
    modelId: model.model_id,
    providerCostUsd,
    coinsRequired,
  };
}

export async function generateWithRouter(params: {
  systemInstruction: string;
  prompt: string;
  expectJson?: boolean;
  preferredModelId?: string;
}): Promise<AiGenerationResult> {
  const models = await getOrderedActiveModels();
  if (models.length === 0) {
    throw new Error('No active AI models configured. Please configure an AI model in Super Admin → AI Management.');
  }

  let ordered = [...models];
  if (params.preferredModelId) {
    const idx = ordered.findIndex((m) => m.model_id === params.preferredModelId);
    if (idx > 0) {
      const [picked] = ordered.splice(idx, 1);
      ordered.unshift(picked);
    }
  }

  // Put models whose provider actually has an API key configured first, then fallbacks
  const withKey = ordered.filter((m) => Boolean(getProviderApiKey(m)));
  const candidates = withKey.length > 0 ? withKey : ordered;

  const defaultAndNormal = candidates.filter((m) => !m.is_fallback);
  const fallbacks = candidates.filter((m) => m.is_fallback);
  const executionQueue = [...defaultAndNormal, ...fallbacks];

  let lastError: Error | null = null;
  for (const candidate of executionQueue) {
    try {
      return await callSingleModel(candidate, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Router] Model ${candidate.model_id} (${candidate.provider.slug}) failed:`, lastError.message);
    }
  }

  throw lastError || new Error('All configured AI providers failed.');
}

export async function testModelConnection(modelDbId: string): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: model, error } = await admin
    .from('ai_models')
    .select('*, provider:ai_providers!inner(*)')
    .eq('id', modelDbId)
    .maybeSingle();

  if (error || !model) {
    return { ok: false, latencyMs: 0, error: 'Model not found.' };
  }

  const start = Date.now();
  try {
    const result = await callSingleModel(model as unknown as AiModelConfig, {
      systemInstruction: 'Reply concisely with OK.',
      prompt: 'Health check ping. Reply with OK.',
      expectJson: false,
    });
    return {
      ok: true,
      latencyMs: Date.now() - start,
      sample: result.text.slice(0, 120),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function testProviderConnection(
  providerDbId: string,
  overrides?: { apiKey?: string; baseUrl?: string; modelId?: string }
): Promise<{ ok: boolean; latencyMs: number; modelId: string; sample?: string; error?: string }> {
  const admin = getSupabaseAdmin();
  const { data: provider, error } = await admin.from('ai_providers').select('*').eq('id', providerDbId).maybeSingle();
  if (error || !provider) {
    return { ok: false, latencyMs: 0, modelId: '', error: 'Provider not found.' };
  }

  const { data: providerModels } = await admin
    .from('ai_models')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('priority', { ascending: true })
    .limit(5);

  const pType = provider.provider_type as 'gemini' | 'openai' | 'deepseek' | 'custom';
  const fallbackModelId =
    pType === 'gemini' ? 'gemini-2.5-flash' : pType === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  const pickedModel =
    (providerModels || []).find((m) => !String(m.model_id).startsWith('gemini-4-')) ||
    (providerModels || [])[0];

  const modelId = overrides?.modelId?.trim() || pickedModel?.model_id || fallbackModelId;

  const syntheticModel: AiModelConfig = {
    id: pickedModel?.id || provider.id,
    provider_id: provider.id,
    model_id: modelId,
    display_name: pickedModel?.display_name || modelId,
    is_active: true,
    is_default: true,
    is_fallback: false,
    priority: 1,
    input_cost_per_1m: Number(pickedModel?.input_cost_per_1m ?? 0.15),
    output_cost_per_1m: Number(pickedModel?.output_cost_per_1m ?? 0.6),
    coins_per_usd: Number(pickedModel?.coins_per_usd ?? 1000),
    max_tokens: Number(pickedModel?.max_tokens ?? 256),
    min_plan_slug: 'free',
    provider: {
      id: provider.id,
      slug: provider.slug,
      name: provider.name,
      provider_type: pType,
      base_url: provider.base_url || '',
      api_key_encrypted: provider.api_key_encrypted || '',
      is_active: true,
    },
  };

  const start = Date.now();
  try {
    const result = await callSingleModel(syntheticModel, {
      systemInstruction: 'Reply concisely with OK.',
      prompt: 'Health check ping. Reply with OK.',
      expectJson: false,
      overrideApiKey: overrides?.apiKey,
      overrideBaseUrl: overrides?.baseUrl,
    });
    return {
      ok: true,
      latencyMs: Date.now() - start,
      modelId,
      sample: result.text.slice(0, 120),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      modelId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
