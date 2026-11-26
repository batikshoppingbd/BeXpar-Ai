import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Bot,
  Check,
  CheckCheck,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  MessageCircle,
  Paperclip,
  PauseCircle,
  Phone,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smile,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getBrowserSupabase } from '../../lib/supabaseClient';
import type { Business, Conversation, Message } from '../../types';
import type { Lang } from '../../i18n/translations';

interface UnifiedInboxProps {
  business: Business;
  lang: Lang;
}

interface PendingAttachment {
  file: File;
  type: 'image' | 'file';
  previewUrl?: string;
}

interface IncomingToast {
  id: string;
  conversationId: string;
  customerName: string;
  channel: Conversation['channel'];
  preview: string;
}

const QUICK_EMOJIS = [
  '😊', '🙏', '❤️', '👍', '🔥', '✨', '🎉', '💯',
  '📦', '🚚', '💰', '✅', '😍', '🤝', '👌', '🥳',
  '🛒', '💳', '📞', '📍', '⏰', '🙌', '😁', '💬',
];

const PlatformIcon: React.FC<{ channel: Conversation['channel']; size?: 'sm' | 'md' }> = ({
  channel,
  size = 'sm',
}) => {
  const dim = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  if (channel === 'facebook') {
    return (
      <span
        title="Facebook Messenger"
        className={`${dim} rounded-full bg-[#0084FF] text-white inline-flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-slate-900`}
      >
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-current" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.14 2 11.25c0 2.9 1.44 5.49 3.7 7.19V22l3.42-1.88c.9.25 1.87.38 2.88.38 5.52 0 10-4.14 10-9.25S17.52 2 12 2zm1.06 12.46l-2.55-2.72-4.98 2.72 5.48-5.82 2.61 2.72 4.92-2.72-5.48 5.82z" />
        </svg>
      </span>
    );
  }
  if (channel === 'instagram') {
    return (
      <span
        title="Instagram DM"
        className={`${dim} rounded-full bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white inline-flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-slate-900`}
      >
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-none stroke-current" strokeWidth="2.3" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  if (channel === 'whatsapp') {
    return (
      <span
        title="WhatsApp Business"
        className={`${dim} rounded-full bg-[#25D366] text-white inline-flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-slate-900`}
      >
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 fill-current" aria-hidden="true">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.77 13.97c-.24.68-1.41 1.3-1.95 1.38-.52.08-1.18.11-1.91-.12-.44-.14-1-.33-1.72-.64-3.03-1.31-5-4.38-5.15-4.58-.15-.2-1.23-1.64-1.23-3.12 0-1.49.78-2.22 1.05-2.52.27-.3.6-.38.8-.38.2 0 .4 0 .57.01.18.01.43-.07.67.51.24.6.84 2.06.91 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.45.51-.15.15-.3.31-.13.61.18.3.78 1.29 1.68 2.09 1.15 1.03 2.13 1.35 2.43 1.5.3.15.48.13.66-.08.18-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.74.82 2.04.97.3.15.5.22.57.34.08.12.08.7-.16 1.38z" />
        </svg>
      </span>
    );
  }
  return (
    <span
      title="AI Test"
      className={`${dim} rounded-full bg-[#5B35F5] text-white inline-flex items-center justify-center shadow-sm ring-2 ring-white dark:ring-slate-900`}
    >
      <Bot className="w-2.5 h-2.5" />
    </span>
  );
};

const CustomerAvatar: React.FC<{
  name: string;
  avatar?: string;
  channel: Conversation['channel'];
  size?: 'sm' | 'md' | 'lg';
}> = ({ name, avatar, channel, size = 'md' }) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [avatar]);

  const sizeClass = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-11 h-11 text-sm';
  const initials = (name || 'C')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="relative shrink-0">
      {avatar && !imgFailed ? (
        <img
          src={avatar}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${sizeClass} rounded-full object-cover border border-[#E6E0FF] dark:border-slate-700 bg-slate-100 dark:bg-slate-800`}
        />
      ) : (
        <div
          className={`${sizeClass} rounded-full bg-gradient-to-br from-[#5B35F5] to-[#7C3AED] text-white font-display font-bold flex items-center justify-center select-none`}
        >
          {initials || 'C'}
        </div>
      )}
      <div className="absolute -bottom-0.5 -right-0.5">
        <PlatformIcon channel={channel} size={size === 'sm' ? 'sm' : 'sm'} />
      </div>
    </div>
  );
};

function formatListTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeMediaUrl(raw?: string): string {
  if (!raw) return '#';
  const trimmed = raw.trim();
  if (trimmed.startsWith('blob:')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // invalid URL
  }
  return '#';
}

function playMessageChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.17);
  } catch {
    // Ignore autoplay restriction errors
  }
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({ business, lang }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [channelFilter, setChannelFilter] = useState<'all' | 'facebook' | 'instagram' | 'whatsapp'>('all');
  const [search, setSearch] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [error, setError] = useState('');
  const [aiWarning, setAiWarning] = useState('');
  const [webhookIssues, setWebhookIssues] = useState<string[]>([]);
  const [subscribingWebhook, setSubscribingWebhook] = useState(false);

  // Messenger UX states
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name?: string } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [incomingToast, setIncomingToast] = useState<IncomingToast | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Test Simulator state
  const [simOpen, setSimOpen] = useState(false);
  const [simCustomerName, setSimCustomerName] = useState('Karim Ahmed');
  const [simChannel, setSimChannel] = useState<'facebook' | 'instagram' | 'whatsapp' | 'web_test'>('facebook');
  const [simMessage, setSimMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const soundEnabledRef = useRef<boolean>(true);
  const prevUnreadTotalRef = useRef<number | null>(null);
  const syncInFlightRef = useRef<boolean>(false);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    selectedIdRef.current = selected?.id || null;
    setNotesDraft(selected?.internal_notes || '');
    setEmojiOpen(false);
    setAiWarning('');
  }, [selected?.id, selected?.internal_notes]);

  // Revoke object URL on unmount or attachment change
  useEffect(() => {
    return () => {
      if (pendingAttachment?.previewUrl) {
        URL.revokeObjectURL(pendingAttachment.previewUrl);
      }
    };
  }, [pendingAttachment]);

  // Escape key closes lightbox or emoji popover
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxImage(null);
        setEmojiOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadConversations = useCallback(async (opts?: { notifyOnNewUnread?: boolean }) => {
    try {
      const res = await apiFetch<{ conversations: Conversation[] }>(`/api/businesses/${business.id}/conversations`, {
        businessId: business.id,
      });
      const sorted = [...(res.conversations || [])].sort(
        (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      );
      setConversations(sorted);

      const totalUnread = sorted.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      if (
        opts?.notifyOnNewUnread &&
        prevUnreadTotalRef.current !== null &&
        totalUnread > prevUnreadTotalRef.current
      ) {
        const newestUnread = sorted.find((c) => c.unread_count > 0 && c.id !== selectedIdRef.current) || sorted[0];
        if (newestUnread) {
          if (soundEnabledRef.current) playMessageChime();
          setIncomingToast({
            id: `${newestUnread.id}_${Date.now()}`,
            conversationId: newestUnread.id,
            customerName: newestUnread.customer_name,
            channel: newestUnread.channel,
            preview: newestUnread.last_message || 'New message received',
          });
        }
      }
      prevUnreadTotalRef.current = totalUnread;

      if (selectedIdRef.current) {
        const updated = sorted.find((c) => c.id === selectedIdRef.current);
        if (updated) setSelected(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox.');
    } finally {
      setLoadingList(false);
    }
  }, [business.id]);

  const loadMessages = useCallback(async (convId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingMessages(true);
    try {
      const res = await apiFetch<{ messages: Message[]; latestAiWarning?: string }>(
        `/api/businesses/${business.id}/conversations/${convId}/messages`,
        { businessId: business.id }
      );
      setMessages(res.messages || []);
      setAiWarning(res.latestAiWarning || '');
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );
      if (!opts?.silent) {
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages.');
    } finally {
      if (!opts?.silent) setLoadingMessages(false);
    }
  }, [business.id]);

  const syncMetaInbox = useCallback(async (opts?: { triggerAutoReply?: boolean; silent?: boolean }) => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
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

      await loadConversations({ notifyOnNewUnread: true });
      if (selectedIdRef.current) {
        await loadMessages(selectedIdRef.current, { silent: true });
      }

      if (res.warnings?.length) {
        if (!opts?.silent) {
          setError(res.warnings[0]);
        }
      } else if (!opts?.silent) {
        if (res.syncedMessages > 0 || res.aiRepliesSent > 0) {
          setSyncNotice(
            lang === 'bn'
              ? `${res.syncedMessages}টি নতুন মেসেজ সিঙ্ক হয়েছে (${res.aiRepliesSent}টি AI রিপ্লাই পাঠানো হয়েছে)।`
              : `Synced ${res.syncedMessages} messages and sent ${res.aiRepliesSent} AI auto-replies.`
          );
        } else {
          setSyncNotice(
            lang === 'bn'
              ? 'Meta ইনবক্স সিঙ্ক সম্পন্ন হয়েছে — সব চ্যাট আপ-টু-ডেট আছে।'
              : 'Meta inbox synced — all connected conversations are up to date.'
          );
        }
      }
    } catch (err) {
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Failed to sync Meta conversations.');
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
    }
  }, [business.id, lang, loadConversations, loadMessages]);

  const loadWebhookStatus = useCallback(async () => {
    try {
      const diag = await apiFetch<{ issues?: string[] }>(
        `/api/businesses/${business.id}/social/webhook-status`,
        { businessId: business.id }
      );
      setWebhookIssues(diag.issues || []);
    } catch {
      // Ignore diagnostic probe errors
    }
  }, [business.id]);

  const handleEnableInstantWebhook = async () => {
    setSubscribingWebhook(true);
    setError('');
    try {
      const res = await apiFetch<{
        subscribedPages: string[];
        failedPages: Array<{ name: string; error: string }>;
        diagnostics?: { issues?: string[] };
      }>(`/api/businesses/${business.id}/social/webhook-subscribe`, {
        method: 'POST',
        businessId: business.id,
      });
      setWebhookIssues(res.diagnostics?.issues || []);
      if (res.failedPages?.length) {
        setError(`${res.failedPages[0].name}: ${res.failedPages[0].error}`);
      } else {
        setSyncNotice(
          lang === 'bn'
            ? `Instant Auto-Reply Webhook সক্রিয় হয়েছে (${res.subscribedPages.length}টি চ্যানেল)।`
            : `Instant Auto-Reply webhook active for ${res.subscribedPages.length} channel(s).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable webhook.');
    } finally {
      setSubscribingWebhook(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    setMessages([]);
    setAiWarning('');
    prevUnreadTotalRef.current = null;
    void loadConversations();
    void loadWebhookStatus();
    void syncMetaInbox({ triggerAutoReply: true, silent: true });
  }, [business.id, loadConversations, loadWebhookStatus, syncMetaInbox]);

  useEffect(() => {
    if (selected?.id) {
      void loadMessages(selected.id);
    }
  }, [selected?.id, loadMessages]);

  // Real-time WebSocket Connection + Serverless 5s Polling Fallback
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
              if (incoming.conversation_id === selectedIdRef.current) {
                setMessages((prev) => {
                  const exists = prev.some((m) => m.id === incoming.id);
                  return exists ? prev : [...prev, incoming];
                });
                if (incoming.sender_type !== 'customer') {
                  setAiWarning('');
                }
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
                if (incoming.sender_type === 'customer') {
                  void apiFetch(`/api/businesses/${business.id}/conversations/${incoming.conversation_id}/read`, {
                    method: 'POST',
                    businessId: business.id,
                  }).catch(() => undefined);
                }
              } else if (incoming.sender_type === 'customer') {
                if (soundEnabledRef.current) playMessageChime();
                const matchedConv = conversationsRef.current.find((c) => c.id === incoming.conversation_id);
                setIncomingToast({
                  id: `${incoming.id}_${Date.now()}`,
                  conversationId: incoming.conversation_id,
                  customerName: matchedConv?.customer_name || 'Customer',
                  channel: matchedConv?.channel || 'facebook',
                  preview: incoming.content || (incoming.message_type === 'image' ? '📷 Photo' : 'New message'),
                });
              }
              void loadConversations();
            } else if (parsed.event === 'ai:warning') {
              const warn = parsed.payload as { conversationId?: string; message?: string };
              if (warn.conversationId && warn.conversationId === selectedIdRef.current && warn.message) {
                setAiWarning(warn.message);
              }
            } else if (parsed.event === 'conversation:updated') {
              void loadConversations({ notifyOnNewUnread: true });
            } else if (parsed.event === 'message:status') {
              const st = parsed.payload as {
                conversationId?: string;
                messageId?: string;
                status?: Message['delivery_status'];
              };
              if (st.conversationId && st.conversationId === selectedIdRef.current && st.status) {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (st.messageId) {
                      return m.id === st.messageId ? { ...m, delivery_status: st.status! } : m;
                    }
                    if (m.sender_type === 'ai' || m.sender_type === 'staff') {
                      if (st.status === 'read' && (m.delivery_status === 'sent' || m.delivery_status === 'delivered')) {
                        return { ...m, delivery_status: 'read' };
                      }
                      if (st.status === 'delivered' && m.delivery_status === 'sent') {
                        return { ...m, delivery_status: 'delivered' };
                      }
                    }
                    return m;
                  })
                );
              }
            }
          } catch {
            // ignore malformed frames
          }
        };
      } catch {
        // ignore WS error and use polling fallback
      }
    };

    void connectWs();

    const pollTimer = window.setInterval(() => {
      if (!active || wsOpen || document.visibilityState !== 'visible') return;
      void loadConversations({ notifyOnNewUnread: true });
      if (selectedIdRef.current) {
        void loadMessages(selectedIdRef.current, { silent: true });
      }
    }, 5000);

    const syncTimer = window.setInterval(() => {
      if (!active || wsOpen || document.visibilityState !== 'visible') return;
      void syncMetaInbox({ triggerAutoReply: true, silent: true });
    }, 8000);

    return () => {
      active = false;
      window.clearInterval(pollTimer);
      window.clearInterval(syncTimer);
      ws?.close();
    };
  }, [business.id, loadConversations, loadMessages, syncMetaInbox]);

  const handleSelectFile = (file: File, forcedType?: 'image' | 'file') => {
    setError('');
    if (file.size > 8 * 1024 * 1024) {
      setError(lang === 'bn' ? 'ফাইলের সাইজ সর্বোচ্চ 8MB হতে পারবে।' : 'File exceeds the 8MB upload limit.');
      return;
    }
    const isImg = forcedType === 'image' || file.type.startsWith('image/');
    if (pendingAttachment?.previewUrl) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment({
      file,
      type: isImg ? 'image' : 'file',
      previewUrl: isImg ? URL.createObjectURL(file) : undefined,
    });
  };

  const clearPendingAttachment = () => {
    if (pendingAttachment?.previewUrl) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment(null);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsDataURL(file);
    });

  const handleSendReply = async (mode: 'staff' | 'ai') => {
    if (!selected) return;
    if (mode === 'staff' && !replyText.trim() && !pendingAttachment) return;

    setSending(true);
    setError('');
    setSyncNotice('');
    setEmojiOpen(false);

    try {
      let attachmentUrl: string | undefined;
      let attachmentType: 'image' | 'file' | undefined;
      let attachmentName: string | undefined;
      let attachmentSize: number | undefined;

      if (mode === 'staff' && pendingAttachment) {
        setUploadingMedia(true);
        const base64Data = await fileToBase64(pendingAttachment.file);
        const uploadRes = await apiFetch<{ url: string }>(`/api/businesses/${business.id}/upload`, {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify({
            bucket: 'chat-attachments',
            fileName: pendingAttachment.file.name,
            base64Data,
            contentType: pendingAttachment.file.type || 'application/octet-stream',
          }),
        });
        attachmentUrl = uploadRes.url;
        attachmentType = pendingAttachment.type;
        attachmentName = pendingAttachment.file.name;
        attachmentSize = pendingAttachment.file.size;
        setUploadingMedia(false);
      }

      const res = await apiFetch<{ deliveryWarning?: string; error?: string }>(
        `/api/businesses/${business.id}/conversations/${selected.id}/reply`,
        {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify({
            content: replyText,
            mode,
            attachmentUrl,
            attachmentType,
            attachmentName,
            attachmentSize,
          }),
        }
      );

      if (mode === 'staff') {
        setReplyText('');
        clearPendingAttachment();
      }
      await loadMessages(selected.id);
      await loadConversations();
      if (res.deliveryWarning) {
        setError(res.deliveryWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reply failed.');
    } finally {
      setUploadingMedia(false);
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
    setSavingNotes(true);
    try {
      await apiFetch(`/api/businesses/${business.id}/conversations/${selected.id}`, {
        method: 'PATCH',
        businessId: business.id,
        body: JSON.stringify({ internal_notes: notes }),
      });
      setSelected((prev) => (prev ? { ...prev, internal_notes: notes } : prev));
    } finally {
      setSavingNotes(false);
    }
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
      if (res.conversationId) {
        const refreshed = await apiFetch<{ conversations: Conversation[] }>(`/api/businesses/${business.id}/conversations`, {
          businessId: business.id,
        });
        const target = refreshed.conversations.find((c) => c.id === res.conversationId);
        if (target) setSelected(target);
        await loadMessages(res.conversationId);
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

  const insertEmoji = (emoji: string) => {
    const el = textInputRef.current;
    if (!el) {
      setReplyText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? replyText.length;
    const end = el.selectionEnd ?? replyText.length;
    const next = replyText.slice(0, start) + emoji + replyText.slice(end);
    setReplyText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const totalUnreadCount = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [conversations]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
      if (q && !c.customer_name.toLowerCase().includes(q) && !c.last_message.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [conversations, channelFilter, search]);

  const channelLabel = (ch: Conversation['channel']) =>
    ch === 'facebook' ? 'Messenger' : ch === 'instagram' ? 'Instagram DM' : ch === 'whatsapp' ? 'WhatsApp' : 'AI Test';

  const renderDeliveryStatus = (m: Message) => {
    if (m.sender_type === 'customer' || m.sender_type === 'system') return null;
    if (m.delivery_status === 'read') {
      return (
        <span className="inline-flex items-center gap-1 text-[#5B35F5] dark:text-[#A78BFA]" title="Seen">
          <CheckCheck className="w-3.5 h-3.5" />
          <span>{lang === 'bn' ? 'Seen' : 'Seen'}</span>
        </span>
      );
    }
    if (m.delivery_status === 'delivered') {
      return (
        <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500" title="Delivered">
          <CheckCheck className="w-3.5 h-3.5" />
          <span>Delivered</span>
        </span>
      );
    }
    if (m.delivery_status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 text-rose-500" title="Failed to send">
          <AlertCircle className="w-3 h-3" />
          <span>Failed</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500" title="Sent">
        <Check className="w-3.5 h-3.5" />
        <span>Sent</span>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Live Incoming Message Toast Notification */}
      {incomingToast && (
        <div className="rounded-2xl border border-[#5B35F5]/30 bg-white dark:bg-slate-900 px-4 py-3 bx-card flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PlatformIcon channel={incomingToast.channel} size="md" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {lang === 'bn' ? `নতুন মেসেজ: ${incomingToast.customerName}` : `New message from ${incomingToast.customerName}`}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{incomingToast.preview}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const target = conversations.find((c) => c.id === incomingToast.conversationId);
                if (target) setSelected(target);
                setIncomingToast(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE]"
            >
              {lang === 'bn' ? 'চ্যাট দেখুন' : 'Open Chat'}
            </button>
            <button
              type="button"
              onClick={() => setIncomingToast(null)}
              aria-label="Dismiss notification"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {syncNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
          <span>{syncNotice}</span>
          <button type="button" onClick={() => setSyncNotice('')} aria-label="Close notice">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Close error">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {simOpen && (
        <form
          onSubmit={handleSimulateCustomer}
          className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
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
              Customer Message
            </label>
            <input
              type="text"
              required
              value={simMessage}
              onChange={(e) => setSimMessage(e.target.value)}
              placeholder="Vai ei product er dam koto?"
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={sending}
              className="flex-1 py-2 px-4 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE] flex items-center justify-center gap-1.5"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Send Test</span>
            </button>
            <button
              type="button"
              onClick={() => setSimOpen(false)}
              className="p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-slate-500"
              aria-label="Close test form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {webhookIssues.length > 0 && (
        <div className="mb-3 rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/35 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{lang === 'bn' ? 'Instant Auto-Reply সতর্কতা: ' : 'Instant Auto-Reply Check: '}</strong>
              {webhookIssues[0]}
            </span>
          </div>
          {webhookIssues[0].includes('Webhook') && (
            <button
              type="button"
              disabled={subscribingWebhook}
              onClick={() => void handleEnableInstantWebhook()}
              className="px-3 py-1.5 rounded-xl bg-[#5B35F5] text-white font-semibold hover:bg-[#4924DE] disabled:opacity-60 shrink-0"
            >
              {subscribingWebhook
                ? lang === 'bn' ? 'চালু হচ্ছে...' : 'Enabling...'
                : lang === 'bn' ? 'Instant Webhook চালু করুন' : 'Enable Instant Webhook'}
            </button>
          )}
        </div>
      )}

      {/* Main Messenger Shell */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card overflow-hidden flex h-[calc(100dvh-165px)] md:h-[calc(100vh-140px)] min-h-[540px]">
        {/* LEFT PANE: Conversation List (Always visible on desktop; visible on mobile when no chat selected) */}
        <aside
          className={`${
            selected ? 'hidden lg:flex' : 'flex'
          } w-full lg:w-[330px] xl:w-[360px] shrink-0 border-r border-[#E6E0FF] dark:border-slate-800 flex-col bg-white dark:bg-slate-900`}
        >
          {/* List Header */}
          <div className="p-4 border-b border-[#E6E0FF] dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-lg font-display font-bold text-slate-900 dark:text-white truncate">
                  {lang === 'bn' ? 'চ্যাট ইনবক্স' : 'Chats'}
                </h1>
                {totalUnreadCount > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#5B35F5] text-white text-[11px] font-bold tabular-nums inline-flex items-center justify-center">
                    {totalUnreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSoundEnabled((s) => !s)}
                  title={soundEnabled ? 'Notification sound on' : 'Notification sound muted'}
                  className={`p-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 transition-colors ${
                    soundEnabled
                      ? 'bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]'
                      : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void syncMetaInbox({ triggerAutoReply: true, silent: false })}
                  title={lang === 'bn' ? 'মেসেঞ্জার ও ইনস্টাগ্রাম সিঙ্ক করুন' : 'Sync Messenger & Instagram'}
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/70 disabled:opacity-60 whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  <span>{lang === 'bn' ? 'সিঙ্ক' : 'Sync'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSimOpen((v) => !v)}
                  title={lang === 'bn' ? 'লাইভ AI টেস্ট মেসেজ' : 'Test Customer Message'}
                  className="p-2 rounded-xl bg-[#5B35F5] text-white hover:bg-[#4924DE]"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'bn' ? 'কাস্টমারের নাম দিয়ে খুঁজুন...' : 'Search Messenger & Instagram...'}
                className="w-full pl-9 pr-8 py-2 rounded-full border border-[#E6E0FF] dark:border-slate-700 bg-[#F0F2F5] dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#5B35F5]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Platform Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-[#F3F0FF]/70 dark:bg-slate-950 rounded-xl overflow-x-auto">
              {(
                [
                  ['all', lang === 'bn' ? 'সব' : 'All'],
                  ['facebook', 'Messenger'],
                  ['instagram', 'Instagram'],
                  ['whatsapp', 'WhatsApp'],
                ] as const
              ).map(([ch, label]) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    channelFilter === ch
                      ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversations Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#E6E0FF]/40 dark:divide-slate-800/70">
            {loadingList ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800/60" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] mx-auto flex items-center justify-center">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {lang === 'bn' ? 'কোনো কথোপকথন পাওয়া যায়নি' : 'No conversations found'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'bn'
                    ? 'আপনার Facebook পেজ বা Instagram থেকে নতুন মেসেজ আনতে সিঙ্ক বাটনে ক্লিক করুন।'
                    : 'Click Sync to pull recent messages from your connected Messenger or Instagram inbox.'}
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = selected?.id === c.id;
                const hasUnread = (c.unread_count || 0) > 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full px-3.5 py-3 text-left flex items-center gap-3 transition-colors ${
                      isSelected
                        ? 'bg-[#F3F0FF] dark:bg-[#5B35F5]/15'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <CustomerAvatar
                      name={c.customer_name}
                      avatar={c.customer_avatar}
                      channel={c.channel}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm truncate ${
                            hasUnread
                              ? 'font-bold text-slate-950 dark:text-white'
                              : 'font-semibold text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {c.customer_name}
                        </span>
                        <span
                          className={`text-[11px] tabular-nums shrink-0 ${
                            hasUnread
                              ? 'font-semibold text-[#5B35F5] dark:text-[#A78BFA]'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {formatListTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span
                          className={`text-xs truncate ${
                            hasUnread
                              ? 'font-semibold text-slate-800 dark:text-slate-200'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {c.last_message || (lang === 'bn' ? 'কথোপকথন শুরু হয়েছে' : 'Started conversation')}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {c.ai_enabled && (
                            <span title="AI Auto-Reply Active" className="text-[#5B35F5] dark:text-[#A78BFA]">
                              <Bot className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {hasUnread && (
                            <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#5B35F5] text-white text-[10px] font-bold tabular-nums inline-flex items-center justify-center">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* CENTER PANE: Active Messenger Chat Window */}
        <section
          className={`${
            selected ? 'flex' : 'hidden lg:flex'
          } flex-1 min-w-0 flex-col bg-white dark:bg-slate-900`}
        >
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3 bg-[#F8F9FC] dark:bg-slate-950/40">
              <div className="w-16 h-16 rounded-2xl bg-[#F3F0FF] dark:bg-[#5B35F5]/15 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
                <MessageCircle className="w-8 h-8" />
              </div>
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'একটি কথোপকথন নির্বাচন করুন' : 'Select a conversation'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                {lang === 'bn'
                  ? 'বাম পাশের তালিকা থেকে যেকোনো কাস্টমারের নামে ক্লিক করে মেসেঞ্জার চ্যাট খুলুন অথবা নতুন টেস্ট মেসেজ পাঠান।'
                  : 'Choose any customer from the left list to view messages, send photos or replies, or manage AI auto-reply.'}
              </p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <header className="px-3.5 sm:px-5 py-3 border-b border-[#E6E0FF] dark:border-slate-800 flex items-center justify-between gap-2 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setInfoDrawerOpen(false);
                    }}
                    aria-label="Back to conversations"
                    className="lg:hidden p-2 -ml-1 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 shrink-0"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <CustomerAvatar
                    name={selected.customer_name}
                    avatar={selected.customer_avatar}
                    channel={selected.channel}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-display font-bold text-slate-900 dark:text-white truncate">
                      {selected.customer_name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
                      <span>{channelLabel(selected.channel)}</span>
                      <span aria-hidden="true">·</span>
                      <span className={selected.ai_enabled ? 'text-[#5B35F5] dark:text-[#A78BFA] font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                        {selected.ai_enabled
                          ? lang === 'bn' ? 'AI অটো-রিপ্লাই চালু' : 'AI Active'
                          : lang === 'bn' ? 'ম্যানুয়াল মোড' : 'Human Takeover'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleToggleAi(selected)}
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors ${
                      selected.ai_enabled
                        ? 'border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                        : 'border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                    }`}
                  >
                    {selected.ai_enabled ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">
                      {selected.ai_enabled
                        ? lang === 'bn' ? 'AI থামান' : 'Pause AI'
                        : lang === 'bn' ? 'AI চালু করুন' : 'Resume AI'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInfoDrawerOpen((v) => !v)}
                    aria-label="Customer details"
                    title={lang === 'bn' ? 'কাস্টমার তথ্য' : 'Customer info'}
                    className={`p-2 rounded-xl border transition-colors ${
                      infoDrawerOpen
                        ? 'border-[#5B35F5] bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA]'
                        : 'border-[#E6E0FF] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                    }`}
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>
              </header>

              {/* Messages Thread */}
              <div className="flex-1 overflow-y-auto px-3.5 sm:px-5 py-4 space-y-3 bg-[#F8F9FC] dark:bg-slate-950/45">
                {loadingMessages && messages.length === 0 ? (
                  <div className="py-12 flex items-center justify-center text-xs text-slate-400 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#5B35F5]" />
                    <span>{lang === 'bn' ? 'মেসেজ লোড হচ্ছে...' : 'Loading messages...'}</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    {lang === 'bn' ? 'এই কথোপকথনে এখনো কোনো মেসেজ নেই।' : 'No messages in this conversation yet.'}
                  </div>
                ) : (
                  messages.map((m, idx) => {
                    const isOutbound = m.sender_type === 'ai' || m.sender_type === 'staff';
                    const isAi = m.sender_type === 'ai';
                    const prevSender = idx > 0 ? messages[idx - 1].sender_type : null;
                    const showSenderTag = prevSender !== m.sender_type;
                    const atts = m.attachments || [];

                    return (
                      <div key={m.id} className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                        {showSenderTag && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1 px-1 flex items-center gap-1">
                            {isAi && <Bot className="w-3 h-3 text-[#5B35F5] dark:text-[#A78BFA]" />}
                            {m.sender_type === 'staff' && <UserCheck className="w-3 h-3 text-emerald-500" />}
                            <span>
                              {isAi
                                ? 'BeXpar AI'
                                : m.sender_type === 'staff'
                                ? lang === 'bn' ? 'স্টাফ রিপ্লাই' : 'Staff'
                                : selected.customer_name}
                            </span>
                          </div>
                        )}

                        <div className={`flex items-end gap-2 max-w-[85%] sm:max-w-[74%] ${isOutbound ? 'flex-row-reverse' : 'flex-row'}`}>
                          {!isOutbound && (
                            <div className="shrink-0 mb-0.5 hidden sm:block">
                              <CustomerAvatar
                                name={selected.customer_name}
                                avatar={selected.customer_avatar}
                                channel={selected.channel}
                                size="sm"
                              />
                            </div>
                          )}

                          <div className={`space-y-1.5 ${isOutbound ? 'items-end' : 'items-start'} flex flex-col`}>
                            {/* Media & File Attachments */}
                            {atts.map((att) => {
                              const isImg = att.file_type === 'image' || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(att.file_url);
                              if (isImg) {
                                return (
                                  <button
                                    key={att.id || att.file_url}
                                    type="button"
                                    onClick={() => setLightboxImage({ url: att.file_url, name: att.file_name })}
                                    className="group relative overflow-hidden rounded-2xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B35F5]"
                                  >
                                    <img
                                      src={att.file_url}
                                      alt={att.file_name || 'Chat image'}
                                      referrerPolicy="no-referrer"
                                      className="max-w-[240px] sm:max-w-[280px] max-h-[280px] object-cover block group-hover:scale-[1.02] transition-transform duration-150"
                                    />
                                  </button>
                                );
                              }
                              return (
                                <a
                                  key={att.id || att.file_url}
                                  href={safeMediaUrl(att.file_url)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border text-xs font-medium transition-colors ${
                                    isOutbound
                                      ? 'bg-[#5B35F5]/95 border-[#5B35F5] text-white hover:bg-[#4924DE]'
                                      : 'bg-white dark:bg-slate-800 border-[#E6E0FF] dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                                >
                                  <FileText className="w-4 h-4 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="truncate max-w-[180px]">{att.file_name || 'File Attachment'}</div>
                                    {att.file_size ? (
                                      <div className="text-[10px] opacity-75">{formatFileSize(att.file_size)}</div>
                                    ) : null}
                                  </div>
                                  <Download className="w-3.5 h-3.5 shrink-0 opacity-80" />
                                </a>
                              );
                            })}

                            {/* Text Bubble */}
                            {m.content && (
                              <div
                                className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
                                  isAi
                                    ? 'bg-[#5B35F5] text-white rounded-br-md shadow-sm'
                                    : isOutbound
                                    ? 'bg-[#4338CA] dark:bg-[#5B35F5] text-white rounded-br-md shadow-sm'
                                    : 'bg-[#F0F2F5] dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-md border border-[#E6E0FF]/50 dark:border-slate-700/60'
                                }`}
                              >
                                {m.content}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Time & Seen / Delivered Status */}
                        <div className="mt-1 px-1 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                          <span>{formatMessageTime(m.created_at)}</span>
                          {isOutbound && (
                            <>
                              <span aria-hidden="true">·</span>
                              {renderDeliveryStatus(m)}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* AI Auto-Reply Diagnostic Banner */}
              {aiWarning && (
                <div className="px-3.5 sm:px-4 py-2 border-t border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/35 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200 min-w-0 flex-1">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <span className="break-words">{aiWarning}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void handleSendReply('ai')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#5B35F5] text-white font-semibold hover:bg-[#4924DE] disabled:opacity-50 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{lang === 'bn' ? 'AI দিয়ে উত্তর দিন' : 'Retry AI Reply'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiWarning('')}
                      aria-label="Dismiss AI warning"
                      className="p-1 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Pending Image / File Preview Before Sending */}
              {pendingAttachment && (
                <div className="px-4 py-2.5 border-t border-[#E6E0FF] dark:border-slate-800 bg-[#F3F0FF]/60 dark:bg-slate-950/60 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {pendingAttachment.type === 'image' && pendingAttachment.previewUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxImage({ url: pendingAttachment.previewUrl!, name: pendingAttachment.file.name })
                        }
                        className="w-14 h-14 rounded-xl overflow-hidden border border-[#E6E0FF] dark:border-slate-700 shrink-0 bg-white"
                      >
                        <img
                          src={pendingAttachment.previewUrl}
                          alt="Preview before send"
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-800 border border-[#E6E0FF] dark:border-slate-700 flex items-center justify-center text-[#5B35F5] shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {pendingAttachment.file.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatFileSize(pendingAttachment.file.size)} ·{' '}
                        {lang === 'bn' ? 'পাঠানোর জন্য প্রস্তুত' : 'Ready to send'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearPendingAttachment}
                    aria-label="Remove selected attachment"
                    className="p-2 rounded-xl text-slate-500 hover:bg-white dark:hover:bg-slate-800 hover:text-rose-600 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Messenger Composer Bar */}
              <div className="relative p-3 sm:px-4 border-t border-[#E6E0FF] dark:border-slate-800 bg-white dark:bg-slate-900">
                {/* Emoji Picker Popover */}
                {emojiOpen && (
                  <div className="absolute bottom-16 left-3 sm:left-4 z-20 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-700 rounded-2xl p-2.5 shadow-xl w-64">
                    <div className="grid grid-cols-6 gap-1">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="h-9 rounded-xl hover:bg-[#F3F0FF] dark:hover:bg-slate-800 text-lg flex items-center justify-center transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSelectFile(f, 'image');
                    e.target.value = '';
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.csv,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSelectFile(f, 'file');
                    e.target.value = '';
                  }}
                />

                <div className="flex items-end gap-1 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    title={lang === 'bn' ? 'ছবি পাঠান' : 'Send photo'}
                    aria-label="Attach image"
                    className="p-2 sm:p-2.5 rounded-full text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors shrink-0"
                  >
                    <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title={lang === 'bn' ? 'ফাইল যুক্ত করুন' : 'Attach file'}
                    aria-label="Attach file"
                    className="inline-flex p-2 sm:p-2.5 rounded-full text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors shrink-0"
                  >
                    <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmojiOpen((v) => !v)}
                    title={lang === 'bn' ? 'ইমোজি' : 'Emoji'}
                    aria-label="Insert emoji"
                    className={`p-2 sm:p-2.5 rounded-full transition-colors shrink-0 ${
                      emojiOpen
                        ? 'bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5]'
                        : 'text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800'
                    }`}
                  >
                    <Smile className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <textarea
                    ref={textInputRef}
                    rows={1}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onPaste={(e) => {
                      const imgItem = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
                      const pastedFile = imgItem?.getAsFile();
                      if (pastedFile) {
                        e.preventDefault();
                        handleSelectFile(pastedFile, 'image');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendReply('staff');
                      }
                    }}
                    placeholder={lang === 'bn' ? 'মেসেজ লিখুন (Aa)...' : 'Message (Aa)...'}
                    className="flex-1 min-w-0 px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F0F2F5] dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none max-h-28 focus:outline-none focus:border-[#5B35F5]"
                  />

                  <button
                    type="button"
                    onClick={() => void handleSendReply('ai')}
                    disabled={sending}
                    title={lang === 'bn' ? 'AI দিয়ে রিপ্লাই পাঠান' : 'Generate & send AI reply'}
                    className="px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-full border border-[#E6E0FF] dark:border-[#5B35F5]/40 bg-[#F3F0FF] dark:bg-[#5B35F5]/15 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/70 inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">AI</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSendReply('staff')}
                    disabled={sending || (!replyText.trim() && !pendingAttachment)}
                    aria-label="Send message"
                    className="p-2.5 rounded-full bg-[#5B35F5] text-white hover:bg-[#4924DE] disabled:opacity-45 transition-colors shrink-0"
                  >
                    {sending || uploadingMedia ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* RIGHT PANE: Collapsible Customer Profile & CRM Context */}
        {selected && infoDrawerOpen && (
          <aside className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[290px] xl:w-[310px] shrink-0 bg-black/40 lg:bg-transparent flex justify-end">
            <div className="w-[86%] max-w-[320px] lg:w-full h-full bg-white dark:bg-slate-900 border-l border-[#E6E0FF] dark:border-slate-800 p-4 overflow-y-auto space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'কাস্টমার প্রোফাইল' : 'Customer Profile'}
                </h3>
                <button
                  type="button"
                  onClick={() => setInfoDrawerOpen(false)}
                  aria-label="Close customer info"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col items-center text-center space-y-2 pb-4 border-b border-[#E6E0FF] dark:border-slate-800">
                <CustomerAvatar
                  name={selected.customer_name}
                  avatar={selected.customer_avatar}
                  channel={selected.channel}
                  size="lg"
                />
                <div className="text-sm font-display font-bold text-slate-900 dark:text-white">
                  {selected.customer_name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {channelLabel(selected.channel)}
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
                  <Phone className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                  <span>{selected.customer?.phone || (lang === 'bn' ? 'ফোন নম্বর এখনো যুক্ত হয়নি' : 'Not collected yet')}</span>
                </div>
                <div className="flex items-start gap-2 text-slate-600 dark:text-slate-300">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                  <span>{selected.customer?.address || (lang === 'bn' ? 'ঠিকানা এখনো যুক্ত হয়নি' : 'Not collected yet')}</span>
                </div>
              </div>

              <div className="border-t border-[#E6E0FF] dark:border-slate-800 pt-4 space-y-2">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {lang === 'bn' ? 'কথোপকথনের স্ট্যাটাস' : 'Conversation Status'}
                </label>
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

              <div className="border-t border-[#E6E0FF] dark:border-slate-800 pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {lang === 'bn' ? 'স্টাফ নোট' : 'Internal Staff Notes'}
                  </label>
                  {savingNotes && <span className="text-[11px] text-[#5B35F5]">Saving...</span>}
                </div>
                <textarea
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => void handleSaveNotes(notesDraft)}
                  placeholder={lang === 'bn' ? 'নোট লিখুন...' : 'Add internal staff notes...'}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/40 dark:bg-slate-950 text-xs"
                />
                <button
                  type="button"
                  disabled={savingNotes}
                  onClick={() => void handleSaveNotes(notesDraft)}
                  className="w-full py-2 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold hover:bg-[#E6E0FF]/70"
                >
                  {lang === 'bn' ? 'নোট সেভ করুন' : 'Save Notes'}
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Full-Screen Image Lightbox Viewer */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
        >
          <div
            className="w-full max-w-4xl flex items-center justify-between text-white mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs font-medium truncate opacity-90">{lightboxImage.name || 'Image'}</span>
            <div className="flex items-center gap-2">
              <a
                href={safeMediaUrl(lightboxImage.url)}
                target="_blank"
                rel="noopener noreferrer"
                download={lightboxImage.name || 'image'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </a>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                aria-label="Close image preview"
                className="p-2 rounded-xl bg-white/15 hover:bg-white/25"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <img
            src={lightboxImage.url}
            alt={lightboxImage.name || 'Full screen view'}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
