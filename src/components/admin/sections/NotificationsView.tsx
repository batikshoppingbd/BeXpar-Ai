import React, { useEffect, useState } from 'react';
import { Bell, Megaphone, Send } from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import type { AdminSectionId } from '../adminTypes';
import { EmptyState, StatusBadge } from '../ui/AdminPrimitives';

export const NotificationsView: React.FC<{
  lang: Lang;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
  onNavigate: (tab: AdminSectionId, sub?: string) => void;
  onRefreshSystem?: () => void;
}> = ({ lang, onNotify, onError, onNavigate, onRefreshSystem }) => {
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([]);
  const [pendingPayments, setPendingPayments] = useState<Array<Record<string, unknown>>>([]);
  const [businesses, setBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [announcement, setAnnouncement] = useState('');

  const [form, setForm] = useState({
    targetBusinessId: 'all',
    type: 'info',
    title: '',
    body: '',
  });
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const res = await apiFetch<{
        notifications: Array<Record<string, unknown>>;
        pendingPayments: Array<Record<string, unknown>>;
        businesses: Array<{ id: string; name: string }>;
        announcement: string;
      }>('/api/admin/notifications');
      setNotifications(res.notifications || []);
      setPendingPayments(res.pendingPayments || []);
      setBusinesses(res.businesses || []);
      setAnnouncement(res.announcement || '');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load notifications.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Global Announcement Banner */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch('/api/admin/settings', {
                method: 'PATCH',
                body: JSON.stringify({ announcement }),
              });
              onNotify('Global announcement banner updated.');
              onRefreshSystem?.();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to save announcement.');
            }
          }}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
              <Megaphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
                Global System Announcement Banner
              </h3>
              <p className="text-[11px] text-[#7C8499]">
                Displayed across all active merchant panels. Leave empty to hide.
              </p>
            </div>
          </div>
          <textarea
            rows={3}
            placeholder="e.g. Scheduled Meta webhook maintenance at 02:00 AM BST..."
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]">
            Update Announcement
          </button>
        </form>

        {/* Send Targeted or Broadcast Notification */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSending(true);
            try {
              const res = await apiFetch<{ sentCount: number }>('/api/admin/notifications/broadcast', {
                method: 'POST',
                body: JSON.stringify(form),
              });
              setForm({ targetBusinessId: 'all', type: 'info', title: '', body: '' });
              onNotify(`Notification sent to ${res.sentCount} workspace(s).`);
              await load();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to send notification.');
            } finally {
              setSending(false);
            }
          }}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
                Send Platform Notification
              </h3>
              <p className="text-[11px] text-[#7C8499]">Writes real notifications to workspace owners.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={form.targetBusinessId}
              onChange={(e) => setForm({ ...form, targetBusinessId: e.target.value })}
              className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            >
              <option value="all">All Active Businesses ({businesses.length})</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            >
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="error">Alert</option>
            </select>
          </div>
          <input
            type="text"
            required
            placeholder="Notification title..."
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <textarea
            rows={2}
            placeholder="Notification message..."
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]"
          >
            {sending ? 'Sending...' : 'Send Notification'}
          </button>
        </form>
      </div>

      {/* Actionable Pending Payment Alerts */}
      {pendingPayments.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 rounded-2xl p-5 bx-card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
              Pending Payment Verifications ({pendingPayments.length})
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('settings', 'payments')}
              className="text-xs font-semibold text-[#5B35F5] hover:underline"
            >
              Review in Platform Settings →
            </button>
          </div>
          <div className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800 text-xs">
            {pendingPayments.map((p) => (
              <div key={String(p.id)} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">
                    {String((p.business as Record<string, unknown>)?.name || p.business_id)}
                  </span>{' '}
                  · <span className="capitalize">{String(p.payment_for).replace('_', ' ')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold tabular-nums">{formatMoney(Number(p.amount || 0))}</span>
                  <StatusBadge status="pending" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sent Notifications Log */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
        <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-[#5B35F5]" />
          <span>Recent Platform Notifications</span>
        </h3>
        {notifications.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
            {notifications.slice(0, 20).map((n) => (
              <div key={String(n.id)} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-[#101536] dark:text-white">{String(n.title)}</div>
                  {Boolean(n.body) && <div className="text-[#7C8499] mt-0.5">{String(n.body)}</div>}
                  <div className="text-[11px] text-[#7C8499] mt-0.5">
                    {String((n.business as Record<string, unknown>)?.name || 'System')} ·{' '}
                    {new Date(String(n.created_at)).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={String(n.type || 'info')} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
