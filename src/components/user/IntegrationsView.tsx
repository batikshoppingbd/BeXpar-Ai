import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Power,
  RefreshCw,
  Star,
  Truck,
  Unplug,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { Business } from '../../types';
import type { Lang } from '../../i18n/translations';

interface IntegrationsViewProps {
  business: Business;
  lang: Lang;
}

interface SafeCourierAccount {
  id: string;
  provider: 'steadfast' | 'pathao';
  label: string;
  client_id: string;
  username: string;
  store_id: string;
  is_sandbox: boolean;
  is_active: boolean;
  is_default: boolean;
  updated_at: string;
  has_api_key: boolean;
  has_secret_key: boolean;
  has_client_secret: boolean;
  has_password: boolean;
}

interface RevealedCourierCreds {
  provider: 'steadfast' | 'pathao';
  api_key?: string;
  secret_key?: string;
  client_id?: string;
  client_secret?: string;
  username?: string;
  password?: string;
  store_id?: string;
  is_sandbox?: boolean;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ business, lang }) => {
  const [section, setSection] = useState<'social' | 'courier' | 'capi'>('social');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);

  // Social state
  const [socialData, setSocialData] = useState<{
    metaConfigured: boolean;
    metaMode: string;
    metaApiVersion: string;
    connections: Array<{ id: string; platform: string; account_id: string; account_name: string; status: string; token_expires_at?: string; connected_at: string }>;
    facebookPages: Array<{ id: string; page_id: string; page_name: string; page_picture: string; is_active: boolean; connected_at: string }>;
    instagramAccounts: Array<{ id: string; ig_account_id: string; username: string; account_type: string; profile_picture: string; is_active: boolean }>;
    whatsappAccounts: Array<{ id: string; waba_id: string; phone_number_id: string; display_phone_number: string; business_name: string; is_active: boolean }>;
    logs: Array<{ id: string; platform: string; event_type: string; status: string; message: string; created_at: string }>;
  } | null>(null);

  // Courier state
  const [steadfastAccount, setSteadfastAccount] = useState<SafeCourierAccount | null>(null);
  const [pathaoAccount, setPathaoAccount] = useState<SafeCourierAccount | null>(null);
  const [defaultCourier, setDefaultCourier] = useState<'steadfast' | 'pathao' | null>(null);

  const [steadfastEditing, setSteadfastEditing] = useState(false);
  const [steadfastKey, setSteadfastKey] = useState('');
  const [steadfastSecret, setSteadfastSecret] = useState('');
  const [showSteadfastKey, setShowSteadfastKey] = useState(false);
  const [showSteadfastSecret, setShowSteadfastSecret] = useState(false);
  const [revealedSteadfast, setRevealedSteadfast] = useState<RevealedCourierCreds | null>(null);
  const [revealingSteadfast, setRevealingSteadfast] = useState(false);
  const [savingSteadfast, setSavingSteadfast] = useState(false);
  const [testingSteadfast, setTestingSteadfast] = useState(false);

  const [pathaoEditing, setPathaoEditing] = useState(false);
  const [pathaoClientId, setPathaoClientId] = useState('');
  const [pathaoClientSecret, setPathaoClientSecret] = useState('');
  const [pathaoUsername, setPathaoUsername] = useState('');
  const [pathaoPassword, setPathaoPassword] = useState('');
  const [pathaoStoreId, setPathaoStoreId] = useState('');
  const [pathaoSandbox, setPathaoSandbox] = useState(false);
  const [showPathaoSecret, setShowPathaoSecret] = useState(false);
  const [showPathaoPassword, setShowPathaoPassword] = useState(false);
  const [revealedPathao, setRevealedPathao] = useState<RevealedCourierCreds | null>(null);
  const [revealingPathao, setRevealingPathao] = useState(false);
  const [savingPathao, setSavingPathao] = useState(false);
  const [testingPathao, setTestingPathao] = useState(false);

  const [togglingCourier, setTogglingCourier] = useState<string | null>(null);
  const [confirmCourierDisconnect, setConfirmCourierDisconnect] = useState<'steadfast' | 'pathao' | null>(null);
  const [copiedCred, setCopiedCred] = useState<string | null>(null);

  const [shipments, setShipments] = useState<
    Array<{
      id: string;
      provider: string;
      tracking_id: string;
      consignment_id?: string;
      parcel_status: string;
      cod_amount: number;
      created_at: string;
    }>
  >([]);

  // Meta CAPI state
  const [pixelId, setPixelId] = useState('');
  const [capiToken, setCapiToken] = useState('');
  const [capiHasToken, setCapiHasToken] = useState(false);
  const [testEventCode, setTestEventCode] = useState('');
  const [capiActive, setCapiActive] = useState(false);
  const [savingCapi, setSavingCapi] = useState(false);
  const [testingCapi, setTestingCapi] = useState(false);
  const [capiEvents, setCapiEvents] = useState<Array<{ id: string; event_name: string; event_id: string; status: string; created_at: string }>>([]);

  const steadfastConfigured = Boolean(steadfastAccount?.has_api_key && steadfastAccount?.has_secret_key);
  const pathaoConfigured = Boolean(pathaoAccount?.has_client_secret && pathaoAccount?.has_password);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [soc, cour, capi] = await Promise.all([
        apiFetch<NonNullable<typeof socialData>>(`/api/businesses/${business.id}/social`, { businessId: business.id }),
        apiFetch<{ accounts: SafeCourierAccount[]; defaultProvider?: 'steadfast' | 'pathao' | null; shipments: typeof shipments }>(
          `/api/businesses/${business.id}/couriers`,
          { businessId: business.id }
        ),
        apiFetch<{ config: Record<string, unknown> | null; events: typeof capiEvents }>(`/api/businesses/${business.id}/capi`, {
          businessId: business.id,
        }),
      ]);
      setSocialData(soc);
      setShipments(cour.shipments || []);
      setDefaultCourier(cour.defaultProvider || null);

      const sfAcc = (cour.accounts || []).find((a) => a.provider === 'steadfast') || null;
      const ptAcc = (cour.accounts || []).find((a) => a.provider === 'pathao') || null;
      setSteadfastAccount(sfAcc);
      setPathaoAccount(ptAcc);

      if (!sfAcc) {
        setSteadfastEditing(true);
        setRevealedSteadfast(null);
      }
      if (ptAcc) {
        setPathaoClientId(String(ptAcc.client_id || ''));
        setPathaoUsername(String(ptAcc.username || ''));
        setPathaoStoreId(String(ptAcc.store_id || ''));
        setPathaoSandbox(Boolean(ptAcc.is_sandbox));
      } else {
        setPathaoEditing(true);
        setRevealedPathao(null);
        setPathaoClientId('');
        setPathaoUsername('');
        setPathaoStoreId('');
        setPathaoSandbox(false);
      }

      if (capi.config) {
        setPixelId(String(capi.config.pixel_id || ''));
        setTestEventCode(String(capi.config.test_event_code || ''));
        setCapiActive(Boolean(capi.config.is_active));
        setCapiHasToken(Boolean(capi.config.has_access_token));
      } else {
        setPixelId('');
        setTestEventCode('');
        setCapiActive(false);
        setCapiHasToken(false);
      }
      setCapiEvents(capi.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [business.id]);

  // Listen for OAuth Popup postMessage
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin &&
        !event.origin.endsWith('.run.app') &&
        !event.origin.includes('localhost')
      ) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setNotice(`${String(event.data.platform || 'Social')} connected successfully!`);
        void loadData();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setError(String(event.data.error || 'OAuth authorization failed.'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleMetaConnect = async (platform: 'facebook' | 'instagram' | 'whatsapp') => {
    setError('');
    setNotice('');
    const popup = window.open('', 'bexpar_meta_oauth', 'width=640,height=740');
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/businesses/${business.id}/social/oauth/${platform}/url`,
        { businessId: business.id }
      );
      if (popup && !popup.closed) {
        popup.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      if (popup && !popup.closed) {
        popup.close();
      }
      setError(err instanceof Error ? err.message : 'Unable to start Meta OAuth flow.');
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setConfirmDisconnectId(null);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/businesses/${business.id}/social/${connectionId}/disconnect`, {
        method: 'POST',
        businessId: business.id,
      });
      setNotice(lang === 'bn' ? 'অ্যাকাউন্ট ডিসকানেক্ট করা হয়েছে।' : 'Social account disconnected.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect account.');
    }
  };

  const fetchRevealedCredentials = async (provider: 'steadfast' | 'pathao'): Promise<RevealedCourierCreds | null> => {
    setError('');
    if (provider === 'steadfast') setRevealingSteadfast(true);
    else setRevealingPathao(true);
    try {
      const res = await apiFetch<{ credentials: RevealedCourierCreds }>(
        `/api/businesses/${business.id}/couriers/${provider}/reveal`,
        { method: 'POST', businessId: business.id }
      );
      if (provider === 'steadfast') {
        setRevealedSteadfast(res.credentials);
      } else {
        setRevealedPathao(res.credentials);
      }
      return res.credentials;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to decrypt ${provider} credentials.`);
      return null;
    } finally {
      if (provider === 'steadfast') setRevealingSteadfast(false);
      else setRevealingPathao(false);
    }
  };

  const toggleRevealField = async (provider: 'steadfast' | 'pathao', field: 'api_key' | 'secret_key' | 'client_secret' | 'password') => {
    if (provider === 'steadfast') {
      const currentlyShown = field === 'api_key' ? showSteadfastKey : showSteadfastSecret;
      if (!currentlyShown && steadfastConfigured && !revealedSteadfast) {
        const creds = await fetchRevealedCredentials('steadfast');
        if (!creds) return;
      }
      if (field === 'api_key') setShowSteadfastKey((s) => !s);
      else setShowSteadfastSecret((s) => !s);
    } else {
      const currentlyShown = field === 'client_secret' ? showPathaoSecret : showPathaoPassword;
      if (!currentlyShown && pathaoConfigured && !revealedPathao) {
        const creds = await fetchRevealedCredentials('pathao');
        if (!creds) return;
      }
      if (field === 'client_secret') setShowPathaoSecret((s) => !s);
      else setShowPathaoPassword((s) => !s);
    }
  };

  const copyCredential = async (
    key: string,
    provider: 'steadfast' | 'pathao',
    field: 'api_key' | 'secret_key' | 'client_id' | 'client_secret' | 'username' | 'password' | 'store_id',
    directValue?: string
  ) => {
    setError('');
    let val = directValue || '';
    if (!val) {
      const creds =
        provider === 'steadfast'
          ? revealedSteadfast || (await fetchRevealedCredentials('steadfast'))
          : revealedPathao || (await fetchRevealedCredentials('pathao'));
      if (creds) {
        val = String(creds[field] || '');
      }
    }
    if (!val) {
      setError('Credential value is empty.');
      return;
    }
    try {
      await navigator.clipboard.writeText(val);
      setCopiedCred(key);
      setTimeout(() => setCopiedCred((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      setError('Clipboard copy failed. Please reveal and copy manually.');
    }
  };

  const startEditCourier = async (provider: 'steadfast' | 'pathao') => {
    setError('');
    setNotice('');
    if (provider === 'steadfast') {
      const creds = revealedSteadfast || (steadfastConfigured ? await fetchRevealedCredentials('steadfast') : null);
      if (creds) {
        setSteadfastKey(creds.api_key || '');
        setSteadfastSecret(creds.secret_key || '');
      }
      setSteadfastEditing(true);
    } else {
      const creds = revealedPathao || (pathaoConfigured ? await fetchRevealedCredentials('pathao') : null);
      if (creds) {
        setPathaoClientId(creds.client_id || '');
        setPathaoClientSecret(creds.client_secret || '');
        setPathaoUsername(creds.username || '');
        setPathaoPassword(creds.password || '');
        setPathaoStoreId(creds.store_id || '');
        setPathaoSandbox(Boolean(creds.is_sandbox));
      }
      setPathaoEditing(true);
    }
  };

  const saveSteadfast = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSavingSteadfast(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/couriers`, {
        method: 'PUT',
        businessId: business.id,
        body: JSON.stringify({ provider: 'steadfast', api_key: steadfastKey, secret_key: steadfastSecret }),
      });
      setNotice(
        lang === 'bn'
          ? 'Steadfast কুরিয়ার ক্রেডেনশিয়াল নিরাপদভাবে সংরক্ষণ করা হয়েছে।'
          : 'Steadfast Courier credentials saved securely on server.'
      );
      setSteadfastKey('');
      setSteadfastSecret('');
      setRevealedSteadfast(null);
      setShowSteadfastKey(false);
      setShowSteadfastSecret(false);
      setSteadfastEditing(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Steadfast credentials.');
    } finally {
      setSavingSteadfast(false);
    }
  };

  const savePathao = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSavingPathao(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/couriers`, {
        method: 'PUT',
        businessId: business.id,
        body: JSON.stringify({
          provider: 'pathao',
          client_id: pathaoClientId,
          client_secret: pathaoClientSecret,
          username: pathaoUsername,
          password: pathaoPassword,
          store_id: pathaoStoreId,
          is_sandbox: pathaoSandbox,
        }),
      });
      setNotice(
        lang === 'bn'
          ? 'Pathao কুরিয়ার ক্রেডেনশিয়াল নিরাপদভাবে সংরক্ষণ করা হয়েছে।'
          : 'Pathao Courier credentials saved securely on server.'
      );
      setPathaoClientSecret('');
      setPathaoPassword('');
      setRevealedPathao(null);
      setShowPathaoSecret(false);
      setShowPathaoPassword(false);
      setPathaoEditing(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Pathao credentials.');
    } finally {
      setSavingPathao(false);
    }
  };

  const updateCourierState = async (
    provider: 'steadfast' | 'pathao',
    patch: { is_active?: boolean; is_default?: boolean }
  ) => {
    setError('');
    setNotice('');
    setTogglingCourier(provider);
    try {
      await apiFetch(`/api/businesses/${business.id}/couriers/${provider}`, {
        method: 'PATCH',
        businessId: business.id,
        body: JSON.stringify(patch),
      });
      if (patch.is_default) {
        setNotice(
          lang === 'bn'
            ? `${provider.toUpperCase()} ডিফল্ট কুরিয়ার হিসেবে সেট করা হয়েছে।`
            : `${provider.toUpperCase()} set as your Default Courier.`
        );
      } else {
        setNotice(
          `${provider.toUpperCase()} ${patch.is_active ? 'activated' : 'deactivated'}.`
        );
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to update ${provider} settings.`);
    } finally {
      setTogglingCourier(null);
    }
  };

  const disconnectCourier = async (provider: 'steadfast' | 'pathao') => {
    setConfirmCourierDisconnect(null);
    setError('');
    setNotice('');
    setTogglingCourier(provider);
    try {
      await apiFetch(`/api/businesses/${business.id}/couriers/${provider}`, {
        method: 'DELETE',
        businessId: business.id,
      });
      if (provider === 'steadfast') {
        setSteadfastKey('');
        setSteadfastSecret('');
        setRevealedSteadfast(null);
        setSteadfastEditing(true);
      } else {
        setPathaoClientId('');
        setPathaoClientSecret('');
        setPathaoUsername('');
        setPathaoPassword('');
        setPathaoStoreId('');
        setRevealedPathao(null);
        setPathaoEditing(true);
      }
      setNotice(
        lang === 'bn'
          ? `${provider.toUpperCase()} কুরিয়ার ডিসকানেক্ট করা হয়েছে।`
          : `${provider.toUpperCase()} courier disconnected.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to disconnect ${provider}.`);
    } finally {
      setTogglingCourier(null);
    }
  };

  const testCourier = async (provider: 'steadfast' | 'pathao') => {
    setError('');
    setNotice('');
    if (provider === 'steadfast') setTestingSteadfast(true);
    else setTestingPathao(true);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/api/businesses/${business.id}/couriers/${provider}/test`,
        { method: 'POST', businessId: business.id }
      );
      setNotice(res.message || `${provider.toUpperCase()} verified successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to verify ${provider} connection.`);
    } finally {
      if (provider === 'steadfast') setTestingSteadfast(false);
      else setTestingPathao(false);
    }
  };

  const saveCapi = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSavingCapi(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/capi`, {
        method: 'PUT',
        businessId: business.id,
        body: JSON.stringify({
          pixel_id: pixelId,
          access_token: capiToken,
          test_event_code: testEventCode,
          is_active: capiActive,
        }),
      });
      setNotice(lang === 'bn' ? 'Meta Conversions API সেটিংস সংরক্ষণ করা হয়েছে।' : 'Meta Conversions API settings saved.');
      setCapiToken('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Meta CAPI settings.');
    } finally {
      setSavingCapi(false);
    }
  };

  const sendTestCapi = async () => {
    setError('');
    setNotice('');
    setTestingCapi(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/capi/test`, {
        method: 'POST',
        businessId: business.id,
      });
      setNotice(
        lang === 'bn'
          ? 'Meta CAPI-তে টেস্ট Lead ইভেন্ট সফলভাবে পাঠানো হয়েছে!'
          : 'Test Lead event dispatched to Meta Conversions API!'
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send test CAPI event.');
      await loadData();
    } finally {
      setTestingCapi(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'সোশ্যাল মিডিয়া ও কুরিয়ার ইন্টিগ্রেশন' : 'Social Media, Courier & CAPI Integrations'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Official 1-click Meta OAuth onboarding, Steadfast/Pathao courier API, and Meta Conversions API.</p>
        </div>
        <div className="inline-flex p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800 overflow-x-auto max-w-full">
          {(
            [
              ['social', 'Social Media (FB/IG/WA)'],
              ['courier', 'Steadfast & Pathao'],
              ['capi', 'Meta CAPI'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSection(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                section === k ? 'bg-[#5B35F5] text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400">Loading integrations...</div>
      ) : section === 'social' ? (
        <div className="space-y-6">
          {!socialData?.metaConfigured && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {lang === 'bn'
                    ? 'Super Admin থেকে Meta App ID ও Secret সেট করা বাকি আছে'
                    : 'Meta Developer App credentials pending Super Admin configuration'}
                </p>
                <p className="mt-1">
                  {lang === 'bn'
                    ? 'Facebook, Instagram ও WhatsApp ১-ক্লিক কানেক্ট চালু করতে Super Admin Console → প্ল্যাটফর্ম সেটিংস → মেটা প্ল্যাটফর্ম API ট্যাবে গিয়ে Meta App ID এবং App Secret সংরক্ষণ করুন।'
                    : 'To enable automatic OAuth onboarding for Facebook Pages, Instagram Professional accounts, and WhatsApp Embedded Signup, configure Meta App ID and App Secret under Super Admin Console → Platform Settings → Meta Platform API.'}
                </p>
              </div>
            </div>
          )}

          {/* 3 Automatic Connect Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">Facebook Pages</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Automatic Meta Login authorization with <span className="font-mono">pages_messaging</span> &amp; <span className="font-mono">pages_show_list</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleMetaConnect('facebook')}
                className="mt-4 w-full py-2.5 px-4 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect Facebook Page</span>
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">Instagram Professional</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Business &amp; Creator accounts via official Meta Instagram Messaging permissions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleMetaConnect('instagram')}
                className="mt-4 w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 to-[#5B35F5] hover:opacity-95 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect Instagram</span>
              </button>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between">
              <div>
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">WhatsApp Business</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Official Meta WhatsApp Embedded Signup &amp; Cloud API automatic webhook provisioning.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleMetaConnect('whatsapp')}
                className="mt-4 w-full py-2.5 px-4 rounded-xl bg-[#25D366] hover:bg-[#20BD5A] text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect WhatsApp Business</span>
              </button>
            </div>
          </div>

          {/* Connected Accounts */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3">Connected Social Accounts ({socialData?.connections.length || 0})</h2>
            {!socialData?.connections.length ? (
              <p className="text-xs text-slate-400 py-4">No channels connected yet.</p>
            ) : (
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
                {socialData.connections.map((conn) => (
                  <div key={conn.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{conn.account_name}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {conn.platform.toUpperCase()} · ID: {conn.account_id} · Connected {new Date(conn.connected_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium inline-flex items-center gap-1 ${conn.status === 'connected' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="capitalize">{conn.status}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleMetaConnect(conn.platform as 'facebook' | 'instagram' | 'whatsapp')}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Reconnect</span>
                      </button>
                      {confirmDisconnectId === conn.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDisconnect(conn.id)}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-medium"
                          >
                            Confirm Disconnect
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDisconnectId(null)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnectId(conn.id)}
                          className="px-2.5 py-1 rounded-lg border border-rose-200 text-rose-600 text-xs inline-flex items-center gap-1"
                        >
                          <Unplug className="w-3 h-3" />
                          <span>Disconnect</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Connection Logs */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#5B35F5] dark:text-[#A78BFA]" />
              <span>Connection Health &amp; Logs</span>
            </h2>
            {!socialData?.logs.length ? (
              <p className="text-xs text-slate-400">No connection events logged yet.</p>
            ) : (
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
                {socialData.logs.map((l) => (
                  <div key={l.id} className="py-2 flex items-center justify-between">
                    <span>
                      <strong className="uppercase mr-2">{l.platform}</strong>
                      {l.message}
                    </span>
                    <span className="font-mono text-slate-400">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : section === 'courier' ? (
        <div className="space-y-6">
          {/* Default Courier Selector Banner */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
                <Star className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-display font-bold text-slate-900 dark:text-white">
                  {lang === 'bn' ? 'ডিফল্ট কুরিয়ার নির্বাচন' : 'Default Courier Selection'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'bn'
                    ? 'Steadfast ও Pathao একসাথে কানেক্ট করতে পারবেন এবং একটিকে Default হিসেবে সেট করতে পারবেন।'
                    : 'Connect Steadfast & Pathao simultaneously and choose your default courier for order bookings.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(['steadfast', 'pathao'] as const).map((prov) => {
                const acc = prov === 'steadfast' ? steadfastAccount : pathaoAccount;
                const isDef = defaultCourier === prov;
                const isActive = Boolean(acc?.is_active);
                return (
                  <button
                    key={prov}
                    type="button"
                    disabled={!acc || !isActive || isDef || togglingCourier === prov}
                    onClick={() => void updateCourierState(prov, { is_default: true })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                      isDef
                        ? 'bg-[#5B35F5] border-[#5B35F5] text-white shadow-sm'
                        : 'border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${isDef ? 'fill-white' : ''}`} />
                    <span className="capitalize">{prov}</span>
                    {isDef && <span className="text-[10px] opacity-90">(Default)</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* STEADFAST CARD */}
            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-display font-bold text-sm text-slate-900 dark:text-white">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <span>Steadfast Courier API</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {steadfastAccount?.is_default && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F0FF] text-[#5B35F5] dark:bg-[#5B35F5]/20 dark:text-[#A78BFA]">
                      <Star className="w-3 h-3 fill-current" /> Default
                    </span>
                  )}
                  {steadfastConfigured ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        steadfastAccount?.is_active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {steadfastAccount?.is_active ? 'Active' : 'Inactive'}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Not Connected
                    </span>
                  )}
                </div>
              </div>

              {steadfastConfigured && !steadfastEditing ? (
                <div className="space-y-3">
                  {/* Api-Key Row */}
                  <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <span>Api-Key</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={revealingSteadfast}
                          onClick={() => void toggleRevealField('steadfast', 'api_key')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                          title={showSteadfastKey ? 'Hide Api-Key' : 'Show Full Api-Key'}
                        >
                          {revealingSteadfast ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : showSteadfastKey ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          <span>{showSteadfastKey ? 'Hide' : 'Show'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyCredential('sf-key', 'steadfast', 'api_key')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          title="Copy Api-Key"
                        >
                          {copiedCred === 'sf-key' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedCred === 'sf-key' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="font-mono text-xs text-slate-900 dark:text-slate-100 break-all select-all">
                      {showSteadfastKey && revealedSteadfast?.api_key
                        ? revealedSteadfast.api_key
                        : '••••••••••••••••••••••••••••'}
                    </div>
                  </div>

                  {/* Secret-Key Row */}
                  <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <span>Secret-Key</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={revealingSteadfast}
                          onClick={() => void toggleRevealField('steadfast', 'secret_key')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                          title={showSteadfastSecret ? 'Hide Secret-Key' : 'Show Full Secret-Key'}
                        >
                          {revealingSteadfast ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : showSteadfastSecret ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          <span>{showSteadfastSecret ? 'Hide' : 'Show'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyCredential('sf-sec', 'steadfast', 'secret_key')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          title="Copy Secret-Key"
                        >
                          {copiedCred === 'sf-sec' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedCred === 'sf-sec' ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="font-mono text-xs text-slate-900 dark:text-slate-100 break-all select-all">
                      {showSteadfastSecret && revealedSteadfast?.secret_key
                        ? revealedSteadfast.secret_key
                        : '••••••••••••••••••••••••••••'}
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void startEditCourier('steadfast')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Credentials</span>
                    </button>
                    <button
                      type="button"
                      disabled={testingSteadfast}
                      onClick={() => void testCourier('steadfast')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-60"
                    >
                      {testingSteadfast ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span>{testingSteadfast ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={togglingCourier === 'steadfast'}
                      onClick={() =>
                        void updateCourierState('steadfast', { is_active: !steadfastAccount?.is_active })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                        steadfastAccount?.is_active
                          ? 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-300'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{steadfastAccount?.is_active ? 'Set Inactive' : 'Set Active'}</span>
                    </button>

                    {confirmCourierDisconnect === 'steadfast' ? (
                      <div className="inline-flex items-center gap-1.5 ml-auto">
                        <button
                          type="button"
                          onClick={() => void disconnectCourier('steadfast')}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                        >
                          Confirm Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmCourierDisconnect(null)}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCourierDisconnect('steadfast')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-semibold ml-auto hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <form onSubmit={saveSteadfast} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Api-Key *
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type={showSteadfastKey ? 'text' : 'password'}
                        required={!steadfastConfigured}
                        placeholder="Enter Steadfast Api-Key"
                        value={steadfastKey}
                        onChange={(e) => setSteadfastKey(e.target.value)}
                        className="w-full pl-3 pr-16 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSteadfastKey((s) => !s)}
                        className="absolute right-2 p-1 text-slate-400 hover:text-[#5B35F5]"
                        aria-label={showSteadfastKey ? 'Hide Api-Key' : 'Show Api-Key'}
                      >
                        {showSteadfastKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Secret-Key *
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type={showSteadfastSecret ? 'text' : 'password'}
                        required={!steadfastConfigured}
                        placeholder="Enter Steadfast Secret-Key"
                        value={steadfastSecret}
                        onChange={(e) => setSteadfastSecret(e.target.value)}
                        className="w-full pl-3 pr-16 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSteadfastSecret((s) => !s)}
                        className="absolute right-2 p-1 text-slate-400 hover:text-[#5B35F5]"
                        aria-label={showSteadfastSecret ? 'Hide Secret-Key' : 'Show Secret-Key'}
                      >
                        {showSteadfastSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={savingSteadfast}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {savingSteadfast
                        ? 'Saving...'
                        : steadfastConfigured
                        ? 'Update / Save Changes'
                        : 'Save Steadfast Credentials'}
                    </button>
                    {steadfastConfigured && (
                      <button
                        type="button"
                        onClick={() => {
                          setSteadfastEditing(false);
                          setSteadfastKey('');
                          setSteadfastSecret('');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            {/* PATHAO CARD */}
            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-display font-bold text-sm text-slate-900 dark:text-white">
                  <Truck className="w-4 h-4 text-rose-600" />
                  <span>Pathao Courier API</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {pathaoAccount?.is_default && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F0FF] text-[#5B35F5] dark:bg-[#5B35F5]/20 dark:text-[#A78BFA]">
                      <Star className="w-3 h-3 fill-current" /> Default
                    </span>
                  )}
                  {pathaoConfigured ? (
                    <>
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          pathaoAccount?.is_active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {pathaoAccount?.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {pathaoAccount?.is_sandbox && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Sandbox
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Not Connected
                    </span>
                  )}
                </div>
              </div>

              {pathaoConfigured && !pathaoEditing ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* Client ID */}
                    <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-2.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                        <span>Client ID</span>
                        <button
                          type="button"
                          onClick={() => void copyCredential('pt-cid', 'pathao', 'client_id', pathaoClientId)}
                          className="text-slate-500 hover:text-[#5B35F5]"
                          title="Copy Client ID"
                        >
                          {copiedCred === 'pt-cid' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="font-mono text-xs text-slate-900 dark:text-slate-100 mt-1 break-all select-all">
                        {pathaoClientId || '—'}
                      </div>
                    </div>

                    {/* Store ID */}
                    <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-2.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                        <span>Store ID</span>
                        <button
                          type="button"
                          onClick={() => void copyCredential('pt-store', 'pathao', 'store_id', pathaoStoreId)}
                          className="text-slate-500 hover:text-[#5B35F5]"
                          title="Copy Store ID"
                        >
                          {copiedCred === 'pt-store' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="font-mono text-xs text-slate-900 dark:text-slate-100 mt-1 break-all select-all">
                        {pathaoStoreId || '—'}
                      </div>
                    </div>

                    {/* Client Secret */}
                    <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-2.5 sm:col-span-2">
                      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                        <span>Client Secret</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={revealingPathao}
                            onClick={() => void toggleRevealField('pathao', 'client_secret')}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                          >
                            {revealingPathao ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : showPathaoSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{showPathaoSecret ? 'Hide' : 'Show'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyCredential('pt-csec', 'pathao', 'client_secret')}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-[#E6E0FF]/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          >
                            {copiedCred === 'pt-csec' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedCred === 'pt-csec' ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>
                      <div className="font-mono text-xs text-slate-900 dark:text-slate-100 mt-1 break-all select-all">
                        {showPathaoSecret && revealedPathao?.client_secret
                          ? revealedPathao.client_secret
                          : '••••••••••••••••••••••••••••'}
                      </div>
                    </div>

                    {/* Username */}
                    <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-2.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                        <span>Username / Email</span>
                        <button
                          type="button"
                          onClick={() => void copyCredential('pt-user', 'pathao', 'username', pathaoUsername)}
                          className="text-slate-500 hover:text-[#5B35F5]"
                        >
                          {copiedCred === 'pt-user' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="text-xs text-slate-900 dark:text-slate-100 mt-1 break-all select-all">
                        {pathaoUsername || '—'}
                      </div>
                    </div>

                    {/* Password */}
                    <div className="rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 p-2.5">
                      <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-slate-500">
                        <span>Password</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={revealingPathao}
                            onClick={() => void toggleRevealField('pathao', 'password')}
                            className="text-[#5B35F5] dark:text-[#A78BFA]"
                            title={showPathaoPassword ? 'Hide Password' : 'Show Password'}
                          >
                            {showPathaoPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyCredential('pt-pass', 'pathao', 'password')}
                            className="text-slate-500 hover:text-[#5B35F5]"
                            title="Copy Password"
                          >
                            {copiedCred === 'pt-pass' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div className="font-mono text-xs text-slate-900 dark:text-slate-100 mt-1 break-all select-all">
                        {showPathaoPassword && revealedPathao?.password
                          ? revealedPathao.password
                          : '••••••••••••••••'}
                      </div>
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void startEditCourier('pathao')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Credentials</span>
                    </button>
                    <button
                      type="button"
                      disabled={testingPathao}
                      onClick={() => void testCourier('pathao')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-60"
                    >
                      {testingPathao ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span>{testingPathao ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={togglingCourier === 'pathao'}
                      onClick={() =>
                        void updateCourierState('pathao', { is_active: !pathaoAccount?.is_active })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
                        pathaoAccount?.is_active
                          ? 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-300'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{pathaoAccount?.is_active ? 'Set Inactive' : 'Set Active'}</span>
                    </button>

                    {confirmCourierDisconnect === 'pathao' ? (
                      <div className="inline-flex items-center gap-1.5 ml-auto">
                        <button
                          type="button"
                          onClick={() => void disconnectCourier('pathao')}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                        >
                          Confirm Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmCourierDisconnect(null)}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCourierDisconnect('pathao')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-semibold ml-auto hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <form onSubmit={savePathao} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Client ID *</label>
                      <input
                        type="text"
                        required
                        placeholder="Client ID"
                        value={pathaoClientId}
                        onChange={(e) => setPathaoClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Client Secret *</label>
                      <div className="relative flex items-center">
                        <input
                          type={showPathaoSecret ? 'text' : 'password'}
                          required={!pathaoConfigured}
                          placeholder={pathaoConfigured ? 'Leave blank to keep existing' : 'Client Secret'}
                          value={pathaoClientSecret}
                          onChange={(e) => setPathaoClientSecret(e.target.value)}
                          className="w-full pl-3 pr-9 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPathaoSecret((s) => !s)}
                          className="absolute right-2 p-1 text-slate-400 hover:text-[#5B35F5]"
                        >
                          {showPathaoSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Username / Email *</label>
                      <input
                        type="text"
                        required
                        placeholder="Username / Email"
                        value={pathaoUsername}
                        onChange={(e) => setPathaoUsername(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Password *</label>
                      <div className="relative flex items-center">
                        <input
                          type={showPathaoPassword ? 'text' : 'password'}
                          required={!pathaoConfigured}
                          placeholder={pathaoConfigured ? 'Leave blank to keep existing' : 'Password'}
                          value={pathaoPassword}
                          onChange={(e) => setPathaoPassword(e.target.value)}
                          className="w-full pl-3 pr-9 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPathaoPassword((s) => !s)}
                          className="absolute right-2 p-1 text-slate-400 hover:text-[#5B35F5]"
                        >
                          {showPathaoPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Store ID *</label>
                      <input
                        type="text"
                        required
                        placeholder="Store ID"
                        value={pathaoStoreId}
                        onChange={(e) => setPathaoStoreId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs pt-4">
                      <input type="checkbox" checked={pathaoSandbox} onChange={(e) => setPathaoSandbox(e.target.checked)} />
                      <span>Sandbox</span>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={savingPathao}
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-60"
                    >
                      {savingPathao
                        ? 'Saving...'
                        : pathaoConfigured
                        ? 'Update / Save Changes'
                        : 'Save Pathao Credentials'}
                    </button>
                    {pathaoConfigured && (
                      <button
                        type="button"
                        onClick={() => {
                          setPathaoEditing(false);
                          setPathaoClientSecret('');
                          setPathaoPassword('');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3">Parcel Bookings &amp; Live Tracking</h2>
            {shipments.length === 0 ? (
              <p className="text-xs text-slate-400">No parcel bookings yet. Book directly from any Order detail view.</p>
            ) : (
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
                {shipments.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="uppercase font-semibold">{s.provider}</span>
                      {s.consignment_id && (
                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                          Parcel ID: #{s.consignment_id}
                        </span>
                      )}
                      <span className="font-mono text-slate-600 dark:text-slate-300">Track: {s.tracking_id}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="capitalize">{s.parcel_status}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          setError('');
                          try {
                            await apiFetch(`/api/businesses/${business.id}/shipments/${s.id}/sync`, {
                              method: 'POST',
                              businessId: business.id,
                            });
                            setNotice(`Tracking synced for ${s.tracking_id}.`);
                            await loadData();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to sync shipment status.');
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-700 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                      >
                        Sync Status
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={saveCapi} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-display font-bold">Meta Conversions API (Server-Side)</h2>
              {capiHasToken && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" /> Token Saved
                </span>
              )}
            </div>
            <input
              type="text"
              required
              placeholder="Meta Pixel ID"
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
            />
            <input
              type="password"
              required={!capiHasToken}
              placeholder={capiHasToken ? 'System User Access Token (leave blank to keep existing)' : 'System User Access Token'}
              value={capiToken}
              onChange={(e) => setCapiToken(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
            />
            <input
              type="text"
              placeholder="Test Event Code (optional)"
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
            />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={capiActive} onChange={(e) => setCapiActive(e.target.checked)} className="rounded text-[#5B35F5]" />
              <span>Enable Server-Side Purchase &amp; Lead Events</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={savingCapi}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 disabled:opacity-60"
              >
                {savingCapi ? 'Saving...' : 'Save CAPI Config'}
              </button>
              <button
                type="button"
                disabled={testingCapi}
                onClick={() => void sendTestCapi()}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-60"
              >
                {testingCapi ? 'Sending...' : 'Send Test Lead Event'}
              </button>
            </div>
          </form>

          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3">CAPI Delivery Logs</h2>
            {capiEvents.length === 0 ? (
              <p className="text-xs text-slate-400">No CAPI events dispatched yet.</p>
            ) : (
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
                {capiEvents.map((ev) => (
                  <div key={ev.id} className="py-2 flex items-center justify-between">
                    <span>
                      <strong>{ev.event_name}</strong> · <span className="font-mono text-slate-400">{ev.event_id}</span>
                    </span>
                    <span className={ev.status === 'sent' ? 'text-emerald-600' : 'text-rose-600'}>{ev.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
