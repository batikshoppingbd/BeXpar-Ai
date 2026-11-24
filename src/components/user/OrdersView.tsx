import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
  X,
} from 'lucide-react';
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

const TERMINAL_PARCEL_STATUSES = new Set(['delivered', 'cancelled', 'returned', 'partial_delivered']);

function getRiskBadgeClass(level: Order['risk_level']) {
  if (level === 'high') {
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50';
  }
  if (level === 'medium') {
    return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50';
  }
  return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50';
}

function getParcelStatusClass(status?: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'delivered' || s === 'partial_delivered') {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (s === 'cancelled' || s === 'returned') {
    return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  }
  if (s === 'hold') {
    return 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300';
}

export const OrdersView: React.FC<OrdersViewProps> = ({ business, lang }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [syncingCouriers, setSyncingCouriers] = useState(false);
  const [syncingShipmentId, setSyncingShipmentId] = useState<string | null>(null);
  const [detectingOrderId, setDetectingOrderId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const autoSyncedBusinessRef = useRef<string | null>(null);

  // Manual order form
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [qty, setQty] = useState(1);
  const [deliveryCharge, setDeliveryCharge] = useState(60);

  const loadOrders = async (): Promise<Order[]> => {
    setLoading(true);
    try {
      const [ordRes, prodRes] = await Promise.all([
        apiFetch<{ orders: Order[] }>(`/api/businesses/${business.id}/orders`, { businessId: business.id }),
        apiFetch<{ products: Product[] }>(`/api/businesses/${business.id}/products`, { businessId: business.id }),
      ]);
      setOrders(ordRes.orders);
      setProducts(prodRes.products);
      setSelectedOrder((prev) => {
        if (!prev) return null;
        return ordRes.orders.find((o) => o.id === prev.id) || prev;
      });
      return ordRes.orders;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders.');
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void loadOrders().then(async (loaded) => {
      if (!active) return;
      const hasActiveShipments = loaded.some((o) =>
        (o.shipments || []).some((s) => !TERMINAL_PARCEL_STATUSES.has(String(s.parcel_status || '').toLowerCase()))
      );
      if (hasActiveShipments && autoSyncedBusinessRef.current !== business.id) {
        autoSyncedBusinessRef.current = business.id;
        try {
          const syncRes = await apiFetch<{ synced: number }>(`/api/businesses/${business.id}/orders/sync-couriers`, {
            method: 'POST',
            businessId: business.id,
          });
          if (active && syncRes.synced > 0) {
            await loadOrders();
          }
        } catch {
          // Silent background sync
        }
      }
    });
    return () => {
      active = false;
    };
  }, [business.id]);

  const copyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
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
      setNotice(lang === 'bn' ? 'নতুন অর্ডার ও অটো রিস্ক ডিটেকশন সম্পন্ন হয়েছে।' : 'Order created with auto risk detection.');
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order creation failed.');
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    setError('');
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
    setNotice('');
    try {
      const res = await apiFetch<{ trackingId: string; consignmentId: string; status: string }>(
        `/api/businesses/${business.id}/orders/${orderId}/book-courier`,
        {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify({ provider }),
        }
      );
      const pid = res.consignmentId ? `Parcel ID: #${res.consignmentId}` : '';
      const tid = res.trackingId ? `Tracking: ${res.trackingId}` : '';
      setNotice(
        `${provider.toUpperCase()} booking successful! ${[pid, tid].filter(Boolean).join(' · ')}`
      );
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Courier booking failed.');
    } finally {
      setBookingLoading(false);
    }
  };

  const handleSyncAllCouriers = async () => {
    setSyncingCouriers(true);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{ synced: number }>(`/api/businesses/${business.id}/orders/sync-couriers`, {
        method: 'POST',
        businessId: business.id,
      });
      setNotice(
        lang === 'bn'
          ? `${res.synced}টি পার্সেলের লাইভ স্ট্যাটাস কুরিয়ার থেকে সিঙ্ক করা হয়েছে।`
          : `Synced live parcel status for ${res.synced} active shipment(s).`
      );
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Courier status sync failed.');
    } finally {
      setSyncingCouriers(false);
    }
  };

  const handleSyncSingleShipment = async (shipmentId: string) => {
    setSyncingShipmentId(shipmentId);
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{ status: string; consignmentId?: string }>(
        `/api/businesses/${business.id}/shipments/${shipmentId}/sync`,
        { method: 'POST', businessId: business.id }
      );
      setNotice(`Parcel status synced: ${res.status}${res.consignmentId ? ` (Parcel ID #${res.consignmentId})` : ''}`);
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tracking sync failed.');
    } finally {
      setSyncingShipmentId(null);
    }
  };

  const handleDetectRisk = async (orderId: string, silent = false) => {
    setDetectingOrderId(orderId);
    if (!silent) {
      setError('');
      setNotice('');
    }
    try {
      const res = await apiFetch<{ risk_level: Order['risk_level']; risk_reasons: string[] }>(
        `/api/businesses/${business.id}/orders/${orderId}/detect-risk`,
        { method: 'POST', businessId: business.id }
      );
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, risk_level: res.risk_level, risk_reasons: res.risk_reasons } : o
        )
      );
      setSelectedOrder((prev) =>
        prev && prev.id === orderId ? { ...prev, risk_level: res.risk_level, risk_reasons: res.risk_reasons } : prev
      );
      if (!silent) {
        setNotice(
          lang === 'bn'
            ? `অটো ডিটেকশন আপডেট হয়েছে: ${res.risk_level.toUpperCase()} রিস্ক`
            : `Auto-detection completed: ${res.risk_level.toUpperCase()} risk`
        );
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Auto risk detection failed.');
      }
    } finally {
      setDetectingOrderId(null);
    }
  };

  const handleOpenOrder = (order: Order) => {
    setSelectedOrder(order);
    if (!order.risk_reasons || order.risk_reasons.length === 0) {
      void handleDetectRisk(order.id, true);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'Order Number',
      'Customer',
      'Phone',
      'Address',
      'Total',
      'Status',
      'Risk',
      'Courier',
      'Parcel ID',
      'Tracking ID',
      'Parcel Status',
      'Created At',
    ];
    const rows = filtered.map((o) => {
      const latestShipment = o.shipments?.[0];
      return [
        o.order_number,
        `"${o.customer_name.replace(/"/g, '""')}"`,
        o.customer_phone,
        `"${o.customer_address.replace(/"/g, '""')}"`,
        o.total_amount,
        o.order_status,
        o.risk_level,
        o.courier_name || '',
        latestShipment?.consignment_id || '',
        o.tracking_id || '',
        latestShipment?.parcel_status || '',
        o.created_at,
      ];
    });
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bexpar-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handlePrintInvoice = (order: Order) => {
    const latestShipment = order.shipments?.[0];
    const html = `
      <!doctype html>
      <html><head><title>Invoice ${order.order_number}</title>
      <style>body{font-family:sans-serif;padding:32px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left}th{font-size:12px;color:#64748b}</style>
      </head><body>
      <h2>${business.name} — Invoice</h2>
      <p><strong>Order:</strong> ${order.order_number}<br/><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
      <p><strong>Customer:</strong> ${order.customer_name} (${order.customer_phone})<br/><strong>Address:</strong> ${order.customer_address}</p>
      ${
        order.tracking_id || latestShipment?.consignment_id
          ? `<p><strong>Courier:</strong> ${(order.courier_name || latestShipment?.provider || '').toUpperCase()} ${
              latestShipment?.consignment_id ? `· <strong>Parcel ID:</strong> #${latestShipment.consignment_id}` : ''
            } ${order.tracking_id ? `· <strong>Tracking:</strong> ${order.tracking_id}` : ''}</p>`
          : ''
      }
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
    if (search) {
      const q = search.toLowerCase();
      const parcelId = o.shipments?.[0]?.consignment_id || '';
      if (
        !o.order_number.toLowerCase().includes(q) &&
        !o.customer_name.toLowerCase().includes(q) &&
        !o.customer_phone.includes(search) &&
        !(o.tracking_id || '').toLowerCase().includes(q) &&
        !parcelId.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const renderCourierSummary = (o: Order) => {
    const latest = o.shipments?.[0];
    const provider = (o.courier_name || latest?.provider || '').toUpperCase();
    const parcelId = latest?.consignment_id;
    const tracking = o.tracking_id || latest?.tracking_id;
    const parcelStatus = latest?.parcel_status;

    if (!tracking && !parcelId) {
      return <span className="text-slate-400 text-xs">—</span>;
    }

    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {provider && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-200">
              {provider}
            </span>
          )}
          {parcelStatus && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${getParcelStatusClass(parcelStatus)}`}>
              {parcelStatus.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {parcelId ? (
          <div className="flex items-center gap-1 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400">
            <span>Parcel ID: #{parcelId}</span>
            <button
              type="button"
              onClick={() => void copyValue(`pid-${o.id}`, parcelId)}
              title="Copy Parcel ID"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              {copiedKey === `pid-${o.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        ) : null}
        {tracking && (
          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-600 dark:text-slate-300">
            <span>Track: {tracking}</span>
            <button
              type="button"
              onClick={() => void copyValue(`tid-${o.id}`, tracking)}
              title="Copy Tracking Code"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              {copiedKey === `tid-${o.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'অর্ডার ম্যানেজমেন্ট ও রিস্ক অ্যানালাইসিস' : 'Orders & Risk Management'}
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            {lang === 'bn'
              ? 'কুরিয়ার পার্সেল আইডি, ফ্রড রিস্ক অটো ডিটেকশন এবং লাইভ ডেলিভারি স্ট্যাটাস সিঙ্ক।'
              : 'Manage AI-collected and manual orders, courier fraud auto-detection, parcel IDs, and live tracking.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncingCouriers}
            onClick={() => void handleSyncAllCouriers()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {syncingCouriers ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>{lang === 'bn' ? 'সিঙ্ক কুরিয়ার' : 'Sync Couriers'}</span>
          </button>
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

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900/50 p-3.5 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900/50 p-3.5 text-xs text-rose-700 dark:text-rose-300">
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
            placeholder="Search order #, parcel ID, name, phone..."
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

      {/* Mobile Card List (avoids horizontal cutoff on phones) */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-500">
            Loading orders...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 text-center text-sm text-slate-500">
            No orders found.
          </div>
        ) : (
          filtered.map((o) => (
            <div
              key={o.id}
              className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-xs font-bold text-slate-900 dark:text-white">{o.order_number}</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{o.customer_name}</div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300">{o.customer_phone}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-sm tabular-nums text-slate-900 dark:text-white">
                    {formatMoney(o.total_amount)}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {new Date(o.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Auto-Detection Risk Summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-950 p-2.5 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold uppercase ${getRiskBadgeClass(o.risk_level)}`}>
                    {o.risk_level} risk
                  </span>
                  {o.risk_reasons?.[0] ? (
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">{o.risk_reasons[0]}</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">Tap detect for courier ratio</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={detectingOrderId === o.id}
                  onClick={() => void handleDetectRisk(o.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-[11px] font-semibold"
                >
                  {detectingOrderId === o.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  <span>{lang === 'bn' ? 'অটো চেক' : 'Detect'}</span>
                </button>
              </div>

              {/* Courier & Parcel ID */}
              <div className="rounded-xl bg-[#F9F7FF] dark:bg-slate-950/70 p-2.5 border border-[#E6E0FF] dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  {lang === 'bn' ? 'কুরিয়ার ও পার্সেল আইডি' : 'Courier & Parcel ID'}
                </div>
                {renderCourierSummary(o)}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <select
                  value={o.order_status}
                  onChange={(e) => void handleUpdateStatus(o.id, e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs capitalize"
                >
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleOpenOrder(o)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3F0FF] dark:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA] text-xs font-semibold"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'বিস্তারিত' : 'Details'}</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F9F7FF] dark:bg-slate-950/60 border-b border-[#E6E0FF] dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <tr>
              <th className="py-3.5 px-4 font-semibold">Order</th>
              <th className="py-3.5 px-4 font-semibold">Customer</th>
              <th className="py-3.5 px-4 font-semibold">Source</th>
              <th className="py-3.5 px-4 font-semibold">Risk &amp; Auto-Detection</th>
              <th className="py-3.5 px-4 font-semibold text-right">Total</th>
              <th className="py-3.5 px-4 font-semibold">Status</th>
              <th className="py-3.5 px-4 font-semibold">Courier &amp; Parcel ID</th>
              <th className="py-3.5 px-4 font-semibold text-right">View</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                  Loading orders...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  No orders found.
                </td>
              </tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                  <td className="py-3 px-4">
                    <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white">{o.order_number}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{new Date(o.created_at).toLocaleDateString()}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-white">{o.customer_name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">{o.customer_phone}</div>
                  </td>
                  <td className="py-3 px-4 text-xs capitalize text-slate-600 dark:text-slate-300">
                    {o.order_source.replace('_', ' ')}
                  </td>
                  <td className="py-3 px-4 text-xs max-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold uppercase ${getRiskBadgeClass(o.risk_level)}`}>
                        {o.risk_level} risk
                      </span>
                      <button
                        type="button"
                        disabled={detectingOrderId === o.id}
                        onClick={() => void handleDetectRisk(o.id)}
                        title="Re-run Courier & Fraud Auto-Detection"
                        className="p-1 rounded hover:bg-[#F3F0FF] dark:hover:bg-slate-800 text-[#5B35F5] dark:text-[#A78BFA]"
                      >
                        {detectingOrderId === o.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    {o.risk_reasons?.[0] && (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                        {o.risk_reasons[0]}
                      </div>
                    )}
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
                  <td className="py-3 px-4">{renderCourierSummary(o)}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => handleOpenOrder(o)}
                      aria-label={`View order ${o.order_number}`}
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
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl my-8 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white font-mono">{selectedOrder.order_number}</h2>
                <p className="text-xs text-slate-600 dark:text-slate-300">
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
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  aria-label="Close"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
              <strong>Delivery Address:</strong> {selectedOrder.customer_address}
            </div>

            {/* Risk & Fraud Auto-Detection */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {selectedOrder.risk_level === 'low' ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                  )}
                  <span>
                    {lang === 'bn' ? 'অটো রিস্ক ও কুরিয়ার ডিটেকশন:' : 'Risk & Courier Auto-Detection:'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md border text-[11px] uppercase ${getRiskBadgeClass(selectedOrder.risk_level)}`}>
                    {selectedOrder.risk_level}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={detectingOrderId === selectedOrder.id}
                  onClick={() => void handleDetectRisk(selectedOrder.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  {detectingOrderId === selectedOrder.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{lang === 'bn' ? 'আবার চেক করুন' : 'Run Auto-Detection'}</span>
                </button>
              </div>
              {selectedOrder.risk_reasons?.length > 0 ? (
                <ul className="text-xs text-slate-700 dark:text-slate-300 list-disc pl-5 space-y-1">
                  {selectedOrder.risk_reasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  {detectingOrderId === selectedOrder.id
                    ? 'Checking store history & Steadfast courier delivery ratio...'
                    : 'Click Run Auto-Detection to fetch Steadfast parcel history and risk signals.'}
                </p>
              )}
            </div>

            {/* Items */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300">
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

            {/* Courier Shipment Details & Booking */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              {selectedOrder.shipments && selectedOrder.shipments.length > 0 ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white uppercase">
                      <Truck className="w-4 h-4 text-emerald-600" />
                      <span>{selectedOrder.shipments[0].provider} Parcel</span>
                      <span className={`px-2 py-0.5 rounded-md text-[11px] capitalize ${getParcelStatusClass(selectedOrder.shipments[0].parcel_status)}`}>
                        {selectedOrder.shipments[0].parcel_status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={syncingShipmentId === selectedOrder.shipments[0].id}
                      onClick={() => void handleSyncSingleShipment(selectedOrder.shipments![0].id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                    >
                      {syncingShipmentId === selectedOrder.shipments[0].id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{lang === 'bn' ? 'স্ট্যাটাস সিঙ্ক' : 'Sync Status'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] uppercase text-slate-500 font-semibold">Parcel ID (Consignment ID)</div>
                        <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                          {selectedOrder.shipments[0].consignment_id ? `#${selectedOrder.shipments[0].consignment_id}` : 'Pending Sync'}
                        </div>
                      </div>
                      {selectedOrder.shipments[0].consignment_id && (
                        <button
                          type="button"
                          onClick={() => void copyValue('modal-pid', selectedOrder.shipments![0].consignment_id!)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                          {copiedKey === 'modal-pid' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase text-slate-500 font-semibold">Tracking Code</div>
                        <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5 truncate">
                          {selectedOrder.shipments[0].tracking_id}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void copyValue('modal-tid', selectedOrder.shipments![0].tracking_id)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                          {copiedKey === 'modal-tid' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {selectedOrder.shipments[0].provider === 'steadfast' && (
                          <a
                            href={`https://steadfast.com.bd/t/${encodeURIComponent(selectedOrder.shipments[0].tracking_id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-600 dark:text-indigo-400"
                            title="Track on Steadfast"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : selectedOrder.tracking_id ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 text-xs">
                  <span className="font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                    Booked ({selectedOrder.courier_name}): {selectedOrder.tracking_id}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {selectedOrder.tracking_id
                    ? lang === 'bn'
                      ? 'প্রয়োজনে নতুন কুরিয়ার বুকিং করুন:'
                      : 'Need another booking? Dispatch via courier API:'
                    : lang === 'bn'
                    ? 'কনফিগার করা কুরিয়ারে সরাসরি পার্সেল পাঠান:'
                    : 'Book parcel directly via configured courier API:'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={bookingLoading}
                    onClick={() => void handleBookCourier(selectedOrder.id, 'steadfast')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 disabled:opacity-50"
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
              <input
                type="text"
                required
                placeholder="Customer Name"
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <input
                type="tel"
                required
                placeholder="Phone Number"
                value={cPhone}
                onChange={(e) => setCPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <input
                type="text"
                required
                placeholder="Full Delivery Address"
                value={cAddress}
                onChange={(e) => setCAddress(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
              <select
                required
                value={selectedProdId}
                onChange={(e) => setSelectedProdId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              >
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
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Delivery Charge</label>
                  <input
                    type="number"
                    min="0"
                    value={deliveryCharge}
                    onChange={(e) => setDeliveryCharge(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
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
