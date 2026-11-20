'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Minus, Package, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CategoryIcon } from '@/components/icons';
import { EmptyState, ErrorState, Overlay, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { ApiError, admin, useAdmin, useLiveReload } from '@/lib/api';
import { formatPaise, titleCase } from '@/lib/format';
import type { Product } from '@/lib/types';

export default function ProductsPage() {
  const { data, error, reload } = useAdmin<{ products: Product[] }>('/products');
  useLiveReload(reload, (e) => e.type === 'product.updated' || e.type.startsWith('order'));
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);

  const categories = useMemo(() => [...new Set(data?.products.map((p) => p.category))].sort(), [data]);
  const rows = (data?.products ?? []).filter(
    (p) => (category === 'all' || p.category === category) && (!q || `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q.toLowerCase())),
  );
  const low = (data?.products ?? []).filter((p) => p.active && p.stock < 15).length;

  return (
    <>
      <PageHeader
        icon={Package}
        title="Products"
        description="Your catalog, shared by every AI assistant. Agents always pay the price set here; they can’t change it. Stock is held the moment an order is placed and released if it doesn’t go through."
      />
      <div className="toolbar">
        <Tabs
          label="Category"
          value={category}
          onChange={setCategory}
          items={[{ value: 'all', label: 'All' }, ...categories.map((c) => ({ value: c, label: titleCase(c) }))]}
        />
        <label className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" />
        </label>
      </div>
      {low > 0 && <p className="small text-warn hint-line">{low} {low === 1 ? 'product is' : 'products are'} running low (under 15 left).</p>}

      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <Skeleton rows={6} height={90} />}
      {data && rows.length === 0 && (
        <section className="card">
          <EmptyState icon={Package} title="No products match" />
        </section>
      )}
      <motion.div layout className="product-grid">
        <AnimatePresence>
          {rows.map((p) => (
            <motion.button
              layout
              key={p.id}
              className={`product-card ${p.active ? '' : 'is-off'}`}
              onClick={() => setEditing(p)}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.2 }}
            >
              <div className="row-between">
                <CategoryIcon category={p.category} />
                {!p.active ? <span className="pill tone-muted pill-sm">Hidden</span> : p.stock < 15 ? <span className="pill tone-warn pill-sm">Low stock</span> : null}
              </div>
              <strong className="product-name">{p.name}</strong>
              <span className="muted small">
                {p.brand} · {p.unit}
              </span>
              <div className="product-tags">
                {p.tags
                  .filter((t) => t.startsWith('contains:') || t === 'subjective')
                  .map((t) => (
                    <span key={t} className={`tag ${t === 'subjective' ? '' : 'tag-warn'}`}>
                      {t === 'subjective' ? 'taste-driven' : t.replace('contains:', 'contains ')}
                    </span>
                  ))}
              </div>
              <div className="product-foot">
                <b>{formatPaise(p.price_paise)}</b>
                <span className="stock-meter" title={`${p.stock} in stock`}>
                  <span style={{ width: `${Math.min(100, (p.stock / 150) * 100)}%` }} className={p.stock < 15 ? 'low' : ''} />
                </span>
                <span className="small muted">{p.stock} left</span>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>

      <Overlay open={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ''} variant="drawer">
        {editing && (
          <EditProduct
            key={editing.id}
            p={editing}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </Overlay>
    </>
  );
}

function EditProduct({ p, onSaved }: { p: Product; onSaved: () => void }) {
  const [price, setPrice] = useState(p.price_paise / 100);
  const [stock, setStock] = useState(p.stock);
  const [active, setActive] = useState(p.active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await admin.patch(`/products/${p.id}`, { price_paise: Math.round(price * 100), stock, active });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <div className="edit-hero">
        <CategoryIcon category={p.category} size={26} />
        <div>
          <b>{p.brand}</b>
          <span className="muted small">
            {titleCase(p.category)} · {p.unit} · <span className="mono">{p.sku}</span>
          </span>
        </div>
      </div>
      <label className="field">
        <span>Price (₹)</span>
        <input className="input input-lg" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
      </label>
      <div className="field">
        <span>In stock</span>
        <div className="stepper-input">
          <button type="button" className="icon-btn" onClick={() => setStock(Math.max(0, stock - 10))} aria-label="Remove 10">
            <Minus size={16} />
          </button>
          <input className="input input-lg" type="number" min={0} value={stock} onChange={(e) => setStock(Math.max(0, Number(e.target.value)))} aria-label="Stock" />
          <button type="button" className="icon-btn" onClick={() => setStock(stock + 10)} aria-label="Add 10">
            <Plus size={16} />
          </button>
        </div>
        <small>Use + / − to add or remove 10 at a time.</small>
      </div>
      <label className="toggle-row">
        <span>
          <b>Show to AI agents</b>
          <small>Hidden products can’t be found or bought by any agent.</small>
        </span>
        <span className="switch">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span />
        </span>
      </label>
      {p.tags.length > 0 && (
        <div className="field">
          <span>Tags agents and rules can see</span>
          <div className="product-tags">
            {p.tags.map((t) => (
              <span key={t} className={`tag ${t.startsWith('contains:') ? 'tag-warn' : ''}`}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {err && <p className="text-bad">{err}</p>}
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
