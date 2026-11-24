import React, { useEffect, useState } from 'react';
import { RefreshCw, ScrollText, Search } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import { AdminModal, EmptyState, PaginationBar, StatusBadge } from '../ui/AdminPrimitives';

export const SystemLogsView: React.FC<{
  lang: Lang;
  globalSearch: string;
  onError: (msg: string) => void;
}> = ({ lang, globalSearch, onError }) => {
  const [logTab, setLogTab] = useState<'audit' | 'ai' | 'social'>('audit');
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [aiLogs, setAiLogs] = useState<Array<Record<string, unknown>>>([]);
  const [socialLogs, setSocialLogs] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [inspectRow, setInspectRow] = useState<Record<string, unknown> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{
        logs: Array<Record<string, unknown>>;
        aiLogs: Array<Record<string, unknown>>;
        socialLogs: Array<Record<string, unknown>>;
      }>('/api/admin/audit-logs');
      setAuditLogs(res.logs || []);
      setAiLogs(res.aiLogs || []);
      setSocialLogs(res.socialLogs || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load system logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const q = (search || globalSearch).trim().toLowerCase();
  const activeList = (logTab === 'audit' ? auditLogs : logTab === 'ai' ? aiLogs : socialLogs).filter((row) =>
    !q ? true : JSON.stringify(row).toLowerCase().includes(q)
  );
  const pageSize = 15;
  const paged = activeList.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['audit', `Admin Audit (${auditLogs.length})`],
              ['ai', `AI Execution (${aiLogs.length})`],
              ['social', `Social Integrations (${socialLogs.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setLogTab(id);
                setPage(1);
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold ${
                logTab === id ? 'bg-[#5B35F5] text-white' : 'bg-[#F3F0FF] dark:bg-slate-800 text-[#7C8499]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7C8499] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Filter logs..."
              className="pl-8 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-[#5B35F5]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card">
        {paged.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} icon={<ScrollText className="w-5 h-5" />} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                  {logTab === 'audit' ? (
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Actor</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Target</th>
                      <th className="py-2.5 px-3">Details</th>
                    </tr>
                  ) : logTab === 'ai' ? (
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Provider / Model</th>
                      <th className="py-2.5 px-3">Tokens / Coins</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Error</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Platform</th>
                      <th className="py-2.5 px-3">Event</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Message</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                  {paged.map((row) => (
                    <tr
                      key={String(row.id)}
                      onClick={() => setInspectRow(row)}
                      className="cursor-pointer hover:bg-[#F3F0FF]/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[#7C8499] whitespace-nowrap">
                        {new Date(String(row.created_at)).toLocaleString()}
                      </td>
                      {logTab === 'audit' ? (
                        <>
                          <td className="py-2.5 px-3">{String(row.actor_email || row.actor_id || 'System')}</td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-[#5B35F5]">
                            {String(row.action)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {String(row.target_type)}:{String(row.target_id).slice(0, 8)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] max-w-xs truncate text-[#7C8499]">
                            {JSON.stringify(row.details)}
                          </td>
                        </>
                      ) : logTab === 'ai' ? (
                        <>
                          <td className="py-2.5 px-3 font-mono">
                            {String(row.provider_slug)} / {String(row.model_id)}
                          </td>
                          <td className="py-2.5 px-3 tabular-nums">
                            {Number(row.total_tokens || 0)} tok · {Number(row.coins_deducted || 0).toFixed(2)} coins
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={String(row.status)} />
                          </td>
                          <td className="py-2.5 px-3 text-rose-500 max-w-xs truncate">
                            {String(row.error_message || '—')}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 px-3 capitalize font-semibold">{String(row.platform)}</td>
                          <td className="py-2.5 px-3 font-mono">{String(row.event_type)}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={String(row.status)} />
                          </td>
                          <td className="py-2.5 px-3 text-[#7C8499] max-w-xs truncate">{String(row.message || '—')}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar page={page} pageSize={pageSize} total={activeList.length} onPageChange={setPage} />
          </>
        )}
      </div>

      <AdminModal
        open={Boolean(inspectRow)}
        title="Log Entry Details"
        onClose={() => setInspectRow(null)}
      >
        {inspectRow && (
          <pre className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(inspectRow, null, 2)}
          </pre>
        )}
      </AdminModal>
    </div>
  );
};
