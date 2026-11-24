import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Coins,
  Edit3,
  Eye,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import type { AdminBusinessRecord, AdminUserRecord } from '../adminTypes';
import {
  AdminModal,
  ConfirmDialog,
  EmptyState,
  PaginationBar,
  StatusBadge,
} from '../ui/AdminPrimitives';

interface BusinessSummary {
  ordersCount: number;
  productsCount: number;
  customersCount: number;
  aiRequestsCount: number;
  recentOrders: Array<{
    id: string;
    order_number: string;
    customer_name: string;
    total_amount: number;
    order_status: string;
    created_at: string;
  }>;
  plans: Array<{ id: string; name: string; slug: string; duration_days: number }>;
}

export const UsersBusinessesView: React.FC<{
  lang: Lang;
  globalSearch: string;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ lang, globalSearch, onNotify, onError }) => {
  const [subTab, setSubTab] = useState<'businesses' | 'users'>('businesses');
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [businesses, setBusinesses] = useState<AdminBusinessRecord[]>([]);
  const [plans, setPlans] = useState<Array<{ id: string; name: string; slug: string; duration_days: number }>>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Modals & Drawers
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [editUserForm, setEditUserForm] = useState<AdminUserRecord | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<AdminBusinessRecord | null>(null);
  const [bizSummary, setBizSummary] = useState<BusinessSummary | null>(null);
  const [editBizForm, setEditBizForm] = useState<AdminBusinessRecord | null>(null);

  const [coinTarget, setCoinTarget] = useState<AdminBusinessRecord | null>(null);
  const [coinMode, setCoinMode] = useState<'credit' | 'debit'>('credit');
  const [coinAmount, setCoinAmount] = useState('500');
  const [coinReason, setCoinReason] = useState('');

  const [planTarget, setPlanTarget] = useState<AdminBusinessRecord | null>(null);
  const [planId, setPlanId] = useState('');
  const [extraDays, setExtraDays] = useState('30');
  const [subStatus, setSubStatus] = useState('active');

  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    tone: 'danger' | 'primary';
    run: () => Promise<void>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, pRes] = await Promise.all([
        apiFetch<{ users: AdminUserRecord[]; businesses: AdminBusinessRecord[] }>('/api/admin/users'),
        apiFetch<{ plans: Array<{ id: string; name: string; slug: string; duration_days: number }> }>(
          '/api/admin/subscription-plans'
        ),
      ]);
      setUsers(uRes.users || []);
      setBusinesses(uRes.businesses || []);
      setPlans(pRes.plans || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load users & businesses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [subTab, search, globalSearch, statusFilter, roleFilter, sortBy]);

  const effectiveSearch = (search || globalSearch).trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    return users
      .filter((u) => {
        if (statusFilter !== 'all' && u.status !== statusFilter) return false;
        if (roleFilter !== 'all' && u.role !== roleFilter) return false;
        if (effectiveSearch) {
          return (
            u.full_name?.toLowerCase().includes(effectiveSearch) ||
            u.email?.toLowerCase().includes(effectiveSearch) ||
            u.phone?.toLowerCase().includes(effectiveSearch)
          );
        }
        return true;
      })
      .sort((a, b) =>
        sortBy === 'name'
          ? (a.full_name || a.email).localeCompare(b.full_name || b.email)
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [users, statusFilter, roleFilter, effectiveSearch, sortBy]);

  const filteredBusinesses = useMemo(() => {
    return businesses
      .filter((b) => {
        if (statusFilter !== 'all' && b.status !== statusFilter) return false;
        if (effectiveSearch) {
          return (
            b.name?.toLowerCase().includes(effectiveSearch) ||
            b.owner_name?.toLowerCase().includes(effectiveSearch) ||
            b.email?.toLowerCase().includes(effectiveSearch) ||
            b.category?.toLowerCase().includes(effectiveSearch)
          );
        }
        return true;
      })
      .sort((a, b) =>
        sortBy === 'name'
          ? a.name.localeCompare(b.name)
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [businesses, statusFilter, effectiveSearch, sortBy]);

  const pagedUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);
  const pagedBusinesses = filteredBusinesses.slice((page - 1) * pageSize, page * pageSize);

  const openBusinessDetails = async (biz: AdminBusinessRecord) => {
    setSelectedBiz(biz);
    setBizSummary(null);
    try {
      const summary = await apiFetch<BusinessSummary>(`/api/admin/businesses/${biz.id}/summary`);
      setBizSummary(summary);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load business overview.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-2 p-1 rounded-xl bg-[#F3F0FF] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 w-fit">
            <button
              type="button"
              onClick={() => setSubTab('businesses')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                subTab === 'businesses'
                  ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-xs'
                  : 'text-[#7C8499] dark:text-slate-400'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>
                {adminT(lang, 'businessesTab')} ({businesses.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('users')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                subTab === 'users'
                  ? 'bg-white dark:bg-slate-800 text-[#5B35F5] dark:text-white shadow-xs'
                  : 'text-[#7C8499] dark:text-slate-400'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>
                {adminT(lang, 'usersTab')} ({users.length})
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 w-fit"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{adminT(lang, 'refresh')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-[#7C8499] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={adminT(lang, 'searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs focus:outline-none focus:border-[#5B35F5]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
          >
            <option value="all">{lang === 'bn' ? 'সকল স্ট্যাটাস' : 'All Statuses'}</option>
            <option value="active">{adminT(lang, 'active')}</option>
            <option value="suspended">{adminT(lang, 'suspended')}</option>
            <option value="inactive">{adminT(lang, 'inactive')}</option>
          </select>
          {subTab === 'users' ? (
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="all">{lang === 'bn' ? 'সকল রোল' : 'All Roles'}</option>
              <option value="super_admin">Super Admin</option>
              <option value="business_owner">Business Owner</option>
              <option value="business_admin">Business Admin</option>
              <option value="business_staff">Business Staff</option>
              <option value="support_staff">Support Staff</option>
            </select>
          ) : (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'newest' | 'name')}
              className="px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            >
              <option value="newest">{lang === 'bn' ? 'সর্বশেষ তৈরি' : 'Newest First'}</option>
              <option value="name">{lang === 'bn' ? 'নাম অনুসারে (A-Z)' : 'Name (A-Z)'}</option>
            </select>
          )}
        </div>
      </div>

      {/* Businesses Table (Desktop) + Cards (Mobile) */}
      {subTab === 'businesses' && (
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 md:p-5 bx-card">
          {pagedBusinesses.length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499] dark:text-slate-400">
                    <tr>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'বিজনেস' : 'Business'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'প্ল্যান ও মেয়াদ' : 'Plan'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'AI কয়েন ব্যালেন্স' : 'Coin Wallet'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'অর্ডার / পণ্য' : 'Orders / Products'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
                      <th className="py-3 px-3 font-semibold text-right">{lang === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                    {pagedBusinesses.map((b) => (
                      <tr key={b.id} className="hover:bg-[#F3F0FF]/35 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[#101536] dark:text-white">{b.name}</div>
                          <div className="text-[11px] text-[#7C8499] dark:text-slate-400">
                            {b.owner_name} · {b.email}
                          </div>
                          <div className="text-[10px] text-[#7C8499] dark:text-slate-500">{b.category}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[#5B35F5] dark:text-[#A78BFA]">
                            {b.subscription_plan?.name || 'Free'}
                          </div>
                          <div className="text-[11px] text-[#7C8499] dark:text-slate-400 capitalize">
                            {b.subscription_status}
                            {b.subscription_expires_at
                              ? ` · ${new Date(b.subscription_expires_at).toLocaleDateString()}`
                              : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3 tabular-nums">
                          <div className="font-bold text-[#101536] dark:text-white">
                            {Number(b.wallet?.balance || 0).toFixed(2)}
                          </div>
                          <div className="text-[10px] text-[#7C8499] dark:text-slate-400">
                            Used: {Number(b.wallet?.total_used || 0).toFixed(0)}
                          </div>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-[#101536] dark:text-slate-200">
                          {b.ordersCount || 0} / {b.productsCount || 0}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void openBusinessDetails(b)}
                              className="p-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] hover:opacity-85"
                              title={adminT(lang, 'viewDetails')}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditBizForm({ ...b })}
                              className="p-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                              title={adminT(lang, 'edit')}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCoinTarget(b);
                                setCoinMode('credit');
                                setCoinAmount('500');
                                setCoinReason('');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-[#5B35F5] text-white text-[11px] font-semibold hover:bg-[#4520D9]"
                            >
                              {adminT(lang, 'adjustCoins')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPlanTarget(b);
                                setPlanId(b.subscription_plan_id || plans[0]?.id || '');
                                setExtraDays('30');
                                setSubStatus('active');
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-[11px] font-semibold text-[#101536] dark:text-slate-200 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
                            >
                              {adminT(lang, 'changePlan')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = b.status === 'active' ? 'suspended' : 'active';
                                setConfirmAction({
                                  title: `${next === 'suspended' ? adminT(lang, 'suspend') : adminT(lang, 'activate')} ${b.name}`,
                                  message:
                                    next === 'suspended'
                                      ? 'Suspending this business immediately blocks workspace API access and mini storefront orders.'
                                      : 'Reactivate this business workspace and storefront.',
                                  tone: next === 'suspended' ? 'danger' : 'primary',
                                  run: async () => {
                                    await apiFetch(`/api/admin/businesses/${b.id}`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ status: next }),
                                    });
                                    onNotify(`Business ${b.name} set to ${next}.`);
                                    await loadData();
                                  },
                                });
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                                b.status === 'active'
                                  ? 'bg-rose-50 text-[#EF4444] dark:bg-rose-950/40'
                                  : 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/40'
                              }`}
                            >
                              {b.status === 'active' ? adminT(lang, 'suspend') : adminT(lang, 'activate')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="lg:hidden space-y-3">
                {pagedBusinesses.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-2xl border border-[#E6E0FF] dark:border-slate-800 p-4 space-y-3 bg-[#F8F9FC]/60 dark:bg-slate-950/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#101536] dark:text-white truncate">{b.name}</div>
                        <div className="text-xs text-[#7C8499] truncate">
                          {b.owner_name} · {b.category}
                        </div>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6E0FF]/60 dark:border-slate-800">
                        <div className="text-[10px] text-[#7C8499]">Plan</div>
                        <div className="font-semibold text-[#5B35F5]">{b.subscription_plan?.name || 'Free'}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6E0FF]/60 dark:border-slate-800">
                        <div className="text-[10px] text-[#7C8499]">Coins</div>
                        <div className="font-bold tabular-nums">{Number(b.wallet?.balance || 0).toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void openBusinessDetails(b)}
                        className="px-3 py-1.5 rounded-xl bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] text-xs font-semibold"
                      >
                        {adminT(lang, 'viewDetails')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCoinTarget(b);
                          setCoinMode('credit');
                          setCoinAmount('500');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold"
                      >
                        {adminT(lang, 'adjustCoins')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanTarget(b);
                          setPlanId(b.subscription_plan_id || plans[0]?.id || '');
                        }}
                        className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold"
                      >
                        {adminT(lang, 'changePlan')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <PaginationBar
                page={page}
                pageSize={pageSize}
                total={filteredBusinesses.length}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}

      {/* Users Table (Desktop) + Cards (Mobile) */}
      {subTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 md:p-5 bx-card">
          {pagedUsers.length === 0 ? (
            <EmptyState title={adminT(lang, 'noData')} />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499] dark:text-slate-400">
                    <tr>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'ইউজার' : 'User'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'রোল' : 'Role'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'যোগদান' : 'Registered'}</th>
                      <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
                      <th className="py-3 px-3 font-semibold text-right">{lang === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                    {pagedUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#F3F0FF]/35 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[#101536] dark:text-white">{u.full_name || '—'}</div>
                          <div className="text-[11px] text-[#7C8499] dark:text-slate-400">{u.email}</div>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={u.role} />
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#7C8499]">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge status={u.status} />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedUser(u)}
                              className="p-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                              title={adminT(lang, 'viewDetails')}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditUserForm({ ...u })}
                              className="p-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-slate-600 dark:text-slate-300"
                              title={adminT(lang, 'edit')}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = u.status === 'active' ? 'suspended' : 'active';
                                setConfirmAction({
                                  title: `${next === 'suspended' ? adminT(lang, 'suspend') : adminT(lang, 'activate')} ${u.email}`,
                                  message:
                                    next === 'suspended'
                                      ? 'This user will immediately be blocked from authenticating with BeXpar Ai APIs.'
                                      : 'Restore active account access for this user.',
                                  tone: next === 'suspended' ? 'danger' : 'primary',
                                  run: async () => {
                                    await apiFetch(`/api/admin/users/${u.id}/status`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ status: next }),
                                    });
                                    onNotify(`User ${u.email} updated to ${next}.`);
                                    await loadData();
                                  },
                                });
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${
                                u.status === 'active'
                                  ? 'bg-rose-50 text-[#EF4444] dark:bg-rose-950/40'
                                  : 'bg-emerald-50 text-[#16B66A] dark:bg-emerald-950/40'
                              }`}
                            >
                              {u.status === 'active' ? adminT(lang, 'suspend') : adminT(lang, 'activate')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile User Cards */}
              <div className="lg:hidden space-y-3">
                {pagedUsers.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-2xl border border-[#E6E0FF] dark:border-slate-800 p-4 space-y-2.5 bg-[#F8F9FC]/60 dark:bg-slate-950/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#101536] dark:text-white truncate">
                          {u.full_name || u.email}
                        </div>
                        <div className="text-xs text-[#7C8499] truncate">{u.email}</div>
                      </div>
                      <StatusBadge status={u.status} />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <StatusBadge status={u.role} />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedUser(u)}
                          className="px-2.5 py-1 rounded-lg bg-[#F3F0FF] text-[#5B35F5] font-semibold"
                        >
                          {adminT(lang, 'viewDetails')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditUserForm({ ...u })}
                          className="px-2.5 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-700 font-semibold"
                        >
                          {adminT(lang, 'edit')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <PaginationBar page={page} pageSize={pageSize} total={filteredUsers.length} onPageChange={setPage} />
            </>
          )}
        </div>
      )}

      {/* User Details Modal */}
      <AdminModal
        open={Boolean(selectedUser)}
        title={selectedUser?.full_name || selectedUser?.email || 'User Details'}
        subtitle={selectedUser?.email}
        onClose={() => setSelectedUser(null)}
      >
        {selectedUser && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950">
                <div className="text-[#7C8499]">Role</div>
                <div className="mt-1">
                  <StatusBadge status={selectedUser.role} />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950">
                <div className="text-[#7C8499]">Status</div>
                <div className="mt-1">
                  <StatusBadge status={selectedUser.status} />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950">
                <div className="text-[#7C8499]">Phone</div>
                <div className="mt-1 font-semibold">{selectedUser.phone || '—'}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8F9FC] dark:bg-slate-950">
                <div className="text-[#7C8499]">Joined</div>
                <div className="mt-1 font-mono">{new Date(selectedUser.created_at).toLocaleString()}</div>
              </div>
            </div>
            <div>
              <div className="font-semibold text-[#101536] dark:text-white mb-2">Owned Businesses</div>
              {businesses.filter((b) => b.owner_id === selectedUser.id).length === 0 ? (
                <div className="text-[#7C8499]">No businesses owned by this user.</div>
              ) : (
                <div className="space-y-2">
                  {businesses
                    .filter((b) => b.owner_id === selectedUser.id)
                    .map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl border border-[#E6E0FF] dark:border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold">{b.name}</div>
                          <div className="text-[11px] text-[#7C8499]">{b.category}</div>
                        </div>
                        <StatusBadge status={b.status} />
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </AdminModal>

      {/* Edit User Modal */}
      <AdminModal
        open={Boolean(editUserForm)}
        title="Edit User Account"
        subtitle={editUserForm?.email}
        onClose={() => setEditUserForm(null)}
      >
        {editUserForm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                await apiFetch(`/api/admin/users/${editUserForm.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    full_name: editUserForm.full_name,
                    phone: editUserForm.phone,
                    role: editUserForm.role,
                    status: editUserForm.status,
                  }),
                });
                onNotify('User profile updated.');
                setEditUserForm(null);
                await loadData();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Update failed.');
              } finally {
                setSubmitting(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="block font-semibold mb-1">Full Name</label>
              <input
                type="text"
                value={editUserForm.full_name}
                onChange={(e) => setEditUserForm({ ...editUserForm, full_name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Phone</label>
              <input
                type="text"
                value={editUserForm.phone || ''}
                onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Role</label>
                <select
                  value={editUserForm.role}
                  onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="business_owner">Business Owner</option>
                  <option value="business_admin">Business Admin</option>
                  <option value="business_staff">Business Staff</option>
                  <option value="support_staff">Support Staff</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={editUserForm.status}
                  onChange={(e) => setEditUserForm({ ...editUserForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditUserForm(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold"
              >
                {adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      {/* Business Details Modal */}
      <AdminModal
        open={Boolean(selectedBiz)}
        title={selectedBiz?.name || 'Business Overview'}
        subtitle={selectedBiz ? `${selectedBiz.owner_name} · ${selectedBiz.category}` : ''}
        onClose={() => setSelectedBiz(null)}
        maxWidthClass="max-w-2xl"
      >
        {selectedBiz && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Orders', bizSummary?.ordersCount ?? '—'],
                ['Products', bizSummary?.productsCount ?? '—'],
                ['Customers', bizSummary?.customersCount ?? '—'],
                ['AI Requests', bizSummary?.aiRequestsCount ?? '—'],
              ].map(([k, v]) => (
                <div key={String(k)} className="p-3 rounded-xl bg-[#F3F0FF] dark:bg-slate-950">
                  <div className="text-[#7C8499]">{k}</div>
                  <div className="text-lg font-display font-bold text-[#101536] dark:text-white tabular-nums mt-0.5">
                    {v}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-[#E6E0FF] dark:border-slate-800">
              <div>
                <span className="text-[#7C8499]">Email:</span>{' '}
                <span className="font-semibold">{selectedBiz.email}</span>
              </div>
              <div>
                <span className="text-[#7C8499]">Phone:</span>{' '}
                <span className="font-semibold">{selectedBiz.phone || '—'}</span>
              </div>
              <div>
                <span className="text-[#7C8499]">Coin Balance:</span>{' '}
                <span className="font-bold text-[#5B35F5] tabular-nums">
                  {Number(selectedBiz.wallet?.balance || 0).toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[#7C8499]">Plan:</span>{' '}
                <span className="font-semibold">{selectedBiz.subscription_plan?.name || 'Free'}</span>
              </div>
            </div>

            {bizSummary && bizSummary.recentOrders.length > 0 && (
              <div>
                <div className="font-semibold mb-2">Recent Orders</div>
                <div className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 border border-[#E6E0FF] dark:border-slate-800 rounded-xl">
                  {bizSummary.recentOrders.map((o) => (
                    <div key={o.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold">#{o.order_number}</span> · {o.customer_name}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">{formatMoney(o.total_amount)}</span>
                        <StatusBadge status={o.order_status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </AdminModal>

      {/* Edit Business Modal */}
      <AdminModal
        open={Boolean(editBizForm)}
        title="Edit Business Details"
        subtitle={editBizForm?.name}
        onClose={() => setEditBizForm(null)}
      >
        {editBizForm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                await apiFetch(`/api/admin/businesses/${editBizForm.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: editBizForm.name,
                    owner_name: editBizForm.owner_name,
                    email: editBizForm.email,
                    phone: editBizForm.phone,
                    category: editBizForm.category,
                    address: editBizForm.address,
                    status: editBizForm.status,
                  }),
                });
                onNotify('Business record updated.');
                setEditBizForm(null);
                await loadData();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Failed to update business.');
              } finally {
                setSubmitting(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Business Name</label>
                <input
                  type="text"
                  required
                  value={editBizForm.name}
                  onChange={(e) => setEditBizForm({ ...editBizForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Owner Name</label>
                <input
                  type="text"
                  value={editBizForm.owner_name}
                  onChange={(e) => setEditBizForm({ ...editBizForm, owner_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Category</label>
                <input
                  type="text"
                  value={editBizForm.category}
                  onChange={(e) => setEditBizForm({ ...editBizForm, category: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={editBizForm.status}
                  onChange={(e) => setEditBizForm({ ...editBizForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Address</label>
              <input
                type="text"
                value={editBizForm.address || ''}
                onChange={(e) => setEditBizForm({ ...editBizForm, address: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditBizForm(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold"
              >
                {adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      {/* Adjust AI Coins Modal */}
      <AdminModal
        open={Boolean(coinTarget)}
        title={adminT(lang, 'adjustCoins')}
        subtitle={coinTarget?.name}
        onClose={() => setCoinTarget(null)}
      >
        {coinTarget && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                await apiFetch(`/api/admin/businesses/${coinTarget.id}/coins`, {
                  method: 'POST',
                  body: JSON.stringify({ amount: Number(coinAmount), mode: coinMode, reason: coinReason }),
                });
                onNotify(`AI coin wallet updated for ${coinTarget.name}.`);
                setCoinTarget(null);
                await loadData();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Coin adjustment failed.');
              } finally {
                setSubmitting(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div className="p-3 rounded-xl bg-[#F3F0FF] dark:bg-slate-950 flex items-center justify-between">
              <span className="text-[#7C8499]">Current Balance</span>
              <span className="font-bold text-[#5B35F5] tabular-nums">
                {Number(coinTarget.wallet?.balance || 0).toFixed(2)} Coins
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Action</label>
                <select
                  value={coinMode}
                  onChange={(e) => setCoinMode(e.target.value as 'credit' | 'debit')}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="credit">Credit (+ Add Coins)</option>
                  <option value="debit">Debit (- Deduct Coins)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Coin Amount</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={coinAmount}
                  onChange={(e) => setCoinAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Reason / Audit Note</label>
              <input
                type="text"
                placeholder="Promotional bonus, billing adjustment, etc."
                value={coinReason}
                onChange={(e) => setCoinReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCoinTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold"
              >
                <Coins className="w-3.5 h-3.5 inline mr-1" />
                {adminT(lang, 'confirm')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      {/* Change Subscription Plan Modal */}
      <AdminModal
        open={Boolean(planTarget)}
        title={adminT(lang, 'changePlan')}
        subtitle={planTarget?.name}
        onClose={() => setPlanTarget(null)}
      >
        {planTarget && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitting(true);
              try {
                await apiFetch(`/api/admin/businesses/${planTarget.id}/subscription`, {
                  method: 'POST',
                  body: JSON.stringify({
                    plan_id: planId || undefined,
                    extra_days: Number(extraDays || 30),
                    status: subStatus,
                  }),
                });
                onNotify(`Subscription updated for ${planTarget.name}.`);
                setPlanTarget(null);
                await loadData();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Subscription update failed.');
              } finally {
                setSubmitting(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="block font-semibold mb-1">Subscription Plan</label>
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Extend Days</label>
                <input
                  type="number"
                  min={1}
                  value={extraDays}
                  onChange={(e) => setExtraDays(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Subscription Status</label>
                <select
                  value={subStatus}
                  onChange={(e) => setSubStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPlanTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold"
              >
                <Layers className="w-3.5 h-3.5 inline mr-1" />
                {adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        message={confirmAction?.message || ''}
        tone={confirmAction?.tone || 'danger'}
        confirmLabel={adminT(lang, 'confirm')}
        cancelLabel={adminT(lang, 'cancel')}
        loading={submitting}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!confirmAction) return;
          setSubmitting(true);
          try {
            await confirmAction.run();
            setConfirmAction(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Action failed.');
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </div>
  );
};
