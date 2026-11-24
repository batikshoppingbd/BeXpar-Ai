import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { Business } from '../../types';
import type { Lang } from '../../i18n/translations';

interface AnalyticsViewProps {
  business: Business;
  lang: Lang;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ business, lang }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{
    summary: {
      totalSales: number;
      totalOrders: number;
      deliveredOrders: number;
      cancelledOrders: number;
      returnedOrders: number;
      revenue: number;
      productCosts: number;
      deliveryCosts: number;
      estimatedProfit: number;
      repeatCustomerRate: number;
      totalCustomers: number;
      aiCoinsSpent: number;
      aiTokens: number;
    };
    bestSellingProducts: Array<{ name: string; quantity: number; revenue: number }>;
  } | null>(null);

  useEffect(() => {
    void apiFetch<NonNullable<typeof data>>(`/api/businesses/${business.id}/analytics?days=${days}`, {
      businessId: business.id,
    }).then(setData);
  }, [business.id, days]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Metric', 'Value'],
      ['Revenue', data.summary.revenue],
      ['Product Costs', data.summary.productCosts],
      ['Delivery Costs', data.summary.deliveryCosts],
      ['Estimated Profit', data.summary.estimatedProfit],
      ['Total Orders', data.summary.totalOrders],
      ['Delivered Orders', data.summary.deliveredOrders],
      ['Cancelled Orders', data.summary.cancelledOrders],
      ['Returned Orders', data.summary.returnedOrders],
      ['Repeat Customer Rate (%)', data.summary.repeatCustomerRate],
      ['AI Coins Spent', data.summary.aiCoinsSpent],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bexpar-analytics-${days}d.csv`;
    a.click();
  };

  const s = data?.summary;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'বিজনেস অ্যানালিটিক্স' : 'Business Analytics'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Estimated Profit = Revenue minus recorded Product Purchase Costs &amp; Delivery Charges (distinct from formal tax/accounting profit).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium">
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 transition-colors">
            <Download className="w-4 h-4" />
            <span>CSV Export</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Gross Revenue</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">{formatMoney(s?.revenue || 0)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Estimated Profit</div>
          <div className="mt-2 text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatMoney(s?.estimatedProfit || 0)}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Product + Delivery Costs</div>
          <div className="mt-2 text-2xl font-display font-bold text-slate-900 dark:text-white tabular-nums">{formatMoney((s?.productCosts || 0) + (s?.deliveryCosts || 0))}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Repeat Customer Rate</div>
          <div className="mt-2 text-2xl font-display font-bold text-[#5B35F5] dark:text-[#A78BFA] tabular-nums">{s?.repeatCustomerRate || 0}%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
          <h2 className="text-sm font-display font-bold mb-3 text-slate-900 dark:text-white">Best-Selling Products</h2>
          {!data?.bestSellingProducts.length ? (
            <p className="text-xs text-slate-400 py-6 text-center">No product sales recorded in this period.</p>
          ) : (
            <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-sm">
              {data.bestSellingProducts.map((p) => (
                <div key={p.name} className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-white">{p.name}</span>
                  <span className="font-mono text-xs tabular-nums">
                    {p.quantity} sold · <strong className="text-[#5B35F5] dark:text-[#A78BFA]">{formatMoney(p.revenue)}</strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">Order Fulfillment &amp; AI Cost</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-[#F9F7FF] dark:bg-slate-950 border border-[#E6E0FF]/60 dark:border-slate-800 flex items-center justify-between">
              <span className="text-slate-500">Delivered Orders</span>
              <strong className="font-mono text-sm text-emerald-600 tabular-nums">{s?.deliveredOrders || 0}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F9F7FF] dark:bg-slate-950 border border-[#E6E0FF]/60 dark:border-slate-800 flex items-center justify-between">
              <span className="text-slate-500">Cancelled Orders</span>
              <strong className="font-mono text-sm text-rose-600 tabular-nums">{s?.cancelledOrders || 0}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F9F7FF] dark:bg-slate-950 border border-[#E6E0FF]/60 dark:border-slate-800 flex items-center justify-between">
              <span className="text-slate-500">Returned Orders</span>
              <strong className="font-mono text-sm text-amber-600 tabular-nums">{s?.returnedOrders || 0}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F9F7FF] dark:bg-slate-950 border border-[#E6E0FF]/60 dark:border-slate-800 flex items-center justify-between">
              <span className="text-slate-500">AI Coins Spent</span>
              <strong className="font-mono text-sm text-[#5B35F5] dark:text-[#A78BFA] tabular-nums">{Number(s?.aiCoinsSpent || 0).toFixed(2)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
