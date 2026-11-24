import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Coins,
  Cpu,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import type { AdminDashboardPayload, AdminSectionId, DateRangePreset } from '../adminTypes';
import { DonutChart, EmptyState, InteractiveSeriesChart, StatCard, StatusBadge } from '../ui/AdminPrimitives';

type AnalyticsMetric = 'users' | 'businesses' | 'revenue' | 'coinsSold' | 'subscriptions';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

export const AdminDashboardView: React.FC<{
  lang: Lang;
  globalSearch: string;
  onNavigate: (tab: AdminSectionId, focusId?: string) => void;
}> = ({ lang, globalSearch, onNavigate }) => {
  const [range, setRange] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [metric, setMetric] = useState<AnalyticsMetric>('revenue');
  const [data, setData] = useState<AdminDashboardPayload | null>(null);
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
      const res = await apiFetch<AdminDashboardPayload>(`/api/admin/dashboard?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range !== 'custom' || customStart) {
      void loadDashboard();
    }
  }, [range, customStart, customEnd]);

  const s = data?.stats;
  const q = globalSearch.trim().toLowerCase();

  const filteredUsers = (data?.recentRegistrations || []).filter(
    (u) => !q || u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  );
  const filteredBusinesses = (data?.recentBusinesses || []).filter(
    (b) =>
      !q ||
      b.name?.toLowerCase().includes(q) ||
      b.owner_name?.toLowerCase().includes(q) ||
      b.category?.toLowerCase().includes(q)
  );

  const chartPoints = (data?.series || []).map((pt) => ({
    date: pt.date,
    value:
      metric === 'users'
        ? pt.users
        : metric === 'businesses'
        ? pt.businesses
        : metric === 'revenue'
        ? pt.revenue
        : metric === 'coinsSold'
        ? pt.coinsSold
        : pt.subscriptions,
  }));

  const healthy = Boolean(data?.supabaseHealth?.connected && data?.supabaseHealth?.schemaReady);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Welcome Banner + Platform Status Card */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#5B35F5] via-[#532EEB] to-[#4520D9] text-white p-6 md:p-7 bx-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-3 relative z-10 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-[11px] font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{adminT(lang, 'welcomeBadge')}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight">
              {adminT(lang, 'welcomeTitle')}
            </h1>
            <p className="text-xs md:text-sm text-white/85 leading-relaxed">
              {adminT(lang, 'welcomeDesc')}
            </p>
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#4520D9] hover:bg-[#F3F0FF] text-xs font-bold shadow-sm transition-colors"
              >
                <span>{adminT(lang, 'viewOverviewCta')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              {s && s.pendingPaymentsCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('settings', 'payments')}
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-300/40 text-white text-xs font-semibold transition-colors"
                >
                  <span>
                    {s.pendingPaymentsCount} {lang === 'bn' ? 'পেন্ডিং পেমেন্ট রিভিউ' : 'Pending Payments'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Clean Geometric AI Illustration */}
          <div className="hidden sm:flex items-center justify-center shrink-0 relative z-10">
            <div className="w-32 h-32 rounded-3xl bg-white/12 border border-white/20 backdrop-blur-xs flex flex-col items-center justify-center gap-2 shadow-inner">
              <div className="w-12 h-12 rounded-2xl bg-white text-[#5B35F5] flex items-center justify-center shadow-lg">
                <Cpu className="w-6 h-6" />
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/85">BeXpar Core</div>
            </div>
          </div>
          <div className="absolute -right-12 -bottom-12 w-56 h-56 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        </div>

        {/* Platform Status Card */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-[#7C8499] dark:text-slate-400">
                  {adminT(lang, 'platformStatus')}
                </div>
                <div className="text-sm font-display font-bold text-[#101536] dark:text-white">
                  {healthy ? adminT(lang, 'operational') : adminT(lang, 'degraded')}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-800 text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
              title={adminT(lang, 'refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/60 dark:border-slate-800">
              <span className="text-[#7C8499] dark:text-slate-400 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#5B35F5]" />
                {adminT(lang, 'dbConnected')}
              </span>
              <StatusBadge
                status={data?.supabaseHealth?.connected ? 'connected' : 'error'}
                label={data?.supabaseHealth?.connected ? 'Supabase OK' : 'Offline'}
              />
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/60 dark:border-slate-800">
              <span className="text-[#7C8499] dark:text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#16B66A]" />
                {adminT(lang, 'migrations')}
              </span>
              <span className="font-semibold text-[#101536] dark:text-white tabular-nums">
                {data?.supabaseHealth?.appliedMigrations?.length || 0} {adminT(lang, 'schemaReady')}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-[#E6E0FF]/60 dark:border-slate-800">
              <span className="text-[#7C8499] dark:text-slate-400">{adminT(lang, 'serverUptime')}</span>
              <span className="font-mono font-semibold text-[#101536] dark:text-white tabular-nums">
                {data?.serverMeta ? formatUptime(data.serverMeta.uptimeSeconds) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span className="text-[#7C8499] dark:text-slate-400">{adminT(lang, 'lastUpdated')}</span>
              <span className="text-[11px] font-mono text-[#7C8499] dark:text-slate-400">
                {data?.serverMeta?.checkedAt ? new Date(data.serverMeta.checkedAt).toLocaleTimeString() : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Four Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label={adminT(lang, 'totalUsers')}
          value={loading && !s ? '...' : s?.totalUsers || 0}
          subValue={s ? `${s.activeUsers} ${adminT(lang, 'active').toLowerCase()}` : ''}
          icon={<Users className="w-4 h-4" />}
          growthPct={s?.usersGrowthPct}
          sparkline={(data?.series || []).map((x) => x.users)}
          sparkColor="#5B35F5"
        />
        <StatCard
          label={adminT(lang, 'totalBusinesses')}
          value={loading && !s ? '...' : s?.totalBusinesses || 0}
          subValue={s ? `${s.activeBusinesses} ${adminT(lang, 'active').toLowerCase()}` : ''}
          icon={<Building2 className="w-4 h-4" />}
          iconBgClass="bg-emerald-50 dark:bg-emerald-950/40 text-[#16B66A]"
          growthPct={s?.businessesGrowthPct}
          sparkline={(data?.series || []).map((x) => x.businesses)}
          sparkColor="#16B66A"
        />
        <StatCard
          label={adminT(lang, 'totalCoinsSold')}
          value={loading && !s ? '...' : Math.round(s?.totalCoinsSold || 0).toLocaleString()}
          subValue={s ? `${Math.round(s.totalCoinsConsumed).toLocaleString()} used` : ''}
          icon={<Coins className="w-4 h-4" />}
          iconBgClass="bg-amber-50 dark:bg-amber-950/40 text-[#F5A623]"
          growthPct={s?.coinsGrowthPct}
          sparkline={(data?.series || []).map((x) => x.coinsSold)}
          sparkColor="#F5A623"
        />
        <StatCard
          label={adminT(lang, 'totalRevenue')}
          value={loading && !s ? '...' : formatMoney(s?.totalRevenue || 0)}
          subValue={
            s ? `Sub ${formatMoney(s.subscriptionRevenue)} · Coin ${formatMoney(s.coinPackageRevenue)}` : ''
          }
          icon={<Wallet className="w-4 h-4" />}
          iconBgClass="bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#4520D9] dark:text-[#A78BFA]"
          growthPct={s?.revenueGrowthPct}
          sparkline={(data?.series || []).map((x) => x.revenue)}
          sparkColor="#4520D9"
        />
      </div>

      {/* Platform Operations Micro Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { k: lang === 'bn' ? 'মোট অর্ডার' : 'Total Orders', v: s?.totalOrders || 0 },
          { k: lang === 'bn' ? 'সফল AI রিকোয়েস্ট' : 'AI Requests', v: (s?.totalAiRequests || 0).toLocaleString() },
          { k: lang === 'bn' ? 'মোট টোকেন ব্যবহৃত' : 'Tokens Processed', v: (s?.totalTokensUsed || 0).toLocaleString() },
          {
            k: lang === 'bn' ? 'আনুমানিক AI খরচ' : 'Est. AI Provider Cost',
            v: `$${(s?.estimatedProviderCostUsd || 0).toFixed(4)}`,
          },
        ].map((item) => (
          <div
            key={item.k}
            className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
          >
            <span className="text-[11px] font-medium text-[#7C8499] dark:text-slate-400 truncate">{item.k}</span>
            <span className="text-sm font-display font-bold text-[#101536] dark:text-white tabular-nums">
              {item.v}
            </span>
          </div>
        ))}
      </div>

      {/* Interactive Platform Analytics + Business Distribution Donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#5B35F5]" />
                <span>{adminT(lang, 'platformAnalytics')}</span>
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#F3F0FF] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
              {(['7d', '30d', '3m', '1y', 'custom'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
                    range === r
                      ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-xs'
                      : 'text-[#7C8499] dark:text-slate-400 hover:text-[#5B35F5]'
                  }`}
                >
                  {adminT(lang, `range_${r}`)}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
              <span className="text-xs text-[#7C8499]">→</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['revenue', adminT(lang, 'metric_revenue')],
                ['users', adminT(lang, 'metric_users')],
                ['businesses', adminT(lang, 'metric_businesses')],
                ['coinsSold', adminT(lang, 'metric_coins')],
                ['subscriptions', adminT(lang, 'metric_subscriptions')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMetric(key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  metric === key
                    ? 'bg-[#5B35F5] text-white shadow-xs'
                    : 'bg-[#F8F9FC] dark:bg-slate-950 text-[#7C8499] dark:text-slate-400 hover:text-[#5B35F5]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <InteractiveSeriesChart
            data={chartPoints}
            color={metric === 'businesses' ? '#16B66A' : metric === 'coinsSold' ? '#F5A623' : '#5B35F5'}
            valuePrefix={metric === 'revenue' ? '৳' : ''}
            emptyLabel={adminT(lang, 'noData')}
          />
        </div>

        {/* Business Distribution Donut */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between gap-5">
          <div>
            <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
              {adminT(lang, 'businessDistribution')}
            </h2>
            <p className="text-xs text-[#7C8499] dark:text-slate-400 mt-0.5">
              {lang === 'bn' ? 'রিয়েল ডাটাবেস স্ট্যাটাস অনুযায়ী' : 'Live status breakdown from Supabase'}
            </p>
          </div>

          <DonutChart
            centerValue={s?.totalBusinesses || 0}
            centerLabel={lang === 'bn' ? 'মোট বিজনেস' : 'Businesses'}
            segments={[
              { label: adminT(lang, 'active'), value: data?.businessDistribution?.active || 0, color: '#16B66A' },
              { label: adminT(lang, 'suspended'), value: data?.businessDistribution?.suspended || 0, color: '#EF4444' },
              { label: adminT(lang, 'inactive'), value: data?.businessDistribution?.inactive || 0, color: '#F5A623' },
            ]}
          />

          <button
            type="button"
            onClick={() => onNavigate('users')}
            className="w-full py-2.5 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/15 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/70 dark:hover:bg-[#5B35F5]/25 transition-colors"
          >
            {lang === 'bn' ? 'সকল বিজনেস পরিচালনা করুন' : 'Manage All Businesses'}
          </button>
        </div>
      </div>

      {/* Recent Users, Recent Businesses, and System Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Users */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
              {adminT(lang, 'recentUsers')}
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
            >
              {adminT(lang, 'viewDetails')}
            </button>
          </div>
          {filteredUsers.length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
              {filteredUsers.map((u) => (
                <div key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#101536] dark:text-white truncate">
                      {u.full_name || u.email}
                    </div>
                    <div className="text-[11px] text-[#7C8499] dark:text-slate-400 truncate">{u.email}</div>
                    <div className="text-[10px] text-[#7C8499] dark:text-slate-500 mt-0.5">
                      {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={u.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Businesses */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
              {adminT(lang, 'recentBusinesses')}
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
            >
              {adminT(lang, 'viewDetails')}
            </button>
          </div>
          {filteredBusinesses.length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
              {filteredBusinesses.map((b) => (
                <div key={b.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#101536] dark:text-white truncate">{b.name}</div>
                    <div className="text-[11px] text-[#7C8499] dark:text-slate-400 truncate">
                      {b.owner_name} · {b.category}
                    </div>
                    <div className="text-[10px] text-[#7C8499] dark:text-slate-500 mt-0.5">
                      {b.subscription_plan?.name || 'Free'} · {new Date(b.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System Activity */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-[#5B35F5]" />
              <span>{adminT(lang, 'systemActivity')}</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('logs')}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline"
            >
              {adminT(lang, 'viewDetails')}
            </button>
          </div>
          {(data?.systemActivity || []).length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
              {(data?.systemActivity || []).slice(0, 6).map((act) => (
                <div key={act.id} className="py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#101536] dark:text-white truncate">
                      {act.action.replace(/_/g, ' ')}
                    </div>
                    <div className="text-[11px] text-[#7C8499] dark:text-slate-400 truncate">
                      {act.actor_email || 'System'}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-[#7C8499] dark:text-slate-500 shrink-0">
                    {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
