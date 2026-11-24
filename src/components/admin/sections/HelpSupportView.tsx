import React, { useEffect, useState } from 'react';
import { BookOpen, HelpCircle, Mail, Phone, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import type { AdminSectionId } from '../adminTypes';

export const HelpSupportView: React.FC<{
  lang: Lang;
  onNavigate: (tab: AdminSectionId) => void;
}> = ({ lang, onNavigate }) => {
  const [support, setSupport] = useState<{
    support_email?: string;
    support_phone?: string;
    terms_url?: string;
    privacy_url?: string;
  }>({});

  useEffect(() => {
    void apiFetch<{ settings: typeof support }>('/api/admin/settings')
      .then((res) => setSupport(res.settings || {}))
      .catch(() => undefined);
  }, []);

  const guides = [
    {
      title: lang === 'bn' ? 'পেমেন্ট ভেরিফিকেশন ও কয়েন ক্রেডিট' : 'Payment Verification & Atomic Coins',
      desc:
        lang === 'bn'
          ? 'Platform Settings → Payments & Gateways থেকে পেন্ডিং bKash/Nagad/Manual পেমেন্ট যাচাই করে Approve করলে অটোমেটিক কয়েন ও সাবস্ক্রিপশন যুক্ত হয়।'
          : 'Review pending merchant payments under Platform Settings → Payments & Gateways. Approving atomically credits AI coin packages or activates subscription plans.',
      target: 'settings' as AdminSectionId,
    },
    {
      title: lang === 'bn' ? 'AI প্রোভাইডার ও কয়েন প্রাইসিং' : 'AI Providers & Model Routing',
      desc:
        lang === 'bn'
          ? 'AI Provider Management থেকে Gemini, OpenAI, বা DeepSeek কী এনক্রিপ্ট করে সেভ করুন এবং Test Connection দিয়ে যাচাই করুন।'
          : 'Configure encrypted API keys for Gemini, OpenAI, DeepSeek, or custom OpenAI-compatible endpoints, set primary/fallback models, and verify live latency.',
      target: 'ai' as AdminSectionId,
    },
    {
      title: lang === 'bn' ? 'ইউজার ও বিজনেস নিয়ন্ত্রণ' : 'User & Business Governance',
      desc:
        lang === 'bn'
          ? 'যেকোনো মার্চেন্ট বিজনেসে কয়েন যোগ/বিয়োগ, প্ল্যান পরিবর্তন বা অ্যাকাউন্ট সাসপেন্ড করার আগে কনফার্মেশন ও অডিট লগ সংরক্ষিত হয়।'
          : 'Every coin adjustment, subscription override, and suspension action writes an immutable record to audit_logs for compliance.',
      target: 'users' as AdminSectionId,
    },
    {
      title: lang === 'bn' ? 'সিস্টেম লগ ও নিরাপত্তা' : 'Security & Audit Trail',
      desc:
        lang === 'bn'
          ? 'Security & Access থেকে আপনার অ্যাডমিন পাসওয়ার্ড পরিবর্তন করুন এবং System Logs থেকে AI ও Meta ইন্টিগ্রেশনের ত্রুটি দেখুন।'
          : 'Update your Super Admin password via Supabase Auth in Security & Access and inspect AI/Meta webhook events in System Logs.',
      target: 'security' as AdminSectionId,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
              {lang === 'bn' ? 'BeXpar Ai সুপার অ্যাডমিন সহায়তা কেন্দ্র' : 'BeXpar Ai Super Admin Operations Guide'}
            </h2>
            <p className="text-xs text-[#7C8499] mt-0.5">
              {lang === 'bn'
                ? 'প্ল্যাটফর্ম পরিচালনার নির্দেশিকা এবং বর্তমান পাবলিক সাপোর্ট তথ্য।'
                : 'Operational workflows, security safeguards, and active platform support channels.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
            <Mail className="w-3.5 h-3.5 text-[#5B35F5]" />
            <span>{support.support_email || 'support@bexpar.ai'}</span>
          </div>
          {support.support_phone && (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F8F9FC] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800">
              <Phone className="w-3.5 h-3.5 text-[#5B35F5]" />
              <span>{support.support_phone}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {guides.map((g) => (
          <div
            key={g.title}
            className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between gap-4"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-display font-bold text-[#101536] dark:text-white">
                <BookOpen className="w-4 h-4 text-[#5B35F5]" />
                <span>{g.title}</span>
              </div>
              <p className="text-xs text-[#7C8499] dark:text-slate-400 leading-relaxed">{g.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(g.target)}
              className="w-fit px-3.5 py-1.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
            >
              {lang === 'bn' ? 'সেকশনে যান →' : 'Open Module →'}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex items-center gap-3 text-xs text-[#7C8499]">
        <ShieldCheck className="w-4 h-4 text-[#16B66A] shrink-0" />
        <span>
          All Super Admin endpoints require an active authenticated Supabase session with `role = super_admin` and
          automatically record sensitive mutations into `audit_logs`.
        </span>
      </div>
    </div>
  );
};
