import React, { useEffect, useState } from 'react';
import { BarChart3, Bot, Building2, Download, ShoppingBag, Wallet } from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import type { AdminAnalyticsPayload, DateRangePreset } from '../adminTypes';
import { EmptyState, InteractiveSeriesChart, StatCard, StatusBadge } from '../ui/AdminPrimitives';

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const AnalyticsReportsView: React.FC<{
  lang: Lang;
  onError: (msg: string) => void;
}> = ({ lang, onError }) => {
  const [range, setRange] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [chartMode, setChartMode] = useState<'revenue' | 'orders' | 'aiRequests' | 'users'>('revenue');
  const [data, setData] = useState<AdminAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ range });
      if (range === 'custom' && customStart) {
        qs.set('start', customStart);
        if (customEnd) qs.set('end', customEnd);
      }
      const res = await apiFetch<AdminAnalyticsPayload>(`/api/admin/analytics?${qs.toString()}`);
      setData(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range !== 'custom' || customStart) {
      void load();
    }
  }, [range, customStart, customEnd]);

  const s = data?.summary;
  const maxCat = Math.max(1, ...(data?.businessByCategory || []).map((c) => c.count));

  return (
    <div className="space-y-6">
      {/* Date Filter + CSV Exports */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#F3F0FF] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 w-fit">
          {(['7d', '30d', '3m', '1y', 'custom'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                range === r ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-xs' : 'text-[#7C8499]'
              }`}
            >
              {adminT(lang, `range_${r}`)}
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

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!data}
            onClick={() => {
              if (!data) return;
              downloadCsv('bexpar-platform-timeseries.csv', [
                ['Date', 'Revenue (BDT)', 'Orders', 'New Users', 'New Businesses', 'AI Requests', 'Coins Used'],
                ...data.timeSeries.map((t) => [t.date, t.revenue, t.orders, t.users, t.businesses, t.aiRequests, t.coinsUsed]),
              ]);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4520D9] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Time-Series CSV</span>
          </button>
          <button
            type="button"
            disabled={!data}
            onClick={() => {
              if (!data) return;
              downloadCsv('bexpar-top-businesses.csv', [
                ['Business', 'Category', 'Status', 'Orders', 'GMV (BDT)', 'AI Coins Used'],
                ...data.topBusinesses.map((b) => [b.name, b.category, b.status, b.orders, b.gmv, b.aiCoinsUsed]),
              ]);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Businesses CSV</span>
          </button>
        </div>
      </div>

      {/* Period KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Period Platform Revenue"
          value={loading && !s ? '...' : formatMoney(s?.periodRevenue || 0)}
          subValue={s ? `Sub ${formatMoney(s.periodSubRevenue)} · Coin ${formatMoney(s.periodCoinRevenue)}` : ''}
          icon={<Wallet className="w-4 h-4" />}
        />
        <StatCard
          label="Merchant Orders & GMV"
          value={loading && !s ? '...' : s?.periodOrders || 0}
          subValue={s ? `GMV ${formatMoney(s.periodGmv)}` : ''}
          icon={<ShoppingBag className="w-4 h-4" />}
          iconBgClass="bg-emerald-50 dark:bg-emerald-950/40 text-[#16B66A]"
        />
        <StatCard
          label="AI Usage & Coins"
          value={loading && !s ? '...' : `${(s?.periodCoinsUsed || 0).toFixed(1)} coins`}
          subValue={s ? `${s.periodAiRequests} calls · $${s.periodAiCostUsd.toFixed(4)} cost` : ''}
          icon={<Bot className="w-4 h-4" />}
          iconBgClass="bg-amber-50 dark:bg-amber-950/40 text-[#F5A623]"
        />
        <StatCard
          label="Active Businesses"
          value={loading && !s ? '...' : `${s?.activeBusinesses || 0} / ${s?.totalBusinesses || 0}`}
          subValue={`${(s?.periodTokens || 0).toLocaleString()} tokens`}
          icon={<Building2 className="w-4 h-4" />}
        />
      </div>

      {/* Interactive Trend Chart */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#5B35F5]" />
            <span>Platform Performance Trend</span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['revenue', 'Revenue'],
                ['orders', 'Merchant Orders'],
                ['aiRequests', 'AI Requests'],
                ['users', 'New Users'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setChartMode(k)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                  chartMode === k ? 'bg-[#5B35F5] text-white' : 'bg-[#F8F9FC] dark:bg-slate-950 text-[#7C8499]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <InteractiveSeriesChart
          data={(data?.timeSeries || []).map((t) => ({ date: t.date, value: t[chartMode] }))}
          valuePrefix={chartMode === 'revenue' ? '৳' : ''}
        />
      </div>

      {/* Breakdowns Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Business Categories */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">Businesses by Category</h3>
          {(data?.businessByCategory || []).length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <div className="space-y-2.5 text-xs">
              {data!.businessByCategory.map((c) => (
                <div key={c.category} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium text-[#101536] dark:text-slate-200">{c.category}</span>
                    <span className="font-bold tabular-nums">{c.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F3F0FF] dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#5B35F5]"
                      style={{ width: `${Math.round((c.count / maxCat) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Provider Breakdown */}
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">AI Provider Usage Breakdown</h3>
          {(data?.aiProviderUsage || []).length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                  <tr>
                    <th className="py-2 px-2">Provider</th>
                    <th className="py-2 px-2">Requests</th>
                    <th className="py-2 px-2">Tokens</th>
                    <th className="py-2 px-2">Coins</th>
                    <th className="py-2 px-2">Cost USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                  {data!.aiProviderUsage.map((p) => (
                    <tr key={p.providerSlug}>
                      <td className="py-2.5 px-2 font-semibold uppercase">{p.providerSlug}</td>
                      <td className="py-2.5 px-2 tabular-nums">{p.requests}</td>
                      <td className="py-2.5 px-2 tabular-nums">{p.tokens.toLocaleString()}</td>
                      <td className="py-2.5 px-2 tabular-nums font-semibold">{p.coinsUsed.toFixed(2)}</td>
                      <td className="py-2.5 px-2 font-mono tabular-nums">${p.costUsd.toFixed(5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Top Businesses */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
        <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
          Top Businesses in Selected Period
        </h3>
        {(data?.topBusinesses || []).length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                <tr>
                  <th className="py-2.5 px-3">Business</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Orders</th>
                  <th className="py-2.5 px-3">Merchant GMV</th>
                  <th className="py-2.5 px-3">AI Coins Used</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                {data!.topBusinesses.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 px-3 font-semibold text-[#101536] dark:text-white">{b.name}</td>
                    <td className="py-2.5 px-3 text-[#7C8499]">{b.category}</td>
                    <td className="py-2.5 px-3 tabular-nums font-semibold">{b.orders}</td>
                    <td className="py-2.5 px-3 tabular-nums font-bold text-[#5B35F5]">{formatMoney(b.gmv)}</td>
                    <td className="py-2.5 px-3 tabular-nums">{b.aiCoinsUsed}</td>
                    <td className="py-2.5 px-3">
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
