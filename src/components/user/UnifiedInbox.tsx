import React, { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, PauseCircle, PlayCircle, Plus, RefreshCw, Search, Send, Sparkles, UserCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getBrowserSupabase } from '../../lib/supabaseClient';
import type { Business, Conversation, Message } from '../../types';
import type { Lang } from '../../i18n/translations';

interface UnifiedInboxProps {
  business: Business;
  lang: Lang;
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({ business, lang }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [simOpen, setSimOpen] = useState(false);
  const [simCustomerName, setSimCustomerName] = useState('Karim Ahmed');
  const [simChannel, setSimChannel] = useState<'facebook' | 'instagram' | 'whatsapp' | 'web_test'>('facebook');
  const [simMessage, setSimMessage] = useState('');
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: Conversation[] }>(`/api/businesses/${business.id}/conversations`, {
        businessId: business.id,
      });
      setConversations(res.conversations);
      if (selected) {
        const updated = res.conversations.find((c) => c.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox.');
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const res = await apiFetch<{ messages: Message[] }>(
        `/api/businesses/${business.id}/conversations/${convId}/messages`,
        { businessId: business.id }
      );
      setMessages(res.messages);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages.');
    }
  };

  const syncMetaInbox = async (opts?: { triggerAutoReply?: boolean; silent?: boolean }) => {
    if (!opts?.silent) {
      setError('');
      setSyncNotice('');
    }
    setSyncing(true);
    try {
      const res = await apiFetch<{
        syncedConversations: number;
        syncedMessages: number;
        aiRepliesSent: number;
        webhookSubscribedPages: number;
        warnings: string[];
      }>(`/api/businesses/${business.id}/social/sync-inbox`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({ triggerAutoReply: opts?.triggerAutoReply !== false }),
      });

      await loadConversations();
      if (selected?.id) {
        await loadMessages(selected.id);
      }

      if (res.warnings?.length) {
        setError(res.warnings[0]);
      } else if (!opts?.silent) {
        if (res.syncedMessages > 0 || res.aiRepliesSent > 0) {
          setSyncNotice(
            lang === 'bn'
              ? `${res.syncedMessages}টি নতুন মেসেজ সিঙ্ক হয়েছে (${res.aiRepliesSent}টি AI রিপ্লাই পাঠানো হয়েছে)।`
              : `Synced ${res.syncedMessages} messages and sent ${res.aiRepliesSent} AI auto-replies.`
          );
        } else {
          setSyncNotice(
            lang === 'bn'
              ? 'Meta ইনবক্স সিঙ্ক সম্পন্ন হয়েছে — কোনো নতুন অমীমাংসিত মেসেজ নেই।'
              : 'Meta inbox synced — all connected conversations are up to date.'
          );
        }
      }
    } catch (err) {
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Failed to sync Meta conversations.');
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void loadConversations();
    void syncMetaInbox({ triggerAutoReply: true, silent: true });
  }, [business.id]);

  useEffect(() => {
    if (selected) {
      void loadMessages(selected.id);
    }
  }, [selected?.id]);

  // Real-time WebSocket Connection for Live Omnichannel Inbox (with 5s polling fallback on serverless hosts like Vercel)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let active = true;
    let wsOpen = false;

    const connectWs = async () => {
      try {
        const { data } = await getBrowserSupabase().auth.getSession();
        const token = data.session?.access_token;
        if (!token || !active) return;
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}&businessId=${business.id}`);
        ws.onopen = () => {
          wsOpen = true;
        };
        ws.onclose = () => {
          wsOpen = false;
        };
        ws.onerror = () => {
          wsOpen = false;
        };
        ws.onmessage = (evt) => {
          try {
            const parsed = JSON.parse(evt.data) as { event: string; payload: unknown };
            if (parsed.event === 'message:new') {
              const incoming = parsed.payload as Message;
              setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
              void loadConversations();
            } else if (parsed.event === 'conversation:updated') {
              void loadConversations();
            }
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore
      }
    };

    void connectWs();

    const pollTimer = window.setInterval(() => {
      if (!active || wsOpen || document.visibilityState !== 'visible') return;
      void loadConversations();
      if (selected?.id) {
        void loadMessages(selected.id);
      }
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(pollTimer);
      ws?.close();
    };
  }, [business.id, selected?.id]);

  const handleSendReply = async (mode: 'staff' | 'ai') => {
    if (!selected) return;
    if (mode === 'staff' && !replyText.trim()) return;
    setSending(true);
    setError('');
    setSyncNotice('');
    try {
      const res = await apiFetch<{ deliveryWarning?: string; error?: string }>(
        `/api/businesses/${business.id}/conversations/${selected.id}/reply`,
        {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify({ content: replyText, mode }),
        }
      );
      if (mode === 'staff') setReplyText('');
      await loadMessages(selected.id);
      await loadConversations();
      if (res.deliveryWarning) {
        setError(res.deliveryWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed.');
    } finally {
      setSending(false);
    }
  };

  const handleToggleAi = async (conv: Conversation) => {
    try {
      const res = await apiFetch<{ conversation: Conversation }>(
        `/api/businesses/${business.id}/conversations/${conv.id}`,
        {
          method: 'PATCH',
          businessId: business.id,
          body: JSON.stringify({ ai_enabled: !conv.ai_enabled }),
        }
      );
      setSelected(res.conversation);
      void loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle AI');
    }
  };

  const handleSaveNotes = async (notes: string) => {
    if (!selected) return;
    await apiFetch(`/api/businesses/${business.id}/conversations/${selected.id}`, {
      method: 'PATCH',
      businessId: business.id,
      body: JSON.stringify({ internal_notes: notes }),
    });
  };

  const handleSimulateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simMessage.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await apiFetch<{ conversationId: string; aiResult?: { error?: string; orderCreatedId?: string } }>(
        `/api/businesses/${business.id}/conversations/test-customer-message`,
        {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify({
            conversationId: selected?.id,
            customerName: simCustomerName,
            channel: simChannel,
            message: simMessage,
          }),
        }
      );
      setSimMessage('');
      setSimOpen(false);
      await loadConversations();
      const targetId = res.conversationId;
      if (targetId) {
        await loadMessages(targetId);
      }
      if (res.aiResult?.error) {
        setError(res.aiResult.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test message failed.');
    } finally {
      setSending(false);
    }
  };

  const filtered = conversations.filter((c) => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
    if (search && !c.customer_name.toLowerCase().includes(search.toLowerCase()) && !c.last_message.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  const channelLabel = (ch: string) =>
    ch === 'facebook' ? 'Messenger' : ch === 'instagram' ? 'Instagram DM' : ch === 'whatsapp' ? 'WhatsApp' : 'AI Test';

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'ইউনিফাইড অমনিচ্যানেল ইনবক্স' : 'Unified Omnichannel Inbox'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Facebook Messenger · Instagram DM · WhatsApp Business
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncing}
            onClick={() => void syncMetaInbox({ triggerAutoReply: true, silent: false })}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/70 disabled:opacity-60 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? (lang === 'bn' ? 'সিঙ্ক হচ্ছে...' : 'Syncing...') : lang === 'bn' ? 'মেসেঞ্জার সিঙ্ক' : 'Sync Meta Chats'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSimOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE] shadow-sm shadow-[#5B35F5]/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'bn' ? 'লাইভ AI টেস্ট মেসেজ' : 'Test Customer Message'}</span>
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          {syncNotice}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {simOpen && (
        <form
          onSubmit={handleSimulateCustomer}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Customer Name</label>
            <input
              type="text"
              value={simCustomerName}
              onChange={(e) => setSimCustomerName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Channel</label>
            <select
              value={simChannel}
              onChange={(e) => setSimChannel(e.target.value as 'facebook' | 'instagram' | 'whatsapp' | 'web_test')}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="facebook">Facebook Messenger</option>
              <option value="instagram">Instagram DM</option>
              <option value="whatsapp">WhatsApp Business</option>
              <option value="web_test">Web AI Test</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Customer Message (Bangla / Banglish / English)
            </label>
            <input
              type="text"
              required
              value={simMessage}
              onChange={(e) => setSimMessage(e.target.value)}
              placeholder="Vai ei product er dam koto? Dhaka delivery hobe?"
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="py-2 px-4 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE] flex items-center justify-center gap-1.5"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>Send &amp; Trigger Real AI</span>
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:h-[calc(100vh-230px)] min-h-[540px]">
        {/* Conversation List */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-[#E6E0FF] dark:border-slate-800 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950 text-xs"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {(['all', 'facebook', 'instagram', 'whatsapp'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                    channelFilter === ch
                      ? 'bg-[#5B35F5] text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No conversations found.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`w-full p-3.5 text-left hover:bg-[#F3F0FF]/60 dark:hover:bg-slate-800/60 transition-colors ${
                    selected?.id === c.id ? 'bg-[#F3F0FF] dark:bg-[#5B35F5]/15' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.customer_name}</span>
                    <span className="text-[11px] font-semibold text-[#5B35F5] dark:text-[#A78BFA]">
                      {channelLabel(c.channel)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500 truncate">{c.last_message}</span>
                    {c.unread_count > 0 && (
                      <span className="text-[11px] font-mono font-bold text-[#5B35F5]">{c.unread_count}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Active Chat Thread */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card flex flex-col overflow-hidden min-h-[420px]">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 p-6 text-center">
              Select a conversation to view messages or click "Test Customer Message" to test the AI agent.
            </div>
          ) : (
            <>
              <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{selected.customer_name}</div>
                  <div className="text-xs text-slate-500">
                    {channelLabel(selected.channel)} · {selected.ai_enabled ? 'AI Active' : 'Human Takeover'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleAi(selected)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    selected.ai_enabled
                      ? 'border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                      : 'border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  {selected.ai_enabled ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  <span>{selected.ai_enabled ? 'Pause AI (Takeover)' : 'Resume AI'}</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F3F0FF]/35 dark:bg-slate-950/40">
                {messages.map((m) => {
                  const isOutbound = m.sender_type === 'ai' || m.sender_type === 'staff';
                  return (
                    <div key={m.id} className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                      <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                        {m.sender_type === 'ai' && <Bot className="w-3 h-3 text-[#5B35F5]" />}
                        {m.sender_type === 'staff' && <UserCheck className="w-3 h-3 text-emerald-500" />}
                        <span className="capitalize">{m.sender_type}</span>
                        <span>·</span>
                        <span className="font-mono">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                          m.sender_type === 'ai'
                            ? 'bg-[#5B35F5] text-white shadow-sm'
                            : m.sender_type === 'staff'
                            ? 'bg-slate-900 dark:bg-slate-700 text-white'
                            : 'bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-[#E6E0FF] dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendReply('staff');
                      }
                    }}
                    placeholder={lang === 'bn' ? 'ম্যানুয়াল উত্তর লিখুন...' : 'Write manual reply...'}
                    className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendReply('ai')}
                    disabled={sending}
                    title="Let AI draft & send reply"
                    className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-[#5B35F5]/40 bg-[#F3F0FF] dark:bg-[#5B35F5]/15 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/60"
                  >
                    AI Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendReply('staff')}
                    disabled={sending || !replyText.trim()}
                    className="p-2.5 rounded-xl bg-[#5B35F5] text-white hover:bg-[#4924DE] disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Customer Context & Internal Notes */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card overflow-y-auto">
          {!selected ? (
            <div className="text-xs text-slate-400 text-center py-8">Customer profile details</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Customer Profile</h3>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{selected.customer_name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Phone: {selected.customer?.phone || 'Not collected yet'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Address: {selected.customer?.address || 'Not collected yet'}
                </div>
              </div>

              <div className="border-t border-[#E6E0FF] dark:border-slate-800 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Conversation Status</h3>
                <select
                  value={selected.status}
                  onChange={async (e) => {
                    await apiFetch(`/api/businesses/${business.id}/conversations/${selected.id}`, {
                      method: 'PATCH',
                      businessId: business.id,
                      body: JSON.stringify({ status: e.target.value }),
                    });
                    void loadConversations();
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="open">Open</option>
                  <option value="resolved">Resolved</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <div className="border-t border-[#E6E0FF] dark:border-slate-800 pt-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Internal Notes</h3>
                <textarea
                  rows={4}
                  defaultValue={selected.internal_notes || ''}
                  onBlur={(e) => void handleSaveNotes(e.target.value)}
                  placeholder="Add internal staff notes..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/40 dark:bg-slate-950 text-xs"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
