import React, { useEffect, useState } from 'react';
import { Download, Eye, Loader2, Plus, Printer, Search, ShieldAlert, Truck, X } from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { Business, Order, Product } from '../../types';
import type { Lang } from '../../i18n/translations';

interface OrdersViewProps {
  business: Business;
  lang: Lang;
}

const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
  'refunded',
] as const;

export const OrdersView: React.FC<OrdersViewProps> = ({ business, lang }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [error, setError] = useState('');

  // Manual order form
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [qty, setQty] = useState(1);
  const [deliveryCharge, setDeliveryCharge] = useState(60);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const [ordRes, prodRes] = await Promise.all([
        apiFetch<{ orders: Order[] }>(`/api/businesses/${business.id}/orders`, { businessId: business.id }),
        apiFetch<{ products: Product[] }>(`/api/businesses/${business.id}/products`, { businessId: business.id }),
      ]);
      setOrders(ordRes.orders);
      setProducts(prodRes.products);
      if (selectedOrder) {
        const ref = ordRes.orders.find((o) => o.id === selectedOrder.id);
        if (ref) setSelectedOrder(ref);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, [business.id]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const prod = products.find((p) => p.id === selectedProdId);
      await apiFetch(`/api/businesses/${business.id}/orders`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          customer_name: cName,
          customer_phone: cPhone,
          customer_address: cAddress,
          delivery_charge: Number(deliveryCharge),
          order_source: 'manual',
          items: [
            {
              product_id: prod?.id,
              product_name: prod?.name || 'Custom Item',
              quantity: Number(qty),
              unit_price: prod ? Number(prod.discount_price ?? prod.regular_price) : 0,
            },
          ],
        }),
      });
      setCreateOpen(false);
      setCName('');
      setCPhone('');
      setCAddress('');
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order creation failed.');
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      await apiFetch(`/api/businesses/${business.id}/orders/${orderId}/status`, {
        method: 'PATCH',
        businessId: business.id,
        body: JSON.stringify({ order_status: newStatus }),
      });
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const handleBookCourier = async (orderId: string, provider: 'steadfast' | 'pathao') => {
    setBookingLoading(true);
    setError('');
    try {
      await apiFetch(`/api/businesses/${business.id}/orders/${orderId}/book-courier`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({ provider }),
      });
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Courier booking failed.');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleExportCsv = () => {
    const header = ['Order Number', 'Customer', 'Phone', 'Address', 'Total', 'Status', 'Risk', 'Courier', 'Tracking ID', 'Created At'];
    const rows = filtered.map((o) => [
      o.order_number,
      `"${o.customer_name.replace(/"/g, '""')}"`,
      o.customer_phone,
      `"${o.customer_address.replace(/"/g, '""')}"`,
      o.total_amount,
      o.order_status,
      o.risk_level,
      o.courier_name || '',
      o.tracking_id || '',
      o.created_at,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bexpar-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handlePrintInvoice = (order: Order) => {
    const html = `
      <!doctype html>
      <html><head><title>Invoice ${order.order_number}</title>
      <style>body{font-family:sans-serif;padding:32px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left}th{font-size:12px;color:#64748b}</style>
      </head><body>
      <h2>${business.name} — Invoice</h2>
      <p><strong>Order:</strong> ${order.order_number}<br/><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
      <p><strong>Customer:</strong> ${order.customer_name} (${order.customer_phone})<br/><strong>Address:</strong> ${order.customer_address}</p>
      <table><thead><tr><th>Item</th><th>Variant</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>
      ${(order.items || [])
        .map(
          (i) =>
            `<tr><td>${i.product_name}</td><td>${[i.variant_color, i.variant_size].filter(Boolean).join('/')}</td><td>${i.quantity}</td><td>${i.unit_price}</td><td>${i.total_price}</td></tr>`
        )
        .join('')}
      </tbody></table>
      <p style="text-align:right;margin-top:20px;">Subtotal: ${order.subtotal} · Delivery: ${order.delivery_charge} · <strong>Total: ${order.total_amount} BDT</strong></p>
      </body></html>
    `;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => {
      iframe.remove();
    }, 1500);
  };

  const filtered = orders.filter((o) => {
    if (statusFilter !== 'all' && o.order_status !== statusFilter) return false;
    if (
      search &&
      !o.order_number.toLowerCase().includes(search.toLowerCase()) &&
      !o.customer_name.toLowerCase().includes(search.toLowerCase()) &&
      !o.customer_phone.includes(search)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'অর্ডার ম্যানেজমেন্ট ও রিস্ক অ্যানালাইসিস' : 'Orders & Risk Management'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage AI-collected and manual orders, risk checks, invoices, and courier bookings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE] shadow-sm shadow-[#5B35F5]/20"
          >
            <Plus className="w-4 h-4" />
            <span>Manual Order</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3.5 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, name, phone..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
        >
          <option value="all">All Statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F9F7FF] dark:bg-slate-950/60 border-b border-[#E6E0FF] dark:border-slate-800 text-xs text-slate-500">
            <tr>
              <th className="py-3.5 px-4 font-semibold">Order</th>
              <th className="py-3.5 px-4 font-semibold">Customer</th>
              <th className="py-3.5 px-4 font-semibold">Source</th>
              <th className="py-3.5 px-4 font-semibold">Risk</th>
              <th className="py-3.5 px-4 font-semibold text-right">Total</th>
              <th className="py-3.5 px-4 font-semibold">Status</th>
              <th className="py-3.5 px-4 font-semibold">Courier</th>
              <th className="py-3.5 px-4 font-semibold text-right">View</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs text-slate-400">
                  Loading orders...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                  No orders found.
                </td>
              </tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{o.order_number}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{new Date(o.created_at).toLocaleDateString()}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-white">{o.customer_name}</div>
                    <div className="text-xs text-slate-500 font-mono">{o.customer_phone}</div>
                  </td>
                  <td className="py-3 px-4 text-xs capitalize text-slate-600 dark:text-slate-300">{o.order_source.replace('_', ' ')}</td>
                  <td className="py-3 px-4 text-xs capitalize">
                    <span
                      className={
                        o.risk_level === 'high'
                          ? 'text-rose-600 font-semibold'
                          : o.risk_level === 'medium'
                          ? 'text-amber-600 font-semibold'
                          : 'text-emerald-600'
                      }
                    >
                      {o.risk_level} risk
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums">{formatMoney(o.total_amount)}</td>
                  <td className="py-3 px-4">
                    <select
                      value={o.order_status}
                      onChange={(e) => void handleUpdateStatus(o.id, e.target.value)}
                      className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs capitalize"
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-xs font-mono">
                    {o.tracking_id ? `${o.courier_name}: ${o.tracking_id}` : '—'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(o)}
                      className="p-1.5 rounded-lg hover:bg-[#F3F0FF] dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
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

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl my-8 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono">{selectedOrder.order_number}</h2>
                <p className="text-xs text-slate-500">
                  {selectedOrder.customer_name} · {selectedOrder.customer_phone}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintInvoice(selectedOrder)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Invoice</span>
                </button>
                <button type="button" onClick={() => setSelectedOrder(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <strong>Delivery Address:</strong> {selectedOrder.customer_address}
            </div>

            {/* Risk Assessment */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>Order Risk Level: {selectedOrder.risk_level.toUpperCase()}</span>
              </div>
              {selectedOrder.risk_reasons?.length > 0 && (
                <ul className="text-xs text-slate-500 list-disc pl-5">
                  {selectedOrder.risk_reasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Items */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500">
                  <tr>
                    <th className="py-2 px-3 text-left">Item</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3 text-right">Unit</th>
                    <th className="py-2 px-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedOrder.items || []).map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 px-3">
                        {it.product_name} {it.variant_color || it.variant_size ? `(${it.variant_color} ${it.variant_size})` : ''}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{it.quantity}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatMoney(it.unit_price)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">{formatMoney(it.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 text-right text-xs space-y-1">
                <div>Delivery: {formatMoney(selectedOrder.delivery_charge)}</div>
                <div className="text-sm font-bold">Total: {formatMoney(selectedOrder.total_amount)}</div>
              </div>
            </div>

            {/* Courier Booking */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500">
                {selectedOrder.tracking_id ? (
                  <span className="font-mono text-emerald-600 font-semibold">
                    Booked ({selectedOrder.courier_name}): {selectedOrder.tracking_id}
                  </span>
                ) : (
                  'Book parcel directly via configured courier API:'
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={bookingLoading}
                  onClick={() => void handleBookCourier(selectedOrder.id, 'steadfast')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {bookingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
                  <span>Book Steadfast</span>
                </button>
                <button
                  type="button"
                  disabled={bookingLoading}
                  onClick={() => void handleBookCourier(selectedOrder.id, 'pathao')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>Book Pathao</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Manual Order Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">Create Manual Order</h2>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1.5 rounded-lg text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOrder} className="space-y-3">
              <input type="text" required placeholder="Customer Name" value={cName} onChange={(e) => setCName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <input type="tel" required placeholder="Phone Number" value={cPhone} onChange={(e) => setCPhone(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <input type="text" required placeholder="Full Delivery Address" value={cAddress} onChange={(e) => setCAddress(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              <select required value={selectedProdId} onChange={(e) => setSelectedProdId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm">
                <option value="">Select Product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMoney(p.discount_price ?? p.regular_price)} (Stock: {p.stock_quantity})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Quantity</label>
                  <input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Delivery Charge</label>
                  <input type="number" min="0" value={deliveryCharge} onChange={(e) => setDeliveryCharge(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-[#5B35F5] text-white text-sm font-semibold hover:bg-[#4924DE]">
                Create Order
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
