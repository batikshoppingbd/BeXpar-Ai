import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Building2,
  Coins,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import { t, type Lang } from '../../i18n/translations';
import type { Business, UserProfile } from '../../types';

interface DashboardData {
  stats: {
    totalOrders: number;
    todayOrders: number;
    pendingOrders: number;
    confirmedOrders: number;
    processingOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    totalProducts: number;
    lowStockProducts: number;
    totalCustomers: number;
    totalSales: number;
    estimatedProfit: number;
    availableCoins: number;
    totalCoinsUsed?: number;
    totalCoinsPurchased?: number;
    aiRequests: number;
    aiTokens: number;
    aiCoinsUsed: number;
    connectedChannelsCount: number;
  };
  connectedChannels: Array<{ id: string; platform: string; account_name: string; status: string }>;
  recentConversations: Array<{
    id: string;
    channel: string;
    customer_name: string;
    last_message: string;
    last_message_at: string;
    unread_count: number;
  }>;
  recentOrders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    total_amount: number;
    order_status: string;
    order_source: string;
    created_at: string;
  }>;
  chartSeries: Array<{ date: string; sales: number; orders: number }>;
}

interface UserDashboardProps {
  business: Business;
  profile?: UserProfile | null;
  lang: Lang;
  onNavigate: (tab: string) => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({ business, profile, lang, onNavigate }) => {
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ range });
      if (range === 'custom' && customStart) {
        qs.set('start', customStart);
        if (customEnd) qs.set('end', customEnd);
      }
      const res = await apiFetch<DashboardData>(`/api/businesses/${business.id}/dashboard?${qs.toString()}`, {
        businessId: business.id,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range !== 'custom' || customStart) {
      void loadDashboard();
    }
  }, [business.id, range, customStart, customEnd]);

  const s = data?.stats;
  const maxSales = Math.max(1, ...(data?.chartSeries || []).map((c) => c.sales));

  // AI Usage Donut math (using real database wallet balance + used coins)
  const availableCoins = Number(s?.availableCoins || 0);
  const lifetimeUsed = Number(s?.totalCoinsUsed ?? s?.aiCoinsUsed ?? 0);
  const periodUsed = Number(s?.aiCoinsUsed || 0);
  const totalPool = availableCoins + lifetimeUsed;
  const remainingPct = totalPool > 0 ? Math.round((availableCoins / totalPool) * 100) : 100;
  const usedPct = totalPool > 0 ? Math.max(0, 100 - remainingPct) : 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const remainingDash = (remainingPct / 100) * circumference;

  const ownerName = profile?.full_name || business.owner_name || business.name;

  return (
    <div className="space-y-6">
      {/* Welcome Back & Controls Header */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 md:p-6 bx-card flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA]">
            {lang === 'bn' ? `স্বাগতম ফিরে আসায়, ${ownerName}` : `Welcome back, ${ownerName}`}
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
            {business.name}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {business.category} · {business.subscription_plan?.name || 'Free'} Plan ·{' '}
            <span className="text-emerald-600 dark:text-emerald-400 font-medium capitalize">{business.status}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('store')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/25 transition-all whitespace-nowrap"
          >
            <Store className="w-4 h-4" />
            <span>{t(lang, 'miniStore')}</span>
          </button>

          <div className="inline-flex items-center gap-1 p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800 overflow-x-auto max-w-full">
            {(
              [
                ['today', t(lang, 'today')],
                ['7d', t(lang, 'last7Days')],
                ['30d', t(lang, 'last30Days')],
                ['month', t(lang, 'thisMonth')],
                ['custom', t(lang, 'customRange')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                  range === k
                    ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Primary KPI Grid (Responsive 2-column tablet / 4-column desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card transition-transform duration-150 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t(lang, 'totalSales')}</span>
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {loading ? '...' : formatMoney(s?.totalSales || 0)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {t(lang, 'estimatedProfit')}:{' '}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatMoney(s?.estimatedProfit || 0)}
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card transition-transform duration-150 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t(lang, 'totalOrders')}</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {loading ? '...' : s?.totalOrders || 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {t(lang, 'todayOrders')}: {s?.todayOrders || 0} · {t(lang, 'pendingOrders')}: {s?.pendingOrders || 0}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card transition-transform duration-150 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t(lang, 'availableCoins')}</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {loading ? '...' : availableCoins.toFixed(2)}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {t(lang, 'aiRequests')}: {s?.aiRequests || 0} · {(s?.aiTokens || 0).toLocaleString()} tokens
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card transition-transform duration-150 hover:-translate-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t(lang, 'totalProducts')} &amp; CRM
            </span>
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">
            {loading ? '...' : s?.totalProducts || 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {t(lang, 'lowStock')}: {s?.lowStockProducts || 0} · {t(lang, 'totalCustomers')}: {s?.totalCustomers || 0}
          </div>
        </div>
      </div>

      {/* Order Statistics Strip */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'অর্ডার স্ট্যাটিস্টিক্স' : 'Order Statistics'}
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('orders')}
            className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline inline-flex items-center gap-1"
          >
            <span>{lang === 'bn' ? 'সব অর্ডার' : 'Manage Orders'}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E6E0FF] dark:divide-slate-800">
          {[
            [t(lang, 'pendingOrders'), s?.pendingOrders || 0, 'text-amber-600 dark:text-amber-400'],
            [t(lang, 'confirmedOrders'), s?.confirmedOrders || 0, 'text-[#5B35F5] dark:text-[#A78BFA]'],
            [lang === 'bn' ? 'প্রসেসিং' : 'Processing', s?.processingOrders || 0, 'text-blue-600 dark:text-blue-400'],
            [t(lang, 'deliveredOrders'), s?.deliveredOrders || 0, 'text-emerald-600 dark:text-emerald-400'],
            [t(lang, 'cancelledOrders'), s?.cancelledOrders || 0, 'text-rose-600 dark:text-rose-400'],
          ].map(([label, val, color]) => (
            <div key={String(label)} className="pt-2.5 sm:pt-0 sm:px-4 first:pl-0">
              <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
              <div className={`mt-1 text-2xl font-display font-bold tabular-nums ${color}`}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sales Analytics Bar Chart + AI Usage Overview Donut Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'সেলস এবং অর্ডার অ্যানালিটিক্স' : 'Sales & Order Analytics'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {lang === 'bn' ? 'দৈনিক বিক্রির প্রবণতা' : 'Daily revenue trend across selected range'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>{lang === 'bn' ? 'পূর্ণ রিপোর্ট' : 'Full Report'}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {!data?.chartSeries?.length ? (
            <div className="h-52 flex items-center justify-center text-sm text-slate-400 border border-dashed border-[#E6E0FF] dark:border-slate-800 rounded-xl bg-[#F3F0FF]/40 dark:bg-slate-950/40">
              {lang === 'bn' ? 'নির্বাচিত সময়ে কোনো অর্ডার পাওয়া যায়নি' : 'No order records in selected date range'}
            </div>
          ) : (
            <div className="h-52 flex items-end gap-2.5 pt-4">
              {data.chartSeries.map((pt) => {
                const heightPct = Math.max(8, Math.round((pt.sales / maxSales) * 100));
                return (
                  <div key={pt.date} className="flex-1 flex flex-col items-center gap-2 group">
                    <div className="w-full flex items-end justify-center h-40">
                      <div
                        style={{ height: `${heightPct}%` }}
                        title={`${pt.date}: ${formatMoney(pt.sales)} (${pt.orders} orders)`}
                        className="w-full max-w-[34px] rounded-t-xl bg-gradient-to-t from-[#5B35F5] to-[#8B5CF6] opacity-90 group-hover:opacity-100 transition-all shadow-sm shadow-[#5B35F5]/20"
                      />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 truncate max-w-full">
                      {pt.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Usage Overview with Donut Chart */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'AI ব্যবহারের সারসংক্ষেপ' : 'AI Usage Overview'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {lang === 'bn' ? 'লাইভ কয়েন ও টোকেন কনজাম্পশন' : 'Live AI coin balance & consumption'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline whitespace-nowrap"
            >
              {lang === 'bn' ? 'টপ-আপ' : 'Top Up'}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5 my-auto">
            <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
                <circle
                  cx="55"
                  cy="55"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="12"
                  className="text-[#F3F0FF] dark:text-slate-800"
                />
                <circle
                  cx="55"
                  cy="55"
                  r={radius}
                  fill="none"
                  stroke="#5B35F5"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${remainingDash} ${circumference}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-lg font-display font-bold text-slate-900 dark:text-white tabular-nums">
                  {remainingPct}%
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'অবশিষ্ট' : 'Remaining'}
                </span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/70 dark:border-slate-800">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#5B35F5]" />
                  {lang === 'bn' ? 'উপলব্ধ কয়েন' : 'Available Coins'}
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                  {availableCoins.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/70 dark:border-slate-800">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E6E0FF] dark:bg-slate-700" />
                  {lang === 'bn' ? 'ব্যবহৃত কয়েন' : 'Coins Used'}
                </span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                  {lifetimeUsed.toFixed(2)} ({usedPct}%)
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/70 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'AI রিপ্লাই সংখ্যা' : 'AI Replies (Range)'}
                </span>
                <span className="font-mono font-semibold tabular-nums">{s?.aiRequests || 0}</span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'রেঞ্জ খরচ' : 'Range Spend'}
                </span>
                <span className="font-mono font-semibold tabular-nums">{periodUsed.toFixed(3)} coins</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Promotional Gradient Banner + Clean Business Profile Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-2xl bg-gradient-to-br from-[#5B35F5] via-[#6741FF] to-[#7C3AED] text-white p-6 md:p-7 shadow-lg shadow-[#5B35F5]/20 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/90">
              <Sparkles className="w-4 h-4" />
              <span>{lang === 'bn' ? 'অটোমেটেড AI সেলস ইঞ্জিন' : 'Automated AI Commerce'}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-display font-bold leading-snug max-w-xl">
              {lang === 'bn'
                ? '২৪/৭ বাংলা ও বাংলিশ AI সেলস এজেন্ট এবং আপনার নিজস্ব মিনি স্টোর একসাথে চালান'
                : 'Scale 24/7 Bangla & English AI customer replies alongside your instant Mini Store'}
            </h2>
            <p className="text-xs md:text-sm text-white/85 max-w-xl leading-relaxed">
              {lang === 'bn'
                ? 'আপনার পণ্যের ক্যাটালগ, নলেজ বেস এবং সোশ্যাল ইনবক্স যুক্ত করে স্বয়ংক্রিয়ভাবে কাস্টমার অর্ডার কনফার্মেশন পান।'
                : 'Keep your product catalog, knowledge base, and social channels synced so your AI agent converts chats into confirmed orders.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('ai')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#5B35F5] text-xs font-bold hover:bg-[#F3F0FF] transition-colors"
            >
              <Bot className="w-4 h-4" />
              <span>{lang === 'bn' ? 'AI এজেন্ট সেটআপ' : 'Configure AI Agent'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-semibold hover:bg-white/25 transition-colors"
            >
              <Coins className="w-4 h-4" />
              <span>{lang === 'bn' ? 'প্ল্যান আপগ্রেড' : 'Upgrade Plan'}</span>
            </button>
          </div>
        </div>

        {/* Business Profile & Connected Channels Card */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                    {lang === 'bn' ? 'বিজনেস প্রোফাইল' : 'Business Profile'}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {business.subscription_plan?.name || 'Free'} Plan · {s?.connectedChannelsCount || 0}{' '}
                    {lang === 'bn' ? 'টি চ্যানেল যুক্ত' : 'Channels'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
              >
                {lang === 'bn' ? 'এডিট' : 'Edit'}
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-mono">{business.phone || '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{business.address || '—'}</span>
              </div>
            </div>

            {data?.connectedChannels?.length ? (
              <div className="pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800 divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                {data.connectedChannels.slice(0, 3).map((ch) => (
                  <div key={ch.id} className="py-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {ch.account_name} · <span className="capitalize text-slate-500">{ch.platform}</span>
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">Connected</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800 text-xs text-slate-400">
                {lang === 'bn'
                  ? 'এখনো কোনো Facebook, Instagram বা WhatsApp চ্যানেল যুক্ত হয়নি।'
                  : 'No Facebook, Instagram, or WhatsApp channels connected yet.'}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('integrations')}
            className="w-full py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
          >
            {lang === 'bn' ? 'সোশ্যাল চ্যানেল ম্যানেজ করুন' : 'Connect Social Channels'}
          </button>
        </div>
      </div>

      {/* Recent Conversations & Recent Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
                <MessageSquare className="w-3.5 h-3.5" />
              </span>
              <span>{t(lang, 'recentConversations')}</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inbox')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
            >
              {lang === 'bn' ? 'ইনবক্স খুলুন' : 'Open Inbox'}
            </button>
          </div>
          {!data?.recentConversations?.length ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              {lang === 'bn' ? 'এখনো কোনো কাস্টমার কথোপকথন নেই।' : 'No customer conversations yet.'}
            </p>
          ) : (
            <div className="divide-y divide-[#E6E0FF]/70 dark:divide-slate-800">
              {data.recentConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onNavigate('inbox')}
                  className="w-full py-3 flex items-center justify-between text-left hover:bg-[#F3F0FF]/60 dark:hover:bg-slate-800/50 rounded-xl px-2.5 -mx-2.5 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {c.customer_name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.last_message}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-semibold uppercase text-[#5B35F5] dark:text-[#A78BFA]">
                      {c.channel}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {new Date(c.last_message_at).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Users className="w-3.5 h-3.5" />
              </span>
              <span>{t(lang, 'recentOrders')}</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
            >
              {lang === 'bn' ? 'সব দেখুন' : 'View All'}
            </button>
          </div>
          {!data?.recentOrders?.length ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              {lang === 'bn' ? 'এখনো কোনো অর্ডার তৈরি হয়নি।' : 'No orders created yet.'}
            </p>
          ) : (
            <div className="divide-y divide-[#E6E0FF]/70 dark:divide-slate-800">
              {data.recentOrders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onNavigate('orders')}
                  className="w-full py-3 flex items-center justify-between text-left hover:bg-[#F3F0FF]/60 dark:hover:bg-slate-800/50 rounded-xl px-2.5 -mx-2.5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      <span className="font-mono text-xs text-[#5B35F5] dark:text-[#A78BFA] mr-2">
                        {o.order_number}
                      </span>
                      {o.customer_name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {o.customer_phone} · {o.order_source}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatMoney(o.total_amount)}
                    </div>
                    <div className="text-[11px] capitalize text-slate-500 dark:text-slate-400">{o.order_status}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
