import React from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  icon: React.ReactNode;
  iconBgClass?: string;
  growthPct?: number | null;
  sparkline?: number[];
  sparkColor?: string;
}> = ({
  label,
  value,
  subValue,
  icon,
  iconBgClass = 'bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA]',
  growthPct,
  sparkline,
  sparkColor = '#5B35F5',
}) => {
  const renderSpark = () => {
    if (!sparkline || sparkline.length < 2) return null;
    const max = Math.max(...sparkline, 1);
    const min = Math.min(...sparkline, 0);
    const span = Math.max(max - min, 1);
    const w = 88;
    const h = 28;
    const pts = sparkline
      .map((v, i) => {
        const x = (i / (sparkline.length - 1)) * w;
        const y = h - ((v - min) / span) * (h - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 overflow-visible" aria-hidden="true">
        <polyline
          fill="none"
          stroke={sparkColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
      </svg>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card transition-transform duration-150 hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[#7C8499] dark:text-slate-400 truncate">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBgClass}`}>
          {icon}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-display font-bold text-[#101536] dark:text-white tabular-nums truncate">
            {value}
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {growthPct !== null && growthPct !== undefined && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${
                  growthPct >= 0
                    ? 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/50 dark:text-emerald-400'
                    : 'bg-rose-50 text-[#EF4444] dark:bg-rose-950/50 dark:text-rose-400'
                }`}
              >
                {growthPct >= 0 ? `+${growthPct}%` : `${growthPct}%`}
              </span>
            )}
            {subValue && (
              <span className="text-xs text-[#7C8499] dark:text-slate-400 tabular-nums truncate">{subValue}</span>
            )}
          </div>
        </div>
        {renderSpark()}
      </div>
    </div>
  );
};

export const StatusBadge: React.FC<{ status: string; label?: string }> = ({ status, label }) => {
  const s = (status || '').toLowerCase();
  let cls = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  if (['active', 'approved', 'success', 'completed', 'connected', 'operational'].includes(s)) {
    cls = 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/50';
  } else if (['pending', 'trial', 'warning', 'development', 'sandbox', 'inactive'].includes(s)) {
    cls = 'bg-amber-50 text-[#D98207] dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200/60 dark:border-amber-900/50';
  } else if (['suspended', 'rejected', 'error', 'failed', 'expired', 'cancelled', 'blocked_insufficient_coins'].includes(s)) {
    cls = 'bg-rose-50 text-[#EF4444] dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/50';
  } else if (['super_admin', 'production', 'primary', 'admin_credit'].includes(s)) {
    cls = 'bg-[#F3F0FF] text-[#5B35F5] dark:bg-[#5B35F5]/20 dark:text-[#A78BFA] border border-[#E6E0FF] dark:border-[#5B35F5]/30';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize whitespace-nowrap ${cls}`}>
      {label || status.replace(/_/g, ' ')}
    </span>
  );
};

export const EmptyState: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({
  title,
  subtitle,
  icon,
}) => (
  <div className="py-10 px-4 text-center flex flex-col items-center justify-center gap-2">
    <div className="w-11 h-11 rounded-2xl bg-[#F3F0FF] dark:bg-[#5B35F5]/15 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
      {icon || <Inbox className="w-5 h-5" />}
    </div>
    <div className="text-sm font-semibold text-[#101536] dark:text-white">{title}</div>
    {subtitle && <div className="text-xs text-[#7C8499] dark:text-slate-400 max-w-md">{subtitle}</div>}
  </div>
);

export const AdminModal: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ open, title, subtitle, onClose, children, maxWidthClass = 'max-w-lg' }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`w-full ${maxWidthClass} bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto`}
      >
        <div className="px-5 py-4 border-b border-[#E6E0FF] dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-display font-bold text-[#101536] dark:text-white truncate">{title}</h3>
            {subtitle && <p className="text-xs text-[#7C8499] dark:text-slate-400 truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              tone === 'danger'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-[#EF4444]'
                : 'bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5]'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-display font-bold text-[#101536] dark:text-white">{title}</h3>
            <p className="text-xs text-[#7C8499] dark:text-slate-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity disabled:opacity-60 ${
              tone === 'danger' ? 'bg-[#EF4444] hover:bg-rose-600' : 'bg-[#5B35F5] hover:bg-[#4520D9]'
            }`}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const PaginationBar: React.FC<{
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
}> = ({ page, pageSize, total, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#E6E0FF]/70 dark:border-slate-800 text-xs text-[#7C8499] dark:text-slate-400">
      <span className="tabular-nums">
        {start}–{end} / {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 disabled:opacity-40 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="px-2 font-semibold text-[#101536] dark:text-white tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 disabled:opacity-40 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const InteractiveSeriesChart: React.FC<{
  data: Array<{ date: string; value: number }>;
  color?: string;
  valuePrefix?: string;
  emptyLabel?: string;
}> = ({ data, color = '#5B35F5', valuePrefix = '', emptyLabel = 'No activity in selected range' }) => {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  if (!data || data.length === 0) {
    return <EmptyState title={emptyLabel} />;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const allZero = data.every((d) => d.value === 0);

  return (
    <div className="space-y-3">
      {hoverIdx !== null && data[hoverIdx] ? (
        <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
          <span className="font-mono text-[#7C8499] dark:text-slate-400">{data[hoverIdx].date}</span>
          <span className="font-bold text-[#101536] dark:text-white tabular-nums">
            {valuePrefix}
            {data[hoverIdx].value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-xl bg-[#F8F9FC] dark:bg-slate-950/60 border border-transparent">
          <span className="text-[#7C8499] dark:text-slate-400">
            {data[0]?.date} — {data[data.length - 1]?.date}
          </span>
          <span className="font-semibold text-[#101536] dark:text-white tabular-nums">
            Total: {valuePrefix}
            {data.reduce((s, d) => s + d.value, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <div className="h-48 flex items-end gap-1 pt-2 px-1">
        {data.map((pt, idx) => {
          const pct = allZero ? 4 : Math.max(4, Math.round((pt.value / maxVal) * 100));
          const isHovered = hoverIdx === idx;
          return (
            <div
              key={pt.date}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex-1 h-full flex flex-col items-center justify-end group cursor-pointer min-w-[4px]"
            >
              <div
                style={{
                  height: `${pct}%`,
                  backgroundColor: isHovered ? '#4520D9' : color,
                  opacity: pt.value === 0 ? 0.22 : isHovered ? 1 : 0.85,
                }}
                className="w-full max-w-[26px] rounded-t-md transition-all duration-150"
                title={`${pt.date}: ${valuePrefix}${pt.value}`}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-[#7C8499] dark:text-slate-500 px-1">
        <span>{data[0]?.date}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)]?.date}</span>}
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
};

export const DonutChart: React.FC<{
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string | number;
}> = ({ segments, centerLabel, centerValue }) => {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
        <svg className="w-32 h-32 -rotate-90" viewBox="0 0 112 112">
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-[#F3F0FF] dark:text-slate-800"
            strokeWidth="14"
          />
          {total > 0 &&
            segments.map((seg) => {
              const frac = seg.value / total;
              const dash = frac * circumference;
              const offset = -cumulative * circumference;
              cumulative += frac;
              if (seg.value <= 0) return null;
              return (
                <circle
                  key={seg.label}
                  cx="56"
                  cy="56"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="14"
                  strokeDasharray={`${dash} ${circumference}`}
                  strokeDashoffset={offset}
                  strokeLinecap="butt"
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-xl font-display font-bold text-[#101536] dark:text-white tabular-nums">
            {centerValue}
          </span>
          <span className="text-[10px] font-medium text-[#7C8499] dark:text-slate-400">{centerLabel}</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2.5">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
          return (
            <div key={seg.label} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-[#101536] dark:text-slate-200 font-medium truncate">{seg.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                <span className="font-bold text-[#101536] dark:text-white">{seg.value}</span>
                <span className="text-[11px] text-[#7C8499] dark:text-slate-400 w-9 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
