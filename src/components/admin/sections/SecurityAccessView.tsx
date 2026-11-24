import React, { useEffect, useState } from 'react';
import { Key, Lock, Shield, UserCheck } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { getBrowserSupabase } from '../../../lib/supabaseClient';
import type { Lang } from '../../../i18n/translations';
import type { UserProfile } from '../../../types';
import { adminT } from '../adminI18n';
import { EmptyState, StatusBadge } from '../ui/AdminPrimitives';

export const SecurityAccessView: React.FC<{
  lang: Lang;
  profile?: UserProfile | null;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ lang, profile, onNotify, onError }) => {
  const [profileForm, setProfileForm] = useState({
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    language: profile?.language || 'bn',
    timezone: profile?.timezone || 'Asia/Dhaka',
  });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityData, setSecurityData] = useState<{
    admins: Array<Record<string, unknown>>;
    roleCounts: Record<string, number>;
    securityLogs: Array<Record<string, unknown>>;
  }>({ admins: [], roleCounts: {}, securityLogs: [] });

  const load = async () => {
    try {
      const res = await apiFetch<typeof securityData>('/api/admin/security');
      setSecurityData(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load security overview.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (profile) {
      setProfileForm({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
        language: profile.language || 'bn',
        timezone: profile.timezone || 'Asia/Dhaka',
      });
    }
  }, [profile]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Admin Profile */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await apiFetch('/api/admin/profile', {
                method: 'PATCH',
                body: JSON.stringify(profileForm),
              });
              onNotify('Admin profile updated.');
              await load();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to update profile.');
            }
          }}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
                {adminT(lang, 'adminProfile')}
              </h3>
              <p className="text-[11px] text-[#7C8499]">{profile?.email || 'Authenticated Super Admin'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Full Name</label>
              <input
                type="text"
                value={profileForm.full_name}
                onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Phone</label>
              <input
                type="text"
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Preferred Language</label>
              <select
                value={profileForm.language}
                onChange={(e) => setProfileForm({ ...profileForm, language: e.target.value as 'bn' | 'en' })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
              >
                <option value="bn">Bangla (bn)</option>
                <option value="en">English (en)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Timezone</label>
              <input
                type="text"
                value={profileForm.timezone}
                onChange={(e) => setProfileForm({ ...profileForm, timezone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]">
            {adminT(lang, 'saveChanges')}
          </button>
        </form>

        {/* Change Password */}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (newPassword.length < 8) {
              onError('Password must be at least 8 characters.');
              return;
            }
            if (newPassword !== confirmPassword) {
              onError('Passwords do not match.');
              return;
            }
            try {
              const { error } = await getBrowserSupabase().auth.updateUser({ password: newPassword });
              if (error) throw error;
              setNewPassword('');
              setConfirmPassword('');
              onNotify('Super Admin password updated via Supabase Auth.');
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Password update failed.');
            }
          }}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
                {adminT(lang, 'changePassword')}
              </h3>
              <p className="text-[11px] text-[#7C8499]">Updates your active Supabase Auth credentials.</p>
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4520D9]">
            Update Password
          </button>
        </form>
      </div>

      {/* Role Distribution & Super Admins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#5B35F5]" />
            <span>{adminT(lang, 'roleMatrix')}</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {Object.entries(securityData.roleCounts).map(([role, count]) => (
              <div key={role} className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF]/70 dark:border-slate-800">
                <div className="text-[11px] text-[#7C8499] capitalize">{role.replace(/_/g, ' ')}</div>
                <div className="text-lg font-display font-bold text-[#101536] dark:text-white tabular-nums mt-0.5">
                  {count}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
          <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
            <Key className="w-4 h-4 text-[#5B35F5]" />
            <span>Authorized Super Admins</span>
          </h3>
          <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
            {securityData.admins.map((a) => (
              <div key={String(a.id)} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-[#101536] dark:text-white">{String(a.full_name || a.email)}</div>
                  <div className="text-[11px] text-[#7C8499]">{String(a.email)}</div>
                </div>
                <StatusBadge status={String(a.status)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Security Events */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3">
        <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">
          {adminT(lang, 'securityAudit')}
        </h3>
        {securityData.securityLogs.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                <tr>
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Actor</th>
                  <th className="py-2 px-3">Security Event</th>
                  <th className="py-2 px-3">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                {securityData.securityLogs.slice(0, 20).map((log) => (
                  <tr key={String(log.id)}>
                    <td className="py-2 px-3 font-mono text-[11px] text-[#7C8499]">
                      {new Date(String(log.created_at)).toLocaleString()}
                    </td>
                    <td className="py-2 px-3">{String(log.actor_email || 'System')}</td>
                    <td className="py-2 px-3 font-mono font-semibold text-[#5B35F5]">{String(log.action)}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">
                      {String(log.target_type)}:{String(log.target_id).slice(0, 8)}
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
