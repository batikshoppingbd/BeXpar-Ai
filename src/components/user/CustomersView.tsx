import React, { useEffect, useState } from 'react';
import { Eye, Plus, Search, X } from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { Business, Customer, Order } from '../../types';
import type { Lang } from '../../i18n/translations';

interface CustomersViewProps {
  business: Business;
  lang: Lang;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ business, lang }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [history, setHistory] = useState<{ orders: Order[]; conversations: Array<{ id: string; channel: string; last_message: string; last_message_at: string }> }>({ orders: [], conversations: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [segment, setSegment] = useState('standard');

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ customers: Customer[] }>(`/api/businesses/${business.id}/customers`, {
        businessId: business.id,
      });
      setCustomers(res.customers);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCustomers();
  }, [business.id]);

  const openHistory = async (cust: Customer) => {
    setSelected(cust);
    const res = await apiFetch<{ orders: Order[]; conversations: Array<{ id: string; channel: string; last_message: string; last_message_at: string }> }>(
      `/api/businesses/${business.id}/customers/${cust.id}/history`,
      { businessId: business.id }
    );
    setHistory(res);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch(`/api/businesses/${business.id}/customers`, {
      method: 'POST',
      businessId: business.id,
      body: JSON.stringify({ name, phone, address, segment }),
    });
    setCreateOpen(false);
    setName('');
    setPhone('');
    setAddress('');
    void loadCustomers();
  };

  const filtered = customers.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'কাস্টমার CRM' : 'Customer CRM'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {lang === 'bn'
              ? 'কাস্টমার প্রোফাইল, রিপিট ক্রেতা ট্র্যাকিং, অর্ডার ইতিহাস এবং নোট।'
              : 'Customer profiles, repeat buyer tracking, purchase history, and notes.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'bn' ? 'কাস্টমার যোগ করুন' : 'Add Customer'}</span>
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === 'bn' ? 'কাস্টমারের নাম বা ফোন দিয়ে খুঁজুন...' : 'Search by customer name or phone...'}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:border-[#5B35F5]"
        />
      </div>

      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl overflow-x-auto bx-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F9F7FF] dark:bg-slate-950/60 border-b border-[#E6E0FF] dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-3.5 px-4 font-semibold">Customer</th>
              <th className="py-3.5 px-4 font-semibold">Phone</th>
              <th className="py-3.5 px-4 font-semibold">Segment</th>
              <th className="py-3.5 px-4 font-semibold text-right">Orders</th>
              <th className="py-3.5 px-4 font-semibold text-right">Total Spent</th>
              <th className="py-3.5 px-4 font-semibold text-right">Profile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                  Loading customers...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                  No customers yet.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="hover:bg-[#F3F0FF]/50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                    <div className="text-xs text-slate-400 truncate max-w-xs">{c.address}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">{c.phone || '—'}</td>
                  <td className="py-3 px-4 text-xs capitalize">
                    {c.total_orders > 1 ? 'Repeat Buyer' : c.segment}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-mono">{c.total_orders}</td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold">{formatMoney(c.total_spent)}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => void openHistory(c)}
                      className="p-1.5 rounded-xl hover:bg-[#F3F0FF] dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-display font-bold">{selected.name}</h2>
                <p className="text-xs text-slate-500 font-mono">{selected.phone} · {selected.address}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="p-1.5 rounded-xl text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">CRM Notes</label>
              <textarea
                rows={2}
                defaultValue={selected.notes}
                onBlur={async (e) => {
                  await apiFetch(`/api/businesses/${business.id}/customers/${selected.id}`, {
                    method: 'PATCH',
                    businessId: business.id,
                    body: JSON.stringify({ notes: e.target.value }),
                  });
                }}
                className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F9F7FF] dark:bg-slate-950 text-xs"
              />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">Previous Orders ({history.orders.length})</h3>
              <div className="max-h-48 overflow-y-auto divide-y divide-[#E6E0FF]/60 dark:divide-slate-800 border border-[#E6E0FF] dark:border-slate-800 rounded-xl">
                {history.orders.length === 0 ? (
                  <p className="p-3 text-xs text-slate-400">No orders yet.</p>
                ) : (
                  history.orders.map((o) => (
                    <div key={o.id} className="p-2.5 flex items-center justify-between text-xs">
                      <span className="font-mono text-[#5B35F5] dark:text-[#A78BFA] font-medium">{o.order_number}</span>
                      <span className="capitalize">{o.order_status}</span>
                      <span className="font-semibold tabular-nums">{formatMoney(o.total_amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-display font-bold">Add Customer</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <input type="text" required placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <input type="tel" required placeholder="Phone Number" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <input type="text" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <select value={segment} onChange={(e) => setSegment(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
                <option value="standard">Standard</option>
                <option value="vip">VIP</option>
                <option value="wholesale">Wholesale</option>
              </select>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-sm font-semibold shadow-sm shadow-[#5B35F5]/20">
                Save Customer
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
