import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  CreditCard,
  Loader2,
  X,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { Business, SubscriptionPlan } from '../../types';
import type { Lang } from '../../i18n/translations';

interface CoinPackage {
  id: string;
  name: string;
  coin_amount: number;
  bonus_coins: number;
  price: number;
  currency: string;
  validity_days: number;
  description: string;
}

interface PaymentAccountOption {
  id: string;
  number: string;
  account_type: string;
  label?: string;
  instructions?: string;
  is_active: boolean;
}

interface Gateway {
  slug: string;
  name: string;
  gateway_type: string;
  instructions: string;
  config_public?: Record<string, unknown>;
  active_accounts?: PaymentAccountOption[];
}

interface PaymentRecord {
  id: string;
  gateway_slug: string;
  payment_for: string;
  amount: number;
  currency?: string;
  transaction_id: string;
  sender_number?: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  admin_notes?: string;
  reviewed_at?: string;
  created_at: string;
  gateway_response?: {
    gateway_name?: string;
    paid_to_number?: string;
    target_title?: string;
  };
}

interface WalletNotification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning' | 'error';
  is_read: boolean;
  created_at: string;
}

interface WalletAndBillingViewProps {
  business: Business;
  lang: Lang;
}

function getGatewayActiveNumbers(gw?: Gateway): PaymentAccountOption[] {
  if (!gw) return [];
  if (Array.isArray(gw.active_accounts) && gw.active_accounts.length > 0) {
    return gw.active_accounts.filter((a) => a.is_active !== false);
  }
  const cfg = gw.config_public || {};
  if (Array.isArray(cfg.accounts)) {
    return (cfg.accounts as PaymentAccountOption[]).filter((a) => a && a.number && a.is_active !== false);
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
}

export const WalletAndBillingView: React.FC<WalletAndBillingViewProps> = ({ business, lang }) => {
  const [wallet, setWallet] = useState({ balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 });
  const [transactions, setTransactions] = useState<
    Array<{ id: string; type: string; amount: number; balance_after: number; description: string; created_at: string }>
  >([]);
  const [aiLogs, setAiLogs] = useState<
    Array<{
      id: string;
      model_id: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      coins_deducted: number;
      status: string;
      created_at: string;
    }>
  >([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [tab, setTab] = useState<'wallet' | 'packages' | 'plans'>('wallet');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const [checkoutTarget, setCheckoutTarget] = useState<{
    type: 'coin_package' | 'subscription';
    id: string;
    title: string;
    price: number;
  } | null>(null);
  const [selectedGateway, setSelectedGateway] = useState('bkash');
  const [selectedPaidToNumber, setSelectedPaidToNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAll = async () => {
    try {
      const [wRes, pkgRes, planRes, gwRes] = await Promise.all([
        apiFetch<{
          wallet: typeof wallet;
          transactions: typeof transactions;
          aiLogs: typeof aiLogs;
          payments: PaymentRecord[];
          notifications?: WalletNotification[];
        }>(`/api/businesses/${business.id}/wallet`, { businessId: business.id }),
        apiFetch<{ packages: CoinPackage[] }>('/api/catalog/packages'),
        apiFetch<{ plans: SubscriptionPlan[] }>('/api/catalog/plans'),
        apiFetch<{ gateways: Gateway[] }>('/api/catalog/gateways'),
      ]);
      setWallet(wRes.wallet);
      setTransactions(wRes.transactions || []);
      setAiLogs(wRes.aiLogs || []);
      setPayments(wRes.payments || []);
      setNotifications(wRes.notifications || []);
      setPackages(pkgRes.packages || []);
      setPlans(planRes.plans || []);
      setGateways(gwRes.gateways || []);
      if (gwRes.gateways.length > 0) {
        const preferred =
          gwRes.gateways.find((g) => g.slug === selectedGateway) || gwRes.gateways[0];
        setSelectedGateway(preferred.slug);
        const nums = getGatewayActiveNumbers(preferred);
        setSelectedPaidToNumber(nums[0]?.number || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet data.');
    }
  };

  useEffect(() => {
    void loadAll();
  }, [business.id]);

  const activeGatewayObj = gateways.find((g) => g.slug === selectedGateway);
  const activeMethodNumbers = getGatewayActiveNumbers(activeGatewayObj);

  const handleSelectGateway = (slug: string) => {
    setSelectedGateway(slug);
    setCheckoutError('');
    const gw = gateways.find((g) => g.slug === slug);
    const nums = getGatewayActiveNumbers(gw);
    setSelectedPaidToNumber(nums[0]?.number || '');
  };

  const openCheckout = (target: NonNullable<typeof checkoutTarget>) => {
    setCheckoutError('');
    setTxId('');
    setSenderPhone('');
    const gw = gateways.find((g) => g.slug === selectedGateway) || gateways[0];
    if (gw) {
      setSelectedGateway(gw.slug);
      const nums = getGatewayActiveNumbers(gw);
      setSelectedPaidToNumber(nums[0]?.number || '');
    }
    setCheckoutTarget(target);
  };

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      await apiFetch(`/api/businesses/${business.id}/wallet/notifications/read`, {
        method: 'POST',
        businessId: business.id,
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Ignore silent failure
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutTarget) return;
    setCheckoutError('');
    setError('');

    if (activeMethodNumbers.length > 0 && !selectedPaidToNumber) {
      setCheckoutError(
        lang === 'bn'
          ? 'যে নম্বরে টাকা পাঠিয়েছেন সেটি সিলেক্ট করুন।'
          : 'Please select the receiving payment number you sent money to.'
      );
      return;
    }

    setSubmittingPayment(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/payments/submit`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          gateway_slug: selectedGateway,
          payment_for: checkoutTarget.type,
          reference_id: checkoutTarget.id,
          transaction_id: txId.trim(),
          sender_number: senderPhone.trim(),
          ...(selectedPaidToNumber ? { paid_to_number: selectedPaidToNumber } : {}),
        }),
      });
      setCheckoutTarget(null);
      setTxId('');
      setSenderPhone('');
      setNotice(
        lang === 'bn'
          ? 'আপনার পেমেন্ট রিকোয়েস্ট জমা হয়েছে। অ্যাডমিন যাচাই করে Approve করলে কয়েন/প্যাকেজ অটো যুক্ত হবে।'
          : 'Payment submitted for Admin verification. Coins or Plan will activate automatically once approved.'
      );
      setTab('wallet');
      await loadAll();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Payment submission failed.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const filteredPayments = payments.filter((p) => historyFilter === 'all' || p.status === historyFilter);

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'AI কয়েন ওয়ালেট ও সাবস্ক্রিপশন' : 'AI Coin Wallet & Subscriptions'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Current Plan:{' '}
            <span className="font-semibold text-[#5B35F5] dark:text-[#A78BFA]">
              {business.subscription_plan?.name || 'Free'}
            </span>
          </p>
        </div>
        <div className="inline-flex p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800 overflow-x-auto max-w-full">
          {(
            [
              ['wallet', lang === 'bn' ? 'ওয়ালেট ও হিস্ট্রি' : 'Wallet & History'],
              ['packages', lang === 'bn' ? 'কয়েন প্যাকেজ কিনুন' : 'Buy Coin Packages'],
              ['plans', lang === 'bn' ? 'সাবস্ক্রিপশন প্ল্যান' : 'Subscription Plans'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                tab === k
                  ? 'bg-[#5B35F5] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Payment Notifications */}
      {notifications.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#5B35F5]" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'পেমেন্ট নোটিফিকেশন' : 'Payment Notifications'}
              </span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[#5B35F5] text-white text-[10px] font-bold">
                  {unreadCount} {lang === 'bn' ? 'নতুন' : 'New'}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkNotificationsRead()}
                className="text-[11px] font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
              >
                {lang === 'bn' ? 'সব পঠিত চিহ্নিত করুন' : 'Mark all read'}
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {notifications.slice(0, 6).map((n) => (
              <div
                key={n.id}
                className={`rounded-xl p-2.5 border text-xs flex items-start justify-between gap-2 ${
                  n.type === 'error'
                    ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/25 text-rose-800 dark:text-rose-200'
                    : n.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-200'
                    : 'border-[#E6E0FF] bg-[#F9F7FF] dark:border-slate-800 dark:bg-slate-950 text-slate-700 dark:text-slate-200'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-bold flex items-center gap-1.5">
                    {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-[#5B35F5]" />}
                    <span>{n.title}</span>
                  </div>
                  <div className="text-[11px] opacity-90">{n.body}</div>
                </div>
                <span className="text-[10px] font-mono opacity-75 shrink-0">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wallet KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Current Balance</span>
            <span className="w-8 h-8 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {Number(wallet.balance).toFixed(2)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Purchased</div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {Number(wallet.total_purchased).toFixed(2)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Coins Used</div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {Number(wallet.total_used).toFixed(2)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Bonus &amp; Grants</div>
          <div className="mt-3 text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {Number(wallet.total_bonus).toFixed(2)}
          </div>
        </div>
      </div>

      {tab === 'wallet' && (
        <div className="space-y-6">
          {/* Manual Payment History & Verification Status */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                  {lang === 'bn' ? 'ম্যানুয়াল পেমেন্ট হিস্ট্রি ও স্ট্যাটাস' : 'Manual Payment History & Verification Status'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'bn'
                    ? 'Pending, Approved ও Rejected পেমেন্ট এবং অ্যাডমিনের রিজেকশন কারণ দেখুন।'
                    : 'Track Pending, Approved, and Rejected requests with Admin review notes.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize ${
                      historyFilter === f
                        ? 'bg-[#5B35F5] text-white'
                        : 'bg-[#F3F0FF] dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredPayments.length === 0 ? (
              <p className="py-6 text-xs text-slate-400 text-center">
                {lang === 'bn' ? 'কোনো পেমেন্ট হিস্ট্রি পাওয়া যায়নি।' : 'No manual payment submissions found.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {filteredPayments.map((p) => {
                  const statusColor =
                    p.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50'
                      : p.status === 'rejected'
                      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50'
                      : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50';
                  const targetTitle =
                    p.gateway_response?.target_title || p.payment_for.replace('_', ' ');
                  const paidTo = p.gateway_response?.paid_to_number;
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border border-[#E6E0FF]/80 dark:border-slate-800 p-3.5 bg-[#F9F7FF]/50 dark:bg-slate-950/50 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-0.5 text-xs">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                            <span>{targetTitle}</span>
                            <span className="px-1.5 py-0.5 rounded bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[10px] font-semibold uppercase">
                              {p.gateway_slug}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>TrxID: {p.transaction_id}</span>
                            {p.sender_number && <span>Sender: {p.sender_number}</span>}
                            {paidTo && <span>Paid To: {paidTo}</span>}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {new Date(p.created_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
                          <div className="font-bold text-sm tabular-nums text-slate-900 dark:text-white">
                            {formatMoney(p.amount)}
                          </div>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${statusColor}`}
                          >
                            {p.status}
                          </span>
                        </div>
                      </div>

                      {p.status === 'rejected' && p.admin_notes && (
                        <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">
                              {lang === 'bn' ? 'বাতিলের কারণ: ' : 'Rejection Reason: '}
                            </span>
                            <span>{p.admin_notes}</span>
                          </div>
                        </div>
                      )}

                      {p.status === 'approved' && p.admin_notes && (
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                          Admin Note: {p.admin_notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
              <h2 className="text-sm font-display font-bold mb-3 text-slate-900 dark:text-white">
                Coin Transaction Ledger
              </h2>
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 max-h-80 overflow-y-auto text-xs">
                {transactions.length === 0 ? (
                  <p className="py-6 text-slate-400 text-center">No transactions yet.</p>
                ) : (
                  transactions.map((tx) => (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{tx.description}</div>
                        <div className="text-slate-400 font-mono">{new Date(tx.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <div
                          className={
                            Number(tx.amount) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'
                          }
                        >
                          {Number(tx.amount) >= 0 ? '+' : ''}
                          {Number(tx.amount).toFixed(2)}
                        </div>
                        <div className="text-slate-400">Bal: {Number(tx.balance_after).toFixed(2)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
              <h2 className="text-sm font-display font-bold mb-3 text-slate-900 dark:text-white">AI Usage Logs</h2>
              <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 max-h-80 overflow-y-auto text-xs">
                {aiLogs.length === 0 ? (
                  <p className="py-6 text-slate-400 text-center">No AI usage logs yet.</p>
                ) : (
                  aiLogs.map((l) => (
                    <div key={l.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <div className="font-mono font-medium">{l.model_id}</div>
                        <div className="text-slate-400">
                          In: {l.input_tokens} · Out: {l.output_tokens} · {l.status}
                        </div>
                      </div>
                      <div className="font-mono font-semibold text-rose-600">
                        -{Number(l.coins_deducted).toFixed(3)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'packages' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between"
            >
              <div>
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">{pkg.name}</h3>
                <div className="mt-2 text-2xl font-display font-bold text-[#5B35F5] dark:text-[#A78BFA] tabular-nums">
                  {pkg.coin_amount.toLocaleString()} Coins
                </div>
                {pkg.bonus_coins > 0 && (
                  <div className="text-xs font-medium text-emerald-600 mt-0.5">
                    + {pkg.bonus_coins.toLocaleString()} Bonus Coins
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-2">{pkg.description}</p>
              </div>
              <div className="mt-5 pt-4 border-t border-[#E6E0FF]/70 dark:border-slate-800 flex items-center justify-between">
                <span className="text-lg font-display font-bold tabular-nums">{formatMoney(pkg.price)}</span>
                <button
                  type="button"
                  onClick={() =>
                    openCheckout({
                      type: 'coin_package',
                      id: pkg.id,
                      title: pkg.name,
                      price: pkg.price,
                    })
                  }
                  className="px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 transition-colors"
                >
                  Recharge Now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {plans.map((plan) => {
            const isCurrent = business.subscription_plan_id === plan.id;
            return (
              <div
                key={plan.id}
                className={`bg-white dark:bg-slate-900 rounded-2xl p-5 bx-card flex flex-col justify-between border ${
                  isCurrent ? 'border-[#5B35F5] ring-2 ring-[#5B35F5]/15' : 'border-[#E6E0FF] dark:border-slate-800'
                }`}
              >
                <div>
                  <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                  <div className="mt-2 text-2xl font-display font-bold text-[#5B35F5] dark:text-[#A78BFA] tabular-nums">
                    {formatMoney(plan.monthly_price)}
                    <span className="text-xs font-normal text-slate-500">/mo</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
                  <div className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-300 border-t border-[#E6E0FF]/70 dark:border-slate-800 pt-3">
                    <div>{plan.coin_allocation.toLocaleString()} AI Coins</div>
                    <div>{plan.max_products.toLocaleString()} Products</div>
                    <div>{plan.max_staff} Staff Members</div>
                    <div>{plan.max_channels} Social Channels</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() =>
                    openCheckout({
                      type: 'subscription',
                      id: plan.id,
                      title: `${plan.name} Plan`,
                      price: plan.monthly_price,
                    })
                  }
                  className="mt-5 w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold disabled:bg-[#F3F0FF] disabled:text-[#5B35F5] dark:disabled:bg-slate-800 dark:disabled:text-slate-400 transition-colors"
                >
                  {isCurrent ? 'Current Plan' : 'Upgrade Plan'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Payment Checkout Modal */}
      {checkoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#5B35F5]" />
                <h2 className="text-base font-display font-bold">Checkout: {checkoutTarget.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutTarget(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-xl bg-[#F3F0FF]/70 dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 text-sm font-semibold flex justify-between">
              <span>{lang === 'bn' ? 'পরিশোধযোগ্য পরিমাণ' : 'Payable Amount'}</span>
              <span className="tabular-nums text-[#5B35F5] dark:text-[#A78BFA]">
                {formatMoney(checkoutTarget.price)}
              </span>
            </div>

            {gateways.length === 0 ? (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
                {lang === 'bn'
                  ? 'বর্তমানে কোনো সক্রিয় ম্যানুয়াল পেমেন্ট মেথড চালু নেই। অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।'
                  : 'No active payment methods are currently configured. Please contact the platform Admin.'}
              </div>
            ) : (
              <form onSubmit={handleSubmitPayment} className="space-y-4 text-xs">
                {/* Step 1: Payment Method Selection */}
                <div>
                  <label className="block font-semibold mb-1.5 text-slate-800 dark:text-slate-200">
                    {lang === 'bn' ? '১. পেমেন্ট মেথড নির্বাচন করুন' : '1. Select Payment Method'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {gateways.map((g) => {
                      const isSel = selectedGateway === g.slug;
                      const nums = getGatewayActiveNumbers(g);
                      return (
                        <button
                          key={g.slug}
                          type="button"
                          onClick={() => handleSelectGateway(g.slug)}
                          className={`px-3 py-2.5 rounded-xl border text-left transition-all ${
                            isSel
                              ? 'border-[#5B35F5] bg-[#F3F0FF] dark:bg-[#5B35F5]/20 ring-2 ring-[#5B35F5]/20'
                              : 'border-[#E6E0FF] dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-[#5B35F5]/50'
                          }`}
                        >
                          <div className="font-bold text-slate-900 dark:text-white truncate">{g.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {nums.length > 0 ? `${nums.length} active number${nums.length > 1 ? 's' : ''}` : g.gateway_type}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Active Payment Numbers & Instructions */}
                <div className="rounded-xl border border-[#E6E0FF] dark:border-slate-800 bg-[#F9F7FF]/70 dark:bg-slate-950 p-3.5 space-y-2.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    {lang === 'bn'
                      ? `২. নিচের সক্রিয় ${activeGatewayObj?.name || selectedGateway} নম্বরে Send Money করুন ও নম্বর কপি করুন:`
                      : `2. Send Money to an active ${activeGatewayObj?.name || selectedGateway} number below:`}
                  </div>

                  {activeGatewayObj?.instructions && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-[#E6E0FF]/70 dark:border-slate-800">
                      {activeGatewayObj.instructions}
                    </p>
                  )}

                  {activeMethodNumbers.length === 0 ? (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-[11px]">
                      {lang === 'bn'
                        ? 'এই মেথডের জন্য এখনো কোনো নম্বর সক্রিয় করা হয়নি।'
                        : 'No active receiving payment numbers are currently set for this method.'}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                      {activeMethodNumbers.map((acc) => {
                        const isNumSel = selectedPaidToNumber === acc.number;
                        return (
                          <div
                            key={acc.id || acc.number}
                            onClick={() => setSelectedPaidToNumber(acc.number)}
                            className={`cursor-pointer rounded-xl border p-2.5 flex items-center justify-between gap-2 transition-colors ${
                              isNumSel
                                ? 'border-[#5B35F5] bg-white dark:bg-slate-900 ring-1 ring-[#5B35F5]'
                                : 'border-[#E6E0FF] dark:border-slate-800 bg-white/80 dark:bg-slate-900/70'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="radio"
                                name="paid_to_number"
                                checked={isNumSel}
                                onChange={() => setSelectedPaidToNumber(acc.number)}
                                className="accent-[#5B35F5]"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                                    {acc.number}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[10px] font-semibold">
                                    {acc.account_type || 'Personal'}
                                  </span>
                                  {acc.label && <span className="text-[10px] text-slate-500">{acc.label}</span>}
                                </div>
                                {acc.instructions && (
                                  <div className="text-[10px] text-slate-500 truncate">{acc.instructions}</div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyValue(`pay-${acc.number}`, acc.number);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[11px] font-semibold shrink-0"
                            >
                              {copiedKey === `pay-${acc.number}` ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Step 3: Transaction ID & Sender Number */}
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
                      {lang === 'bn' ? '৩. যে নম্বর থেকে টাকা পাঠিয়েছেন (Sender Number) *' : '3. Sender Mobile Number *'}
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="01XXXXXXXXX"
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
                      {lang === 'bn' ? '৪. Transaction ID (TrxID) *' : '4. Transaction ID (TrxID) *'}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BL98A2K7X1"
                      value={txId}
                      onChange={(e) => setTxId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono uppercase"
                    />
                  </div>
                </div>

                {checkoutError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900 p-3 text-xs text-rose-700 dark:text-rose-300">
                    {checkoutError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submittingPayment || (activeMethodNumbers.length === 0 && !activeGatewayObj)}
                  className="w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-sm font-semibold shadow-sm shadow-[#5B35F5]/20 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {submittingPayment && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {lang === 'bn'
                      ? 'যাচাইয়ের জন্য পেমেন্ট জমা দিন'
                      : 'Submit Payment for Admin Verification'}
                  </span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

