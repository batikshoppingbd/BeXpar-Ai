import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Coins,
  MessageSquare,
  Moon,
  Package,
  ShieldCheck,
  Sparkles,
  Sun,
  Truck,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { AppSettings, CoinPackage, SubscriptionPlan } from '../../types';
import type { Lang } from '../../i18n/translations';
import { PWAInstallButton } from '../pwa/PWAControls';

interface LandingPageProps {
  appSettings: AppSettings;
  lang: Lang;
  onToggleLang: () => void;
  dark: boolean;
  onToggleDark: () => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  appSettings,
  lang,
  onToggleLang,
  dark,
  onToggleDark,
  onOpenAuth,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch<{ plans: SubscriptionPlan[]; packages: CoinPackage[] }>('/api/system/public-catalog')
      .then((res) => {
        if (!active) return;
        setPlans(res.plans || []);
        setPackages(res.packages || []);
      })
      .catch(() => {
        // Silent fallback if catalog unavailable
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const features = [
    {
      icon: <MessageSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: lang === 'bn' ? 'অমনি-চ্যানেল ইউনিফাইড ইনবক্স' : 'Omnichannel Unified Inbox',
      desc:
        lang === 'bn'
          ? 'Facebook Messenger, Instagram DM ও WhatsApp Business-এর সব মেসেজ এক জায়গায় রিয়েল-টাইম পরিচালনা করুন।'
          : 'Manage Facebook Messenger, Instagram DM, and WhatsApp Business conversations in one real-time workspace.',
    },
    {
      icon: <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: lang === 'bn' ? 'বাংলা ও বাংলিশ AI সেলস এজেন্ট' : 'Bangla & Banglish AI Sales Agent',
      desc:
        lang === 'bn'
          ? '২৪/৭ কাস্টমার প্রশ্নের উত্তর, আসল স্টক ও দাম যাচাই এবং স্বয়ংক্রিয়ভাবে অর্ডার কনফার্মেশন সংগ্রহ।'
          : '24/7 customer replies grounded in your real product catalog and automatic conversational order collection.',
    },
    {
      icon: <Package className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: lang === 'bn' ? 'পণ্য, স্টক ও ইনভেন্টরি কন্ট্রোল' : 'Catalog & Live Inventory Sync',
      desc:
        lang === 'bn'
          ? 'SKU, কালার-সাইজ ভ্যারিয়েন্ট, ছবি এবং অটোমেটিক স্টক আপডেট—সব অর্ডারের সাথে রিয়েল-টাইম সিঙ্কড।'
          : 'Manage SKUs, color/size variants, product images, and live stock quantities directly synced with AI replies.',
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      title: lang === 'bn' ? 'স্মার্ট অর্ডার ও ফ্রড রিস্ক স্কোরিং' : 'Order & Fraud Risk Scoring',
      desc:
        lang === 'bn'
          ? 'ডুপ্লিকেট অর্ডার চেক, পূর্বের ক্যানসেল ও রিটার্ন হিস্ট্রি বিশ্লেষণ, এবং প্রিন্টেবল ইনভয়েস ও CSV এক্সপোর্ট।'
          : 'Automated duplicate checks, return/cancellation risk scoring, printable invoices, and CSV reporting.',
    },
    {
      icon: <Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: lang === 'bn' ? 'Steadfast ও Pathao ডিরেক্ট বুকিং' : 'Steadfast & Pathao Courier API',
      desc:
        lang === 'bn'
          ? 'অর্ডার থেকেই ১ ক্লিকে পার্সেল বুকিং, কনসাইনমেন্ট ট্র্যাকিং আইডি এবং লাইভ ডেলিভারি স্ট্যাটাস আপডেট।'
          : 'Book courier parcels directly from any order and sync live tracking statuses without switching tabs.',
    },
    {
      icon: <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      title: lang === 'bn' ? 'Meta CAPI ও বিজনেস অ্যানালিটিক্স' : 'Meta CAPI & Profit Analytics',
      desc:
        lang === 'bn'
          ? 'সার্ভার-সাইড Purchase/Lead ইভেন্ট ট্র্যাকিং এবং দৈনিক বিক্রি, লাভ ও AI খরচের নির্ভুল রিপোর্ট।'
          : 'Server-side Meta Conversions API tracking paired with clear revenue, profit, and AI usage analytics.',
    },
  ];

  const appName = appSettings.app_name || 'BeXpar Ai';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
              alt={appName}
              className="w-9 h-9 rounded-xl object-cover shrink-0 shadow-sm"
            />
            <span className="font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white truncate">
              {appName}
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#features" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              {lang === 'bn' ? 'ফিচারসমূহ' : 'Features'}
            </a>
            <a href="#packages" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              {lang === 'bn' ? 'প্যাকেজ ও প্রাইসিং' : 'Packages & Pricing'}
            </a>
            <a href="#coins" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              {lang === 'bn' ? 'AI কয়েন প্যাক' : 'AI Coin Packs'}
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact label={lang === 'bn' ? 'ইনস্টল' : 'Install'} />
            </div>
            <button
              type="button"
              onClick={onToggleLang}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              aria-label="Toggle theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {lang === 'bn' ? 'লগইন' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <span>{lang === 'bn' ? 'শুরু করুন' : 'Get Started'}</span>
              <ArrowRight className="w-3.5 h-3.5 hidden sm:inline" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <Sparkles className="w-4 h-4" />
              <span>
                {lang === 'bn'
                  ? 'বাংলাদেশের ই-কমার্স ও এফ-কমার্স অটোমেশন প্ল্যাটফর্ম'
                  : 'Multi-Tenant AI Business Automation SaaS'}
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              {lang === 'bn'
                ? 'আপনার Facebook, Instagram ও WhatsApp সেলস অটোমেট করুন ১ ড্যাশবোর্ডে'
                : 'Automate Your Omnichannel Sales, Inbox & Courier Operations'}
            </h1>

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              {lang === 'bn'
                ? 'BeXpar Ai আপনার কাস্টমারের বাংলা ও বাংলিশ মেসেজের রিপ্লাই দেয়, আসল প্রোডাক্ট ও স্টক যাচাই করে অর্ডার কনফার্ম করে, ফ্রড রিস্ক চেক করে এবং সরাসরি Steadfast ও Pathao-তে পার্সেল বুক করে।'
                : 'Reply to Bangla, Banglish, and English customer messages 24/7, extract verified orders from your real catalog, score fraud risk, and book Steadfast & Pathao parcels automatically.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenAuth('register')}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors shadow-sm"
              >
                <span>{lang === 'bn' ? 'ফ্রি অ্যাকাউন্ট খুলুন' : 'Start Free Workspace'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#packages"
                className="px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                {lang === 'bn' ? 'প্যাকেজসমূহ দেখুন' : 'View Packages'}
              </a>
            </div>
          </div>

          {/* Right Live Workflow Snapshot Card */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    {lang === 'bn' ? 'লাইভ অটোমেশন ফ্লো' : 'End-to-End Automation Flow'}
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                    {appName} Workspace
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">24/7 Active</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    1. {lang === 'bn' ? 'সোশ্যাল ইনবক্স কানেক্ট (Meta OAuth)' : '1-Click Meta OAuth Channels'}
                  </div>
                  <p className="text-slate-500 mt-1">
                    Facebook Pages · Instagram Professional · WhatsApp Cloud API
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    2. {lang === 'bn' ? 'AI রিপ্লাই ও অর্ডার এন্ট্রি' : 'AI Grounded Reply & Order Capture'}
                  </div>
                  <p className="text-slate-500 mt-1">
                    Gemini / GPT / DeepSeek · Live Catalog Prices &amp; Stock Check
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    3. {lang === 'bn' ? 'রিস্ক চেক, কুরিয়ার ও CAPI' : 'Risk Check, Courier & Meta CAPI'}
                  </div>
                  <p className="text-slate-500 mt-1">
                    Duplicate Check · Steadfast &amp; Pathao Booking · Purchase CAPI
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-16 w-full">
        <div className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'একটি প্ল্যাটফর্মে সম্পূর্ণ বিজনেস অটোমেশন' : 'Everything Your Commerce Team Needs'}
          </h2>
          <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mt-2">
            {lang === 'bn'
              ? 'আলাদা ইনবক্স, এক্সেল শিট বা ম্যানুয়াল কুরিয়ার এন্ট্রির ঝামেলা ছাড়াই পুরো ব্যবসা পরিচালনা করুন।'
              : 'Built as a unified multi-tenant workspace with strict data isolation and automated workflows.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, idx) => (
            <div
              key={idx}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center">
                {f.icon}
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{f.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription Packages Section */}
      <section id="packages" className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-14 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'সাবস্ক্রিপশন প্যাকেজসমূহ' : 'Subscription Packages'}
              </h2>
              <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 mt-1.5">
                {lang === 'bn'
                  ? 'আপনার ব্যবসার আকার অনুযায়ী মাসিক বা বাৎসরিক প্ল্যান বেছে নিন—যেকোনো সময় আপগ্রেড করা যাবে।'
                  : 'Choose a plan tailored to your order volume and channel count.'}
              </p>
            </div>

            <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  billing === 'monthly'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {lang === 'bn' ? 'মাসিক (Monthly)' : 'Monthly'}
              </button>
              <button
                type="button"
                onClick={() => setBilling('yearly')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  billing === 'yearly'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                {lang === 'bn' ? 'বাৎসরিক (Yearly)' : 'Yearly'}
              </button>
            </div>
          </div>

          {loadingCatalog ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading packages...</div>
          ) : plans.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No active subscription plans configured yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {plans.map((p) => {
                const price = billing === 'yearly' ? p.yearly_price : p.monthly_price;
                const featured = p.slug === 'growth';
                return (
                  <div
                    key={p.id}
                    className={`rounded-2xl p-5 flex flex-col justify-between border ${
                      featured
                        ? 'border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{p.name}</h3>
                        {featured && (
                          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                            Popular
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[32px]">{p.description}</p>

                      <div className="mt-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                        <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                          {Number(price) === 0 ? (lang === 'bn' ? 'ফ্রি' : 'Free') : formatMoney(price)}
                        </span>
                        {Number(price) > 0 && (
                          <span className="text-xs text-slate-500 ml-1">
                            / {billing === 'yearly' ? (lang === 'bn' ? 'বছর' : 'yr') : lang === 'bn' ? 'মাস' : 'mo'}
                          </span>
                        )}
                      </div>

                      <ul className="mt-4 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{Number(p.coin_allocation).toLocaleString()} AI Coins</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{p.max_products.toLocaleString()} Products</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{p.max_channels} Social Channels</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>{p.max_staff} Staff Members</span>
                        </li>
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenAuth('register')}
                      className={`mt-6 w-full py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors ${
                        featured
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          : 'bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white'
                      }`}
                    >
                      {lang === 'bn' ? 'এই প্যাকেজ নিন' : 'Choose Plan'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Coin Top-Up Packs */}
          {packages.length > 0 && (
            <div id="coins" className="mt-14 pt-10 border-t border-slate-200 dark:border-slate-800">
              <div className="mb-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-500" />
                  <span>{lang === 'bn' ? 'AI কয়েন টপ-আপ প্যাক' : 'AI Coin Top-Up Packs'}</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  {lang === 'bn'
                    ? 'অতিরিক্ত AI রিপ্লাই ও অটোমেশনের জন্য যেকোনো সময় কয়েন প্যাক কিনতে পারবেন।'
                    : 'Purchase flexible AI coin packs anytime as your customer conversation volume grows.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-5 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{pkg.name}</div>
                      <div className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5 tabular-nums">
                        {Number(pkg.coin_amount).toLocaleString()} Coins
                        {Number(pkg.bonus_coins) > 0 ? ` + ${Number(pkg.bonus_coins).toLocaleString()} Bonus` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {pkg.description || `${pkg.validity_days} days validity`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(pkg.price)}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenAuth('register')}
                        className="mt-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                      >
                        {lang === 'bn' ? 'কিনুন' : 'Buy Pack'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            © {new Date().getFullYear()} {appName}. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            {appSettings.support_email && <span>{appSettings.support_email}</span>}
            {appSettings.support_phone && <span>{appSettings.support_phone}</span>}
            {appSettings.terms_url && (
              <a href={appSettings.terms_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Terms
              </a>
            )}
            {appSettings.privacy_url && (
              <a href={appSettings.privacy_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                Privacy
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
