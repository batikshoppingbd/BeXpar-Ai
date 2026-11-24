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

export async function getOrderedActiveModels(): Promise<AiModelConfig[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('ai_models')
    .select('*, provider:ai_providers!inner(*)')
    .eq('is_active', true)
    .eq('provider.is_active', true)
    .order('is_default', { ascending: false })
    .order('priority', { ascending: true });

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
  }
): Promise<AiGenerationResult> {
  const apiKey = getProviderApiKey(model);
  if (!apiKey) {
    throw new Error(`No API key configured for provider ${model.provider.name}.`);
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (model.provider.provider_type === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const response = await ai.models.generateContent({
      model: model.model_id,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        ...(params.expectJson
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

    text = response.text || '';
    inputTokens = response.usageMetadata?.promptTokenCount || 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
  } else {
    // OpenAI / DeepSeek / Custom OpenAI-compatible API
    const baseUrl =
      model.provider.base_url?.replace(/\/+$/, '') ||
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

  // Ensure fallback models are tried after default if default fails
  const defaultAndNormal = ordered.filter((m) => !m.is_fallback);
  const fallbacks = ordered.filter((m) => m.is_fallback);
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
