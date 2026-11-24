import React, { useEffect, useState } from 'react';
import { BookOpen, Bot, Check, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { Business } from '../../types';
import type { Lang } from '../../i18n/translations';

interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  is_enabled: boolean;
  created_at: string;
}

interface AiStudioViewProps {
  business: Business;
  lang: Lang;
}

export const AiStudioView: React.FC<AiStudioViewProps> = ({ business, lang }) => {
  const [tab, setTab] = useState<'settings' | 'kb'>('settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  // AI Settings state
  const [agentName, setAgentName] = useState('BeXpar Assistant');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [aiLanguage, setAiLanguage] = useState('bn-en');
  const [replyTone, setReplyTone] = useState('friendly_professional');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [businessRules, setBusinessRules] = useState('');
  const [autoReply, setAutoReply] = useState(true);
  const [humanHandover, setHumanHandover] = useState(true);
  const [orderCollection, setOrderCollection] = useState(true);
  const [defaultDelivery, setDefaultDelivery] = useState(60);

  // Knowledge Base state
  const [kbItems, setKbItems] = useState<KnowledgeItem[]>([]);
  const [kbSearch, setKbSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('faq');
  const [newContent, setNewContent] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sRes, kbRes] = await Promise.all([
        apiFetch<{ settings: Record<string, unknown> }>(`/api/businesses/${business.id}/ai-settings`, {
          businessId: business.id,
        }),
        apiFetch<{ items: KnowledgeItem[] }>(`/api/businesses/${business.id}/knowledge-base`, {
          businessId: business.id,
        }),
      ]);
      const s = sRes.settings || {};
      setAgentName(String(s.agent_name || 'BeXpar Assistant'));
      setWelcomeMessage(String(s.welcome_message || ''));
      setAiLanguage(String(s.language || 'bn-en'));
      setReplyTone(String(s.reply_tone || 'friendly_professional'));
      setSystemInstructions(String(s.system_instructions || ''));
      setBusinessRules(String(s.business_rules || ''));
      setAutoReply(s.auto_reply_enabled !== false);
      setHumanHandover(s.human_handover_enabled !== false);
      setOrderCollection(s.order_collection_enabled !== false);
      const rules = (s.order_collection_rules || {}) as { default_delivery_charge?: number };
      setDefaultDelivery(Number(rules.default_delivery_charge ?? 60));
      setKbItems(kbRes.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [business.id]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice('');
    try {
      await apiFetch(`/api/businesses/${business.id}/ai-settings`, {
        method: 'PUT',
        businessId: business.id,
        body: JSON.stringify({
          agent_name: agentName,
          welcome_message: welcomeMessage,
          language: aiLanguage,
          reply_tone: replyTone,
          system_instructions: systemInstructions,
          business_rules: businessRules,
          auto_reply_enabled: autoReply,
          human_handover_enabled: humanHandover,
          order_collection_enabled: orderCollection,
          order_collection_rules: {
            require_name: true,
            require_phone: true,
            require_address: true,
            default_delivery_charge: Number(defaultDelivery),
          },
          is_available: true,
        }),
      });
      setSavedNotice('AI Agent settings saved.');
      setTimeout(() => setSavedNotice(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleAddKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    await apiFetch(`/api/businesses/${business.id}/knowledge-base`, {
      method: 'POST',
      businessId: business.id,
      body: JSON.stringify({
        category: newCategory,
        title: newTitle,
        content: newContent,
        is_enabled: true,
      }),
    });
    setNewTitle('');
    setNewContent('');
    void loadAll();
  };

  const toggleKb = async (item: KnowledgeItem) => {
    await apiFetch(`/api/businesses/${business.id}/knowledge-base/${item.id}`, {
      method: 'PATCH',
      businessId: business.id,
      body: JSON.stringify({ is_enabled: !item.is_enabled }),
    });
    void loadAll();
  };

  const deleteKb = async (id: string) => {
    await apiFetch(`/api/businesses/${business.id}/knowledge-base/${id}`, {
      method: 'DELETE',
      businessId: business.id,
    });
    void loadAll();
  };

  const filteredKb = kbItems.filter(
    (k) => !kbSearch || k.title.toLowerCase().includes(kbSearch.toLowerCase()) || k.content.toLowerCase().includes(kbSearch.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'AI এজেন্ট ও নলেজ বেস' : 'AI Agent & Knowledge Base'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure Bangla, Banglish &amp; English responses, order collection rules, and business policies.
          </p>
        </div>
        <div className="inline-flex p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'settings' ? 'bg-[#5B35F5] text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>AI Customization</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('kb')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'kb' ? 'bg-[#5B35F5] text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Knowledge Base ({kbItems.length})</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading AI configuration...</div>
      ) : tab === 'settings' ? (
        <form onSubmit={handleSaveSettings} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 bx-card space-y-5 max-w-3xl">
          {savedNotice && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{savedNotice}</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">AI Agent Name</label>
              <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Default Delivery Charge (BDT)</label>
              <input type="number" min="0" value={defaultDelivery} onChange={(e) => setDefaultDelivery(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Supported Language Mode</label>
              <select value={aiLanguage} onChange={(e) => setAiLanguage(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
                <option value="bn-en">Auto (Bangla, Banglish & English)</option>
                <option value="bn">Bangla Primary</option>
                <option value="en">English Primary</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Reply Tone</label>
              <select value={replyTone} onChange={(e) => setReplyTone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
                <option value="friendly_professional">Friendly & Professional</option>
                <option value="concise_direct">Concise & Direct</option>
                <option value="warm_consultative">Warm & Consultative</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Welcome Message</label>
            <input type="text" value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">System Instructions</label>
            <textarea rows={3} value={systemInstructions} onChange={(e) => setSystemInstructions(e.target.value)} placeholder="Guide how the AI greets customers and answers questions..." className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Business & Order Rules</label>
            <textarea rows={3} value={businessRules} onChange={(e) => setBusinessRules(e.target.value)} placeholder="e.g., Inside Dhaka delivery 60 BDT (24-48h), Outside Dhaka 120 BDT..." className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} className="rounded text-[#5B35F5]" />
              <span>Enable Auto-Reply</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input type="checkbox" checked={orderCollection} onChange={(e) => setOrderCollection(e.target.checked)} className="rounded text-[#5B35F5]" />
              <span>Auto Order Collection</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input type="checkbox" checked={humanHandover} onChange={(e) => setHumanHandover(e.target.checked)} className="rounded text-[#5B35F5]" />
              <span>Auto Human Handover</span>
            </label>
          </div>

          <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-sm font-semibold shadow-sm shadow-[#5B35F5]/20 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Save AI Configuration</span>
          </button>
        </form>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form onSubmit={handleAddKb} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-3 h-fit">
            <h2 className="text-sm font-display font-bold">Add Knowledge Entry</h2>
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs">
                <option value="business_info">Business Info</option>
                <option value="faq">FAQ</option>
                <option value="delivery_policy">Delivery Policy</option>
                <option value="return_policy">Return Policy</option>
                <option value="refund_policy">Refund Policy</option>
                <option value="product_info">Product Info</option>
                <option value="custom">Custom Instruction</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Title *</label>
              <input type="text" required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g., Dhaka & Outside Delivery Charge" className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Content *</label>
              <textarea rows={5} required value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Exact policy details the AI must follow..." className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 inline-flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Add to Knowledge Base</span>
            </button>
          </form>

          <div className="lg:col-span-2 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input type="text" value={kbSearch} onChange={(e) => setKbSearch(e.target.value)} placeholder="Search knowledge entries..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:border-[#5B35F5]" />
            </div>
            {filteredKb.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400 bx-card">
                No knowledge entries yet. Add your delivery policy, return policy, and FAQs.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredKb.map((item) => (
                  <div key={item.id} className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-[#5B35F5] dark:text-[#A78BFA] font-semibold capitalize">{item.category.replace('_', ' ')}</div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{item.title}</h3>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 whitespace-pre-wrap">{item.content}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void toggleKb(item)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                            item.is_enabled
                              ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                              : 'border-[#E6E0FF] dark:border-slate-700 text-slate-500'
                          }`}
                        >
                          {item.is_enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button type="button" onClick={() => void deleteKb(item.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
