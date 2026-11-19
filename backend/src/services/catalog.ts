import type { Queryable } from '../db/client.js';
import type { CartItemInput, Product, Quote, QuoteLine } from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import { canonicalJson, sha256Hex } from '../lib/ids.js';

const PRODUCT_COLUMNS =
  'id, merchant_id, sku, name, brand, description, category, unit, price_paise, currency, stock, tags, active';

export interface ProductSearch {
  query?: string | undefined;
  category?: string | undefined;
  maxPricePaise?: number | undefined;
  excludeTags?: string[] | undefined;
  includeInactive?: boolean;
  limit?: number | undefined;
}

export async function searchProducts(q: Queryable, merchantId: string, s: ProductSearch = {}): Promise<Product[]> {
  const where = ['merchant_id = $1'];
  const params: unknown[] = [merchantId];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (!s.includeInactive) where.push('active');
  if (s.query?.trim()) {
    // Match every word against name/brand/category/description, case-insensitively.
    for (const word of s.query.trim().split(/\s+/).slice(0, 6)) {
      const w = p(`%${word.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(name ILIKE ${w} OR brand ILIKE ${w} OR category ILIKE ${w} OR description ILIKE ${w})`);
    }
  }
  if (s.category) where.push(`category = ${p(s.category)}`);
  if (s.maxPricePaise !== undefined) where.push(`price_paise <= ${p(s.maxPricePaise)}`);
  if (s.excludeTags?.length) where.push(`NOT (tags && ${p(s.excludeTags)}::text[])`);
  const limit = Math.min(Math.max(s.limit ?? 50, 1), 200);
  return q.query<Product>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ${where.join(' AND ')} ORDER BY category, name LIMIT ${limit}`,
    params,
  );
}

export async function getProduct(q: Queryable, merchantId: string, id: string): Promise<Product | null> {
  const rows = await q.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE merchant_id = $1 AND id = $2`, [
    merchantId,
    id,
  ]);
  return rows[0] ?? null;
}

export async function listCategories(q: Queryable, merchantId: string) {
  return q.query<{ category: string; products: number }>(
    `SELECT category, count(*)::int AS products FROM products WHERE merchant_id = $1 AND active
     GROUP BY category ORDER BY category`,
    [merchantId],
  );
}

/** Hash of the merchant + exact lines + total. Any change to the cart changes the hash. */
export function cartHash(merchantId: string, currency: string, lines: Pick<QuoteLine, 'product_id' | 'unit_price_paise' | 'quantity'>[], totalPaise: number) {
  return sha256Hex(
    canonicalJson({
      merchant_id: merchantId,
      currency,
      total_paise: totalPaise,
      lines: lines.map((l) => ({ product_id: l.product_id, unit_price_paise: l.unit_price_paise, quantity: l.quantity })),
    }),
  );
}

/**
 * Prices a cart from the database (never trust agent-supplied prices).
 * Pass `lock: true` inside a transaction to row-lock products before reserving stock.
 */
export async function buildQuote(
  q: Queryable,
  merchantId: string,
  items: CartItemInput[],
  opts: { lock?: boolean } = {},
): Promise<Quote> {
  // Merge duplicate product lines so limits and stock apply to the real quantity.
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.product_id, (merged.get(it.product_id) ?? 0) + it.quantity);

  const ids = [...merged.keys()].sort();
  const products = await q.query<Product>(
    `SELECT ${PRODUCT_COLUMNS} FROM products WHERE merchant_id = $1 AND id = ANY($2::text[]) ORDER BY id${
      opts.lock ? ' FOR UPDATE' : ''
    }`,
    [merchantId, ids],
  );
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: QuoteLine[] = [];
  let lineNo = 0;
  for (const [productId, quantity] of merged) {
    const product = byId.get(productId);
    if (!product || !product.active) throw new AppError('not_found', `Product ${productId} not found`);
    if (product.stock < quantity) {
      throw new AppError('out_of_stock', `Only ${product.stock} × "${product.name}" in stock`, {
        product_id: productId,
        available: product.stock,
      });
    }
    lineNo += 1;
    lines.push({
      line_no: lineNo,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      tags: product.tags,
      unit_price_paise: product.price_paise,
      quantity,
      line_total_paise: product.price_paise * quantity,
    });
  }

  const currency = products[0]?.currency ?? 'INR';
  if (products.some((p) => p.currency !== currency)) throw new AppError('validation_error', 'Mixed currencies in cart');
  const subtotal = lines.reduce((s, l) => s + l.line_total_paise, 0);
  const total = subtotal; // No tax/shipping modelled yet; kept separate so they can be added.
  return {
    merchant_id: merchantId,
    currency,
    lines,
    subtotal_paise: subtotal,
    total_paise: total,
    cart_hash: cartHash(merchantId, currency, lines, total),
  };
}
