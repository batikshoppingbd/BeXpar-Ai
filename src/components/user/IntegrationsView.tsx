import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Truck, Unplug } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { Business } from '../../types';
import type { Lang } from '../../i18n/translations';

interface IntegrationsViewProps {
  business: Business;
  lang: Lang;
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
  const [steadfastKey, setSteadfastKey] = useState('');
  const [steadfastSecret, setSteadfastSecret] = useState('');
  const [pathaoClientId, setPathaoClientId] = useState('');
  const [pathaoClientSecret, setPathaoClientSecret] = useState('');
  const [pathaoUsername, setPathaoUsername] = useState('');
  const [pathaoPassword, setPathaoPassword] = useState('');
  const [pathaoStoreId, setPathaoStoreId] = useState('');
  const [pathaoSandbox, setPathaoSandbox] = useState(false);
  const [shipments, setShipments] = useState<Array<{ id: string; provider: string; tracking_id: string; parcel_status: string; cod_amount: number; created_at: string }>>([]);

  // Meta CAPI state
  const [pixelId, setPixelId] = useState('');
  const [capiToken, setCapiToken] = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  const [capiActive, setCapiActive] = useState(false);
  const [capiEvents, setCapiEvents] = useState<Array<{ id: string; event_name: string; event_id: string; status: string; created_at: string }>>([]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [soc, cour, capi] = await Promise.all([
        apiFetch<NonNullable<typeof socialData>>(`/api/businesses/${business.id}/social`, { businessId: business.id }),
        apiFetch<{ accounts: Array<Record<string, unknown>>; shipments: typeof shipments }>(`/api/businesses/${business.id}/couriers`, {
          businessId: business.id,
        }).catch(() => ({ accounts: [], shipments: [] })),
        apiFetch<{ config: Record<string, unknown> | null; events: typeof capiEvents }>(`/api/businesses/${business.id}/capi`, {
          businessId: business.id,
        }).catch(() => ({ config: null, events: [] })),
      ]);
      setSocialData(soc);
      setShipments(cour.shipments || []);
      const pathaoAcc = (cour.accounts || []).find((a) => a.provider === 'pathao');
      if (pathaoAcc) {
        setPathaoClientId(String(pathaoAcc.client_id || ''));
        setPathaoUsername(String(pathaoAcc.username || ''));
        setPathaoStoreId(String(pathaoAcc.store_id || ''));
        setPathaoSandbox(Boolean(pathaoAcc.is_sandbox));
      }
      if (capi.config) {
        setPixelId(String(capi.config.pixel_id || ''));
        setTestEventCode(String(capi.config.test_event_code || ''));
        setCapiActive(Boolean(capi.config.is_active));
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
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/businesses/${business.id}/social/oauth/${platform}/url`,
        { businessId: business.id }
      );
      const popup = window.open(url, 'bexpar_meta_oauth', 'width=640,height=740');
      if (!popup) {
        setError('Popup was blocked by your browser. Please allow popups for this site.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Meta OAuth flow.');
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setConfirmDisconnectId(null);
    await apiFetch(`/api/businesses/${business.id}/social/${connectionId}/disconnect`, {
      method: 'POST',
      businessId: business.id,
    });
    void loadData();
  };

  const saveSteadfast = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/api/businesses/${business.id}/couriers`, {
      method: 'PUT',
      businessId: business.id,
      body: JSON.stringify({ provider: 'steadfast', api_key: steadfastKey, secret_key: steadfastSecret }),
    });
    setNotice('Steadfast Courier credentials saved securely on server.');
    setSteadfastKey('');
    setSteadfastSecret('');
  };

  const savePathao = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setNotice('Pathao Courier credentials saved securely on server.');
    setPathaoClientSecret('');
    setPathaoPassword('');
  };

  const saveCapi = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setNotice('Meta Conversions API settings saved.');
    setCapiToken('');
    void loadData();
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
                <p className="font-semibold">Meta Developer App credentials pending Super Admin configuration</p>
                <p className="mt-1">
                  To enable automatic OAuth popup onboarding for Facebook Pages, Instagram Professional accounts, and WhatsApp Embedded Signup, the Super Admin must configure Meta App ID, App Secret, and OAuth Redirect URLs under Super Admin → Social Integrations.
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form onSubmit={saveSteadfast} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm">
                <Truck className="w-4 h-4 text-emerald-600" />
                <span>Steadfast Courier API</span>
              </div>
              <input type="text" required placeholder="Api-Key" value={steadfastKey} onChange={(e) => setSteadfastKey(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
              <input type="password" required placeholder="Secret-Key" value={steadfastSecret} onChange={(e) => setSteadfastSecret(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">
                Save Steadfast Credentials
              </button>
            </form>

            <form onSubmit={savePathao} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm">
                <Truck className="w-4 h-4 text-rose-600" />
                <span>Pathao Courier API</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" required placeholder="Client ID" value={pathaoClientId} onChange={(e) => setPathaoClientId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
                <input type="password" required placeholder="Client Secret" value={pathaoClientSecret} onChange={(e) => setPathaoClientSecret(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
                <input type="text" required placeholder="Username / Email" value={pathaoUsername} onChange={(e) => setPathaoUsername(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs" />
                <input type="password" required placeholder="Password" value={pathaoPassword} onChange={(e) => setPathaoPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs" />
              </div>
              <div className="flex items-center gap-4">
                <input type="text" required placeholder="Store ID" value={pathaoStoreId} onChange={(e) => setPathaoStoreId(e.target.value)} className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={pathaoSandbox} onChange={(e) => setPathaoSandbox(e.target.checked)} />
                  <span>Sandbox</span>
                </label>
              </div>
              <button type="submit" className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700">
                Save Pathao Credentials
              </button>
            </form>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3">Parcel Bookings &amp; Live Tracking</h2>
            {shipments.length === 0 ? (
              <p className="text-xs text-slate-400">No parcel bookings yet. Book directly from any Order detail view.</p>
            ) : (
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
                {shipments.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <span className="uppercase font-semibold mr-2">{s.provider}</span>
                      <span className="font-mono">{s.tracking_id}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="capitalize">{s.parcel_status}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/businesses/${business.id}/shipments/${s.id}/sync`, {
                            method: 'POST',
                            businessId: business.id,
                          });
                          void loadData();
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
            <h2 className="text-sm font-display font-bold">Meta Conversions API (Server-Side)</h2>
            <input type="text" required placeholder="Meta Pixel ID" value={pixelId} onChange={(e) => setPixelId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
            <input type="password" placeholder="System User Access Token (leave blank to keep existing)" value={capiToken} onChange={(e) => setCapiToken(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
            <input type="text" placeholder="Test Event Code (optional)" value={testEventCode} onChange={(e) => setTestEventCode(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={capiActive} onChange={(e) => setCapiActive(e.target.checked)} className="rounded text-[#5B35F5]" />
              <span>Enable Server-Side Purchase &amp; Lead Events</span>
            </label>
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20">
                Save CAPI Config
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiFetch(`/api/businesses/${business.id}/capi/test`, { method: 'POST', businessId: business.id });
                  void loadData();
                }}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
              >
                Send Test Lead Event
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
