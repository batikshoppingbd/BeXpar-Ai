import React, { useEffect, useState } from 'react';
import { Check, Loader2, LogOut, UserPlus } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getBrowserSupabase } from '../../lib/supabaseClient';
import type { Business, UserProfile } from '../../types';
import type { Lang } from '../../i18n/translations';
import { PWAInstallButton } from '../pwa/PWAControls';

interface UserSettingsViewProps {
  profile: UserProfile;
  business: Business;
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  onRefresh: () => void;
  onLogout?: () => void;
}

export const UserSettingsView: React.FC<UserSettingsViewProps> = ({
  profile,
  business,
  lang,
  onChangeLang,
  onRefresh,
  onLogout,
}) => {
  const [bizName, setBizName] = useState(business.name);
  const [bizPhone, setBizPhone] = useState(business.phone);
  const [bizAddress, setBizAddress] = useState(business.address);
  const [bizCategory, setBizCategory] = useState(business.category);
  const [fullName, setFullName] = useState(profile.full_name);
  const [newPassword, setNewPassword] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('business_staff');
  const [members, setMembers] = useState<Array<{ id: string; role: string; status: string; profile?: { full_name: string; email: string } }>>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadStaff = async () => {
    try {
      const res = await apiFetch<{ members: typeof members }>(`/api/businesses/${business.id}/staff`, {
        businessId: business.id,
      });
      setMembers(res.members);
    } catch {
      // Staff feature may be disabled or user lacks permission
    }
  };

  useEffect(() => {
    void loadStaff();
  }, [business.id]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch(`/api/businesses/${business.id}`, {
        method: 'PATCH',
        businessId: business.id,
        body: JSON.stringify({ name: bizName, phone: bizPhone, address: bizAddress, category: bizCategory }),
      });
      await apiFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ full_name: fullName, language: lang }),
      });
      setNotice('Business & account settings saved.');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) return;
    const { error } = await getBrowserSupabase().auth.updateUser({ password: newPassword });
    if (!error) {
      setNewPassword('');
      setNotice('Password updated successfully.');
    }
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/api/businesses/${business.id}/staff/invite`, {
      method: 'POST',
      businessId: business.id,
      body: JSON.stringify({ email: staffEmail, role: staffRole }),
    });
    setStaffEmail('');
    setNotice('Staff member invited / added.');
    void loadStaff();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'বিজনেস ও অ্যাকাউন্ট সেটিংস' : 'Business & Account Settings'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {lang === 'bn' ? 'ব্যবসার তথ্য, ভাষা, পাসওয়ার্ড এবং স্টাফ টিম পরিচালনা করুন।' : 'Manage business profile, language, security, and team access.'}
          </p>
        </div>
        <PWAInstallButton label={lang === 'bn' ? 'অ্যাপ ইনস্টল করুন' : 'Install BeXpar Ai App'} />
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={handleSaveBusiness} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-4">
        <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">Business Profile &amp; Preferences</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Business Name</label>
            <input type="text" value={bizName} onChange={(e) => setBizName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Your Name</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Phone</label>
            <input type="text" value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Category</label>
            <input type="text" value={bizCategory} onChange={(e) => setBizCategory(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Address</label>
          <input type="text" value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Interface Language</label>
          <select value={lang} onChange={(e) => onChangeLang(e.target.value as Lang)} className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
            <option value="bn">বাংলা (Bengali - Default)</option>
            <option value="en">English</option>
          </select>
        </div>
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 inline-flex items-center gap-2 transition-colors">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>Save Settings</span>
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={handleUpdatePassword} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-3">
          <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">Security — Change Password</h2>
          <input type="password" minLength={6} required placeholder="New Password (min 6 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          <button type="submit" className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950 text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 text-xs font-semibold transition-colors">
            Update Password
          </button>
        </form>

        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-3">
          <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">Staff Team Management</h2>
          <form onSubmit={handleInviteStaff} className="flex gap-2">
            <input type="email" required placeholder="staff@email.com" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs" />
            <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)} className="px-2 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs">
              <option value="business_staff">Staff</option>
              <option value="business_admin">Admin</option>
              <option value="support_staff">Support</option>
            </select>
            <button type="submit" className="px-3 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs shrink-0 transition-colors">
              <UserPlus className="w-4 h-4" />
            </button>
          </form>
          <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 text-xs">
            {members.map((m) => (
              <div key={m.id} className="py-2 flex items-center justify-between">
                <span className="truncate pr-2">{m.profile?.email || m.id}</span>
                <span className="capitalize text-slate-500 shrink-0">{m.role.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {onLogout && (
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white">
              {lang === 'bn' ? 'অ্যাকাউন্ট সেশন' : 'Account Session'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'bn' ? `বর্তমানে লগইন করা আছে: ${profile.email}` : `Signed in as ${profile.email}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{lang === 'bn' ? 'লগআউট করুন' : 'Logout'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
