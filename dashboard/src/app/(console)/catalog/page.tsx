'use client';

import { useMemo, useState } from 'react';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { ApiError, admin, useAdmin, useLiveReload } from '@/lib/api';
import { formatPaise, titleCase } from '@/lib/format';
import type { Product } from '@/lib/types';

export default function CatalogPage() {
  const { data, error, reload } = useAdmin<{ products: Product[] }>('/products');
  useLiveReload(reload, (e) => e.type === 'product.updated' || e.type === 'order.created' || e.type === 'order.updated');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');

  const categories = useMemo(() => [...new Set(data?.products.map((p) => p.category))].sort(), [data]);
  const rows = (data?.products ?? []).filter(
    (p) => (!category || p.category === category) && (!q || `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        kicker="PRODUCTS"
        title="Catalog"
        description="The single catalog every protocol reads from. Prices are always taken from here, never from the agent. Stock is reserved at checkout and released if an order is rejected or expires."
      />
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by category">
          <button className={`tab ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} className={`tab ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {titleCase(c)}
            </button>
          ))}
        </div>
        <label className="search-box">
          <span className="search-icon" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" />
        </label>
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      <section className="section-block">
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Tags</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th>Listed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <ProductRow key={p.id} p={p} onSaved={reload} />
              ))}
            </tbody>
          </table>
          {!data && !error && (
            <div className="card-body">
              <Skeleton rows={8} />
            </div>
          )}
        </div>
        {data && (
          <div className="table-footer">
            {rows.length} of {data.products.length} products
          </div>
        )}
      </section>
    </>
  );
}

function ProductRow({ p, onSaved }: { p: Product; onSaved: () => void }) {
  const [stock, setStock] = useState(String(p.stock));
  const [price, setPrice] = useState(String(p.price_paise / 100));
  const [err, setErr] = useState<string | null>(null);
  const dirty = Number(stock) !== p.stock || Math.round(Number(price) * 100) !== p.price_paise;

  const save = async (body: Partial<Product>) => {
    setErr(null);
    try {
      await admin.patch(`/products/${p.id}`, body);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    }
  };

  return (
    <tr className={p.active ? '' : 'is-dim'}>
      <td>
        <strong>{p.name}</strong>
        <span className="sub">
          {p.brand} · {p.unit} · <span className="mono">{p.sku}</span>
        </span>
        {err && <span className="error-text small">{err}</span>}
      </td>
      <td>{titleCase(p.category)}</td>
      <td>
        <span className="tags">
          {p.tags.map((t) => (
            <span key={t} className={`tag ${t.startsWith('contains:') ? 'tag-warn' : ''}`}>
              {t}
            </span>
          ))}
        </span>
      </td>
      <td className="num">
        <input
          className="input input-sm input-num"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-label={`Price of ${p.name} in rupees`}
          title={formatPaise(p.price_paise)}
        />
      </td>
      <td className="num">
        <input
          className={`input input-sm input-num ${p.stock < 15 ? 'input-warn' : ''}`}
          type="number"
          min={0}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          aria-label={`Stock of ${p.name}`}
        />
        {dirty && (
          <button className="btn btn-sm btn-primary inline-save" onClick={() => save({ stock: Number(stock), price_paise: Math.round(Number(price) * 100) })}>
            Save
          </button>
        )}
      </td>
      <td>
        <label className="switch">
          <input type="checkbox" checked={p.active} onChange={(e) => save({ active: e.target.checked })} aria-label={`List ${p.name}`} />
          <span />
        </label>
      </td>
    </tr>
  );
}
