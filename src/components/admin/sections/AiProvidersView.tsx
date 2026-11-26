import React, { useEffect, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Plus, Sparkles, Trash2, Zap } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import type { AdminAiModel, AdminAiProvider } from '../adminTypes';
import { AdminModal, ConfirmDialog, EmptyState, StatusBadge } from '../ui/AdminPrimitives';

export const AiProvidersView: React.FC<{
  lang: Lang;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ lang, onNotify, onError }) => {
  const [providers, setProviders] = useState<AdminAiProvider[]>([]);
  const [models, setModels] = useState<AdminAiModel[]>([]);
  const [usageLogs, setUsageLogs] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [baseUrlInputs, setBaseUrlInputs] = useState<Record<string, string>>({});
  const [savingProviderId, setSavingProviderId] = useState<string | null>(null);
  const [togglingProviderId, setTogglingProviderId] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [providerFeedback, setProviderFeedback] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const [newProviderOpen, setNewProviderOpen] = useState(false);
  const [creatingProvider, setCreatingProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    slug: '',
    name: '',
    provider_type: 'custom' as 'gemini' | 'openai' | 'deepseek' | 'custom',
    base_url: '',
    api_key: '',
    priority: 4,
  });

  const [newModel, setNewModel] = useState({
    provider_id: '',
    model_id: '',
    display_name: '',
    input_cost_per_1m: 0.15,
    output_cost_per_1m: 0.6,
    coins_per_usd: 1000,
    max_tokens: 2048,
    min_plan_slug: 'free',
  });
  const [addingModel, setAddingModel] = useState(false);
  const [modelFormError, setModelFormError] = useState('');
  const [editingModel, setEditingModel] = useState<AdminAiModel | null>(null);
  const [savingEditModel, setSavingEditModel] = useState(false);
  const [deleteModelTarget, setDeleteModelTarget] = useState<AdminAiModel | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        providers: AdminAiProvider[];
        models: AdminAiModel[];
        usageLogs: Array<Record<string, unknown>>;
      }>('/api/admin/ai');
      setProviders(res.providers || []);
      setModels(res.models || []);
      setUsageLogs(res.usageLogs || []);
      if ((res.providers || []).length > 0 && !newModel.provider_id) {
        setNewModel((m) => ({ ...m, provider_id: res.providers[0].id }));
      }
      const urls: Record<string, string> = {};
      for (const p of res.providers || []) {
        urls[p.id] = p.base_url || '';
      }
      setBaseUrlInputs(urls);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load AI providers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaveProvider = async (p: AdminAiProvider) => {
    const cleanKey = (keyInputs[p.id] || '').trim();
    const cleanUrl = p.provider_type !== 'gemini' ? (baseUrlInputs[p.id] ?? '').trim() : undefined;
    const urlChanged = p.provider_type !== 'gemini' && cleanUrl !== (p.base_url || '');

    if (!cleanKey && !urlChanged) {
      const msg = lang === 'bn' ? 'আগে আপনার API Key পেস্ট করুন।' : 'Please paste your API key before clicking Save.';
      setProviderFeedback((prev) => ({ ...prev, [p.id]: { ok: false, msg } }));
      onError(msg);
      return;
    }

    setSavingProviderId(p.id);
    setProviderFeedback((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    try {
      await apiFetch(`/api/admin/ai/providers/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          api_key: cleanKey || undefined,
          base_url: urlChanged ? cleanUrl : undefined,
        }),
      });
      setKeyInputs((prev) => ({ ...prev, [p.id]: '' }));
      const msg =
        lang === 'bn'
          ? `${p.name}-এর API Key সেভ ও সক্রিয় করা হয়েছে।`
          : `Saved & activated ${p.name} configuration.`;
      setProviderFeedback((prev) => ({ ...prev, [p.id]: { ok: true, msg } }));
      onNotify(msg);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save provider.';
      setProviderFeedback((prev) => ({ ...prev, [p.id]: { ok: false, msg } }));
      onError(msg);
    } finally {
      setSavingProviderId(null);
    }
  };

  const handleTestProvider = async (p: AdminAiProvider) => {
    const cleanKey = (keyInputs[p.id] || '').trim();
    if (!cleanKey && !p.has_api_key) {
      const msg = lang === 'bn' ? 'টেস্ট করার আগে API Key দিন।' : 'Paste an API key first to test the connection.';
      setProviderFeedback((prev) => ({ ...prev, [p.id]: { ok: false, msg } }));
      return;
    }

    setTestingProviderId(p.id);
    setProviderFeedback((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    try {
      const res = await apiFetch<{ ok: boolean; latencyMs: number; modelId?: string; sample?: string; error?: string }>(
        `/api/admin/ai/providers/${p.id}/test`,
        {
          method: 'POST',
          body: JSON.stringify({
            api_key: cleanKey || undefined,
            base_url: p.provider_type !== 'gemini' ? (baseUrlInputs[p.id] || '').trim() || undefined : undefined,
          }),
        }
      );
      setProviderFeedback((prev) => ({
        ...prev,
        [p.id]: {
          ok: res.ok,
          msg: res.ok
            ? `Connected (${res.latencyMs}ms · ${res.modelId || p.provider_type}): ${res.sample || 'OK'}`
            : `Connection failed: ${res.error || 'Unknown error'}`,
        },
      }));
    } catch (err) {
      setProviderFeedback((prev) => ({
        ...prev,
        [p.id]: {
          ok: false,
          msg: err instanceof Error ? err.message : 'Provider connection test failed.',
        },
      }));
    } finally {
      setTestingProviderId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Providers Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#5B35F5]" />
            <span>{adminT(lang, 'providersTitle')}</span>
          </h2>
          <p className="text-xs text-[#7C8499] dark:text-slate-400">
            API keys are encrypted server-side and never exposed back to the browser.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewProviderOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Provider</span>
        </button>
      </div>

      {/* Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {providers.map((p) => {
          const fb = providerFeedback[p.id];
          const isSaving = savingProviderId === p.id;
          const isTesting = testingProviderId === p.id;
          const isToggling = togglingProviderId === p.id;
          const showKey = Boolean(showKeys[p.id]);

          return (
            <div
              key={p.id}
              className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-display font-bold text-[#101536] dark:text-white">{p.name}</div>
                  <div className="text-[11px] font-mono text-[#7C8499]">
                    {p.provider_type} · priority #{p.priority}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={p.has_api_key ? 'active' : 'inactive'}
                    label={p.has_api_key ? adminT(lang, 'configured') : adminT(lang, 'notConfigured')}
                  />
                  <button
                    type="button"
                    disabled={isToggling}
                    onClick={async () => {
                      setTogglingProviderId(p.id);
                      try {
                        await apiFetch(`/api/admin/ai/providers/${p.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ is_active: !p.is_active }),
                        });
                        onNotify(`${p.name} ${!p.is_active ? 'enabled' : 'disabled'}.`);
                        await load();
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Failed to toggle provider.';
                        setProviderFeedback((prev) => ({ ...prev, [p.id]: { ok: false, msg } }));
                        onError(msg);
                      } finally {
                        setTogglingProviderId(null);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold disabled:opacity-60 ${
                      p.is_active
                        ? 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/40'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {isToggling ? '...' : p.is_active ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                {p.provider_type !== 'gemini' && (
                  <input
                    type="url"
                    placeholder="Base URL (https://...)"
                    value={baseUrlInputs[p.id] ?? p.base_url ?? ''}
                    onChange={(e) => setBaseUrlInputs({ ...baseUrlInputs, [p.id]: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono text-[11px]"
                  />
                )}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <KeyRound className="w-3.5 h-3.5 text-[#7C8499] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder={
                        p.has_api_key
                          ? '•••••••••••• (paste new key to rotate)'
                          : p.provider_type === 'gemini'
                          ? 'Paste Gemini API key (AIza...)'
                          : 'Paste API key (sk-...)'
                      }
                      value={keyInputs[p.id] || ''}
                      onChange={(e) => setKeyInputs({ ...keyInputs, [p.id]: e.target.value })}
                      className="w-full pl-8 pr-9 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      aria-label={showKey ? 'Hide API key' : 'Show API key'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7C8499] hover:text-[#101536] dark:hover:text-white"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleSaveProvider(p)}
                    className="px-3.5 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9] disabled:opacity-60 inline-flex items-center gap-1.5 shrink-0"
                  >
                    {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{isSaving ? 'Saving...' : 'Save'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    disabled={isTesting}
                    onClick={() => void handleTestProvider(p)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[11px] font-semibold hover:bg-[#E6E0FF]/70 disabled:opacity-60"
                  >
                    {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    <span>{isTesting ? 'Testing...' : adminT(lang, 'testConnection')}</span>
                  </button>
                  {p.has_api_key && (
                    <span className="text-[11px] text-[#16B66A] inline-flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Key active</span>
                    </span>
                  )}
                </div>

                {fb && (
                  <div
                    className={`rounded-xl px-2.5 py-2 text-[11px] font-medium flex items-start gap-1.5 ${
                      fb.ok
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                    }`}
                  >
                    {fb.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    )}
                    <span className="break-words">{fb.msg}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add New AI Model */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setModelFormError('');
          setAddingModel(true);
          try {
            const payload = {
              ...newModel,
              provider_id: newModel.provider_id || providers[0]?.id || '',
            };
            await apiFetch('/api/admin/ai/models', { method: 'POST', body: JSON.stringify(payload) });
            setNewModel({ ...newModel, model_id: '', display_name: '' });
            onNotify('AI model added.');
            await load();
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create model.';
            setModelFormError(msg);
            onError(msg);
          } finally {
            setAddingModel(false);
          }
        }}
        className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3"
      >
        <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#5B35F5]" />
          <span>Add AI Model</span>
        </h3>
        {modelFormError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {modelFormError}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 text-xs">
          <select
            value={newModel.provider_id}
            onChange={(e) => setNewModel({ ...newModel, provider_id: e.target.value })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            placeholder="Model ID (e.g. gemini-3.8-flash)"
            value={newModel.model_id}
            onChange={(e) => setNewModel({ ...newModel, model_id: e.target.value })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
          />
          <input
            type="text"
            required
            placeholder="Display Name"
            value={newModel.display_name}
            onChange={(e) => setNewModel({ ...newModel, display_name: e.target.value })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Input $/1M"
            title="Input $/1M tokens"
            value={newModel.input_cost_per_1m}
            onChange={(e) => setNewModel({ ...newModel, input_cost_per_1m: Number(e.target.value) })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Output $/1M"
            title="Output $/1M tokens"
            value={newModel.output_cost_per_1m}
            onChange={(e) => setNewModel({ ...newModel, output_cost_per_1m: Number(e.target.value) })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <input
            type="number"
            step="1"
            placeholder="Coins per USD"
            title="Coins per $1 USD"
            value={newModel.coins_per_usd}
            onChange={(e) => setNewModel({ ...newModel, coins_per_usd: Number(e.target.value) })}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <button
            type="submit"
            disabled={addingModel}
            className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9] disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
          >
            {addingModel && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{addingModel ? 'Adding...' : 'Add Model'}</span>
          </button>
        </div>
      </form>

      {/* Models Table */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
        <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
          {adminT(lang, 'modelsTitle')}
        </h3>
        {loading && models.length === 0 ? (
          <div className="text-xs text-[#7C8499] py-4">{adminT(lang, 'loading')}</div>
        ) : models.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                <tr>
                  <th className="py-2.5 px-3">Model</th>
                  <th className="py-2.5 px-3">Provider</th>
                  <th className="py-2.5 px-3">Cost ($/1M)</th>
                  <th className="py-2.5 px-3">Coins / $1</th>
                  <th className="py-2.5 px-3">Routing</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                {models.map((m) => (
                  <tr key={m.id}>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-[#101536] dark:text-white">{m.display_name}</div>
                      <div className="text-[11px] font-mono text-[#7C8499]">{m.model_id}</div>
                      {testResults[m.id] && (
                        <div
                          className={`text-[11px] mt-1 font-medium ${
                            testResults[m.id].ok ? 'text-[#16B66A]' : 'text-[#EF4444]'
                          }`}
                        >
                          {testResults[m.id].msg}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">{m.provider?.name}</td>
                    <td className="py-3 px-3 font-mono tabular-nums">
                      ${m.input_cost_per_1m} / ${m.output_cost_per_1m}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums">{m.coins_per_usd}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1.5">
                        {m.is_default && <StatusBadge status="primary" label="Default" />}
                        {m.is_fallback && <StatusBadge status="warning" label="Fallback" />}
                        <StatusBadge status={m.is_active ? 'active' : 'inactive'} />
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={testingId === m.id}
                          onClick={async () => {
                            setTestingId(m.id);
                            try {
                              const res = await apiFetch<{ ok: boolean; latencyMs: number; sample?: string; error?: string }>(
                                `/api/admin/ai/models/${m.id}/test`,
                                { method: 'POST' }
                              );
                              setTestResults({
                                ...testResults,
                                [m.id]: {
                                  ok: res.ok,
                                  msg: res.ok
                                    ? `Connected (${res.latencyMs}ms): ${res.sample || 'OK'}`
                                    : `Error: ${res.error}`,
                                },
                              });
                            } catch (err) {
                              setTestResults({
                                ...testResults,
                                [m.id]: {
                                  ok: false,
                                  msg: err instanceof Error ? err.message : 'Test request failed.',
                                },
                              });
                            } finally {
                              setTestingId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] font-semibold"
                        >
                          <Zap className="w-3 h-3" />
                          <span>{testingId === m.id ? 'Testing...' : adminT(lang, 'testConnection')}</span>
                        </button>
                        {!m.is_default && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiFetch(`/api/admin/ai/models/${m.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ is_default: true }),
                                });
                                onNotify(`${m.display_name} set as primary default model.`);
                                await load();
                              } catch (err) {
                                onError(err instanceof Error ? err.message : 'Failed to set default model.');
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#5B35F5] text-white font-semibold"
                          >
                            Set Default
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingModel({ ...m })}
                          className="px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 font-semibold"
                        >
                          {adminT(lang, 'edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModelTarget(m)}
                          className="p-1.5 rounded-lg text-[#EF4444] hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent AI Usage Logs */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
        <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">Recent AI Usage Logs</h3>
        {usageLogs.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                <tr>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Provider / Model</th>
                  <th className="py-2 px-3">Tokens</th>
                  <th className="py-2 px-3">Cost USD</th>
                  <th className="py-2 px-3">Coins Deducted</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                {usageLogs.slice(0, 15).map((l) => (
                  <tr key={String(l.id)}>
                    <td className="py-2 px-3 font-mono text-[11px] text-[#7C8499]">
                      {new Date(String(l.created_at)).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {String(l.provider_slug)} / {String(l.model_id)}
                    </td>
                    <td className="py-2 px-3 tabular-nums">{Number(l.total_tokens || 0).toLocaleString()}</td>
                    <td className="py-2 px-3 font-mono tabular-nums">${Number(l.provider_cost_usd || 0).toFixed(5)}</td>
                    <td className="py-2 px-3 font-bold tabular-nums">{Number(l.coins_deducted || 0).toFixed(2)}</td>
                    <td className="py-2 px-3">
                      <StatusBadge status={String(l.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Provider Modal */}
      <AdminModal open={newProviderOpen} title="Add AI Provider" onClose={() => setNewProviderOpen(false)}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setCreatingProvider(true);
            try {
              await apiFetch('/api/admin/ai/providers', {
                method: 'POST',
                body: JSON.stringify(newProvider),
              });
              setNewProviderOpen(false);
              setNewProvider({ slug: '', name: '', provider_type: 'custom', base_url: '', api_key: '', priority: 4 });
              onNotify('AI provider created.');
              await load();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to add provider.');
            } finally {
              setCreatingProvider(false);
            }
          }}
          className="space-y-3 text-xs"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Slug</label>
              <input
                type="text"
                required
                placeholder="openrouter"
                value={newProvider.slug}
                onChange={(e) => setNewProvider({ ...newProvider, slug: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Provider Type</label>
              <select
                value={newProvider.provider_type}
                onChange={(e) =>
                  setNewProvider({
                    ...newProvider,
                    provider_type: e.target.value as 'gemini' | 'openai' | 'deepseek' | 'custom',
                  })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI Compatible</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">Custom OpenAI Endpoint</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Display Name</label>
            <input
              type="text"
              required
              placeholder="OpenRouter / Custom LLM"
              value={newProvider.name}
              onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Base URL (optional for Gemini)</label>
            <input
              type="url"
              placeholder="https://api.openai.com/v1"
              value={newProvider.base_url}
              onChange={(e) => setNewProvider({ ...newProvider, base_url: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">API Key (Encrypted Server-Side)</label>
            <input
              type="password"
              value={newProvider.api_key}
              onChange={(e) => setNewProvider({ ...newProvider, api_key: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewProviderOpen(false)}
              className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
            >
              {adminT(lang, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={creatingProvider}
              className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold disabled:opacity-60"
            >
              {creatingProvider ? 'Adding...' : 'Add Provider'}
            </button>
          </div>
        </form>
      </AdminModal>

      {/* Edit Model Modal */}
      <AdminModal
        open={Boolean(editingModel)}
        title="Edit AI Model Configuration"
        subtitle={editingModel?.model_id}
        onClose={() => setEditingModel(null)}
      >
        {editingModel && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSavingEditModel(true);
              try {
                await apiFetch(`/api/admin/ai/models/${editingModel.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    display_name: editingModel.display_name,
                    input_cost_per_1m: Number(editingModel.input_cost_per_1m),
                    output_cost_per_1m: Number(editingModel.output_cost_per_1m),
                    coins_per_usd: Number(editingModel.coins_per_usd),
                    max_tokens: Number(editingModel.max_tokens),
                    is_active: editingModel.is_active,
                    is_fallback: editingModel.is_fallback,
                    min_plan_slug: editingModel.min_plan_slug,
                  }),
                });
                setEditingModel(null);
                onNotify('AI model updated.');
                await load();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to update AI model.');
              } finally {
                setSavingEditModel(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="block font-semibold mb-1">Display Name</label>
              <input
                type="text"
                value={editingModel.display_name}
                onChange={(e) => setEditingModel({ ...editingModel, display_name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Input $/1M</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingModel.input_cost_per_1m}
                  onChange={(e) => setEditingModel({ ...editingModel, input_cost_per_1m: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Output $/1M</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingModel.output_cost_per_1m}
                  onChange={(e) => setEditingModel({ ...editingModel, output_cost_per_1m: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Coins per USD</label>
                <input
                  type="number"
                  value={editingModel.coins_per_usd}
                  onChange={(e) => setEditingModel({ ...editingModel, coins_per_usd: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Tokens</label>
                <input
                  type="number"
                  value={editingModel.max_tokens}
                  onChange={(e) => setEditingModel({ ...editingModel, max_tokens: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <div className="flex items-center gap-5 pt-1">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={editingModel.is_active}
                  onChange={(e) => setEditingModel({ ...editingModel, is_active: e.target.checked })}
                />
                <span>Active</span>
              </label>
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={editingModel.is_fallback}
                  onChange={(e) => setEditingModel({ ...editingModel, is_fallback: e.target.checked })}
                />
                <span>Use as Fallback</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingModel(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={savingEditModel}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold disabled:opacity-60"
              >
                {savingEditModel ? 'Saving...' : adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteModelTarget)}
        title={`Delete model ${deleteModelTarget?.display_name || ''}?`}
        message="Businesses currently using this model will automatically fall back to the active default model."
        confirmLabel={adminT(lang, 'delete')}
        cancelLabel={adminT(lang, 'cancel')}
        onCancel={() => setDeleteModelTarget(null)}
        onConfirm={async () => {
          if (!deleteModelTarget) return;
          try {
            await apiFetch(`/api/admin/ai/models/${deleteModelTarget.id}`, { method: 'DELETE' });
            setDeleteModelTarget(null);
            onNotify('AI model deleted.');
            await load();
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to delete model.');
          }
        }}
      />
    </div>
  );
};
