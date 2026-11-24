import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  Flag,
  Globe,
  KeyRound,
  Layers,
  Plus,
  Share2,
  Smartphone,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import { AdminModal, ConfirmDialog, EmptyState, StatusBadge } from '../ui/AdminPrimitives';

export type PlatformSettingsSubTab = 'general' | 'plans' | 'payments' | 'features' | 'meta';

export const PlatformSettingsView: React.FC<{
  lang: Lang;
  initialSubTab?: PlatformSettingsSubTab;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
  onRefreshSystem?: () => void;
}> = ({ lang, initialSubTab = 'general', onNotify, onError, onRefreshSystem }) => {
  const [subTab, setSubTab] = useState<PlatformSettingsSubTab>(initialSubTab);

  // General Settings
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  // Plans
  const [plans, setPlans] = useState<Array<Record<string, unknown>>>([]);
  const [newPlan, setNewPlan] = useState({
    slug: '',
    name: '',
    description: '',
    monthly_price: 990,
    yearly_price: 9900,
    coin_allocation: 2000,
    max_products: 200,
    max_staff: 3,
    max_channels: 3,
    ai_usage_limit: 10000,
    duration_days: 30,
  });
  const [editingPlan, setEditingPlan] = useState<Record<string, unknown> | null>(null);

  // Payments & Gateways
  const [gateways, setGateways] = useState<Array<Record<string, unknown>>>([]);
  const [payments, setPayments] = useState<Array<Record<string, unknown>>>([]);
  const [payFilter, setPayFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [reviewModal, setReviewModal] = useState<{
    id: string;
    decision: 'approved' | 'rejected';
    amount: number;
    currency: string;
    bizName: string;
    trxId: string;
    senderNumber: string;
    paidToNumber: string;
    gatewaySlug: string;
    targetTitle: string;
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  // Manual Payment Methods Manager (bKash max 9, Nagad & Rocket multiple)
  type ManualMethodSlug = 'bkash' | 'nagad' | 'rocket';
  type ManualAccountItem = {
    id: string;
    number: string;
    account_type: string;
    label: string;
    instructions: string;
    is_active: boolean;
  };
  const [activeMfsMethod, setActiveMfsMethod] = useState<ManualMethodSlug>('bkash');
  const [mfsInstructionsDraft, setMfsInstructionsDraft] = useState('');
  const [mfsSaving, setMfsSaving] = useState(false);
  const [mfsAccountModalOpen, setMfsAccountModalOpen] = useState(false);
  const [mfsEditingAccountId, setMfsEditingAccountId] = useState<string | null>(null);
  const [mfsAccountForm, setMfsAccountForm] = useState({
    number: '',
    account_type: 'Personal',
    label: '',
    instructions: '',
    is_active: true,
  });

  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);
  const [gatewayMode, setGatewayMode] = useState<'create' | 'edit'>('create');
  const [gatewaySlugTouched, setGatewaySlugTouched] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [deleteGatewayConfirm, setDeleteGatewayConfirm] = useState<{ slug: string; name: string } | null>(null);
  const [gatewayForm, setGatewayForm] = useState({
    slug: '',
    name: '',
    gateway_type: 'bkash' as 'manual' | 'bkash' | 'nagad' | 'rocket' | 'sslcommerz' | 'custom',
    is_active: true,
    is_sandbox: false,
    account_number: '',
    account_type: '',
    display_note: '',
    instructions: '',
    merchant_id: '',
    api_key: '',
    api_secret: '',
    username: '',
    password: '',
    clear_credentials: false,
    has_credentials: false,
  });

  // Feature flags
  const [features, setFeatures] = useState<Array<Record<string, unknown>>>([]);

  // Meta settings
  const [metaData, setMetaData] = useState<{
    settings: Record<string, unknown> | null;
    oauthRedirectUri: string;
    webhookUrl: string;
    connections: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
  } | null>(null);
  const [metaForm, setMetaForm] = useState({
    meta_app_id: '',
    meta_app_secret: '',
    meta_api_version: 'v21.0',
    meta_webhook_verify_token: '',
    meta_mode: 'development',
  });

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadSubTab = async (target: PlatformSettingsSubTab) => {
    try {
      if (target === 'general') {
        const res = await apiFetch<{ settings: Record<string, unknown> }>('/api/admin/settings');
        setSettings(res.settings || {});
      } else if (target === 'plans') {
        const res = await apiFetch<{ plans: Array<Record<string, unknown>> }>('/api/admin/subscription-plans');
        setPlans(res.plans || []);
      } else if (target === 'payments') {
        const res = await apiFetch<{
          gateways: Array<Record<string, unknown>>;
          payments: Array<Record<string, unknown>>;
        }>('/api/admin/payments');
        setGateways(res.gateways || []);
        setPayments(res.payments || []);
      } else if (target === 'features') {
        const res = await apiFetch<{ features: Array<Record<string, unknown>> }>('/api/admin/features');
        setFeatures(res.features || []);
      } else if (target === 'meta') {
        const res = await apiFetch<NonNullable<typeof metaData>>('/api/admin/meta-settings');
        setMetaData(res);
        setMetaForm({
          meta_app_id: String(res.settings?.meta_app_id || ''),
          meta_app_secret: '',
          meta_api_version: String(res.settings?.meta_api_version || 'v21.0'),
          meta_webhook_verify_token: String(res.settings?.meta_webhook_verify_token || ''),
          meta_mode: String(res.settings?.meta_mode || 'development'),
        });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load platform settings.');
    }
  };

  useEffect(() => {
    void loadSubTab(subTab);
  }, [subTab]);

  const parseGatewayAccounts = (gw?: Record<string, unknown>): ManualAccountItem[] => {
    if (!gw) return [];
    if (Array.isArray(gw.accounts)) {
      return (gw.accounts as Array<Record<string, unknown>>).map((a, idx) => ({
        id: String(a.id || `acc_${idx + 1}`),
        number: String(a.number || ''),
        account_type: String(a.account_type || 'Personal'),
        label: String(a.label || ''),
        instructions: String(a.instructions || ''),
        is_active: a.is_active !== false,
      }));
    }
    const cfg = (gw.config_public && typeof gw.config_public === 'object' ? gw.config_public : {}) as Record<string, unknown>;
    if (Array.isArray(cfg.accounts)) {
      return (cfg.accounts as Array<Record<string, unknown>>).map((a, idx) => ({
        id: String(a.id || `acc_${idx + 1}`),
        number: String(a.number || ''),
        account_type: String(a.account_type || 'Personal'),
        label: String(a.label || ''),
        instructions: String(a.instructions || ''),
        is_active: a.is_active !== false,
      }));
    }
    if (typeof cfg.account_number === 'string' && cfg.account_number.trim()) {
      return [
        {
          id: 'primary',
          number: cfg.account_number.trim(),
          account_type: typeof cfg.account_type === 'string' && cfg.account_type.trim() ? cfg.account_type.trim() : 'Personal',
          label: typeof cfg.display_note === 'string' ? cfg.display_note.trim() : '',
          instructions: '',
          is_active: true,
        },
      ];
    }
    return [];
  };

  const activeMfsGateway = gateways.find((g) => String(g.slug || '').toLowerCase() === activeMfsMethod);
  const activeMfsAccounts = parseGatewayAccounts(activeMfsGateway);

  useEffect(() => {
    if (subTab === 'payments') {
      const gw = gateways.find((g) => String(g.slug || '').toLowerCase() === activeMfsMethod);
      setMfsInstructionsDraft(String(gw?.instructions || ''));
    }
  }, [activeMfsMethod, gateways, subTab]);

  const saveManualMethodPayload = async (
    method: ManualMethodSlug,
    payload: { accounts?: ManualAccountItem[]; is_active?: boolean; instructions?: string },
    successMsg: string
  ) => {
    setMfsSaving(true);
    try {
      await apiFetch(`/api/admin/manual-payment-methods/${method}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      onNotify(successMsg);
      await loadSubTab('payments');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update manual payment method.');
    } finally {
      setMfsSaving(false);
    }
  };

  const openAddMfsNumberModal = () => {
    if (activeMfsMethod === 'bkash' && activeMfsAccounts.length >= 9) {
      onError(lang === 'bn' ? 'bKash-এ সর্বোচ্চ ৯টি নম্বর যুক্ত করা যাবে।' : 'bKash allows a maximum of 9 payment numbers.');
      return;
    }
    setMfsEditingAccountId(null);
    setMfsAccountForm({
      number: '',
      account_type: 'Personal',
      label: '',
      instructions: '',
      is_active: true,
    });
    setMfsAccountModalOpen(true);
  };

  const openEditMfsNumberModal = (acc: ManualAccountItem) => {
    setMfsEditingAccountId(acc.id);
    setMfsAccountForm({
      number: acc.number,
      account_type: acc.account_type || 'Personal',
      label: acc.label || '',
      instructions: acc.instructions || '',
      is_active: acc.is_active,
    });
    setMfsAccountModalOpen(true);
  };

  const handleSaveMfsAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedNumber = mfsAccountForm.number.replace(/[\s()-]+/g, '').trim();
    if (!cleanedNumber) {
      onError(lang === 'bn' ? 'সঠিক পেমেন্ট নম্বর দিন।' : 'Please enter a valid payment number.');
      return;
    }

    let nextAccounts: ManualAccountItem[];
    if (mfsEditingAccountId) {
      nextAccounts = activeMfsAccounts.map((item) =>
        item.id === mfsEditingAccountId
          ? {
              ...item,
              number: cleanedNumber,
              account_type: mfsAccountForm.account_type.trim() || 'Personal',
              label: mfsAccountForm.label.trim(),
              instructions: mfsAccountForm.instructions.trim(),
              is_active: mfsAccountForm.is_active,
            }
          : item
      );
    } else {
      const nextId = `num_${Date.now().toString(36)}`;
      nextAccounts = [
        ...activeMfsAccounts,
        {
          id: nextId,
          number: cleanedNumber,
          account_type: mfsAccountForm.account_type.trim() || 'Personal',
          label: mfsAccountForm.label.trim(),
          instructions: mfsAccountForm.instructions.trim(),
          is_active: mfsAccountForm.is_active,
        },
      ];
    }

    await saveManualMethodPayload(
      activeMfsMethod,
      { accounts: nextAccounts },
      mfsEditingAccountId
        ? lang === 'bn'
          ? 'পেমেন্ট নম্বর আপডেট হয়েছে।'
          : 'Payment number updated.'
        : lang === 'bn'
        ? 'নতুন পেমেন্ট নম্বর যুক্ত হয়েছে।'
        : 'Payment number added.'
    );
    setMfsAccountModalOpen(false);
  };

  const filteredPayments = payments.filter((p) => payFilter === 'all' || p.status === payFilter);
  const paymentCounts = {
    all: payments.length,
    pending: payments.filter((p) => p.status === 'pending').length,
    approved: payments.filter((p) => p.status === 'approved').length,
    rejected: payments.filter((p) => p.status === 'rejected').length,
  };

  const openCreateGatewayModal = () => {
    setGatewayMode('create');
    setGatewaySlugTouched(false);
    setGatewayForm({
      slug: '',
      name: '',
      gateway_type: 'bkash',
      is_active: true,
      is_sandbox: false,
      account_number: '',
      account_type: '',
      display_note: '',
      instructions: '',
      merchant_id: '',
      api_key: '',
      api_secret: '',
      username: '',
      password: '',
      clear_credentials: false,
      has_credentials: false,
    });
    setGatewayModalOpen(true);
  };

  const openEditGatewayModal = (g: Record<string, unknown>) => {
    const cfg = (g.config_public && typeof g.config_public === 'object' ? g.config_public : {}) as Record<string, unknown>;
    setGatewayMode('edit');
    setGatewaySlugTouched(true);
    setGatewayForm({
      slug: String(g.slug || ''),
      name: String(g.name || ''),
      gateway_type: (String(g.gateway_type || 'manual') as 'manual' | 'bkash' | 'nagad' | 'rocket' | 'sslcommerz' | 'custom'),
      is_active: Boolean(g.is_active),
      is_sandbox: Boolean(g.is_sandbox),
      account_number: String(cfg.account_number || ''),
      account_type: String(cfg.account_type || ''),
      display_note: String(cfg.display_note || ''),
      instructions: String(g.instructions || ''),
      merchant_id: String(cfg.merchant_id || ''),
      api_key: '',
      api_secret: '',
      username: '',
      password: '',
      clear_credentials: false,
      has_credentials: Boolean(g.has_credentials),
    });
    setGatewayModalOpen(true);
  };

  const handleSaveGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    setGatewaySaving(true);
    try {
      const config_public: Record<string, string> = {};
      if (gatewayForm.account_number.trim()) config_public.account_number = gatewayForm.account_number.trim();
      if (gatewayForm.account_type.trim()) config_public.account_type = gatewayForm.account_type.trim();
      if (gatewayForm.merchant_id.trim()) config_public.merchant_id = gatewayForm.merchant_id.trim();
      if (gatewayForm.display_note.trim()) config_public.display_note = gatewayForm.display_note.trim();

      const credentials: Record<string, string> = {};
      if (gatewayForm.merchant_id.trim()) credentials.merchant_id = gatewayForm.merchant_id.trim();
      if (gatewayForm.api_key.trim()) credentials.api_key = gatewayForm.api_key.trim();
      if (gatewayForm.api_secret.trim()) credentials.api_secret = gatewayForm.api_secret.trim();
      if (gatewayForm.username.trim()) credentials.username = gatewayForm.username.trim();
      if (gatewayForm.password.trim()) credentials.password = gatewayForm.password.trim();

      const hasCredInputs =
        Boolean(gatewayForm.api_key.trim()) ||
        Boolean(gatewayForm.api_secret.trim()) ||
        Boolean(gatewayForm.username.trim()) ||
        Boolean(gatewayForm.password.trim());

      if (gatewayMode === 'create') {
        await apiFetch('/api/admin/payment-gateways', {
          method: 'POST',
          body: JSON.stringify({
            name: gatewayForm.name,
            slug: gatewayForm.slug,
            gateway_type: gatewayForm.gateway_type,
            is_active: gatewayForm.is_active,
            is_sandbox: gatewayForm.is_sandbox,
            config_public,
            instructions: gatewayForm.instructions,
            ...(hasCredInputs ? { credentials } : {}),
          }),
        });
        onNotify(lang === 'bn' ? 'নতুন পেমেন্ট গেটওয়ে যুক্ত হয়েছে।' : 'Payment gateway created.');
      } else {
        await apiFetch(`/api/admin/payment-gateways/${gatewayForm.slug}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: gatewayForm.name,
            gateway_type: gatewayForm.gateway_type,
            is_active: gatewayForm.is_active,
            is_sandbox: gatewayForm.is_sandbox,
            config_public,
            instructions: gatewayForm.instructions,
            ...(gatewayForm.clear_credentials ? { clear_credentials: true } : hasCredInputs ? { credentials } : {}),
          }),
        });
        onNotify(lang === 'bn' ? 'পেমেন্ট গেটওয়ে আপডেট হয়েছে।' : 'Payment gateway updated.');
      }
      setGatewayModalOpen(false);
      await loadSubTab('payments');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save payment gateway.');
    } finally {
      setGatewaySaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation Pills */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-2 bx-card flex flex-wrap gap-1.5">
        {(
          [
            ['general', adminT(lang, 'generalSettings'), <Globe className="w-3.5 h-3.5" />],
            ['plans', adminT(lang, 'subscriptionPlans'), <Layers className="w-3.5 h-3.5" />],
            ['payments', adminT(lang, 'paymentsBilling'), <CreditCard className="w-3.5 h-3.5" />],
            ['features', adminT(lang, 'featureFlags'), <Flag className="w-3.5 h-3.5" />],
            ['meta', adminT(lang, 'metaPlatform'), <Share2 className="w-3.5 h-3.5" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
              subTab === id
                ? 'bg-[#5B35F5] text-white shadow-xs'
                : 'text-[#7C8499] dark:text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 hover:text-[#5B35F5]'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 1. General Settings */}
      {subTab === 'general' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(settings) });
              onNotify('Platform settings updated.');
              onRefreshSystem?.();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to save settings.');
            }
          }}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-5 max-w-3xl"
        >
          <div>
            <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
              {adminT(lang, 'generalSettings')}
            </h2>
            <p className="text-xs text-[#7C8499]">Control platform registration, maintenance mode, and regional defaults.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Platform Name</label>
              <input
                type="text"
                value={String(settings.app_name || 'BeXpar Ai')}
                onChange={(e) => setSettings({ ...settings, app_name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Default Language</label>
              <select
                value={String(settings.default_language || 'bn')}
                onChange={(e) => setSettings({ ...settings, default_language: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              >
                <option value="bn">Bangla (bn)</option>
                <option value="en">English (en)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Support Email</label>
              <input
                type="email"
                value={String(settings.support_email || '')}
                onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Support Phone</label>
              <input
                type="text"
                value={String(settings.support_phone || '')}
                onChange={(e) => setSettings({ ...settings, support_phone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-1 text-xs">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={Boolean(settings.maintenance_mode)}
                onChange={(e) => setSettings({ ...settings, maintenance_mode: e.target.checked })}
              />
              <span>Maintenance Mode</span>
            </label>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={settings.registration_enabled !== false}
                onChange={(e) => setSettings({ ...settings, registration_enabled: e.target.checked })}
              />
              <span>Allow New User Registrations</span>
            </label>
          </div>

          <button type="submit" className="px-5 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold">
            {adminT(lang, 'saveChanges')}
          </button>
        </form>
      )}

      {/* 2. Subscription Plans */}
      {subTab === 'plans' && (
        <div className="space-y-5">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiFetch('/api/admin/subscription-plans', {
                  method: 'POST',
                  body: JSON.stringify({
                    ...newPlan,
                    currency: 'BDT',
                    allowed_features: ['ai_chat', 'products', 'orders', 'crm', 'courier', 'analytics'],
                  }),
                });
                setNewPlan({
                  slug: '',
                  name: '',
                  description: '',
                  monthly_price: 990,
                  yearly_price: 9900,
                  coin_allocation: 2000,
                  max_products: 200,
                  max_staff: 3,
                  max_channels: 3,
                  ai_usage_limit: 10000,
                  duration_days: 30,
                });
                onNotify('Subscription plan created.');
                await loadSubTab('plans');
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to create plan.');
              }
            }}
            className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3 text-xs"
          >
            <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">Create Subscription Plan</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
              <input
                type="text"
                required
                placeholder="Slug (e.g. pro)"
                value={newPlan.slug}
                onChange={(e) => setNewPlan({ ...newPlan, slug: e.target.value })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
              <input
                type="text"
                required
                placeholder="Plan Name"
                value={newPlan.name}
                onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
              <input
                type="number"
                placeholder="Monthly Price"
                value={newPlan.monthly_price}
                onChange={(e) => setNewPlan({ ...newPlan, monthly_price: Number(e.target.value) })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
              <input
                type="number"
                placeholder="Coins Included"
                value={newPlan.coin_allocation}
                onChange={(e) => setNewPlan({ ...newPlan, coin_allocation: Number(e.target.value) })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
              <input
                type="number"
                placeholder="Max Products"
                value={newPlan.max_products}
                onChange={(e) => setNewPlan({ ...newPlan, max_products: Number(e.target.value) })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]">
                Add Plan
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div
                key={String(p.id)}
                className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-display font-bold text-[#101536] dark:text-white">{String(p.name)}</div>
                    <div className="text-[11px] font-mono text-[#7C8499]">{String(p.slug)}</div>
                  </div>
                  <StatusBadge status={p.is_active ? 'active' : 'inactive'} />
                </div>
                <div className="text-xl font-display font-bold text-[#5B35F5] tabular-nums">
                  {formatMoney(Number(p.monthly_price || 0))}{' '}
                  <span className="text-xs font-normal text-[#7C8499]">/ month</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#7C8499]">
                  <div>Coins: {Number(p.coin_allocation || 0).toLocaleString()}</div>
                  <div>Products: {Number(p.max_products || 0)}</div>
                  <div>Staff: {Number(p.max_staff || 0)}</div>
                  <div>Channels: {Number(p.max_channels || 0)}</div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-[#E6E0FF]/60 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingPlan({ ...p })}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] text-xs font-semibold"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{adminT(lang, 'edit')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/subscription-plans/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ is_active: !p.is_active }),
                      });
                      onNotify('Plan status updated.');
                      await loadSubTab('plans');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold"
                  >
                    {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Payments & Gateways */}
      {subTab === 'payments' && (
        <div className="space-y-5">
          {/* Manual Payment Methods Manager: bKash (max 9), Nagad (multiple), Rocket (multiple) */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#5B35F5]" />
                  <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
                    {lang === 'bn'
                      ? 'ম্যানুয়াল পেমেন্ট নম্বর ম্যানেজমেন্ট (bKash · Nagad · Rocket)'
                      : 'Manual Payment Numbers (bKash · Nagad · Rocket)'}
                  </h3>
                </div>
                <p className="text-xs text-[#7C8499] mt-0.5">
                  {lang === 'bn'
                    ? 'কোনো পেমেন্ট গেটওয়ে ছাড়াই bKash (সর্বোচ্চ ৯টি), Nagad ও Rocket-এর একাধিক নম্বর ও নির্দেশনা পরিচালনা করুন।'
                    : 'Manage receiving numbers without any payment gateway: up to 9 for bKash, and multiple numbers for Nagad & Rocket.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['bkash', 'nagad', 'rocket'] as const).map((methodKey) => {
                  const gwRow = gateways.find((g) => String(g.slug || '').toLowerCase() === methodKey);
                  const nums = parseGatewayAccounts(gwRow);
                  const activeCount = nums.filter((a) => a.is_active).length;
                  const label = methodKey === 'bkash' ? 'bKash' : methodKey === 'nagad' ? 'Nagad' : 'Rocket';
                  const isSel = activeMfsMethod === methodKey;
                  return (
                    <button
                      key={methodKey}
                      type="button"
                      onClick={() => setActiveMfsMethod(methodKey)}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        isSel
                          ? 'bg-[#5B35F5] text-white border-[#5B35F5] shadow-xs'
                          : 'bg-[#F8F9FC] dark:bg-slate-950 text-[#101536] dark:text-slate-200 border-[#E6E0FF] dark:border-slate-800 hover:bg-[#F3F0FF]'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums ${
                          isSel
                            ? 'bg-white/20 text-white'
                            : 'bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]'
                        }`}
                      >
                        {methodKey === 'bkash' ? `${nums.length}/9` : `${activeCount}/${nums.length}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {(() => {
              const methodTitle =
                activeMfsMethod === 'bkash' ? 'bKash' : activeMfsMethod === 'nagad' ? 'Nagad' : 'Rocket';
              const isMethodActive = activeMfsGateway ? Boolean(activeMfsGateway.is_active) : false;
              const isBkashFull = activeMfsMethod === 'bkash' && activeMfsAccounts.length >= 9;
              return (
                <div className="rounded-2xl border border-[#E6E0FF] dark:border-slate-800 bg-[#F9F7FF]/60 dark:bg-slate-950/60 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-display font-bold text-[#101536] dark:text-white">
                        {methodTitle}
                      </span>
                      <StatusBadge status={isMethodActive ? 'active' : 'inactive'} />
                      <span className="text-[11px] font-semibold text-[#7C8499] tabular-nums">
                        {activeMfsMethod === 'bkash'
                          ? `${activeMfsAccounts.length} / 9 ${lang === 'bn' ? 'নম্বর' : 'Numbers Max'}`
                          : `${activeMfsAccounts.filter((a) => a.is_active).length} Active · ${activeMfsAccounts.length} Total`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={mfsSaving}
                        onClick={() =>
                          void saveManualMethodPayload(
                            activeMfsMethod,
                            { is_active: !isMethodActive, accounts: activeMfsAccounts },
                            `${methodTitle} ${!isMethodActive ? 'enabled' : 'disabled'}.`
                          )
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                          isMethodActive
                            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                        }`}
                      >
                        {isMethodActive
                          ? lang === 'bn'
                            ? 'Method নিষ্ক্রিয় করুন'
                            : 'Set Method Inactive'
                          : lang === 'bn'
                          ? 'Method সক্রিয় করুন'
                          : 'Set Method Active'}
                      </button>

                      <button
                        type="button"
                        disabled={mfsSaving || isBkashFull}
                        onClick={openAddMfsNumberModal}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>
                          {isBkashFull
                            ? lang === 'bn'
                              ? 'bKash সীমা পূর্ণ (৯/৯)'
                              : 'bKash Limit Reached (9/9)'
                            : lang === 'bn'
                            ? `${methodTitle} নম্বর যোগ করুন`
                            : `Add ${methodTitle} Number`}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Send Money Instructions */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={mfsInstructionsDraft}
                      onChange={(e) => setMfsInstructionsDraft(e.target.value)}
                      placeholder={
                        lang === 'bn'
                          ? `${methodTitle} Send Money নির্দেশনা লিখুন...`
                          : `${methodTitle} Send Money instructions shown to users...`
                      }
                      className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    />
                    <button
                      type="button"
                      disabled={mfsSaving}
                      onClick={() =>
                        void saveManualMethodPayload(
                          activeMfsMethod,
                          { instructions: mfsInstructionsDraft, accounts: activeMfsAccounts },
                          `${methodTitle} instructions saved.`
                        )
                      }
                      className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#F3F0FF] shrink-0"
                    >
                      {lang === 'bn' ? 'নির্দেশনা সেভ' : 'Save Instructions'}
                    </button>
                  </div>

                  {/* Numbers List */}
                  {activeMfsAccounts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#E6E0FF] dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 p-5 text-center text-xs text-[#7C8499]">
                      {lang === 'bn'
                        ? `এখনো কোনো ${methodTitle} পেমেন্ট নম্বর যুক্ত করা হয়নি। উপরে "Add ${methodTitle} Number" বাটনে ক্লিক করুন।`
                        : `No ${methodTitle} payment numbers configured yet. Click "Add ${methodTitle} Number" above to add one.`}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {activeMfsAccounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="rounded-xl border border-[#E6E0FF] dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-sm text-[#101536] dark:text-white truncate">
                                  {acc.number}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(acc.number);
                                    onNotify(`Copied ${acc.number}`);
                                  }}
                                  className="p-1 rounded-md text-[#7C8499] hover:text-[#5B35F5] hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                                  title="Copy number"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[10px] font-semibold">
                                  {acc.account_type || 'Personal'}
                                </span>
                                {acc.label && (
                                  <span className="text-[11px] text-[#7C8499] truncate">{acc.label}</span>
                                )}
                              </div>
                            </div>
                            <StatusBadge status={acc.is_active ? 'active' : 'inactive'} />
                          </div>

                          {acc.instructions && (
                            <p className="text-[11px] text-[#7C8499] line-clamp-2">{acc.instructions}</p>
                          )}

                          <div className="flex items-center gap-1.5 pt-2 border-t border-[#E6E0FF]/60 dark:border-slate-800">
                            <button
                              type="button"
                              disabled={mfsSaving}
                              onClick={() => {
                                const next = activeMfsAccounts.map((item) =>
                                  item.id === acc.id ? { ...item, is_active: !item.is_active } : item
                                );
                                void saveManualMethodPayload(
                                  activeMfsMethod,
                                  { accounts: next },
                                  `${acc.number} marked ${!acc.is_active ? 'active' : 'inactive'}.`
                                );
                              }}
                              className="px-2.5 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-[11px] font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                            >
                              {acc.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              disabled={mfsSaving}
                              onClick={() => openEditMfsNumberModal(acc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[11px] font-semibold"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>{adminT(lang, 'edit')}</span>
                            </button>
                            <button
                              type="button"
                              disabled={mfsSaving}
                              onClick={() => {
                                const next = activeMfsAccounts.filter((item) => item.id !== acc.id);
                                void saveManualMethodPayload(
                                  activeMfsMethod,
                                  { accounts: next },
                                  `${acc.number} deleted.`
                                );
                              }}
                              className="ml-auto p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              title={adminT(lang, 'delete')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
                {adminT(lang, 'paymentGatewaysTitle')}
              </h3>
              <p className="text-xs text-[#7C8499] mt-0.5">{adminT(lang, 'paymentGatewaysDesc')}</p>
            </div>
            <button
              type="button"
              onClick={openCreateGatewayModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 shrink-0 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{adminT(lang, 'addGateway')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {gateways.map((g) => {
              const cfg = (g.config_public && typeof g.config_public === 'object' ? g.config_public : {}) as Record<
                string,
                unknown
              >;
              const accounts = parseGatewayAccounts(g);
              const accNum = cfg.account_number ? String(cfg.account_number) : '';
              const accType = cfg.account_type ? String(cfg.account_type) : '';
              const slug = String(g.slug || '');
              const isBuiltIn = slug === 'manual' || slug === 'bkash' || slug === 'nagad' || slug === 'rocket';
              return (
                <div
                  key={String(g.id)}
                  className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[#101536] dark:text-white truncate">
                          {String(g.name)}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[11px] font-mono text-[#7C8499]">{slug}</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[10px] font-semibold uppercase">
                            {String(g.gateway_type || 'manual')}
                          </span>
                          {accounts.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                              {accounts.filter((a) => a.is_active).length}/{accounts.length} active
                            </span>
                          )}
                        </div>
                      </div>
                      <StatusBadge status={g.is_active ? 'active' : 'inactive'} />
                    </div>

                    {(accNum || accType) && (
                      <div className="px-3 py-2 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF]/70 dark:border-slate-800 text-[11px] flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#101536] dark:text-slate-200 truncate">
                          {accNum || '—'}
                        </span>
                        {accType && <span className="text-[#7C8499] shrink-0">{accType}</span>}
                      </div>
                    )}

                    <p className="text-[11px] text-[#7C8499] line-clamp-2 min-h-[2rem]">
                      {String(g.instructions || (lang === 'bn' ? 'কোনো নির্দেশনা দেওয়া নেই।' : 'No checkout instructions set.'))}
                    </p>

                    <div className="flex items-center gap-2 text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                          g.has_credentials
                            ? 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/40'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        <KeyRound className="w-3 h-3" />
                        {g.has_credentials ? adminT(lang, 'credentialsConfigured') : adminT(lang, 'noCredentials')}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] font-medium">
                        {g.is_sandbox ? 'Sandbox' : 'Live'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#E6E0FF]/60 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/admin/payment-gateways/${slug}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_active: !g.is_active }),
                          });
                          onNotify('Gateway updated.');
                          await loadSubTab('payments');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed to update gateway.');
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold transition-colors"
                    >
                      {g.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await apiFetch(`/api/admin/payment-gateways/${slug}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_sandbox: !g.is_sandbox }),
                          });
                          onNotify('Gateway mode updated.');
                          await loadSubTab('payments');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed to update gateway mode.');
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                    >
                      {g.is_sandbox ? 'Sandbox' : 'Live'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditGatewayModal(g)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{adminT(lang, 'edit')}</span>
                    </button>
                    {!isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => setDeleteGatewayConfirm({ slug, name: String(g.name || slug) })}
                        className="ml-auto p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title={adminT(lang, 'deleteGateway')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
                  {lang === 'bn' ? 'পেমেন্ট ভেরিফিকেশন কিউ' : 'Payment Verification Queue'}
                </h3>
                <p className="text-xs text-[#7C8499]">
                  {lang === 'bn'
                    ? 'Pending, Approved ও Rejected পেমেন্ট যাচাই করুন। Reject করলে কারণ লিখতে হবে।'
                    : 'Review Pending, Approved, and Rejected requests. Rejection requires a reason visible to the user.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setPayFilter(f)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize inline-flex items-center gap-1.5 ${
                      payFilter === f ? 'bg-[#5B35F5] text-white' : 'bg-[#F3F0FF] dark:bg-slate-800 text-[#7C8499]'
                    }`}
                  >
                    <span>{f}</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-black/10 dark:bg-white/10 text-[10px] tabular-nums">
                      {paymentCounts[f]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {filteredPayments.length === 0 ? (
              <EmptyState title={adminT(lang, 'noData')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Business</th>
                      <th className="py-2.5 px-3">Package / Method</th>
                      <th className="py-2.5 px-3">TrxID &amp; Numbers</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Status &amp; Note</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                    {filteredPayments.map((p) => {
                      const bizName = String((p.business as Record<string, unknown>)?.name || p.business_id);
                      const gwMeta = (p.gateway_response && typeof p.gateway_response === 'object'
                        ? p.gateway_response
                        : {}) as Record<string, unknown>;
                      const paidTo = gwMeta.paid_to_number ? String(gwMeta.paid_to_number) : '';
                      const targetTitle = gwMeta.target_title
                        ? String(gwMeta.target_title)
                        : String(p.payment_for || '').replace('_', ' ');
                      const senderNumber = p.sender_number ? String(p.sender_number) : '';
                      const adminNotes = p.admin_notes ? String(p.admin_notes) : '';
                      return (
                        <tr key={String(p.id)} className="align-top">
                          <td className="py-3 px-3 font-mono text-[11px] text-[#7C8499] whitespace-nowrap">
                            {new Date(String(p.created_at)).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-3 font-semibold text-[#101536] dark:text-white">{bizName}</td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-[#101536] dark:text-white">{targetTitle}</div>
                            <div className="text-[11px] text-[#7C8499] uppercase font-semibold">
                              {String(p.gateway_slug)}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] space-y-0.5">
                            <div className="font-bold text-[#101536] dark:text-white">{String(p.transaction_id || '—')}</div>
                            {senderNumber && (
                              <div className="text-[#7C8499]">From: {senderNumber}</div>
                            )}
                            {paidTo && <div className="text-[#5B35F5] dark:text-[#A78BFA]">To: {paidTo}</div>}
                          </td>
                          <td className="py-3 px-3 font-bold tabular-nums whitespace-nowrap">
                            {formatMoney(Number(p.amount || 0))}
                          </td>
                          <td className="py-3 px-3 space-y-1 max-w-[220px]">
                            <StatusBadge status={String(p.status)} />
                            {adminNotes && (
                              <div
                                className={`text-[11px] ${
                                  p.status === 'rejected' ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-[#7C8499]'
                                }`}
                              >
                                {adminNotes}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {p.status === 'pending' ? (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewNotes('');
                                    setReviewError('');
                                    setReviewModal({
                                      id: String(p.id),
                                      decision: 'approved',
                                      amount: Number(p.amount || 0),
                                      currency: String(p.currency || 'BDT'),
                                      bizName,
                                      trxId: String(p.transaction_id || ''),
                                      senderNumber: String(p.sender_number || ''),
                                      paidToNumber: paidTo,
                                      gatewaySlug: String(p.gateway_slug || ''),
                                      targetTitle,
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#16B66A] text-white font-semibold"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReviewNotes('');
                                    setReviewError('');
                                    setReviewModal({
                                      id: String(p.id),
                                      decision: 'rejected',
                                      amount: Number(p.amount || 0),
                                      currency: String(p.currency || 'BDT'),
                                      bizName,
                                      trxId: String(p.transaction_id || ''),
                                      senderNumber: String(p.sender_number || ''),
                                      paidToNumber: paidTo,
                                      gatewaySlug: String(p.gateway_slug || ''),
                                      targetTitle,
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EF4444] text-white font-semibold"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[#7C8499]">
                                {p.reviewed_at ? new Date(String(p.reviewed_at)).toLocaleDateString() : 'Reviewed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Global Feature Flags */}
      {subTab === 'features' && (
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
            {adminT(lang, 'featureFlags')}
          </h3>
          <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {features.map((f) => (
              <div key={String(f.key)} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#101536] dark:text-white">{String(f.name)}</div>
                  <div className="text-xs text-[#7C8499]">{String(f.description)}</div>
                  <div className="text-[11px] font-mono text-[#7C8499] mt-0.5">
                    key: {String(f.key)} · min plan: {String(f.min_plan_slug)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/admin/features/${f.key}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ is_globally_enabled: !f.is_globally_enabled }),
                    });
                    onNotify(`Feature ${f.key} ${!f.is_globally_enabled ? 'enabled' : 'disabled'}.`);
                    await loadSubTab('features');
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold shrink-0 ${
                    f.is_globally_enabled
                      ? 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/40'
                      : 'bg-rose-50 text-[#EF4444] dark:bg-rose-950/40'
                  }`}
                >
                  {f.is_globally_enabled ? 'Globally Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Meta Platform API */}
      {subTab === 'meta' && metaData && (
        <div className="space-y-5 max-w-4xl">
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3 text-xs">
            <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">
              Meta Platform OAuth & Webhook Endpoints
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ['OAuth Redirect URI', metaData.oauthRedirectUri],
                ['Webhook Callback URL', metaData.webhookUrl],
              ].map(([label, val]) => (
                <div key={label} className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-[#7C8499] mb-1">{label}</div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] truncate">{val}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(val);
                        onNotify(`${label} copied.`);
                      }}
                      className="p-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiFetch('/api/admin/meta-settings', { method: 'PATCH', body: JSON.stringify(metaForm) });
                onNotify('Meta platform credentials saved securely.');
                setMetaForm({ ...metaForm, meta_app_secret: '' });
                await loadSubTab('meta');
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to save Meta config.');
              }
            }}
            className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">Meta App Credentials</h3>
              <StatusBadge
                status={metaData.settings?.has_meta_app_secret ? 'active' : 'inactive'}
                label={metaData.settings?.has_meta_app_secret ? 'Secret Encrypted' : 'No Secret Saved'}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold mb-1">Meta App ID</label>
                <input
                  type="text"
                  value={metaForm.meta_app_id}
                  onChange={(e) => setMetaForm({ ...metaForm, meta_app_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Meta App Secret (Encrypted Server-Side)</label>
                <input
                  type="password"
                  placeholder="Leave blank to keep existing"
                  value={metaForm.meta_app_secret}
                  onChange={(e) => setMetaForm({ ...metaForm, meta_app_secret: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Graph API Version</label>
                <input
                  type="text"
                  value={metaForm.meta_api_version}
                  onChange={(e) => setMetaForm({ ...metaForm, meta_api_version: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Webhook Verify Token</label>
                <input
                  type="text"
                  value={metaForm.meta_webhook_verify_token}
                  onChange={(e) => setMetaForm({ ...metaForm, meta_webhook_verify_token: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">App Mode</label>
              <select
                value={metaForm.meta_mode}
                onChange={(e) => setMetaForm({ ...metaForm, meta_mode: e.target.value })}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              >
                <option value="development">Development Mode</option>
                <option value="production">Production Mode</option>
              </select>
            </div>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]">
              Save Meta Configuration
            </button>
          </form>
        </div>
      )}

      {/* Edit Subscription Plan Modal */}
      <AdminModal
        open={Boolean(editingPlan)}
        title={`Edit Plan: ${String(editingPlan?.name || '')}`}
        onClose={() => setEditingPlan(null)}
      >
        {editingPlan && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch(`/api/admin/subscription-plans/${editingPlan.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  name: editingPlan.name,
                  description: editingPlan.description,
                  monthly_price: Number(editingPlan.monthly_price),
                  yearly_price: Number(editingPlan.yearly_price),
                  coin_allocation: Number(editingPlan.coin_allocation),
                  max_products: Number(editingPlan.max_products),
                  max_staff: Number(editingPlan.max_staff),
                  max_channels: Number(editingPlan.max_channels),
                }),
              });
              setEditingPlan(null);
              onNotify('Subscription plan updated.');
              await loadSubTab('plans');
            }}
            className="space-y-3 text-xs"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Plan Name</label>
                <input
                  type="text"
                  value={String(editingPlan.name || '')}
                  onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Monthly Price</label>
                <input
                  type="number"
                  value={Number(editingPlan.monthly_price || 0)}
                  onChange={(e) => setEditingPlan({ ...editingPlan, monthly_price: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Coins Allocated</label>
                <input
                  type="number"
                  value={Number(editingPlan.coin_allocation || 0)}
                  onChange={(e) => setEditingPlan({ ...editingPlan, coin_allocation: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Products</label>
                <input
                  type="number"
                  value={Number(editingPlan.max_products || 0)}
                  onChange={(e) => setEditingPlan({ ...editingPlan, max_products: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold">
                {adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      {/* Add / Edit Manual Payment Number Modal */}
      <AdminModal
        open={mfsAccountModalOpen}
        title={
          mfsEditingAccountId
            ? lang === 'bn'
              ? `${activeMfsMethod.toUpperCase()} নম্বর এডিট করুন`
              : `Edit ${activeMfsMethod.toUpperCase()} Number`
            : lang === 'bn'
            ? `নতুন ${activeMfsMethod.toUpperCase()} নম্বর যোগ করুন`
            : `Add ${activeMfsMethod.toUpperCase()} Number`
        }
        subtitle={
          activeMfsMethod === 'bkash'
            ? `${activeMfsAccounts.length} / 9 numbers configured`
            : `${activeMfsAccounts.length} numbers configured`
        }
        onClose={() => setMfsAccountModalOpen(false)}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleSaveMfsAccount} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">
              {lang === 'bn' ? 'মোবাইল / মার্চেন্ট নম্বর *' : 'Mobile / Payment Number *'}
            </label>
            <input
              type="text"
              required
              placeholder="01XXXXXXXXX"
              value={mfsAccountForm.number}
              onChange={(e) => setMfsAccountForm((prev) => ({ ...prev, number: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">{lang === 'bn' ? 'অ্যাকাউন্ট টাইপ' : 'Account Type'}</label>
              <select
                value={mfsAccountForm.account_type}
                onChange={(e) => setMfsAccountForm((prev) => ({ ...prev, account_type: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              >
                <option value="Personal">Personal (Send Money)</option>
                <option value="Merchant">Merchant (Payment)</option>
                <option value="Agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">{lang === 'bn' ? 'লেবেল / নাম (ঐচ্ছিক)' : 'Label (Optional)'}</label>
              <input
                type="text"
                placeholder="e.g. Primary #1"
                value={mfsAccountForm.label}
                onChange={(e) => setMfsAccountForm((prev) => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">
              {lang === 'bn' ? 'এই নম্বরের আলাদা নির্দেশনা (ঐচ্ছিক)' : 'Per-Number Note / Instruction (Optional)'}
            </label>
            <input
              type="text"
              placeholder="e.g. Send Money only (Reference: Business Name)"
              value={mfsAccountForm.instructions}
              onChange={(e) => setMfsAccountForm((prev) => ({ ...prev, instructions: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <label className="flex items-center gap-2 font-semibold pt-1">
            <input
              type="checkbox"
              checked={mfsAccountForm.is_active}
              onChange={(e) => setMfsAccountForm((prev) => ({ ...prev, is_active: e.target.checked }))}
            />
            <span>{adminT(lang, 'active')}</span>
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setMfsAccountModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
            >
              {adminT(lang, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={mfsSaving}
              className="px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white font-semibold disabled:opacity-60"
            >
              {mfsSaving ? '...' : adminT(lang, 'saveChanges')}
            </button>
          </div>
        </form>
      </AdminModal>

      {/* Approve / Reject Payment Verification Modal */}
      <AdminModal
        open={Boolean(reviewModal)}
        title={
          reviewModal?.decision === 'approved'
            ? lang === 'bn'
              ? 'পেমেন্ট অনুমোদন করুন (Approve)'
              : 'Approve Manual Payment'
            : lang === 'bn'
            ? 'পেমেন্ট বাতিল করুন (Reject)'
            : 'Reject Manual Payment'
        }
        subtitle={reviewModal ? `${reviewModal.bizName} · ${reviewModal.targetTitle}` : undefined}
        onClose={() => {
          setReviewModal(null);
          setReviewError('');
        }}
        maxWidthClass="max-w-md"
      >
        {reviewModal && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setReviewError('');
              if (reviewModal.decision === 'rejected' && reviewNotes.trim().length < 3) {
                setReviewError(
                  lang === 'bn'
                    ? 'পেমেন্ট Reject করতে হলে অবশ্যই অন্তত ৩ অক্ষরের কারণ লিখতে হবে।'
                    : 'Please enter a clear rejection reason (at least 3 characters).'
                );
                return;
              }
              setReviewLoading(true);
              try {
                await apiFetch(`/api/admin/payments/${reviewModal.id}/review`, {
                  method: 'POST',
                  body: JSON.stringify({
                    decision: reviewModal.decision,
                    admin_notes: reviewNotes.trim(),
                  }),
                });
                onNotify(`Payment ${reviewModal.decision}.`);
                setReviewModal(null);
                setReviewNotes('');
                await loadSubTab('payments');
              } catch (err) {
                setReviewError(err instanceof Error ? err.message : 'Failed to review payment.');
              } finally {
                setReviewLoading(false);
              }
            }}
            className="space-y-4 text-xs"
          >
            <div className="p-3.5 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#7C8499]">Amount:</span>
                <span className="font-bold tabular-nums text-[#101536] dark:text-white">
                  {formatMoney(reviewModal.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7C8499]">Method:</span>
                <span className="font-semibold uppercase text-[#101536] dark:text-white">{reviewModal.gatewaySlug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7C8499]">TrxID:</span>
                <span className="font-mono font-bold text-[#5B35F5] dark:text-[#A78BFA]">{reviewModal.trxId}</span>
              </div>
              {reviewModal.senderNumber && (
                <div className="flex justify-between">
                  <span className="text-[#7C8499]">Sender:</span>
                  <span className="font-mono">{reviewModal.senderNumber}</span>
                </div>
              )}
              {reviewModal.paidToNumber && (
                <div className="flex justify-between">
                  <span className="text-[#7C8499]">Paid To:</span>
                  <span className="font-mono">{reviewModal.paidToNumber}</span>
                </div>
              )}
            </div>

            {reviewModal.decision === 'approved' ? (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                {lang === 'bn'
                  ? 'Approve করলে সংশ্লিষ্ট কয়েন প্যাকেজ বা সাবস্ক্রিপশন স্বয়ংক্রিয়ভাবে যুক্ত হবে এবং ইউজারকে নোটিফিকেশন পাঠানো হবে।'
                  : 'Approving will atomically credit the Coin Package or activate the Subscription Plan and notify the merchant.'}
              </div>
            ) : (
              <div>
                <label className="block font-semibold text-rose-600 dark:text-rose-400 mb-1">
                  {lang === 'bn' ? 'বাতিলের কারণ (ইউজার দেখতে পাবে) *' : 'Rejection Reason (Visible to User) *'}
                </label>
                <textarea
                  rows={3}
                  required
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder={
                    lang === 'bn'
                      ? 'যেমন: TrxID পাওয়া যায়নি বা পাঠানো টাকার পরিমাণ কম ছিল।'
                      : 'e.g. Transaction ID not found or amount mismatch.'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-950"
                />
              </div>
            )}

            {reviewModal.decision === 'approved' && (
              <div>
                <label className="block font-semibold mb-1">
                  {lang === 'bn' ? 'অ্যাডমিন নোট (ঐচ্ছিক)' : 'Admin Note (Optional)'}
                </label>
                <input
                  type="text"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Optional verification remark"
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
                />
              </div>
            )}

            {reviewError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">
                {reviewError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800">
              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => {
                  setReviewModal(null);
                  setReviewError('');
                }}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={reviewLoading}
                className={`px-4 py-2 rounded-xl text-white font-semibold disabled:opacity-60 inline-flex items-center gap-1.5 ${
                  reviewModal.decision === 'approved'
                    ? 'bg-[#16B66A] hover:bg-emerald-600'
                    : 'bg-[#EF4444] hover:bg-rose-600'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {reviewLoading
                    ? '...'
                    : reviewModal.decision === 'approved'
                    ? lang === 'bn'
                      ? 'Confirm Approve'
                      : 'Confirm Approve'
                    : lang === 'bn'
                    ? 'Confirm Reject'
                    : 'Confirm Reject'}
                </span>
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      {/* Add / Edit Payment Gateway Modal */}
      <AdminModal
        open={gatewayModalOpen}
        title={gatewayMode === 'create' ? adminT(lang, 'addGateway') : `${adminT(lang, 'editGateway')}: ${gatewayForm.name}`}
        subtitle={
          gatewayMode === 'create'
            ? lang === 'bn'
              ? 'ইউজার চেকআউটে দেখানোর জন্য নতুন পেমেন্ট গেটওয়ে তৈরি করুন।'
              : 'Configure a new payment gateway for user checkout & billing.'
            : `Slug: ${gatewayForm.slug}`
        }
        onClose={() => setGatewayModalOpen(false)}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSaveGateway} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">{adminT(lang, 'gatewayName')} *</label>
              <input
                type="text"
                required
                placeholder="e.g. bKash Personal / SSLCommerz"
                value={gatewayForm.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setGatewayForm((prev) => ({
                    ...prev,
                    name: nextName,
                    slug:
                      gatewayMode === 'create' && !gatewaySlugTouched
                        ? nextName
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]+/g, '_')
                            .replace(/^_+|_+$/g, '')
                            .slice(0, 48)
                        : prev.slug,
                  }));
                }}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">{adminT(lang, 'gatewaySlug')} *</label>
              <input
                type="text"
                required
                disabled={gatewayMode === 'edit'}
                placeholder="e.g. bkash_personal"
                value={gatewayForm.slug}
                onChange={(e) => {
                  setGatewaySlugTouched(true);
                  setGatewayForm((prev) => ({
                    ...prev,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                  }));
                }}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">{adminT(lang, 'gatewayType')} *</label>
              <select
                value={gatewayForm.gateway_type}
                onChange={(e) =>
                  setGatewayForm((prev) => ({
                    ...prev,
                    gateway_type: e.target.value as typeof prev.gateway_type,
                  }))
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              >
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="rocket">Rocket</option>
                <option value="sslcommerz">SSLCommerz</option>
                <option value="manual">Manual / Bank / Upay</option>
                <option value="custom">Custom Gateway</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">{adminT(lang, 'accountType')}</label>
              <input
                type="text"
                placeholder="e.g. Personal / Merchant / Bank"
                value={gatewayForm.account_type}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, account_type: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">{adminT(lang, 'accountNumber')}</label>
              <input
                type="text"
                placeholder="01XXXXXXXXX"
                value={gatewayForm.account_number}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, account_number: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Merchant / Store ID</label>
              <input
                type="text"
                placeholder="Optional merchant ID"
                value={gatewayForm.merchant_id}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, merchant_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">{adminT(lang, 'gatewayInstructions')}</label>
            <textarea
              rows={2}
              placeholder={
                lang === 'bn'
                  ? 'যেমন: 017XXXXXXXX নম্বরে Send Money করে নিচে TrxID দিন।'
                  : 'e.g. Send Money to 017XXXXXXXX (Personal) and enter your TrxID below.'
              }
              value={gatewayForm.instructions}
              onChange={(e) => setGatewayForm((prev) => ({ ...prev, instructions: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-[#101536] dark:text-white">{adminT(lang, 'apiCredentials')}</span>
              {gatewayMode === 'edit' && gatewayForm.has_credentials && (
                <StatusBadge status="active" label={adminT(lang, 'credentialsConfigured')} />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="password"
                placeholder={gatewayMode === 'edit' ? 'API / App Key (blank to keep)' : 'API / App Key (Optional)'}
                value={gatewayForm.api_key}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, api_key: e.target.value }))}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="password"
                placeholder={gatewayMode === 'edit' ? 'API / App Secret (blank to keep)' : 'API / App Secret (Optional)'}
                value={gatewayForm.api_secret}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, api_secret: e.target.value }))}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="text"
                placeholder="Username (Optional)"
                value={gatewayForm.username}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, username: e.target.value }))}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
              <input
                type="password"
                placeholder="Password (Optional)"
                value={gatewayForm.password}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, password: e.target.value }))}
                className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
              />
            </div>
            {gatewayMode === 'edit' && gatewayForm.has_credentials && (
              <label className="flex items-center gap-2 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                <input
                  type="checkbox"
                  checked={gatewayForm.clear_credentials}
                  onChange={(e) => setGatewayForm((prev) => ({ ...prev, clear_credentials: e.target.checked }))}
                />
                <span>Clear stored API credentials</span>
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-6 pt-1">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={gatewayForm.is_active}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              <span>{adminT(lang, 'active')}</span>
            </label>
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={gatewayForm.is_sandbox}
                onChange={(e) => setGatewayForm((prev) => ({ ...prev, is_sandbox: e.target.checked }))}
              />
              <span>Sandbox / Test Mode</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setGatewayModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
            >
              {adminT(lang, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={gatewaySaving}
              className="px-5 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white font-semibold disabled:opacity-60"
            >
              {gatewaySaving ? '...' : adminT(lang, 'saveChanges')}
            </button>
          </div>
        </form>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteGatewayConfirm)}
        title={adminT(lang, 'deleteGateway')}
        message={
          lang === 'bn'
            ? `আপনি কি নিশ্চিতভাবে "${deleteGatewayConfirm?.name || ''}" (${deleteGatewayConfirm?.slug || ''}) পেমেন্ট গেটওয়েটি ডিলিট করতে চান?`
            : `Delete payment gateway "${deleteGatewayConfirm?.name || ''}" (${deleteGatewayConfirm?.slug || ''})?`
        }
        tone="danger"
        confirmLabel={adminT(lang, 'delete')}
        cancelLabel={adminT(lang, 'cancel')}
        onCancel={() => setDeleteGatewayConfirm(null)}
        onConfirm={async () => {
          if (!deleteGatewayConfirm) return;
          try {
            await apiFetch(`/api/admin/payment-gateways/${deleteGatewayConfirm.slug}`, {
              method: 'DELETE',
            });
            onNotify(lang === 'bn' ? 'পেমেন্ট গেটওয়ে ডিলিট হয়েছে।' : 'Payment gateway deleted.');
            setDeleteGatewayConfirm(null);
            await loadSubTab('payments');
          } catch (err) {
            setDeleteGatewayConfirm(null);
            onError(err instanceof Error ? err.message : 'Failed to delete payment gateway.');
          }
        }}
      />
    </div>
  );
};
