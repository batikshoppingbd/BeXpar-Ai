import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Globe,
  Instagram,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Moon,
  Phone,
  Search,
  Shirt,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  Sun,
  Tag,
  Trash2,
  Upload,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { apiFetch, fileToBase64 } from '../../lib/api';
import type { Business, UserProfile } from '../../types';
import type { Lang } from '../../i18n/translations';

interface BusinessSetupWizardProps {
  profile: UserProfile;
  lang: Lang;
  onComplete: (business: Business) => void;
  onLogout?: () => void;
  onToggleLang?: () => void;
  dark?: boolean;
  onToggleDark?: () => void;
}

interface CategoryOption {
  value: string;
  labelBn: string;
  descEn: string;
  descBn: string;
  icon: React.ReactNode;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    value: 'Fashion & Apparel',
    labelBn: 'ফ্যাশন ও পোশাক',
    descEn: 'Clothing, footwear, boutique, saree, panjabi & accessories',
    descBn: 'জামাকাপড়, বুটিক, শাড়ি, পাঞ্জাবি, জুতা ও এক্সেসরিজ',
    icon: <Shirt className="w-5 h-5" />,
  },
  {
    value: 'Electronics & Gadgets',
    labelBn: 'ইলেকট্রনিক্স ও গ্যাজেট',
    descEn: 'Smartphones, watches, audio gear, computer & tech accessories',
    descBn: 'স্মার্টফোন, ওয়াচ, অডিও গ্যাজেট ও টেক এক্সেসরিজ',
    icon: <Smartphone className="w-5 h-5" />,
  },
  {
    value: 'Beauty & Cosmetics',
    labelBn: 'বিউটি ও কসমেটিক্স',
    descEn: 'Skincare, makeup, fragrance, salon & personal care products',
    descBn: 'স্কিনকেয়ার, মেকআপ, পারফিউম ও পার্সোনাল কেয়ার',
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    value: 'Food & Grocery',
    labelBn: 'খাবার ও গ্রোসারি',
    descEn: 'Organic foods, homemade kitchen, bakery, honey & groceries',
    descBn: 'অর্গানিক ফুড, হোমমেড খাবার, বেকারি ও গ্রোসারি',
    icon: <UtensilsCrossed className="w-5 h-5" />,
  },
  {
    value: 'Home & Living',
    labelBn: 'হোম ও লিভিং',
    descEn: 'Furniture, home decor, kitchenware, bedding & lighting',
    descBn: 'ফার্নিচার, হোম ডেকোর, কিচেনওয়্যার ও বেডিং',
    icon: <Sofa className="w-5 h-5" />,
  },
  {
    value: 'Services & Agency',
    labelBn: 'সার্ভিস ও এজেন্সি',
    descEn: 'Digital services, coaching, travel, repair & consultancy',
    descBn: 'ডিজিটাল সার্ভিস, কনসালটেন্সি, ট্রাভেল ও এজেন্সি',
    icon: <Briefcase className="w-5 h-5" />,
  },
];

export const BusinessSetupWizard: React.FC<BusinessSetupWizardProps> = ({
  profile,
  lang,
  onComplete,
  onLogout,
  onToggleLang,
  dark,
  onToggleDark,
}) => {
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState(profile.full_name || '');
  const [email, setEmail] = useState(profile.email || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [category, setCategory] = useState('Fashion & Apparel');
  const [address, setAddress] = useState('');
  const [fbPageName, setFbPageName] = useState('');
  const [igUsername, setIgUsername] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Custom Category Dialog State
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [customCategoryDraft, setCustomCategoryDraft] = useState('');

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setLogoPreview(b64);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ business: Business }>('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({
          name,
          owner_name: ownerName,
          email,
          phone,
          category,
          address,
          logo_url: logoPreview,
          facebook_info: fbPageName ? { page_name: fbPageName } : {},
          instagram_info: igUsername ? { username: igUsername } : {},
          whatsapp_info: waNumber ? { phone: waNumber } : {},
        }),
      });
      onComplete(res.business);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to setup business.');
    } finally {
      setLoading(false);
    }
  };

  const selectedCategoryObj = CATEGORY_OPTIONS.find((c) => c.value === category);

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return CATEGORY_OPTIONS;
    return CATEGORY_OPTIONS.filter(
      (c) =>
        c.value.toLowerCase().includes(q) ||
        c.labelBn.toLowerCase().includes(q) ||
        c.descEn.toLowerCase().includes(q) ||
        c.descBn.toLowerCase().includes(q)
    );
  }, [categorySearch]);

  return (
    <div className="min-h-screen bg-[#F3F0FF] dark:bg-slate-950 text-[#101536] dark:text-slate-100 flex flex-col">
      {/* Clean Top Bar */}
      <header className="sticky top-0 z-20 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-[#E6E0FF] dark:border-slate-800 px-4 md:px-8 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/assets/aistudio/file_000000008b8c82088417c1ec660bd1b7_795facb3.png"
            alt="BeXpar Ai"
            className="w-9 h-9 rounded-xl object-cover shadow-sm"
          />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm md:text-base text-[#101536] dark:text-white truncate">
              BeXpar Ai
            </div>
            <div className="text-[11px] text-[#7C8499] dark:text-slate-400 truncate">
              {lang === 'bn' ? 'বিজনেস ওয়ার্কস্পেস সেটআপ' : 'Workspace Onboarding'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onToggleLang && (
            <button
              type="button"
              onClick={onToggleLang}
              className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/70 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] transition-colors"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>
          )}
          {onToggleDark && (
            <button
              type="button"
              onClick={onToggleDark}
              aria-label="Toggle theme"
              className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors"
            >
              {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#5B35F5]" />}
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'লগআউট' : 'Sign Out'}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Centered Setup Container */}
      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-3xl bx-card overflow-hidden">
          {/* Premium Purple Hero Header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#5B35F5] via-[#532EEB] to-[#4520D9] text-white p-6 md:p-8">
            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="space-y-2 max-w-xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-xs text-[11px] font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? '১ মিনিটে অটোমেশন শুরু করুন' : 'Launch in under 60 seconds'}</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight">
                  {lang === 'bn' ? 'আপনার বিজনেস সেটআপ করুন' : 'Set Up Your Business Workspace'}
                </h1>
                <p className="text-xs md:text-sm text-white/85 leading-relaxed">
                  {lang === 'bn'
                    ? 'BeXpar Ai আপনার বিজনেসের জন্য আলাদা AI সেলস এজেন্ট, কয়েন ওয়ালেট, মিনি স্টোর এবং ইউনিফাইড ইনবক্স তৈরি করবে।'
                    : 'Configure your store profile to activate your isolated AI sales agent, coin wallet, mini storefront, and omnichannel inbox.'}
                </p>
              </div>
              <div className="hidden sm:flex w-16 h-16 rounded-2xl bg-white/15 border border-white/25 backdrop-blur-xs items-center justify-center shrink-0">
                <Store className="w-8 h-8 text-white" />
              </div>
            </div>

            {/* Included Pillars */}
            <div className="relative z-10 mt-5 pt-4 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-white/90">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                <span>{lang === 'bn' ? 'ফ্রি AI কয়েন বোনাস' : 'Starter AI Coin Wallet'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                <span>{lang === 'bn' ? 'ইনস্ট্যান্ট মিনি স্টোরফ্রন্ট' : 'Instant Mini Storefront'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3" />
                </span>
                <span>{lang === 'bn' ? 'অর্ডার ও কুরিয়ার ট্র্যাকিং' : 'Order & Courier Automation'}</span>
              </div>
            </div>
            <div className="absolute -right-10 -bottom-12 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          </div>

          <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
            {error && (
              <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}

            {/* Section 1: Business Identity */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-[#5B35F5] dark:text-[#A78BFA]">
                <Building2 className="w-4 h-4" />
                <span>{lang === 'bn' ? '১. বিজনেসের মূল তথ্য' : '1. Business Identity'}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'বিজনেসের নাম *' : 'Business Name *'}
                  </label>
                  <div className="relative">
                    <Store className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={lang === 'bn' ? 'যেমন: ঢাকা আরবান ফ্যাশন' : 'e.g. Dhaka Urban Fashion'}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5] focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'মালিকের নাম *' : 'Owner Name *'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder={lang === 'bn' ? 'আপনার পূর্ণ নাম' : 'Your full name'}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5] focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'বিজনেস ইমেইল *' : 'Business Email *'}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5] focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'মোবাইল নম্বর *' : 'Mobile Number *'}
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="017XXXXXXXX"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5] focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Custom Category Picker Trigger (Replaces native <select> popup) */}
              <div>
                <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                  {lang === 'bn' ? 'বিজনেস ক্যাটাগরি নির্বাচন করুন *' : 'Business Category *'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCategorySearch('');
                    setCustomCategoryDraft('');
                    setCategoryDialogOpen(true);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 hover:border-[#5B35F5] hover:bg-[#F3F0FF]/50 dark:hover:bg-slate-900 text-left transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
                      {selectedCategoryObj?.icon || <Tag className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#101536] dark:text-white truncate">
                        {lang === 'bn' && selectedCategoryObj
                          ? `${selectedCategoryObj.labelBn} (${selectedCategoryObj.value})`
                          : category}
                      </div>
                      <div className="text-[11px] text-[#7C8499] dark:text-slate-400 truncate">
                        {selectedCategoryObj
                          ? lang === 'bn'
                            ? selectedCategoryObj.descBn
                            : selectedCategoryObj.descEn
                          : lang === 'bn'
                          ? 'কাস্টম ক্যাটাগরি নির্বাচিত'
                          : 'Custom business category'}
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-[#E6E0FF] dark:border-slate-700 text-[11px] font-semibold text-[#5B35F5] dark:text-[#A78BFA] shrink-0">
                    <span>{lang === 'bn' ? 'পরিবর্তন' : 'Select'}</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </div>
                </button>
              </div>
            </div>

            {/* Section 2: Location & Logo */}
            <div className="pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800 space-y-4">
              <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-[#5B35F5] dark:text-[#A78BFA]">
                <MapPin className="w-4 h-4" />
                <span>{lang === 'bn' ? '২. ঠিকানা ও ব্র্যান্ড লোগো' : '2. Location & Branding'}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'বিজনেসের ঠিকানা' : 'Business Address'}
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder={
                        lang === 'bn' ? 'বাড়ি ১২, রোড ৪, বনানী, ঢাকা' : 'House 12, Road 4, Banani, Dhaka'
                      }
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5] focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#101536] dark:text-slate-200 mb-1.5">
                    {lang === 'bn' ? 'বিজনেস লোগো (ঐচ্ছিক)' : 'Store Logo (Optional)'}
                  </label>
                  {logoPreview ? (
                    <div className="flex items-center gap-2.5 p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950">
                      <img src={logoPreview} alt="Logo preview" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                      <span className="text-xs font-medium text-[#5B35F5] truncate flex-1">
                        {lang === 'bn' ? 'লোগো যুক্ত হয়েছে' : 'Logo ready'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLogoPreview('')}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        aria-label="Remove logo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-[#5B35F5]/40 bg-[#F3F0FF]/40 dark:bg-slate-950 cursor-pointer text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors">
                      <Upload className="w-4 h-4" />
                      <span>{lang === 'bn' ? 'লোগো আপলোড' : 'Upload Logo'}</span>
                      <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Social Channels */}
            <div className="pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-[#5B35F5] dark:text-[#A78BFA]">
                  <Globe className="w-4 h-4" />
                  <span>{lang === 'bn' ? '৩. সোশ্যাল চ্যানেল (ঐচ্ছিক)' : '3. Social Channels (Optional)'}</span>
                </div>
                <span className="text-[11px] text-[#7C8499]">
                  {lang === 'bn' ? 'পরেও যুক্ত করা যাবে' : 'You can also connect later'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl border border-[#E6E0FF] dark:border-slate-800 bg-[#F8F9FC] dark:bg-slate-950 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#101536] dark:text-slate-300">
                    <Globe className="w-3.5 h-3.5 text-blue-600" />
                    <span>Facebook Page</span>
                  </label>
                  <input
                    type="text"
                    value={fbPageName}
                    onChange={(e) => setFbPageName(e.target.value)}
                    placeholder="Page name"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:border-[#5B35F5]"
                  />
                </div>

                <div className="p-3 rounded-xl border border-[#E6E0FF] dark:border-slate-800 bg-[#F8F9FC] dark:bg-slate-950 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#101536] dark:text-slate-300">
                    <Instagram className="w-3.5 h-3.5 text-pink-600" />
                    <span>Instagram Handle</span>
                  </label>
                  <input
                    type="text"
                    value={igUsername}
                    onChange={(e) => setIgUsername(e.target.value)}
                    placeholder="@yourstore"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:border-[#5B35F5]"
                  />
                </div>

                <div className="p-3 rounded-xl border border-[#E6E0FF] dark:border-slate-800 bg-[#F8F9FC] dark:bg-slate-950 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#101536] dark:text-slate-300">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp Business</span>
                  </label>
                  <input
                    type="text"
                    value={waNumber}
                    onChange={(e) => setWaNumber(e.target.value)}
                    placeholder="+8801..."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:border-[#5B35F5]"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-[#5B35F5] to-[#4520D9] hover:opacity-95 text-white text-sm font-display font-bold shadow-lg shadow-[#5B35F5]/25 flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>
                {lang === 'bn' ? 'বিজনেস তৈরি করুন ও ড্যাশবোর্ডে যান' : 'Complete Setup & Open Dashboard'}
              </span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </main>

      {/* Beautiful Custom Category Picker Dialog Box */}
      {categoryDialogOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setCategoryDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
          >
            {/* Dialog Header */}
            <div className="px-5 py-4 border-b border-[#E6E0FF] dark:border-slate-800 flex items-center justify-between gap-3 bg-gradient-to-r from-[#F3F0FF] to-white dark:from-slate-900 dark:to-slate-900">
              <div>
                <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
                  {lang === 'bn' ? 'বিজনেস ক্যাটাগরি নির্বাচন করুন' : 'Choose Business Category'}
                </h2>
                <p className="text-xs text-[#7C8499] dark:text-slate-400">
                  {lang === 'bn'
                    ? 'আপনার বিজনেসের ধরন অনুযায়ী AI অ্যাসিস্ট্যান্ট অপ্টিমাইজ হবে।'
                    : 'Helps BeXpar Ai tailor your storefront and AI responses.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCategoryDialogOpen(false)}
                className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E6E0FF] dark:border-slate-700 text-slate-500 hover:text-[#5B35F5] transition-colors"
                aria-label="Close category dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Filter */}
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="w-4 h-4 text-[#7C8499] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder={lang === 'bn' ? 'ক্যাটাগরি খুঁজুন...' : 'Search category...'}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs focus:outline-none focus:border-[#5B35F5]"
                />
              </div>
            </div>

            {/* Category Cards List */}
            <div className="px-5 py-3 space-y-2.5 overflow-y-auto">
              {filteredCategories.map((opt) => {
                const isSelected = category === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setCategory(opt.value);
                      setCategoryDialogOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 p-3.5 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? 'border-[#5B35F5] bg-[#F3F0FF] dark:bg-[#5B35F5]/15 shadow-xs'
                        : 'border-[#E6E0FF] dark:border-slate-800 bg-white dark:bg-slate-950/60 hover:border-[#5B35F5]/50 hover:bg-[#F3F0FF]/40 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#5B35F5] text-white shadow-sm'
                            : 'bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]'
                        }`}
                      >
                        {opt.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-display font-bold text-[#101536] dark:text-white truncate">
                          {lang === 'bn' ? `${opt.labelBn} · ${opt.value}` : opt.value}
                        </div>
                        <div className="text-[11px] text-[#7C8499] dark:text-slate-400 line-clamp-1 mt-0.5">
                          {lang === 'bn' ? opt.descBn : opt.descEn}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                        isSelected
                          ? 'bg-[#5B35F5] border-[#5B35F5] text-white'
                          : 'border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </button>
                );
              })}

              {/* Custom Category Input Option */}
              <div className="pt-2 border-t border-[#E6E0FF]/70 dark:border-slate-800 space-y-2 pb-2">
                <div className="text-[11px] font-semibold text-[#7C8499] dark:text-slate-400">
                  {lang === 'bn' ? 'অন্য কোনো ক্যাটাগরি হলে লিখুন:' : 'Or enter a custom category:'}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customCategoryDraft}
                    onChange={(e) => setCustomCategoryDraft(e.target.value)}
                    placeholder={lang === 'bn' ? 'যেমন: বই ও স্টেশনারি' : 'e.g. Books & Stationery'}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs focus:outline-none focus:border-[#5B35F5]"
                  />
                  <button
                    type="button"
                    disabled={!customCategoryDraft.trim()}
                    onClick={() => {
                      if (!customCategoryDraft.trim()) return;
                      setCategory(customCategoryDraft.trim());
                      setCategoryDialogOpen(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4520D9] disabled:opacity-40"
                  >
                    {lang === 'bn' ? 'ব্যবহার করুন' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
