import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  Coins,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Settings,
  Share2,
  Shield,
  ShoppingBag,
  Store,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import { getBrowserSupabase, initBrowserSupabase } from './lib/supabaseClient';
import { t, type Lang } from './i18n/translations';
import type { Business, SystemStatus, UserProfile } from './types';
import { SupabaseWizard } from './components/setup/SupabaseWizard';
import { AuthScreen } from './components/auth/AuthScreen';
import { LandingPage } from './components/public/LandingPage';
import { PublicStorePage } from './components/public/PublicStorePage';
import { BusinessSetupWizard } from './components/setup/BusinessSetupWizard';
import { BootstrapAdminModal } from './components/setup/BootstrapAdminModal';
import { OfflineIndicator, PWAInstallButton } from './components/pwa/PWAControls';
import { UserDashboard } from './components/user/UserDashboard';
import { UnifiedInbox } from './components/user/UnifiedInbox';
import { ProductsView } from './components/user/ProductsView';
import { StorefrontView } from './components/user/StorefrontView';
import { OrdersView } from './components/user/OrdersView';
import { CustomersView } from './components/user/CustomersView';
import { AiStudioView } from './components/user/AiStudioView';
import { IntegrationsView } from './components/user/IntegrationsView';
import { WalletAndBillingView } from './components/user/WalletAndBillingView';
import { AnalyticsView } from './components/user/AnalyticsView';
import { UserSettingsView } from './components/user/UserSettingsView';
import { AdminPanel } from './components/admin/AdminPanel';

type UserTab =
  | 'dashboard'
  | 'inbox'
  | 'orders'
  | 'products'
  | 'store'
  | 'customers'
  | 'ai'
  | 'integrations'
  | 'analytics'
  | 'wallet'
  | 'settings';

export default function App() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);

  const [lang, setLang] = useState<Lang>('bn');
  const [dark, setDark] = useState(false);
  const [activeTab, setActiveTab] = useState<UserTab>('dashboard');
  const [adminMode, setAdminMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bootstrapModalOpen, setBootstrapModalOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');
  const [oauthError, setOauthError] = useState('');
  const [authError, setAuthError] = useState('');
  const [publicStoreId, setPublicStoreId] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('store');
    } catch {
      return null;
    }
  });
  const [previewStoreId, setPreviewStoreId] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const loadAccountContext = async () => {
    try {
      const me = await apiFetch<{
        profile: UserProfile;
        businesses: Business[];
      }>('/api/me');
      setProfile(me.profile);
      setBusinesses(me.businesses);
      if (me.profile.language === 'en' || me.profile.language === 'bn') {
        setLang(me.profile.language);
      }
      if (me.businesses.length > 0) {
        setActiveBusiness((prev) => me.businesses.find((b) => b.id === prev?.id) || me.businesses[0]);
      } else {
        setActiveBusiness(null);
      }
      setAuthError('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to load user workspace.');
    }
  };

  const boot = async () => {
    setBootLoading(true);
    try {
      const status = await apiFetch<SystemStatus>('/api/system/status');
      setSystem(status);
      if (status.appSettings?.default_language === 'en' || status.appSettings?.default_language === 'bn') {
        setLang(status.appSettings.default_language);
      }
      if (status.appSettings?.default_theme === 'dark') {
        setDark(true);
      }

      try {
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const errDesc =
          searchParams.get('error_description') ||
          hashParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error');
        if (errDesc) {
          setOauthError(errDesc);
          setShowAuth(true);
        }
      } catch {
        // ignore URL parse errors
      }

      if (status.supabaseConnected && status.schemaReady && status.supabase.url && status.supabase.anonKey) {
        const client = initBrowserSupabase(status.supabase.url, status.supabase.anonKey);
        if (client) {
          const { data } = await client.auth.getSession();
          if (data.session) {
            setAuthed(true);
            await loadAccountContext();
          } else {
            setAuthed(false);
          }

          try {
            const url = new URL(window.location.href);
            if (url.searchParams.has('code') || url.searchParams.has('error') || url.searchParams.has('error_description')) {
              url.searchParams.delete('code');
              url.searchParams.delete('error');
              url.searchParams.delete('error_description');
              url.searchParams.delete('error_code');
              window.history.replaceState({}, '', url.pathname + (url.search || ''));
            }
          } catch {
            // ignore history errors
          }

          client.auth.onAuthStateChange((_event, session) => {
            if (session) {
              setAuthed(true);
              setOauthError('');
              void loadAccountContext();
            } else {
              setAuthed(false);
              setProfile(null);
              setBusinesses([]);
              setActiveBusiness(null);
              setAdminMode(false);
            }
          });
        }
      }
    } finally {
      setBootLoading(false);
    }
  };

  useEffect(() => {
    void boot();
  }, []);

  const handleLogout = async () => {
    await getBrowserSupabase().auth.signOut();
    setAuthed(false);
    setAdminMode(false);
    setShowAuth(false);
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F0FF] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <img
            src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
            alt="BeXpar Ai"
            className="w-14 h-14 rounded-2xl object-cover shadow-md shadow-[#5B35F5]/20"
          />
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-[#5B35F5]" />
            <span>Loading BeXpar Ai...</span>
          </div>
        </div>
      </div>
    );
  }

  // 1. Supabase Connection & Schema Migration Wizard
  if (!system || !system.supabaseConnected || !system.schemaReady) {
    return (
      <>
        <SupabaseWizard
          initialConnected={system?.supabaseConnected}
          initialSchemaReady={system?.schemaReady}
          initialError={system?.schemaError}
          onConnected={() => void boot()}
        />
        <OfflineIndicator />
      </>
    );
  }

  // 1b. Public Mini Storefront or Merchant Store Preview
  const activeStoreViewId = previewStoreId || publicStoreId;
  if (activeStoreViewId) {
    return (
      <>
        <PublicStorePage
          businessId={activeStoreViewId}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          isPreview={Boolean(previewStoreId)}
          onExit={() => {
            if (previewStoreId) {
              setPreviewStoreId(null);
            } else {
              setPublicStoreId(null);
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('store');
                window.history.replaceState({}, '', url.pathname + url.search);
              } catch {
                // ignore history errors
              }
            }
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  // 2. Public Landing Page & Authentication Screen
  if (!authed) {
    if (!showAuth) {
      return (
        <>
          <LandingPage
            appSettings={system.appSettings}
            lang={lang}
            onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
            dark={dark}
            onToggleDark={() => setDark((d) => !d)}
            onOpenAuth={(mode) => {
              setAuthInitialMode(mode);
              setShowAuth(true);
            }}
          />
          <OfflineIndicator />
        </>
      );
    }

    return (
      <>
        <AuthScreen
          appSettings={system.appSettings}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          initialMode={authInitialMode}
          initialError={oauthError}
          onBackToHome={() => setShowAuth(false)}
          onAuthenticated={() => void loadAccountContext()}
        />
        <OfflineIndicator />
      </>
    );
  }

  if (authError && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold text-rose-600">Account Access Restricted</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{authError}</p>
          <button type="button" onClick={handleLogout} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // 3. Super Admin Panel Mode
  if (adminMode && profile?.role === 'super_admin') {
    return (
      <>
        <AdminPanel
          onExitAdmin={() => setAdminMode(false)}
          profile={profile}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          onLogout={() => void handleLogout()}
          onRefreshSystem={() => void boot()}
          appSettings={system.appSettings}
        />
        <OfflineIndicator />
      </>
    );
  }

  // 4. Post-Registration Business Setup Wizard
  if (profile && !activeBusiness && profile.role !== 'super_admin') {
    return (
      <>
        {system.bootstrapNeeded && (
          <div className="bg-indigo-600 text-white text-xs px-4 py-2 flex items-center justify-between">
            <span>No Super Admin configured yet. Are you the platform owner?</span>
            <button type="button" onClick={() => setBootstrapModalOpen(true)} className="underline font-semibold">
              Claim First-Time Super Admin
            </button>
          </div>
        )}
        <BusinessSetupWizard
          profile={profile}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          onLogout={() => void handleLogout()}
          onComplete={(biz) => {
            setBusinesses([biz]);
            setActiveBusiness(biz);
          }}
        />
        {bootstrapModalOpen && (
          <BootstrapAdminModal
            onClose={() => setBootstrapModalOpen(false)}
            onSuccess={() => {
              setBootstrapModalOpen(false);
              void boot();
              setAdminMode(true);
            }}
          />
        )}
        <OfflineIndicator />
      </>
    );
  }

  // If Super Admin logged in with no personal business, go straight to Admin Panel or allow creating one
  if (profile?.role === 'super_admin' && !activeBusiness) {
    return (
      <>
        <AdminPanel
          profile={profile}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          onLogout={() => void handleLogout()}
          onRefreshSystem={() => void boot()}
          appSettings={system.appSettings}
        />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: Array<{ id: UserTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: t(lang, 'dashboard'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'inbox', label: t(lang, 'inbox'), icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'orders', label: t(lang, 'orders'), icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'store', label: t(lang, 'miniStore'), icon: <Store className="w-4 h-4" /> },
    { id: 'products', label: t(lang, 'products'), icon: <Package className="w-4 h-4" /> },
    { id: 'customers', label: t(lang, 'customers'), icon: <Users className="w-4 h-4" /> },
    { id: 'ai', label: t(lang, 'aiStudio'), icon: <Bot className="w-4 h-4" /> },
    { id: 'integrations', label: t(lang, 'integrations'), icon: <Share2 className="w-4 h-4" /> },
    { id: 'analytics', label: t(lang, 'analytics'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'wallet', label: t(lang, 'wallet'), icon: <Coins className="w-4 h-4" /> },
    { id: 'settings', label: t(lang, 'settings'), icon: <Settings className="w-4 h-4" /> },
  ];

  const mobileTabs: UserTab[] = ['dashboard', 'inbox', 'orders', 'products'];
  const activeNav = navItems.find((n) => n.id === activeTab);
  const ownerInitials = (profile?.full_name || profile?.email || 'B')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen bg-[#F3F0FF] dark:bg-slate-950 flex flex-col md:flex-row overflow-x-hidden">
      {/* Desktop Fixed Left Sidebar */}
      <aside className="hidden md:flex md:w-68 md:sticky md:top-0 md:h-screen bg-white dark:bg-slate-900 border-r border-[#E6E0FF] dark:border-slate-800 flex-col shrink-0">
        {/* Purple BeXpar Ai Brand Header */}
        <div className="p-4 border-b border-[#E6E0FF] dark:border-slate-800">
          <div className="rounded-2xl bg-gradient-to-br from-[#5B35F5] via-[#6842FF] to-[#7C3AED] p-3.5 text-white shadow-md shadow-[#5B35F5]/25 flex items-center gap-3">
            <img
              src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
              alt="BeXpar Ai"
              className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-sm border border-white/20"
            />
            <div className="min-w-0">
              <div className="font-display font-bold text-base leading-tight truncate">
                {system.appSettings.app_name || 'BeXpar Ai'}
              </div>
              <div className="text-[11px] text-white/80 truncate">
                {activeBusiness?.name || t(lang, 'userPanel')}
              </div>
            </div>
          </div>
        </div>

        {businesses.length > 1 && (
          <div className="px-3.5 pt-3.5">
            <select
              value={activeBusiness?.id || ''}
              onChange={(e) => {
                const found = businesses.find((b) => b.id === e.target.value);
                if (found) setActiveBusiness(found);
              }}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/70 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#5B35F5]"
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-gradient-to-r from-[#5B35F5] to-[#704BFF] text-white shadow-md shadow-[#5B35F5]/25'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-[#F3F0FF] hover:text-[#5B35F5] dark:hover:bg-[#5B35F5]/15 dark:hover:text-[#A78BFA]'
                }`}
              >
                <span className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-[#E6E0FF] dark:border-slate-800 space-y-2.5">
          {profile && (
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#F3F0FF]/80 dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-[#5B35F5] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {ownerInitials || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {profile.full_name || profile.email}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {activeBusiness?.subscription_plan?.name || 'Free'} Plan
                </div>
              </div>
            </div>
          )}
          {profile?.role === 'super_admin' && (
            <button
              type="button"
              onClick={() => setAdminMode(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 dark:bg-[#5B35F5] text-white text-xs font-semibold hover:opacity-95 transition-opacity"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{t(lang, 'superAdmin')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t(lang, 'logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {system.appSettings.announcement && (
          <div className="bg-gradient-to-r from-[#5B35F5] to-[#7C3AED] text-white text-xs px-4 py-1.5 text-center font-medium">
            {system.appSettings.announcement}
          </div>
        )}

        {system.bootstrapNeeded && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-xs flex items-center justify-between gap-2">
            <span className="text-amber-800 dark:text-amber-200">
              Platform setup incomplete: No Super Admin exists yet.
            </span>
            <button
              type="button"
              onClick={() => setBootstrapModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-amber-700 text-white font-medium whitespace-nowrap shrink-0"
            >
              Claim Super Admin
            </button>
          </div>
        )}

        {/* Premium Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-14 md:h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-[#E6E0FF] dark:border-slate-800 px-4 md:px-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-1 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="hidden sm:flex w-8 h-8 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] items-center justify-center shrink-0">
                {activeNav?.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm md:text-base font-display font-bold text-slate-900 dark:text-white truncate">
                  {activeNav?.label}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact label={t(lang, 'installApp')} />
            </div>
            <button
              type="button"
              onClick={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
              className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/60 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] transition-colors whitespace-nowrap"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>
            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              aria-label="Toggle theme"
              className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
            >
              {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#5B35F5]" />}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              title={t(lang, 'logout')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t(lang, 'logout')}</span>
            </button>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 md:p-7 pb-24 md:pb-10 max-w-[1360px] w-full mx-auto">
          {activeBusiness && profile && (
            <>
              {activeTab === 'dashboard' && (
                <UserDashboard
                  business={activeBusiness}
                  profile={profile}
                  lang={lang}
                  onNavigate={(tab) => setActiveTab(tab as UserTab)}
                />
              )}
              {activeTab === 'inbox' && <UnifiedInbox business={activeBusiness} lang={lang} />}
              {activeTab === 'orders' && <OrdersView business={activeBusiness} lang={lang} />}
              {activeTab === 'store' && (
                <StorefrontView
                  business={activeBusiness}
                  lang={lang}
                  onNavigate={(tab) => setActiveTab(tab as UserTab)}
                  onPreviewStore={(id) => setPreviewStoreId(id)}
                />
              )}
              {activeTab === 'products' && <ProductsView business={activeBusiness} lang={lang} />}
              {activeTab === 'customers' && <CustomersView business={activeBusiness} lang={lang} />}
              {activeTab === 'ai' && <AiStudioView business={activeBusiness} lang={lang} />}
              {activeTab === 'integrations' && <IntegrationsView business={activeBusiness} lang={lang} />}
              {activeTab === 'analytics' && <AnalyticsView business={activeBusiness} lang={lang} />}
              {activeTab === 'wallet' && <WalletAndBillingView business={activeBusiness} lang={lang} />}
              {activeTab === 'settings' && (
                <UserSettingsView
                  profile={profile}
                  business={activeBusiness}
                  lang={lang}
                  onChangeLang={setLang}
                  onRefresh={() => void loadAccountContext()}
                  onLogout={() => void handleLogout()}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-15 pb-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-[#E6E0FF] dark:border-slate-800 grid grid-cols-4 px-1 shadow-[0_-6px_24px_-6px_rgba(91,53,245,0.12)]">
        {mobileTabs.map((id) => {
          const item = navItems.find((n) => n.id === id)!;
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
                active ? 'text-[#5B35F5] dark:text-[#A78BFA]' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span
                className={`px-3 py-1 rounded-full transition-colors ${
                  active ? 'bg-[#F3F0FF] dark:bg-[#5B35F5]/20' : ''
                }`}
              >
                {item.icon}
              </span>
              <span className="truncate max-w-[78px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Slide-Out Hamburger Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex">
          <div className="w-76 bg-white dark:bg-slate-900 h-full p-4 flex flex-col justify-between shadow-2xl border-r border-[#E6E0FF] dark:border-slate-800 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#E6E0FF] dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
                    alt="BeXpar Ai"
                    className="w-9 h-9 rounded-xl object-cover shrink-0 shadow-sm"
                  />
                  <div>
                    <div className="font-display font-bold text-sm text-slate-900 dark:text-white">
                      {system.appSettings.app_name || 'BeXpar Ai'}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[140px]">
                      {activeBusiness?.name}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 space-y-1">
                {navItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-gradient-to-r from-[#5B35F5] to-[#704BFF] text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="pt-4 mt-4 border-t border-[#E6E0FF] dark:border-slate-800 space-y-2">
              <PWAInstallButton label={t(lang, 'installApp')} />
              {profile?.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setAdminMode(true);
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-[#5B35F5] text-white text-xs font-semibold"
                >
                  {t(lang, 'superAdmin')}
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 text-xs font-semibold"
              >
                {t(lang, 'logout')}
              </button>
            </div>
          </div>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {bootstrapModalOpen && (
        <BootstrapAdminModal
          onClose={() => setBootstrapModalOpen(false)}
          onSuccess={() => {
            setBootstrapModalOpen(false);
            void boot();
            setAdminMode(true);
          }}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
