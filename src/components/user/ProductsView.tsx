import React, { useEffect, useState } from 'react';
import { Copy, Edit2, Loader2, Package, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { apiFetch, fileToBase64, formatMoney } from '../../lib/api';
import type { Business, Product } from '../../types';
import type { Lang } from '../../i18n/translations';

interface ProductsViewProps {
  business: Business;
  lang: Lang;
}

export const ProductsView: React.FC<ProductsViewProps> = ({ business, lang }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'low_stock' | 'out_of_stock'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryName, setCategoryName] = useState('General');
  const [description, setDescription] = useState('');
  const [regularPrice, setRegularPrice] = useState('0');
  const [discountPrice, setDiscountPrice] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('0');
  const [stockQuantity, setStockQuantity] = useState('10');
  const [colorsText, setColorsText] = useState('');
  const [sizesText, setSizesText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [status, setStatus] = useState<'active' | 'draft' | 'out_of_stock'>('active');

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ products: Product[] }>(`/api/businesses/${business.id}/products`, {
        businessId: business.id,
      });
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, [business.id]);

  const openModal = (prod?: Product) => {
    if (prod) {
      setEditing(prod);
      setName(prod.name);
      setSku(prod.sku);
      setCategoryName(prod.category_name);
      setDescription(prod.description);
      setRegularPrice(String(prod.regular_price));
      setDiscountPrice(prod.discount_price !== null ? String(prod.discount_price) : '');
      setPurchaseCost(String(prod.purchase_cost));
      setStockQuantity(String(prod.stock_quantity));
      setColorsText((prod.colors || []).join(', '));
      setSizesText((prod.sizes || []).join(', '));
      setImages(prod.images?.map((i) => i.image_url) || (prod.primary_image_url ? [prod.primary_image_url] : []));
      setStatus(prod.status);
    } else {
      setEditing(null);
      setName('');
      setSku('');
      setCategoryName('General');
      setDescription('');
      setRegularPrice('');
      setDiscountPrice('');
      setPurchaseCost('');
      setStockQuantity('10');
      setColorsText('');
      setSizesText('');
      setImages([]);
      setStatus('active');
    }
    setModalOpen(true);
  };

  const handleUploadImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const b64 = await fileToBase64(file);
      try {
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
        setImages((prev) => [...prev, uploaded.url]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Image upload failed');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name,
        sku,
        category_name: categoryName,
        description,
        regular_price: Number(regularPrice || 0),
        discount_price: discountPrice ? Number(discountPrice) : null,
        purchase_cost: Number(purchaseCost || 0),
        stock_quantity: Number(stockQuantity || 0),
        colors: colorsText.split(',').map((s) => s.trim()).filter(Boolean),
        sizes: sizesText.split(',').map((s) => s.trim()).filter(Boolean),
        images,
        primary_image_url: images[0] || '',
        status,
      };

      if (editing) {
        await apiFetch(`/api/businesses/${business.id}/products/${editing.id}`, {
          method: 'PATCH',
          businessId: business.id,
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/businesses/${business.id}/products`, {
          method: 'POST',
          businessId: business.id,
          body: JSON.stringify(payload),
        });
      }
      setModalOpen(false);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (prod: Product) => {
    await apiFetch(`/api/businesses/${business.id}/products`, {
      method: 'POST',
      businessId: business.id,
      body: JSON.stringify({
        ...prod,
        name: `${prod.name} (Copy)`,
        sku: `${prod.sku}-COPY`,
        images: prod.images?.map((i) => i.image_url) || [],
      }),
    });
    await loadProducts();
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await apiFetch(`/api/businesses/${business.id}/products/${id}`, {
      method: 'DELETE',
      businessId: business.id,
    });
    await loadProducts();
  };

  const filtered = products.filter((p) => {
    if (statusFilter === 'active' && p.status !== 'active') return false;
    if (statusFilter === 'out_of_stock' && p.stock_quantity > 0) return false;
    if (statusFilter === 'low_stock' && (p.stock_quantity <= 0 || p.stock_quantity > p.low_stock_threshold)) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl p-5 bx-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white">
            {lang === 'bn' ? 'পণ্য ও ইনভেন্টরি ম্যানেজমেন্ট' : 'Products & Inventory'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            AI Customer Agent automatically pulls prices, stock, and variants from this catalog.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5B35F5] text-white text-xs font-semibold hover:bg-[#4924DE] shadow-sm shadow-[#5B35F5]/20"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'bn' ? 'নতুন পণ্য যোগ করুন' : 'Add Product'}</span>
        </button>
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
            placeholder="Search by product name or SKU..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <div className="inline-flex items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-xl border border-[#E6E0FF] dark:border-slate-800">
          {(
            [
              ['all', 'All'],
              ['active', 'Active'],
              ['low_stock', 'Low Stock'],
              ['out_of_stock', 'Out of Stock'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                statusFilter === k ? 'bg-[#5B35F5] text-white shadow-sm' : 'text-slate-500 hover:text-[#5B35F5]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-[#E6E0FF] dark:border-slate-800 rounded-2xl bx-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F9F7FF] dark:bg-slate-950/60 border-b border-[#E6E0FF] dark:border-slate-800 text-xs text-slate-500">
            <tr>
              <th className="py-3.5 px-4 font-semibold">Product</th>
              <th className="py-3.5 px-4 font-semibold">SKU</th>
              <th className="py-3.5 px-4 font-semibold">Category</th>
              <th className="py-3.5 px-4 font-semibold text-right">Price</th>
              <th className="py-3.5 px-4 font-semibold text-right">Stock</th>
              <th className="py-3.5 px-4 font-semibold">Status</th>
              <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E6E0FF]/60 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                  Loading products...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-slate-400">
                  No products found. Click "Add Product" to create your first item.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {p.primary_image_url ? (
                        <img
                          src={p.primary_image_url}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                          <Package className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">{p.name}</div>
                        <div className="text-xs text-slate-400">
                          {[p.colors?.length ? `Colors: ${p.colors.join('/')}` : '', p.sizes?.length ? `Sizes: ${p.sizes.join('/')}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500">{p.sku}</td>
                  <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">{p.category_name}</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {p.discount_price !== null ? (
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">{formatMoney(p.discount_price)}</span>
                        <span className="ml-1.5 text-xs line-through text-slate-400">{formatMoney(p.regular_price)}</span>
                      </div>
                    ) : (
                      <span className="font-semibold text-slate-900 dark:text-white">{formatMoney(p.regular_price)}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-mono">
                    <span className={p.stock_quantity <= p.low_stock_threshold ? 'text-amber-600 font-semibold' : ''}>
                      {p.stock_quantity}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs capitalize">
                    <span
                      className={
                        p.stock_quantity <= 0
                          ? 'text-rose-600 font-medium'
                          : p.status === 'active'
                          ? 'text-emerald-600 font-medium'
                          : 'text-slate-500'
                      }
                    >
                      {p.stock_quantity <= 0 ? 'Out of stock' : p.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => openModal(p)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => void handleDuplicate(p)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" title="Duplicate">
                        <Copy className="w-4 h-4" />
                      </button>
                      {confirmDeleteId === p.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDelete(p.id)}
                            className="px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-medium hover:bg-rose-700"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-rose-600" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {editing ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Product Name *</label>
                  <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SKU</label>
                  <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Auto-generated if blank" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Regular Price *</label>
                  <input type="number" required min="0" step="0.01" value={regularPrice} onChange={(e) => setRegularPrice(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Discount Price</label>
                  <input type="number" min="0" step="0.01" value={discountPrice} onChange={(e) => setDiscountPrice(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Purchase Cost</label>
                  <input type="number" min="0" step="0.01" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Stock Qty *</label>
                  <input type="number" required min="0" value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Category</label>
                  <input type="text" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Colors (comma separated)</label>
                  <input type="text" value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="Black, Navy, White" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Sizes (comma separated)</label>
                  <input type="text" value={sizesText} onChange={(e) => setSizesText(e.target.value)} placeholder="M, L, XL" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm" />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Product Images (Supabase Storage)</label>
                <div className="flex flex-wrap items-center gap-2">
                  {images.map((img, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                      <img src={img} alt="Product" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <label className="w-16 h-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center cursor-pointer text-xs text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Upload className="w-4 h-4" />
                    <input type="file" multiple accept="image/*" onChange={handleUploadImages} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl border border-[#E6E0FF] dark:border-slate-700 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-[#5B35F5] text-white text-sm font-semibold flex items-center gap-2 hover:bg-[#4924DE]">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Save Product</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
