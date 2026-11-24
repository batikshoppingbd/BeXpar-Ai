import React, { useEffect, useState } from 'react';
import { Coins, Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch, formatMoney } from '../../../lib/api';
import type { Lang } from '../../../i18n/translations';
import { adminT } from '../adminI18n';
import { AdminModal, ConfirmDialog, EmptyState, PaginationBar, StatusBadge } from '../ui/AdminPrimitives';

interface CoinPackageRow {
  id: string;
  name: string;
  coin_amount: number;
  bonus_coins: number;
  price: number;
  currency: string;
  validity_days: number;
  description: string;
  status: 'active' | 'inactive' | 'archived';
  display_order: number;
}

interface CoinTxRow {
  id: string;
  business_id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
  business?: { id: string; name: string } | null;
}

export const CoinPackagesView: React.FC<{
  lang: Lang;
  globalSearch: string;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}> = ({ lang, globalSearch, onNotify, onError }) => {
  const [packages, setPackages] = useState<CoinPackageRow[]>([]);
  const [transactions, setTransactions] = useState<CoinTxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newPkg, setNewPkg] = useState({
    name: '',
    coin_amount: 1000,
    bonus_coins: 100,
    price: 350,
    validity_days: 365,
    description: '',
    display_order: 1,
  });
  const [editingPkg, setEditingPkg] = useState<CoinPackageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CoinPackageRow | null>(null);
  const [txFilter, setTxFilter] = useState('all');
  const [txPage, setTxPage] = useState(1);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ packages: CoinPackageRow[]; transactions: CoinTxRow[] }>('/api/admin/coin-packages');
      setPackages(res.packages || []);
      setTransactions(res.transactions || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load coin packages.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const q = globalSearch.trim().toLowerCase();
  const filteredTx = transactions.filter((tx) => {
    if (txFilter !== 'all' && tx.type !== txFilter) return false;
    if (q) {
      return (
        tx.description?.toLowerCase().includes(q) ||
        tx.business?.name?.toLowerCase().includes(q) ||
        tx.type?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pagedTx = filteredTx.slice((txPage - 1) * 10, txPage * 10);

  return (
    <div className="space-y-6">
      {/* Create Coin Package */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await apiFetch('/api/admin/coin-packages', {
              method: 'POST',
              body: JSON.stringify({ ...newPkg, currency: 'BDT', status: 'active' }),
            });
            setNewPkg({
              name: '',
              coin_amount: 1000,
              bonus_coins: 100,
              price: 350,
              validity_days: 365,
              description: '',
              display_order: packages.length + 1,
            });
            onNotify('Coin package created.');
            await load();
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to create package.');
          } finally {
            setSaving(false);
          }
        }}
        className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4"
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] flex items-center justify-center">
            <Plus className="w-4 h-4" />
          </div>
          <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
            {adminT(lang, 'createPackage')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          <div className="lg:col-span-2">
            <label className="block font-semibold text-[#7C8499] mb-1">Package Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Growth Coin Pack"
              value={newPkg.name}
              onChange={(e) => setNewPkg({ ...newPkg, name: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold text-[#7C8499] mb-1">Coins</label>
            <input
              type="number"
              min={1}
              required
              value={newPkg.coin_amount}
              onChange={(e) => setNewPkg({ ...newPkg, coin_amount: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold text-[#7C8499] mb-1">Bonus Coins</label>
            <input
              type="number"
              min={0}
              value={newPkg.bonus_coins}
              onChange={(e) => setNewPkg({ ...newPkg, bonus_coins: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold text-[#7C8499] mb-1">Price (BDT)</label>
            <input
              type="number"
              min={0}
              required
              value={newPkg.price}
              onChange={(e) => setNewPkg({ ...newPkg, price: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block font-semibold text-[#7C8499] mb-1">Validity (Days)</label>
            <input
              type="number"
              min={1}
              value={newPkg.validity_days}
              onChange={(e) => setNewPkg({ ...newPkg, validity_days: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Short package description..."
            value={newPkg.description}
            onChange={(e) => setNewPkg({ ...newPkg, description: e.target.value })}
            className="flex-1 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F8F9FC] dark:bg-slate-950 text-xs"
          />
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4520D9] text-white text-xs font-semibold shadow-sm transition-colors"
          >
            {adminT(lang, 'createPackage')}
          </button>
        </div>
      </form>

      {/* Packages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {packages.map((p) => (
          <div
            key={p.id}
            className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-col justify-between gap-4"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-[#F5A623] flex items-center justify-center">
                    <Coins className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-display font-bold text-[#101536] dark:text-white">{p.name}</h3>
                    <div className="text-[11px] text-[#7C8499]">Validity: {p.validity_days} days</div>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>

              <div className="pt-2 flex items-baseline justify-between">
                <div className="text-2xl font-display font-bold text-[#5B35F5] dark:text-[#A78BFA] tabular-nums">
                  {formatMoney(p.price)}
                </div>
                <div className="text-xs font-semibold text-[#101536] dark:text-slate-200 tabular-nums">
                  {p.coin_amount.toLocaleString()} + {p.bonus_coins} bonus
                </div>
              </div>
              {p.description && <p className="text-xs text-[#7C8499] dark:text-slate-400">{p.description}</p>}
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E6E0FF]/70 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingPkg({ ...p })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{adminT(lang, 'edit')}</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const next = p.status === 'active' ? 'inactive' : 'active';
                    await apiFetch(`/api/admin/coin-packages/${p.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ status: next }),
                    });
                    onNotify(`Package ${p.name} marked ${next}.`);
                    await load();
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold"
                >
                  {p.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(p)}
                className="p-1.5 rounded-lg text-[#EF4444] hover:bg-rose-50 dark:hover:bg-rose-950/30"
                title={adminT(lang, 'delete')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Coin Transaction History */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-base font-display font-bold text-[#101536] dark:text-white">
            {adminT(lang, 'coinTransactions')}
          </h2>
          <select
            value={txFilter}
            onChange={(e) => {
              setTxFilter(e.target.value);
              setTxPage(1);
            }}
            className="px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs w-fit"
          >
            <option value="all">All Types</option>
            <option value="purchase">Purchase</option>
            <option value="usage">AI Usage</option>
            <option value="admin_credit">Admin Credit</option>
            <option value="admin_debit">Admin Debit</option>
            <option value="subscription_grant">Subscription Grant</option>
            <option value="bonus">Bonus</option>
          </select>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="text-xs text-[#7C8499] py-6 text-center">{adminT(lang, 'loading')}</div>
        ) : pagedTx.length === 0 ? (
          <EmptyState title={adminT(lang, 'noData')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E6E0FF] dark:border-slate-800 text-[#7C8499]">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Business</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Balance After</th>
                    <th className="py-2.5 px-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E0FF]/50 dark:divide-slate-800">
                  {pagedTx.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap text-[#7C8499]">
                        {new Date(tx.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#101536] dark:text-white">
                        {tx.business?.name || tx.business_id.slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge status={tx.type} />
                      </td>
                      <td
                        className={`py-2.5 px-3 font-bold tabular-nums ${
                          Number(tx.amount) >= 0 ? 'text-[#16B66A]' : 'text-[#EF4444]'
                        }`}
                      >
                        {Number(tx.amount) >= 0 ? `+${Number(tx.amount).toFixed(2)}` : Number(tx.amount).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">{Number(tx.balance_after).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-[#7C8499] max-w-xs truncate">{tx.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar page={txPage} pageSize={10} total={filteredTx.length} onPageChange={setTxPage} />
          </>
        )}
      </div>

      {/* Edit Package Modal */}
      <AdminModal
        open={Boolean(editingPkg)}
        title="Edit Coin Package"
        subtitle={editingPkg?.name}
        onClose={() => setEditingPkg(null)}
      >
        {editingPkg && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await apiFetch(`/api/admin/coin-packages/${editingPkg.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: editingPkg.name,
                    coin_amount: Number(editingPkg.coin_amount),
                    bonus_coins: Number(editingPkg.bonus_coins),
                    price: Number(editingPkg.price),
                    validity_days: Number(editingPkg.validity_days),
                    description: editingPkg.description,
                    status: editingPkg.status,
                  }),
                });
                onNotify('Coin package updated.');
                setEditingPkg(null);
                await load();
              } catch (err) {
                onError(err instanceof Error ? err.message : 'Update failed.');
              } finally {
                setSaving(false);
              }
            }}
            className="space-y-3 text-xs"
          >
            <div>
              <label className="block font-semibold mb-1">Name</label>
              <input
                type="text"
                required
                value={editingPkg.name}
                onChange={(e) => setEditingPkg({ ...editingPkg, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Coins</label>
                <input
                  type="number"
                  min={1}
                  value={editingPkg.coin_amount}
                  onChange={(e) => setEditingPkg({ ...editingPkg, coin_amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Bonus Coins</label>
                <input
                  type="number"
                  min={0}
                  value={editingPkg.bonus_coins}
                  onChange={(e) => setEditingPkg({ ...editingPkg, bonus_coins: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Price (BDT)</label>
                <input
                  type="number"
                  min={0}
                  value={editingPkg.price}
                  onChange={(e) => setEditingPkg({ ...editingPkg, price: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={editingPkg.status}
                  onChange={(e) =>
                    setEditingPkg({ ...editingPkg, status: e.target.value as 'active' | 'inactive' | 'archived' })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Description</label>
              <input
                type="text"
                value={editingPkg.description}
                onChange={(e) => setEditingPkg({ ...editingPkg, description: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPkg(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 font-semibold"
              >
                {adminT(lang, 'cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white font-semibold"
              >
                {adminT(lang, 'saveChanges')}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.name || 'Package'}?`}
        message="This permanently removes the coin package if it has no recorded purchases."
        confirmLabel={adminT(lang, 'delete')}
        cancelLabel={adminT(lang, 'cancel')}
        tone="danger"
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setSaving(true);
          try {
            await apiFetch(`/api/admin/coin-packages/${deleteTarget.id}`, { method: 'DELETE' });
            onNotify('Coin package deleted.');
            setDeleteTarget(null);
            await load();
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Delete failed.');
            setDeleteTarget(null);
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
};
