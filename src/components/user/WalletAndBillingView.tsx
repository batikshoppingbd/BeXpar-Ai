import React, { useEffect, useState } from 'react';
import { CheckCircle2, Coins, CreditCard, X } from 'lucide-react';
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

interface Gateway {
  slug: string;
  name: string;
  gateway_type: string;
  instructions: string;
}

interface WalletAndBillingViewProps {
  business: Business;
  lang: Lang;
}

export const WalletAndBillingView: React.FC<WalletAndBillingViewProps> = ({ business, lang }) => {
  const [wallet, setWallet] = useState({ balance: 0, total_purchased: 0, total_used: 0, total_bonus: 0 });
  const [transactions, setTransactions] = useState<Array<{ id: string; type: string; amount: number; balance_after: number; description: string; created_at: string }>>([]);
  const [aiLogs, setAiLogs] = useState<Array<{ id: string; model_id: string; input_tokens: number; output_tokens: number; total_tokens: number; coins_deducted: number; status: string; created_at: string }>>([]);
  const [payments, setPayments] = useState<Array<{ id: string; gateway_slug: string; payment_for: string; amount: number; transaction_id: string; status: string; created_at: string }>>([]);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [tab, setTab] = useState<'wallet' | 'packages' | 'plans'>('wallet');

  const [checkoutTarget, setCheckoutTarget] = useState<{
    type: 'coin_package' | 'subscription';
    id: string;
    title: string;
    price: number;
  } | null>(null);
  const [selectedGateway, setSelectedGateway] = useState('manual');
  const [txId, setTxId] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadAll = async () => {
    const [wRes, pkgRes, planRes, gwRes] = await Promise.all([
      apiFetch<{ wallet: typeof wallet; transactions: typeof transactions; aiLogs: typeof aiLogs; payments: typeof payments }>(
        `/api/businesses/${business.id}/wallet`,
        { businessId: business.id }
      ),
      apiFetch<{ packages: CoinPackage[] }>('/api/catalog/packages'),
      apiFetch<{ plans: SubscriptionPlan[] }>('/api/catalog/plans'),
      apiFetch<{ gateways: Gateway[] }>('/api/catalog/gateways'),
    ]);
    setWallet(wRes.wallet);
    setTransactions(wRes.transactions);
    setAiLogs(wRes.aiLogs);
    setPayments(wRes.payments);
    setPackages(pkgRes.packages);
    setPlans(planRes.plans);
    setGateways(gwRes.gateways);
    if (gwRes.gateways.length > 0) setSelectedGateway(gwRes.gateways[0].slug);
  };

  useEffect(() => {
    void loadAll();
  }, [business.id]);

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutTarget) return;
    setError('');
    try {
      await apiFetch(`/api/businesses/${business.id}/payments/submit`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          gateway_slug: selectedGateway,
          payment_for: checkoutTarget.type,
          reference_id: checkoutTarget.id,
          transaction_id: txId,
          sender_number: senderPhone,
        }),
      });
      setCheckoutTarget(null);
      setTxId('');
      setSenderPhone('');
      setNotice('Payment submitted for Admin verification. Coins/Plan will activate upon approval.');
      void loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment submission failed.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'AI কয়েন ওয়ালেট ও সাবস্ক্রিপশন' : 'AI Coin Wallet & Subscriptions'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Current Plan: <span className="font-semibold text-[#5B35F5] dark:text-[#A78BFA]">{business.subscription_plan?.name || 'Free'}</span>
          </p>
        </div>
        <div className="inline-flex p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800 overflow-x-auto max-w-full">
          {(
            [
              ['wallet', 'Wallet & Logs'],
              ['packages', 'Buy Coin Packages'],
              ['plans', 'Subscription Plans'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                tab === k ? 'bg-[#5B35F5] text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
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
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">{Number(wallet.balance).toFixed(2)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Purchased</div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">{Number(wallet.total_purchased).toFixed(2)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Coins Used</div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">{Number(wallet.total_used).toFixed(2)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Bonus &amp; Grants</div>
          <div className="mt-3 text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{Number(wallet.total_bonus).toFixed(2)}</div>
        </div>
      </div>

      {tab === 'wallet' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
            <h2 className="text-sm font-display font-bold mb-3 text-slate-900 dark:text-white">Coin Transaction Ledger</h2>
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
                      <div className={Number(tx.amount) >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
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
            <h2 className="text-sm font-display font-bold mb-3 text-slate-900 dark:text-white">AI Usage &amp; Recharge Requests</h2>
            <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 max-h-80 overflow-y-auto text-xs">
              {aiLogs.map((l) => (
                <div key={l.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-mono font-medium">{l.model_id}</div>
                    <div className="text-slate-400">
                      In: {l.input_tokens} · Out: {l.output_tokens} · {l.status}
                    </div>
                  </div>
                  <div className="font-mono font-semibold text-rose-600">-{Number(l.coins_deducted).toFixed(3)}</div>
                </div>
              ))}
              {payments.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-medium capitalize">
                      {p.payment_for.replace('_', ' ')} ({p.gateway_slug})
                    </div>
                    <div className="text-slate-400 font-mono">TxID: {p.transaction_id}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{formatMoney(p.amount)}</div>
                    <div className="capitalize text-amber-600">{p.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'packages' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {packages.map((pkg) => (
            <div key={pkg.id} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between">
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
                    setCheckoutTarget({
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
                    {formatMoney(plan.monthly_price)}<span className="text-xs font-normal text-slate-500">/mo</span>
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
                    setCheckoutTarget({
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

      {checkoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#5B35F5]" />
                <h2 className="text-base font-display font-bold">Checkout: {checkoutTarget.title}</h2>
              </div>
              <button type="button" onClick={() => setCheckoutTarget(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4 p-3 rounded-xl bg-[#F3F0FF]/70 dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 text-sm font-semibold flex justify-between">
              <span>Payable Amount</span>
              <span className="tabular-nums text-[#5B35F5] dark:text-[#A78BFA]">{formatMoney(checkoutTarget.price)}</span>
            </div>
            <form onSubmit={handleSubmitPayment} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Payment Method</label>
                <select value={selectedGateway} onChange={(e) => setSelectedGateway(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
                  {gateways.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {gateways.find((g) => g.slug === selectedGateway)?.instructions}
                </p>
              </div>
              <input type="text" required placeholder="Transaction ID (TrxID)" value={txId} onChange={(e) => setTxId(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono" />
              <input type="tel" placeholder="Sender Phone / Account Number" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <button type="submit" className="w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-sm font-semibold shadow-sm shadow-[#5B35F5]/20">
                Submit Payment for Verification
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
