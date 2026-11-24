import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Minus,
  Moon,
  Package,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  Sun,
  X,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../../lib/api';
import type { Lang } from '../../i18n/translations';
import type { Product } from '../../types';

interface PublicStorePageProps {
  businessId: string;
  lang: Lang;
  onToggleLang: () => void;
  dark: boolean;
  onToggleDark: () => void;
  isPreview?: boolean;
  onExit: () => void;
}

interface PublicBusiness {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  logo_url?: string;
}

interface BagItem {
  key: string;
  product: Product;
  quantity: number;
  variant_color: string;
  variant_size: string;
}

interface ConfirmedReceipt {
  order_number: string;
  customer_name: string;
  total_amount: number;
  delivery_charge: number;
  payment_method: string;
}

export const PublicStorePage: React.FC<PublicStorePageProps> = ({
  businessId,
  lang,
  onToggleLang,
  dark,
  onToggleDark,
  isPreview = false,
  onExit,
}) => {
  const [store, setStore] = useState<PublicBusiness | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [deliveryCharge, setDeliveryCharge] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({});
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});

  const [bagOpen, setBagOpen] = useState(false);
  const [bag, setBag] = useState<BagItem[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'bkash' | 'nagad'>('cod');
  const [notes, setNotes] = useState('');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [receipt, setReceipt] = useState<ConfirmedReceipt | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiFetch<{ business: PublicBusiness; products: Product[]; deliveryCharge: number }>(
      `/api/system/public-store/${businessId}`
    )
      .then((res) => {
        if (!active) return;
        setStore(res.business);
        setProducts(res.products || []);
        setDeliveryCharge(Number(res.deliveryCharge ?? 60));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load store.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [businessId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category_name) set.add(p.category_name);
    }
    return ['all', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (category !== 'all' && p.category_name !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.category_name || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [products, category, search]);

  const bagCount = bag.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = bag.reduce(
    (sum, item) => sum + Number(item.product.discount_price ?? item.product.regular_price ?? 0) * item.quantity,
    0
  );
  const grandTotal = subtotal + (bag.length > 0 ? deliveryCharge : 0);

  const addToBag = (product: Product) => {
    const color = selectedColors[product.id] ?? product.colors?.[0] ?? '';
    const size = selectedSizes[product.id] ?? product.sizes?.[0] ?? '';
    const key = `${product.id}::${color}::${size}`;

    setBag((prev) => {
      const existing = prev.find((b) => b.key === key);
      if (existing) {
        return prev.map((b) =>
          b.key === key ? { ...b, quantity: Math.min(product.stock_quantity, b.quantity + 1) } : b
        );
      }
      return [...prev, { key, product, quantity: 1, variant_color: color, variant_size: size }];
    });
    setReceipt(null);
    setBagOpen(true);
  };

  const updateQty = (key: string, nextQty: number) => {
    setBag((prev) =>
      prev
        .map((item) => {
          if (item.key !== key) return item;
          if (nextQty <= 0) return null;
          return { ...item, quantity: Math.min(item.product.stock_quantity, nextQty) };
        })
        .filter((x): x is BagItem => x !== null)
    );
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bag.length === 0) return;
    setPlacingOrder(true);
    setOrderError('');
    try {
      const res = await apiFetch<{ order: ConfirmedReceipt }>(`/api/system/public-store/${businessId}/orders`, {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_address: customerAddress.trim(),
          payment_method: paymentMethod,
          notes: notes.trim(),
          items: bag.map((b) => ({
            product_id: b.product.id,
            quantity: b.quantity,
            variant_color: b.variant_color,
            variant_size: b.variant_size,
          })),
        }),
      });
      setReceipt(res.order);
      setBag([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setNotes('');
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to place order.');
    } finally {
      setPlacingOrder(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span>{lang === 'bn' ? 'স্টোর লোড হচ্ছে...' : 'Loading store...'}</span>
        </div>
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <Package className="w-10 h-10 text-slate-400 mx-auto" />
          <h1 className="text-lg font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'স্টোর পাওয়া যায়নি' : 'Store Unavailable'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{error || 'This storefront is unavailable.'}</p>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{isPreview ? (lang === 'bn' ? 'ড্যাশবোর্ডে ফিরুন' : 'Back to Dashboard') : 'BeXpar Ai'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Store Top Navigation */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onExit}
              className="p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="font-display font-bold text-lg text-slate-900 dark:text-white truncate">
              {store.name}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleLang}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {lang === 'bn' ? 'EN' : 'বাংলা'}
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              aria-label="Toggle theme"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setBagOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 whitespace-nowrap"
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="tabular-nums">
                {lang === 'bn' ? `ব্যাগ (${bagCount})` : `Bag (${bagCount})`}
              </span>
            </button>
          </div>
        </div>
      </header>

      {isPreview && (
        <div className="bg-indigo-600 text-white text-xs px-4 py-2 text-center flex items-center justify-center gap-3">
          <span>{lang === 'bn' ? 'এটি আপনার কাস্টমার স্টোর প্রিভিউ মোড' : 'Customer Storefront Preview Mode'}</span>
          <button type="button" onClick={onExit} className="underline font-semibold">
            {lang === 'bn' ? 'প্যানেলে ফিরুন' : 'Exit Preview'}
          </button>
        </div>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Storefront Banner */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {store.category} · {lang === 'bn' ? 'অফিসিয়াল অনলাইন স্টোর' : 'Official Mini Store'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white">
              {store.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              {store.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {store.address}
                </span>
              )}
              {store.phone && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Phone className="w-3.5 h-3.5" />
                  {store.phone}
                </span>
              )}
            </div>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'bn' ? 'পণ্য খুঁজুন...' : 'Search products...'}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
          </div>
        </section>

        {/* Category Filter Tabs */}
        {categories.length > 2 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  category === c
                    ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {c === 'all' ? (lang === 'bn' ? 'সব পণ্য' : 'All Products') : c}
              </button>
            ))}
          </div>
        )}

        {/* Featured Collection Grid */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-sm text-slate-500">
            {lang === 'bn' ? 'এই মুহূর্তে কোনো সক্রিয় পণ্য পাওয়া যায়নি।' : 'No products available in this store right now.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((p) => {
              const imgUrl = p.primary_image_url || p.images?.[0]?.image_url || '';
              const price = p.discount_price !== null ? p.discount_price : p.regular_price;
              const inStock = p.stock_quantity > 0;

              return (
                <div
                  key={p.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col transition-transform duration-150 hover:-translate-y-0.5"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-950 overflow-hidden">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                        <Package className="w-8 h-8" />
                        <span className="text-xs font-medium px-4 text-center line-clamp-1">{p.name}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>{p.category_name}</span>
                        <span className={inStock ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 font-medium'}>
                          {inStock ? (lang === 'bn' ? 'স্টকে আছে' : 'In Stock') : lang === 'bn' ? 'স্টক শেষ' : 'Out of Stock'}
                        </span>
                      </div>

                      <h2 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-2">
                        {p.name}
                      </h2>

                      {p.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{p.description}</p>
                      )}

                      {(p.colors?.length > 0 || p.sizes?.length > 0) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {p.colors?.length > 0 && (
                            <select
                              value={selectedColors[p.id] ?? p.colors[0]}
                              onChange={(e) => setSelectedColors((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            >
                              {p.colors.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          )}
                          {p.sizes?.length > 0 && (
                            <select
                              value={selectedSizes[p.id] ?? p.sizes[0]}
                              onChange={(e) => setSelectedSizes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                            >
                              {p.sizes.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                      <div className="tabular-nums">
                        <div className="text-base font-bold text-slate-900 dark:text-white">{formatMoney(price)}</div>
                        {p.discount_price !== null && (
                          <div className="text-xs line-through text-slate-400">{formatMoney(p.regular_price)}</div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={!inStock}
                        onClick={() => addToBag(p)}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {lang === 'bn' ? 'অর্ডার করুন' : 'Add to Bag'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Slide-over Cart & Checkout Drawer */}
      {bagOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="flex-1" onClick={() => setBagOpen(false)} />
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full flex flex-col border-l border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'আপনার অর্ডার ব্যাগ' : 'Your Order Bag'} ({bagCount})
              </h2>
              <button
                type="button"
                onClick={() => setBagOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {receipt ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>{lang === 'bn' ? 'অর্ডার কনফার্মড!' : 'Order Received!'}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {lang === 'bn'
                      ? `ধন্যবাদ ${receipt.customer_name}! আপনার অর্ডার নম্বর #${receipt.order_number}। শীঘ্রই আমাদের টিম আপনার সাথে যোগাযোগ করবে।`
                      : `Thank you ${receipt.customer_name}! Order #${receipt.order_number} is confirmed for processing.`}
                  </p>
                  <div className="text-xs font-mono pt-2 border-t border-emerald-200 dark:border-emerald-800 space-y-1 tabular-nums">
                    <div className="flex justify-between">
                      <span>Order ID:</span>
                      <span className="font-bold">#{receipt.order_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Payable:</span>
                      <span className="font-bold">{formatMoney(receipt.total_amount)}</span>
                    </div>
                  </div>
                </div>
              ) : bag.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  {lang === 'bn' ? 'আপনার ব্যাগ খালি। স্টোর থেকে পণ্য যোগ করুন।' : 'Your bag is empty.'}
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {bag.map((item) => {
                      const unitPrice = Number(item.product.discount_price ?? item.product.regular_price ?? 0);
                      return (
                        <div
                          key={item.key}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {item.product.name}
                            </div>
                            {(item.variant_color || item.variant_size) && (
                              <div className="text-[11px] text-slate-500">
                                {[item.variant_color, item.variant_size].filter(Boolean).join(' · ')}
                              </div>
                            )}
                            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400 tabular-nums mt-0.5">
                              {formatMoney(unitPrice * item.quantity)}
                            </div>
                          </div>

                          <div className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-lg shrink-0">
                            <button
                              type="button"
                              onClick={() => updateQty(item.key, item.quantity - 1)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-l-lg"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="px-2.5 text-xs font-semibold tabular-nums">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQty(item.key, item.quantity + 1)}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-r-lg"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {orderError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
                      {orderError}
                    </div>
                  )}

                  <form id="public-checkout-form" onSubmit={handlePlaceOrder} className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {lang === 'bn' ? 'ডেলিভারি তথ্য' : 'Delivery Details'}
                    </h3>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder={lang === 'bn' ? 'আপনার নাম *' : 'Your Full Name *'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder={lang === 'bn' ? 'মোবাইল নম্বর (01XXXXXXXXX) *' : 'Phone Number *'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono"
                    />
                    <textarea
                      rows={2}
                      required
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder={lang === 'bn' ? 'সম্পূর্ণ ডেলিভারি ঠিকানা *' : 'Full Delivery Address *'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as 'cod' | 'bkash' | 'nagad')}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    >
                      <option value="cod">Cash on Delivery (COD)</option>
                      <option value="bkash">bKash</option>
                      <option value="nagad">Nagad</option>
                    </select>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={lang === 'bn' ? 'নোট (ঐচ্ছিক)' : 'Delivery note (optional)'}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                  </form>
                </>
              )}
            </div>

            {bag.length > 0 && !receipt && (
              <div className="p-5 border-t border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50 dark:bg-slate-950">
                <div className="space-y-1 text-xs tabular-nums">
                  <div className="flex justify-between text-slate-500">
                    <span>{lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}</span>
                    <span>{formatMoney(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{lang === 'bn' ? 'ডেলিভারি চার্জ' : 'Delivery Charge'}</span>
                    <span>{formatMoney(deliveryCharge)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white pt-1">
                    <span>{lang === 'bn' ? 'মোট প্রদেয়' : 'Total Payable'}</span>
                    <span>{formatMoney(grandTotal)}</span>
                  </div>
                </div>
                <button
                  type="submit"
                  form="public-checkout-form"
                  disabled={placingOrder}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {placingOrder && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {lang === 'bn' ? `অর্ডার কনফার্ম করুন (${formatMoney(grandTotal)})` : `Confirm Order (${formatMoney(grandTotal)})`}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
