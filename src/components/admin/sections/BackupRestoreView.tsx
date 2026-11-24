import React, { useEffect, useState } from 'react';
import { Database, Download, HardDrive, Info, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { StatusBadge } from '../ui/AdminPrimitives';

interface BackupStatusPayload {
  schemaStatus: {
    connected: boolean;
    schemaReady: boolean;
    appliedMigrations: string[];
  };
  tableCounts: Record<string, number>;
  automatedBackupSupported: boolean;
  checkedAt: string;
}

export const BackupRestoreView: React.FC<{
  lang: Lang;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ lang, onNotify, onError }) => {
  const [status, setStatus] = useState<BackupStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<BackupStatusPayload>('/api/admin/backup/status');
      setStatus(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load database health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleExportConfig = async () => {
    setExporting(true);
    try {
      const payload = await apiFetch<Record<string, unknown>>('/api/admin/backup/export-config');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bexpar-platform-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Non-secret platform configuration exported.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Configuration export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Honest Infrastructure Notice */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center shrink-0">
          <Info className="w-4 h-4" />
        </div>
        <div className="space-y-1 text-xs">
          <div className="font-display font-bold text-sm text-[#101536] dark:text-white">
            {lang === 'bn'
              ? 'Supabase ক্লাউড ব্যাকআপ এবং কনফিগারেশন এক্সপোর্ট'
              : 'Supabase Managed Backups & Safe Config Export'}
          </div>
          <p className="text-[#7C8499] dark:text-slate-400 leading-relaxed">
            {lang === 'bn'
              ? 'সম্পূর্ণ PostgreSQL ডাটাবেস স্ন্যাপশট এবং পয়েন্ট-ইন-টাইম রিস্টোর সরাসরি আপনার Supabase প্রজেক্ট ড্যাশবোর্ড থেকে পরিচালিত হয়। নিরাপত্তার কারণে অ্যাপ সার্ভার থেকে সরাসরি ডাটাবেস রিস্টোর সক্রিয় নেই; তবে এখান থেকে আপনি নন-সিক্রেট প্ল্যাটফর্ম কনফিগারেশন JSON আকারে এক্সপোর্ট করতে এবং রিয়েল-টাইম টেবিল স্বাস্থ্য পরীক্ষা করতে পারবেন।'
              : 'Full PostgreSQL snapshots and point-in-time recovery (PITR) are managed directly by Supabase inside your Supabase Project Dashboard. To preserve database integrity, destructive restore operations are not executed from the web console. Below you can verify live schema health and export non-secret platform configuration.'}
          </p>
        </div>
      </div>

      {/* Database & Schema Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display font-bold text-sm text-[#101536] dark:text-white">
              <Database className="w-4 h-4 text-[#5B35F5]" />
              <span>Schema & Migrations</span>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="p-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-[#5B35F5]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[#7C8499]">Supabase Connection</span>
              <StatusBadge
                status={status?.schemaStatus?.connected ? 'connected' : 'error'}
                label={status?.schemaStatus?.connected ? 'Connected' : 'Disconnected'}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#7C8499]">Schema Integrity</span>
              <StatusBadge
                status={status?.schemaStatus?.schemaReady ? 'active' : 'error'}
                label={status?.schemaStatus?.schemaReady ? 'Ready' : 'Incomplete'}
              />
            </div>
          </div>

          <div>
            <div className="font-semibold text-[#7C8499] mb-1.5">Applied Migrations</div>
            <div className="flex flex-wrap gap-1.5">
              {(status?.schemaStatus?.appliedMigrations || []).map((m) => (
                <span
                  key={m}
                  className="px-2 py-1 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] font-mono text-[11px]"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Live Table Row Counts */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-display font-bold text-sm text-[#101536] dark:text-white">
              <HardDrive className="w-4 h-4 text-[#5B35F5]" />
              <span>Live Table Inventory</span>
            </div>
            <button
              type="button"
              onClick={handleExportConfig}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Exporting...' : 'Export Config JSON'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {Object.entries(status?.tableCounts || {}).map(([table, count]) => (
              <div
                key={table}
                className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF]/70 dark:border-slate-800"
              >
                <div className="text-[11px] font-mono text-[#7C8499]">{table}</div>
                <div className="text-lg font-display font-bold text-[#101536] dark:text-white tabular-nums mt-0.5">
                  {count.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
