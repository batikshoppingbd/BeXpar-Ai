import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  ExternalLink,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, fileToBase64, formatMoney } from '../../lib/api';
import type { Business, Order, Product } from '../../types';
import type { Lang } from '../../i18n/translations';

interface StorefrontViewProps {
  business: Business;
  lang: Lang;
  onNavigate: (tab: string) => void;
  onPreviewStore: (businessId: string) => void;
}

interface CartItem {
  key: string;
  product_id?: string;
  product_name: string;
  unit_price: number;
  max_stock?: number;
  quantity: number;
  variant_color: string;
  variant_size: string;
  colors: string[];
  sizes: string[];
  image_url?: string;
}

export const StorefrontView: React.FC<StorefrontViewProps> = ({
  business,
  lang,
  onNavigate,
  onPreviewStore,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'draft' | 'out_of_stock'>('all');

  // Inline product delete & status toggle
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Store URL copy feedback
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Quick Add Product Modal
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qaName, setQaName] = useState('');
  const [qaCategory, setQaCategory] = useState('General');
  const [qaPrice, setQaPrice] = useState('');
  const [qaDiscount, setQaDiscount] = useState('');
  const [qaStock, setQaStock] = useState('10');
  const [qaColors, setQaColors] = useState('');
  const [qaSizes, setQaSizes] = useState('');
  const [qaImageUrl, setQaImageUrl] = useState('');
  const [qaSaving, setQaSaving] = useState(false);

  // Order Taking Cart & Customer Form
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customQty, setCustomQty] = useState('1');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'bkash' | 'nagad'>('cod');
  const [orderSource, setOrderSource] = useState<'manual' | 'facebook' | 'whatsapp' | 'instagram'>('manual');
  const [deliveryCharge, setDeliveryCharge] = useState('60');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [confirmNow, setConfirmNow] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);

  const storeUrl = `${window.location.origin}/?store=${business.id}`;

  const loadProducts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ products: Product[] }>(`/api/businesses/${business.id}/products`, {
        businessId: business.id,
      });
      setProducts(res.products || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load store products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, [business.id]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category_name) set.add(p.category_name);
    }
    return ['all', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'all' && p.category_name !== selectedCategory) return false;
      if (statusFilter === 'active' && (p.status !== 'active' || p.stock_quantity <= 0)) return false;
      if (statusFilter === 'draft' && p.status !== 'draft') return false;
      if (statusFilter === 'out_of_stock' && p.stock_quantity > 0 && p.status !== 'out_of_stock') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !(p.sku || '').toLowerCase().includes(q) &&
          !(p.category_name || '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [products, selectedCategory, statusFilter, search]);

  const activeCount = products.filter((p) => p.status === 'active' && p.stock_quantity > 0).length;
  const totalStockUnits = products.reduce((sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)), 0);

  const handleCopyStoreLink = () => {
    void navigator.clipboard.writeText(storeUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleDeleteProduct = async (productId: string) => {
    setDeletingId(productId);
    setError('');
    try {
      await apiFetch(`/api/businesses/${business.id}/products/${productId}`, {
        method: 'DELETE',
        businessId: business.id,
      });
      setConfirmDeleteId(null);
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      setCart((prev) => prev.filter((c) => c.product_id !== productId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleProductStatus = async (p: Product) => {
    setTogglingId(p.id);
    setError('');
    try {
      const nextStatus = p.status === 'draft' ? (p.stock_quantity > 0 ? 'active' : 'out_of_stock') : 'draft';
      await apiFetch(`/api/businesses/${business.id}/products/${p.id}`, {
        method: 'PATCH',
        businessId: business.id,
        body: JSON.stringify({ status: nextStatus }),
      });
      setProducts((prev) => prev.map((item) => (item.id === p.id ? { ...item, status: nextStatus } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleQuickImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await fileToBase64(file);
      const uploaded = await apiFetch<{ url: string }>(`/api/businesses/${business.id}/upload`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          bucket: 'product-images',
          fileName: file.name,
          base64Data: b64,
          contentType: file.type,
        }),
      });
      setQaImageUrl(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    }
  };

  const handleQuickAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setQaSaving(true);
    setError('');
    try {
      await apiFetch(`/api/businesses/${business.id}/products`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          name: qaName.trim(),
          category_name: qaCategory.trim() || 'General',
          regular_price: Number(qaPrice || 0),
          discount_price: qaDiscount ? Number(qaDiscount) : null,
          stock_quantity: Number(qaStock || 0),
          colors: qaColors.split(',').map((s) => s.trim()).filter(Boolean),
          sizes: qaSizes.split(',').map((s) => s.trim()).filter(Boolean),
          images: qaImageUrl ? [qaImageUrl] : [],
          primary_image_url: qaImageUrl,
          status: Number(qaStock || 0) > 0 ? 'active' : 'out_of_stock',
        }),
      });
      setQuickAddOpen(false);
      setQaName('');
      setQaCategory('General');
      setQaPrice('');
      setQaDiscount('');
      setQaStock('10');
      setQaColors('');
      setQaSizes('');
      setQaImageUrl('');
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add product.');
    } finally {
      setQaSaving(false);
    }
  };

  const addToCart = (p: Product) => {
    const unitPrice = Number(p.discount_price ?? p.regular_price ?? 0);
    const defaultColor = p.colors?.[0] || '';
    const defaultSize = p.sizes?.[0] || '';
    const key = `${p.id}::${defaultColor}::${defaultSize}`;

    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (existing) {
        return prev.map((item) =>
          item.key === key
            ? {
                ...item,
                quantity:
                  item.max_stock !== undefined ? Math.min(item.max_stock, item.quantity + 1) : item.quantity + 1,
              }
            : item
        );
      }
      return [
        ...prev,
        {
          key,
          product_id: p.id,
          product_name: p.name,
          unit_price: unitPrice,
          max_stock: p.stock_quantity > 0 ? p.stock_quantity : undefined,
          quantity: 1,
          variant_color: defaultColor,
          variant_size: defaultSize,
          colors: p.colors || [],
          sizes: p.sizes || [],
          image_url: p.primary_image_url || p.images?.[0]?.image_url || '',
        },
      ];
    });
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    const price = Math.max(0, Number(customPrice || 0));
    const qty = Math.max(1, Number(customQty || 1));
    setCart((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        product_name: customName.trim(),
        unit_price: price,
        quantity: qty,
        variant_color: '',
        variant_size: '',
        colors: [],
        sizes: [],
      },
    ]);
    setCustomName('');
    setCustomPrice('');
    setCustomQty('1');
    setCustomItemOpen(false);
  };

  const updateCartItem = (key: string, patch: Partial<CartItem>) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.key !== key) return item;
          const next = { ...item, ...patch };
          if (next.quantity <= 0) return null;
          return next;
        })
        .filter((x): x is CartItem => x !== null)
    );
  };

  const subtotal = cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const discountNum = Math.max(0, Number(discount || 0));
  const deliveryNum = Math.max(0, Number(deliveryCharge || 0));
  const grandTotal = Math.max(0, subtotal - discountNum + deliveryNum);

  const handleTakeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      setError(lang === 'bn' ? 'অর্ডার নেওয়ার জন্য অন্তত একটি পণ্য কার্টে যোগ করুন।' : 'Add at least one product to the order cart.');
      return;
    }
    setSubmittingOrder(true);
    setError('');
    setCreatedOrder(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/businesses/${business.id}/orders`, {
        method: 'POST',
        businessId: business.id,
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_address: customerAddress.trim(),
          payment_method: paymentMethod,
          order_source: orderSource,
          delivery_charge: deliveryNum,
          discount: discountNum,
          notes: notes.trim() || 'Mini Store Order',
          confirm_now: confirmNow,
          items: cart.map((c) => ({
            product_id: c.product_id,
            product_name: c.product_name,
            quantity: c.quantity,
            unit_price: c.unit_price,
            variant_color: c.variant_color,
            variant_size: c.variant_size,
          })),
        }),
      });

      setCreatedOrder(res.order);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setDiscount('0');
      setNotes('');
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Store Link Bar */}
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 md:p-6 bx-card space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" />
              </span>
              <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? `${business.name} — মিনি স্টোর ও অর্ডার টেকিং` : `${business.name} — Mini Store & Order Taking`}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {lang === 'bn'
                ? `মোট ${products.length}টি পণ্য · ${activeCount}টি সক্রিয় · মোট স্টক ${totalStockUnits} পিস`
                : `${products.length} total products · ${activeCount} active · ${totalStockUnits} units in stock`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm shadow-[#5B35F5]/20 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'bn' ? 'নতুন পণ্য যোগ করুন' : 'Add Product'}</span>
            </button>
            <button
              type="button"
              onClick={() => onPreviewStore(business.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F3F0FF]/50 dark:bg-slate-950 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Eye className="w-4 h-4" />
              <span>{lang === 'bn' ? 'কাস্টমার স্টোর ভিউ' : 'Customer View'}</span>
            </button>
          </div>
        </div>

        {/* Shareable Public Store Link */}
        <div className="pt-3 border-t border-[#E6E0FF]/70 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 min-w-0">
            <ExternalLink className="w-3.5 h-3.5 text-[#5B35F5] dark:text-[#A78BFA] shrink-0" />
            <span className="shrink-0 font-medium">{lang === 'bn' ? 'স্টোর লিংক:' : 'Public Store URL:'}</span>
            <code className="font-mono text-[11px] bg-[#F3F0FF]/60 dark:bg-slate-950 px-2.5 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-800 truncate">
              {storeUrl}
            </code>
          </div>
          <button
            type="button"
            onClick={handleCopyStoreLink}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:bg-[#F3F0FF] dark:hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedUrl ? (lang === 'bn' ? 'কপি হয়েছে' : 'Copied') : lang === 'bn' ? 'লিংক কপি করুন' : 'Copy Link'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="p-1 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {createdOrder && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <span className="font-semibold">
                {lang === 'bn' ? 'অর্ডার সফলভাবে তৈরি হয়েছে!' : 'Order created successfully!'}
              </span>{' '}
              <span className="font-mono font-bold">#{createdOrder.order_number}</span> · {createdOrder.customer_name} ·{' '}
              <span className="tabular-nums font-semibold">{formatMoney(createdOrder.total_amount)}</span> ·{' '}
              <span className="capitalize">{createdOrder.order_status}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('orders')}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 whitespace-nowrap"
          >
            {lang === 'bn' ? 'অর্ডার ম্যানেজমেন্টে দেখুন' : 'View in Orders'}
          </button>
        </div>
      )}

      {/* Main 2-Column Storefront + Order Taking Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Mini Store All-Products Catalog */}
        <div className="xl:col-span-7 space-y-4">
          {/* Search & Filters */}
          <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 bx-card space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === 'bn' ? 'পণ্যের নাম, SKU বা ক্যাটাগরি দিয়ে খুঁজুন...' : 'Search by product name, SKU, or category...'}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-[#F9F7FF] dark:bg-slate-950 text-sm focus:outline-none focus:border-[#5B35F5]"
                />
              </div>

              <div className="inline-flex items-center gap-1 p-1 bg-[#F3F0FF] dark:bg-slate-950 rounded-xl border border-[#E6E0FF] dark:border-slate-800 shrink-0 overflow-x-auto">
                {(
                  [
                    ['all', lang === 'bn' ? 'সব' : 'All'],
                    ['active', lang === 'bn' ? 'সক্রিয়' : 'Active'],
                    ['draft', lang === 'bn' ? 'ড্রাফট' : 'Draft'],
                    ['out_of_stock', lang === 'bn' ? 'স্টক নেই' : 'Out'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                      statusFilter === k
                        ? 'bg-[#5B35F5] text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-[#5B35F5] dark:hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {categories.length > 2 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      selectedCategory === cat
                        ? 'bg-[#5B35F5] text-white shadow-sm'
                        : 'bg-[#F3F0FF] dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-[#5B35F5] dark:hover:bg-slate-700'
                    }`}
                  >
                    {cat === 'all' ? (lang === 'bn' ? 'সব ক্যাটাগরি' : 'All Categories') : cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-4 h-72 animate-pulse"
                />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-dashed border-[#E6E0FF] dark:border-slate-700 rounded-2xl p-10 text-center space-y-3 bx-card">
              <Package className="w-8 h-8 text-[#5B35F5] mx-auto" />
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {products.length === 0
                  ? lang === 'bn'
                    ? 'আপনার মিনি স্টোরে এখনো কোনো পণ্য নেই'
                    : 'Your Mini Store has no products yet'
                  : lang === 'bn'
                  ? 'ফিল্টার অনুযায়ী কোনো পণ্য পাওয়া যায়নি'
                  : 'No products match the current filter'}
              </div>
              <button
                type="button"
                onClick={() => setQuickAddOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === 'bn' ? 'প্রথম পণ্য যোগ করুন' : 'Add Your First Product'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredProducts.map((p) => {
                const imgSrc = p.primary_image_url || p.images?.[0]?.image_url || '';
                const effectivePrice = p.discount_price !== null ? p.discount_price : p.regular_price;
                const isOutOfStock = p.stock_quantity <= 0;

                return (
                  <div
                    key={p.id}
                    className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl overflow-hidden flex flex-col bx-card hover:border-[#5B35F5]/50 transition-all"
                  >
                    {/* 4:3 Product Image */}
                    <div className="aspect-[4/3] bg-[#F3F0FF]/50 dark:bg-slate-950 relative overflow-hidden">
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#F3F0FF] to-[#E6E0FF]/50 dark:from-slate-800 dark:to-slate-900 flex flex-col items-center justify-center gap-1.5 text-[#5B35F5]/60 dark:text-slate-400 px-4 text-center">
                          <Package className="w-7 h-7" />
                          <span className="text-[11px] font-medium line-clamp-1">{p.name}</span>
                        </div>
                      )}
                    </div>

                    {/* Product Details & Inline Actions */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="truncate">
                            {p.category_name} · <span className="font-mono">{p.sku}</span>
                          </span>
                          <span
                            className={`shrink-0 font-medium ${
                              isOutOfStock
                                ? 'text-rose-600 dark:text-rose-400'
                                : p.status === 'draft'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {isOutOfStock
                              ? lang === 'bn'
                                ? 'স্টক নেই'
                                : 'Out of stock'
                              : p.status === 'draft'
                              ? lang === 'bn'
                                ? 'ড্রাফট'
                                : 'Draft'
                              : lang === 'bn'
                              ? `স্টক: ${p.stock_quantity}`
                              : `${p.stock_quantity} in stock`}
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-1">
                          {p.name}
                        </h3>

                        <div className="flex items-baseline gap-2 tabular-nums">
                          <span className="text-base font-bold text-slate-900 dark:text-white">
                            {formatMoney(effectivePrice)}
                          </span>
                          {p.discount_price !== null && (
                            <span className="text-xs line-through text-slate-400">
                              {formatMoney(p.regular_price)}
                            </span>
                          )}
                        </div>

                        {(p.colors?.length > 0 || p.sizes?.length > 0) && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {[
                              p.colors?.length ? `${lang === 'bn' ? 'রং' : 'Colors'}: ${p.colors.join(', ')}` : '',
                              p.sizes?.length ? `${lang === 'bn' ? 'সাইজ' : 'Sizes'}: ${p.sizes.join(', ')}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </div>

                      {/* Actions: Add to Order, Toggle Draft/Active, Delete */}
                      <div className="pt-2 border-t border-[#E6E0FF]/60 dark:border-slate-800 space-y-2">
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center justify-between gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl px-2.5 py-2">
                            <span className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                              {lang === 'bn' ? 'পণ্যটি মুছে ফেলবেন?' : 'Delete product?'}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                disabled={deletingId === p.id}
                                onClick={() => void handleDeleteProduct(p.id)}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold hover:bg-rose-700 disabled:opacity-60"
                              >
                                {deletingId === p.id
                                  ? '...'
                                  : lang === 'bn'
                                  ? 'ডিলিট করুন'
                                  : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded-lg border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium"
                              >
                                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isOutOfStock}
                              onClick={() => addToCart(p)}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shadow-sm shadow-[#5B35F5]/20"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span>{lang === 'bn' ? 'অর্ডারে নিন' : 'Add to Order'}</span>
                            </button>

                            <button
                              type="button"
                              disabled={togglingId === p.id}
                              onClick={() => void handleToggleProductStatus(p)}
                              title={p.status === 'draft' ? 'Publish to Storefront' : 'Hide as Draft'}
                              className="px-2.5 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-[#F3F0FF] dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              {p.status === 'draft'
                                ? lang === 'bn'
                                  ? 'সক্রিয় করুন'
                                  : 'Publish'
                                : lang === 'bn'
                                ? 'ড্রাফট'
                                : 'Hide'}
                            </button>

                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(p.id)}
                              title={lang === 'bn' ? 'পণ্য ডিলিট করুন' : 'Delete product'}
                              aria-label="Delete product"
                              className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Quick Order Taking Panel */}
        <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card space-y-4 xl:sticky xl:top-20">
          <div className="flex items-center justify-between border-b border-[#E6E0FF]/70 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#F3F0FF] dark:bg-[#5B35F5]/20 text-[#5B35F5] dark:text-[#A78BFA] flex items-center justify-center">
                <ShoppingBag className="w-4 h-4" />
              </span>
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'অর্ডার টেকিং প্যানেল' : 'Order Taking'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setCustomItemOpen((v) => !v)}
              className="text-xs font-semibold text-[#5B35F5] dark:text-[#A78BFA] hover:underline whitespace-nowrap"
            >
              {customItemOpen
                ? lang === 'bn'
                  ? 'বন্ধ করুন'
                  : 'Close'
                : lang === 'bn'
                ? '+ কাস্টম আইটেম'
                : '+ Custom Item'}
            </button>
          </div>

          {customItemOpen && (
            <form
              onSubmit={handleAddCustomItem}
              className="p-3 rounded-xl bg-[#F9F7FF] dark:bg-slate-950 border border-[#E6E0FF] dark:border-slate-800 space-y-2.5"
            >
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {lang === 'bn' ? 'ক্যাটালগের বাইরের কাস্টম আইটেম যোগ করুন' : 'Add Custom Item'}
              </div>
              <input
                type="text"
                required
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={lang === 'bn' ? 'আইটেমের নাম *' : 'Item name *'}
                className="w-full px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder={lang === 'bn' ? 'দাম (BDT) *' : 'Price *'}
                  className="w-full px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
                <input
                  type="number"
                  required
                  min="1"
                  value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  placeholder="Qty"
                  className="w-full px-3 py-1.5 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold"
              >
                {lang === 'bn' ? 'অর্ডারে যোগ করুন' : 'Add to Cart'}
              </button>
            </form>
          )}

          {/* Selected Cart Items */}
          {cart.length === 0 ? (
            <div className="py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-400">
              {lang === 'bn'
                ? 'বাম পাশের মিনি স্টোর থেকে "অর্ডারে নিন" বাটনে ক্লিক করে পণ্য যোগ করুন'
                : 'Select products from your Mini Store on the left to start an order'}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {cart.map((item) => (
                <div
                  key={item.key}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {item.product_name}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {formatMoney(item.unit_price)} × {item.quantity} ={' '}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {formatMoney(item.unit_price * item.quantity)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCartItem(item.key, { quantity: 0 })}
                      className="p-1 text-slate-400 hover:text-rose-600"
                      aria-label="Remove item"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {item.colors.length > 0 && (
                        <select
                          value={item.variant_color}
                          onChange={(e) => updateCartItem(item.key, { variant_color: e.target.value })}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                        >
                          {item.colors.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      )}
                      {item.sizes.length > 0 && (
                        <select
                          value={item.variant_size}
                          onChange={(e) => updateCartItem(item.key, { variant_size: e.target.value })}
                          className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px]"
                        >
                          {item.sizes.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
                      <button
                        type="button"
                        onClick={() => updateCartItem(item.key, { quantity: item.quantity - 1 })}
                        className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-l-lg"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2.5 text-xs font-semibold tabular-nums">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateCartItem(item.key, {
                            quantity:
                              item.max_stock !== undefined
                                ? Math.min(item.max_stock, item.quantity + 1)
                                : item.quantity + 1,
                          })
                        }
                        className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-r-lg"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Customer Checkout Form */}
          <form onSubmit={handleTakeOrder} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'কাস্টমারের নাম *' : 'Customer Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={lang === 'bn' ? 'নাম লিখুন' : 'Full name'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'মোবাইল নম্বর *' : 'Phone Number *'}
                </label>
                <input
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'ডেলিভারি ঠিকানা *' : 'Delivery Address *'}
              </label>
              <textarea
                rows={2}
                required
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder={lang === 'bn' ? 'সম্পূর্ণ ঠিকানা লিখুন...' : 'House, road, area, district...'}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment'}
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'cod' | 'bkash' | 'nagad')}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="cod">Cash on Delivery</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'অর্ডার সোর্স' : 'Order Source'}
                </label>
                <select
                  value={orderSource}
                  onChange={(e) => setOrderSource(e.target.value as 'manual' | 'facebook' | 'whatsapp' | 'instagram')}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="manual">{lang === 'bn' ? 'ডিরেক্ট / স্টোর' : 'Direct / Store'}</option>
                  <option value="facebook">Facebook</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'ডেলিভারি চার্জ' : 'Delivery Charge'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={deliveryCharge}
                  onChange={(e) => setDeliveryCharge(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {lang === 'bn' ? 'ডিসকাউন্ট' : 'Discount'}
                </label>
                <input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs tabular-nums"
                />
              </div>
            </div>

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={lang === 'bn' ? 'অর্ডার নোট (ঐচ্ছিক)' : 'Order note (optional)'}
              className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
            />

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmNow}
                onChange={(e) => setConfirmNow(e.target.checked)}
                className="rounded border-[#E6E0FF] text-[#5B35F5]"
              />
              <span>
                {lang === 'bn'
                  ? 'সরাসরি কনফার্ম করুন ও স্টক সমন্বয় করুন'
                  : 'Confirm immediately & deduct stock'}
              </span>
            </label>

            {/* Totals Breakdown */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between text-slate-500">
                <span>{lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {discountNum > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>{lang === 'bn' ? 'ডিসকাউন্ট' : 'Discount'}</span>
                  <span>-{formatMoney(discountNum)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500">
                <span>{lang === 'bn' ? 'ডেলিভারি চার্জ' : 'Delivery Charge'}</span>
                <span>{formatMoney(deliveryNum)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white pt-1">
                <span>{lang === 'bn' ? 'সর্বমোট বিল' : 'Grand Total'}</span>
                <span>{formatMoney(grandTotal)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingOrder || cart.length === 0}
              className="w-full py-2.5 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-sm shadow-[#5B35F5]/20"
            >
              {submittingOrder && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {lang === 'bn'
                  ? `অর্ডার কনফার্ম করুন (${formatMoney(grandTotal)})`
                  : `Take Order (${formatMoney(grandTotal)})`}
              </span>
            </button>
          </form>
        </div>
      </div>

      {/* Quick Add Product Modal */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-display font-bold text-slate-900 dark:text-white">
                {lang === 'bn' ? 'মিনি স্টোরে নতুন পণ্য যোগ করুন' : 'Add Product to Mini Store'}
              </h2>
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-[#F3F0FF] dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleQuickAddProduct} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium mb-1">
                  {lang === 'bn' ? 'পণ্যের নাম *' : 'Product Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={qaName}
                  onChange={(e) => setQaName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'দাম *' : 'Price *'}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={qaPrice}
                    onChange={(e) => setQaPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'অফার দাম' : 'Discount'}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={qaDiscount}
                    onChange={(e) => setQaDiscount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'স্টক *' : 'Stock *'}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={qaStock}
                    onChange={(e) => setQaStock(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</label>
                  <input
                    type="text"
                    value={qaCategory}
                    onChange={(e) => setQaCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'কালার' : 'Colors'}</label>
                  <input
                    type="text"
                    value={qaColors}
                    onChange={(e) => setQaColors(e.target.value)}
                    placeholder="Red, Blue"
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{lang === 'bn' ? 'সাইজ' : 'Sizes'}</label>
                  <input
                    type="text"
                    value={qaSizes}
                    onChange={(e) => setQaSizes(e.target.value)}
                    placeholder="M, L, XL"
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  {lang === 'bn' ? 'পণ্যের ছবি' : 'Product Image'}
                </label>
                <div className="flex items-center gap-3">
                  {qaImageUrl && (
                    <img
                      src={qaImageUrl}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-xl object-cover border border-[#E6E0FF] dark:border-slate-700"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleQuickImageUpload}
                    className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-[#F3F0FF] dark:file:bg-slate-800 file:text-[#5B35F5] dark:file:text-slate-200 file:text-xs file:font-semibold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-xs font-medium"
                >
                  {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={qaSaving}
                  className="px-4 py-2 rounded-xl bg-[#5B35F5] hover:bg-[#4924DE] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  {qaSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{lang === 'bn' ? 'সেভ করুন' : 'Save Product'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
