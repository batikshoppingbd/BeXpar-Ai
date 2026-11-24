import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Palette,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getBrowserSupabase } from '../../lib/supabaseClient';
import type { Lang } from '../../i18n/translations';
import type { AppSettings, UserProfile } from '../../types';
import { adminT, getNavLabel } from './adminI18n';
import type { AdminSectionId } from './adminTypes';
import { AdminDashboardView } from './sections/AdminDashboardView';
import { UsersBusinessesView } from './sections/UsersBusinessesView';
import { CoinPackagesView } from './sections/CoinPackagesView';
import { AiProvidersView } from './sections/AiProvidersView';
import { PlatformSettingsView, type PlatformSettingsSubTab } from './sections/PlatformSettingsView';
import { AppCustomizationView } from './sections/AppCustomizationView';
import { AnalyticsReportsView } from './sections/AnalyticsReportsView';
import { SystemLogsView } from './sections/SystemLogsView';
import { NotificationsView } from './sections/NotificationsView';
import { SecurityAccessView } from './sections/SecurityAccessView';
import { BackupRestoreView } from './sections/BackupRestoreView';
import { HelpSupportView } from './sections/HelpSupportView';

export interface AdminPanelProps {
  onExitAdmin?: () => void;
  profile?: UserProfile | null;
  lang?: Lang;
  onToggleLang?: () => void;
  dark?: boolean;
  onToggleDark?: () => void;
  onLogout?: () => void;
  onRefreshSystem?: () => void;
  appSettings?: AppSettings;
}

const ADMIN_NAV_IDS: Array<{ id: AdminSectionId; icon: React.ReactNode }> = [
  { id: 'dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'users', icon: <Users className="w-4 h-4" /> },
  { id: 'packages', icon: <Coins className="w-4 h-4" /> },
  { id: 'ai', icon: <Bot className="w-4 h-4" /> },
  { id: 'settings', icon: <Settings className="w-4 h-4" /> },
  { id: 'customization', icon: <Palette className="w-4 h-4" /> },
  { id: 'analytics', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'logs', icon: <ScrollText className="w-4 h-4" /> },
  { id: 'notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'security', icon: <Shield className="w-4 h-4" /> },
  { id: 'backup', icon: <Database className="w-4 h-4" /> },
  { id: 'help', icon: <HelpCircle className="w-4 h-4" /> },
];

export const AdminPanel: React.FC<AdminPanelProps> = ({
  onExitAdmin,
  profile,
  lang: propLang,
  onToggleLang,
  dark: propDark,
  onToggleDark,
  onLogout,
  onRefreshSystem,
  appSettings,
}) => {
  const [localLang, setLocalLang] = useState<Lang>(propLang || 'bn');
  const [localDark, setLocalDark] = useState<boolean>(Boolean(propDark));
  const lang = propLang ?? localLang;
  const dark = propDark ?? localDark;

  const toggleLang = () => {
    if (onToggleLang) onToggleLang();
    else setLocalLang((l) => (l === 'bn' ? 'en' : 'bn'));
  };

  const toggleDark = () => {
    if (onToggleDark) onToggleDark();
    else {
      setLocalDark((d) => {
        const next = !d;
        document.documentElement.classList.toggle('dark', next);
        return next;
      });
    }
  };

  const handleLogout = async () => {
    if (onLogout) {
      onLogout();
      return;
    }
    try {
      await getBrowserSupabase().auth.signOut();
    } catch {
      // ignore if uninitialized
    }
  };

  const [section, setSection] = useState<AdminSectionId>('dashboard');
  const [settingsSubTab, setSettingsSubTab] = useState<PlatformSettingsSubTab>('general');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const flash = (msg: string) => {
    setError('');
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const reportError = (msg: string) => {
    setNotice('');
    setError(msg);
  };

  useEffect(() => {
    void apiFetch<{ stats?: { pendingPaymentsCount?: number } }>('/api/admin/dashboard?range=7d')
      .then((res) => setPendingPaymentsCount(Number(res?.stats?.pendingPaymentsCount || 0)))
      .catch(() => undefined);
  }, [section]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const navigateTo = (target: AdminSectionId, sub?: string) => {
    setSection(target);
    if (target === 'settings' && sub && ['general', 'plans', 'payments', 'features', 'meta'].includes(sub)) {
      setSettingsSubTab(sub as PlatformSettingsSubTab);
    }
    setMobileDrawerOpen(false);
  };

  const initials = (profile?.full_name || profile?.email || 'SA')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const brandName = appSettings?.app_name || 'BeXpar Ai';
  const brandLogo =
    appSettings?.logo_url?.trim() || '/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png';

  const activeNav = ADMIN_NAV_IDS.find((n) => n.id === section);

  return (
    <div className="min-h-screen bg-[#F8F9FC] dark:bg-slate-950 text-[#101536] dark:text-slate-100 flex flex-col lg:flex-row overflow-x-hidden">
      {/* Desktop Fixed & Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex lg:sticky lg:top-0 lg:h-screen bg-white dark:bg-slate-900 border-r border-[#E6E0FF] dark:border-slate-800 flex-col shrink-0 transition-all duration-200 ${
          collapsed ? 'lg:w-20' : 'lg:w-68'
        }`}
      >
        {/* Purple Brand Card */}
        <div className="p-3.5 border-b border-[#E6E0FF] dark:border-slate-800 flex items-center justify-between gap-2">
          <div
            className={`rounded-2xl bg-gradient-to-br from-[#5B35F5] to-[#4520D9] text-white shadow-md shadow-[#5B35F5]/20 flex items-center gap-2.5 flex-1 min-w-0 ${
              collapsed ? 'p-2 justify-center' : 'p-3'
            }`}
          >
            <img
              src={brandLogo}
              alt={brandName}
              className="w-9 h-9 rounded-xl object-cover shrink-0 border border-white/20"
            />
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display font-bold text-sm leading-tight truncate">{brandName}</div>
                <div className="text-[11px] text-white/80 truncate">{adminT(lang, 'brandSubtitle')}</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-800 text-[#7C8499] hover:text-[#5B35F5] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 shrink-0"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* 12 Sidebar Navigation Items */}
        <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
          {ADMIN_NAV_IDS.map((item) => {
            const isActive = section === item.id;
            const label = getNavLabel(lang, item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                title={collapsed ? label : undefined}
                className={`w-full flex items-center gap-3 rounded-xl text-[13px] font-medium transition-all ${
                  collapsed ? 'justify-center px-2 py-2.5' : 'px-3.5 py-2.5'
                } ${
                  isActive
                    ? 'bg-gradient-to-r from-[#5B35F5] to-[#4520D9] text-white shadow-sm shadow-[#5B35F5]/25'
                    : 'text-[#7C8499] dark:text-slate-400 hover:bg-[#F3F0FF] hover:text-[#5B35F5] dark:hover:bg-[#5B35F5]/15 dark:hover:text-[#A78BFA]'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && <span className="truncate flex-1 text-left">{label}</span>}
                {!collapsed && item.id === 'notifications' && pendingPaymentsCount > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                      isActive ? 'bg-white/25 text-white' : 'bg-[#F5A623]/15 text-[#D98207]'
                    }`}
                  >
                    {pendingPaymentsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Switcher / Logout */}
        <div className="p-3 border-t border-[#E6E0FF] dark:border-slate-800 space-y-2">
          {onExitAdmin && (
            <button
              type="button"
              onClick={onExitAdmin}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF] transition-colors ${
                collapsed ? 'justify-center' : 'justify-center'
              }`}
              title={adminT(lang, 'userPanelBtn')}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              {!collapsed && <span>{adminT(lang, 'userPanelBtn')}</span>}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-[#EF4444] hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            title={adminT(lang, 'logout')}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>{adminT(lang, 'logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-[#E6E0FF] dark:border-slate-800 px-4 md:px-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex w-8 h-8 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] items-center justify-center shrink-0">
              {activeNav?.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm md:text-base font-display font-bold text-[#101536] dark:text-white truncate">
                {getNavLabel(lang, section)}
              </div>
            </div>
          </div>

          {/* Global Search (Desktop & Tablet) */}
          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder={adminT(lang, 'searchPlaceholder')}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs text-[#101536] dark:text-white focus:outline-none focus:border-[#5B35F5]"
              />
            </div>
          </div>

          {/* Right Controls: Language, Theme, Notifications, Admin Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLang}
              className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/70 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] transition-colors"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>

            <button
              type="button"
              onClick={toggleDark}
              aria-label="Toggle theme"
              className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
            >
              {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#5B35F5]" />}
            </button>

            <button
              type="button"
              onClick={() => navigateTo('notifications')}
              aria-label={adminT(lang, 'notifications')}
              className="relative p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-[#7C8499] hover:text-[#5B35F5] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {pendingPaymentsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {pendingPaymentsCount > 9 ? '9+' : pendingPaymentsCount}
                </span>
              )}
            </button>

            {/* Admin Profile Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((o) => !o)}
                className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-[#F3F0FF]/60 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#5B35F5] to-[#4520D9] text-white text-[11px] font-bold flex items-center justify-center">
                  {initials || 'SA'}
                </div>
                <div className="hidden sm:block text-left max-w-[120px]">
                  <div className="text-xs font-semibold text-[#101536] dark:text-white truncate">
                    {profile?.full_name || 'Super Admin'}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#7C8499]" />
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 shadow-xl py-2 z-50 text-xs">
                  <div className="px-4 py-2 border-b border-[#E6E0FF]/70 dark:border-slate-800">
                    <div className="font-bold text-[#101536] dark:text-white truncate">
                      {profile?.full_name || 'Super Admin'}
                    </div>
                    <div className="text-[11px] text-[#7C8499] truncate">{profile?.email || 'super_admin'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigateTo('security');
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-[#F3F0FF] dark:hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Shield className="w-3.5 h-3.5 text-[#5B35F5]" />
                    <span>{getNavLabel(lang, 'security')}</span>
                  </button>
                  {onExitAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        onExitAdmin();
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-[#F3F0FF] dark:hover:bg-slate-800 flex items-center gap-2"
                    >
                      <Users className="w-3.5 h-3.5 text-[#5B35F5]" />
                      <span>{adminT(lang, 'userPanelBtn')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void handleLogout();
                    }}
                    className="w-full px-4 py-2 text-left text-[#EF4444] hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2 font-semibold"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{adminT(lang, 'logout')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Search Bar */}
        <div className="md:hidden px-4 pt-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#7C8499] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder={adminT(lang, 'searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>
        </div>

        {/* Main Content Workspace */}
        <main className="flex-1 p-4 md:p-7 max-w-[1400px] w-full mx-auto space-y-5">
          {notice && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-xs font-medium text-[#16B66A] flex items-center justify-between gap-2">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice('')} className="p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {error && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs font-medium text-[#EF4444] flex items-center justify-between gap-2">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {section === 'dashboard' && (
            <AdminDashboardView lang={lang} globalSearch={globalSearch} onNavigate={navigateTo} />
          )}
          {section === 'users' && (
            <UsersBusinessesView
              lang={lang}
              globalSearch={globalSearch}
              onNotify={flash}
              onError={reportError}
            />
          )}
          {section === 'packages' && (
            <CoinPackagesView
              lang={lang}
              globalSearch={globalSearch}
              onNotify={flash}
              onError={reportError}
            />
          )}
          {section === 'ai' && <AiProvidersView lang={lang} onNotify={flash} onError={reportError} />}
          {section === 'settings' && (
            <PlatformSettingsView
              lang={lang}
              initialSubTab={settingsSubTab}
              onNotify={flash}
              onError={reportError}
              onRefreshSystem={onRefreshSystem}
            />
          )}
          {section === 'customization' && (
            <AppCustomizationView
              lang={lang}
              onNotify={flash}
              onError={reportError}
              onRefreshSystem={onRefreshSystem}
            />
          )}
          {section === 'analytics' && <AnalyticsReportsView lang={lang} onError={reportError} />}
          {section === 'logs' && <SystemLogsView lang={lang} globalSearch={globalSearch} onError={reportError} />}
          {section === 'notifications' && (
            <NotificationsView
              lang={lang}
              onNotify={flash}
              onError={reportError}
              onNavigate={navigateTo}
              onRefreshSystem={onRefreshSystem}
            />
          )}
          {section === 'security' && (
            <SecurityAccessView lang={lang} profile={profile} onNotify={flash} onError={reportError} />
          )}
          {section === 'backup' && <BackupRestoreView lang={lang} onNotify={flash} onError={reportError} />}
          {section === 'help' && <HelpSupportView lang={lang} onNavigate={(t) => navigateTo(t)} />}
        </main>
      </div>

      {/* Mobile Slide-Out Hamburger Drawer */}
      {mobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex">
          <div className="w-76 bg-white dark:bg-slate-900 h-full p-4 flex flex-col justify-between shadow-2xl border-r border-[#E6E0FF] dark:border-slate-800 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#E6E0FF] dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <img src={brandLogo} alt={brandName} className="w-9 h-9 rounded-xl object-cover" />
                  <div>
                    <div className="font-display font-bold text-sm text-[#101536] dark:text-white">{brandName}</div>
                    <div className="text-[11px] text-[#7C8499]">{adminT(lang, 'brandSubtitle')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-1">
                {ADMIN_NAV_IDS.map((item) => {
                  const isActive = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTo(item.id)}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-gradient-to-r from-[#5B35F5] to-[#4520D9] text-white shadow-sm'
                          : 'text-[#7C8499] dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      {item.icon}
                      <span className="truncate">{getNavLabel(lang, item.id)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-[#E6E0FF] dark:border-slate-800 space-y-2">
              {onExitAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    onExitAdmin();
                  }}
                  className="w-full py-2.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] text-xs font-semibold"
                >
                  {adminT(lang, 'userPanelBtn')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-[#EF4444] text-xs font-semibold"
              >
                {adminT(lang, 'logout')}
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileDrawerOpen(false)} />
        </div>
      )}
    </div>
  );
};
