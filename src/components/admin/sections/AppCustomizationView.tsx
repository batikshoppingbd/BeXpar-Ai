import React, { useEffect, useState } from 'react';
import { Palette, Sparkles } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';

export const AppCustomizationView: React.FC<{
  lang: Lang;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
  onRefreshSystem?: () => void;
}> = ({ lang, onNotify, onError, onRefreshSystem }) => {
  const [form, setForm] = useState({
    app_name: 'BeXpar Ai',
    logo_url: '',
    icon_url: '/icon.svg',
    primary_color: '#5B35F5',
    secondary_color: '#4520D9',
    default_theme: 'light',
    default_language: 'bn',
    terms_url: '',
    privacy_url: '',
    announcement: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<{ settings: Record<string, unknown> }>('/api/admin/settings');
        const s = res.settings || {};
        setForm({
          app_name: String(s.app_name || 'BeXpar Ai'),
          logo_url: String(s.logo_url || ''),
          icon_url: String(s.icon_url || '/icon.svg'),
          primary_color: String(s.primary_color || '#5B35F5'),
          secondary_color: String(s.secondary_color || '#4520D9'),
          default_theme: String(s.default_theme || 'light'),
          default_language: String(s.default_language || 'bn'),
          terms_url: String(s.terms_url || ''),
          privacy_url: String(s.privacy_url || ''),
          announcement: String(s.announcement || ''),
        });
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load customization settings.');
      }
    })();
  }, []);

  const previewLogo =
    form.logo_url.trim() || '/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await apiFetch('/api/admin/settings', {
              method: 'PATCH',
              body: JSON.stringify(form),
            });
            onNotify('App branding & customization saved.');
            onRefreshSystem?.();
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to save customization.');
          } finally {
            setSaving(false);
          }
        }}
        className="xl:col-span-2 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-5 text-xs"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
            <Palette className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
              {adminT(lang, 'nav_customization')}
            </h2>
            <p className="text-xs text-[#7C8499]">
              Customize BeXpar Ai identity, theme colors, public announcement, and policy links stored in Supabase.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold mb-1">Application Name</label>
            <input
              type="text"
              required
              value={form.app_name}
              onChange={(e) => setForm({ ...form, app_name: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Default Theme</label>
            <select
              value={form.default_theme}
              onChange={(e) => setForm({ ...form, default_theme: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            >
              <option value="light">Light (Purple & White)</option>
              <option value="dark">Dark Mode</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Logo URL (Optional override)</label>
            <input
              type="text"
              placeholder="/assets/aistudio/..."
              value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Favicon / Icon URL</label>
            <input
              type="text"
              value={form.icon_url}
              onChange={(e) => setForm({ ...form, icon_url: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Primary Purple Color</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={form.primary_color}
                onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                className="w-10 h-9 rounded-lg border border-[#E6E0FF] cursor-pointer"
              />
              <input
                type="text"
                value={form.primary_color}
                onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Secondary / Deep Color</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={form.secondary_color}
                onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                className="w-10 h-9 rounded-lg border border-[#E6E0FF] cursor-pointer"
              />
              <input
                type="text"
                value={form.secondary_color}
                onChange={(e) => setForm({ ...form, secondary_color: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Terms of Service URL</label>
            <input
              type="text"
              placeholder="https://..."
              value={form.terms_url}
              onChange={(e) => setForm({ ...form, terms_url: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Privacy Policy URL</label>
            <input
              type="text"
              placeholder="https://..."
              value={form.privacy_url}
              onChange={(e) => setForm({ ...form, privacy_url: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold mb-1">Global Top Announcement Banner</label>
          <input
            type="text"
            placeholder="Optional notice displayed across User Panel header..."
            value={form.announcement}
            onChange={(e) => setForm({ ...form, announcement: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white font-semibold"
        >
          {saving ? '...' : adminT(lang, 'saveChanges')}
        </button>
      </form>

      {/* Live Brand Preview */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-4">
        <div className="text-sm font-display font-bold text-[#101536] dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#5B35F5]" />
          <span>Live Brand Preview</span>
        </div>
        <div
          className="rounded-2xl p-5 text-white space-y-4 shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${form.primary_color}, ${form.secondary_color})`,
          }}
        >
          <div className="flex items-center gap-3">
            <img src={previewLogo} alt={form.app_name} className="w-11 h-11 rounded-xl object-cover bg-white/10" />
            <div>
              <div className="font-display font-bold text-base">{form.app_name || 'BeXpar Ai'}</div>
              <div className="text-[11px] text-white/80">AI Business Automation Platform</div>
            </div>
          </div>
          {form.announcement && (
            <div className="rounded-xl bg-white/15 px-3 py-2 text-xs">{form.announcement}</div>
          )}
          <div className="flex gap-2">
            <span className="px-3 py-1.5 rounded-lg bg-white text-[#101536] text-xs font-bold">Primary CTA</span>
            <span className="px-3 py-1.5 rounded-lg bg-white/20 text-white text-xs font-semibold">
              {form.default_language.toUpperCase()} · {form.default_theme}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
