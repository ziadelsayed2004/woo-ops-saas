import { createCipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ConnectorCapabilities, ReadOnlyCommerceConnector } from './index.js';

export type WooCredentials = { key: string; secret: string };
export type WooCatalogKind = 'products' | 'categories' | 'tags' | 'shipping_classes';
export type WooOrderKind = 'orders' | 'refunds';
export type WooCatalogPage = {
  kind: WooCatalogKind;
  page: number;
  totalPages: number;
  items: readonly unknown[];
};
export type NormalizedCatalogItem = {
  identity: string;
  kind: 'product' | 'variation' | 'category' | 'tag' | 'shipping_class';
  externalId: string;
  parentExternalId: string | null;
  name: string;
  sku: string | null;
  sourceJson: string;
};
export type NormalizedOrder = {
  externalOrderId: string;
  orderNumber: string;
  remoteStatus: string;
  currency: string;
  grandTotalMinor: string;
  createdAt: string | null;
  modifiedAt: string | null;
  customer: Record<string, unknown>;
  billing: Record<string, unknown>;
  shipping: Record<string, unknown>;
  lines: readonly Record<string, unknown>[];
  refunds: readonly Record<string, unknown>[];
  sourceJson: string;
  sourceHash: string;
};
export type CredentialEnvelope = {
  algorithm: 'aes-256-gcm';
  keyVersion: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export const canonicalizeStoreUrl = (input: string): URL => {
  const url = new URL(input.trim());
  if (
    url.protocol !== 'https:' &&
    !(process.env.NODE_ENV === 'development' && url.hostname === 'localhost')
  )
    throw new Error('CONNECTOR_HTTPS_REQUIRED');
  if (url.username || url.password || (url.port && !['443', '80'].includes(url.port)))
    throw new Error('CONNECTOR_URL_UNSAFE');
  if (
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.internal')
  )
    throw new Error('CONNECTOR_PRIVATE_HOST');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
};

export const createAuthorizationUrl = (
  storeUrl: URL,
  input: { state: string; returnUrl: string; callbackUrl: string; appName?: string },
): string => {
  const url = new URL('/wc-auth/v1/authorize', storeUrl);
  url.searchParams.set('app_name', input.appName ?? 'Woo Ops');
  url.searchParams.set('scope', 'read');
  url.searchParams.set('user_id', 'woo-ops');
  url.searchParams.set('return_url', input.returnUrl);
  url.searchParams.set('callback_url', input.callbackUrl);
  url.searchParams.set('state', input.state);
  return url.toString();
};

export const encryptCredentialEnvelope = (
  credentials: WooCredentials,
  secret: string,
  keyVersion = 'v1',
): CredentialEnvelope => {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY_INVALID');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  return {
    algorithm: 'aes-256-gcm',
    keyVersion,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};

export const verifyWebhookSignature = (
  rawBody: Uint8Array,
  signature: string,
  secret: string,
): boolean => {
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const received = Buffer.from(signature, 'base64');
  const calculated = Buffer.from(expected, 'base64');
  return received.length === calculated.length && timingSafeEqual(received, calculated);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requiredInteger = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`WOO_SCHEMA_INVALID:${key}`);
  return Number(value);
};

export const decimalToMinorUnits = (value: unknown, fractionDigits = 2): string => {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))
    throw new Error('WOO_MONEY_INVALID');
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > fractionDigits) throw new Error('WOO_MONEY_PRECISION');
  const minor =
    BigInt(whole ?? '0') * 10n ** BigInt(fractionDigits) +
    BigInt(fraction.padEnd(fractionDigits, '0') || 0);
  return (negative ? -minor : minor).toString();
};

const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('WOO_DATE_INVALID');
  return date.toISOString();
};

export const normalizeWooOrder = (value: unknown): NormalizedOrder => {
  const record = asRecord(value);
  if (!record || !Number.isInteger(record.id) || typeof record.number !== 'string')
    throw new Error('WOO_SCHEMA_INVALID:order');
  if (typeof record.currency !== 'string' || typeof record.total !== 'string')
    throw new Error('WOO_SCHEMA_INVALID:order_amounts');
  const lines = Array.isArray(record.line_items)
    ? record.line_items.map((item) => {
        const line = asRecord(item);
        if (
          !line ||
          !Number.isInteger(line.id) ||
          !Number.isInteger(line.quantity) ||
          typeof line.total !== 'string'
        )
          throw new Error('WOO_SCHEMA_INVALID:line');
        return {
          externalLineId: String(line.id),
          productId: Number.isInteger(line.product_id) ? line.product_id : null,
          variationId: Number.isInteger(line.variation_id) ? line.variation_id : null,
          sku: typeof line.sku === 'string' ? line.sku : null,
          name: typeof line.name === 'string' ? line.name : '',
          quantity: line.quantity,
          subtotalMinor: decimalToMinorUnits(line.subtotal ?? '0'),
          totalMinor: decimalToMinorUnits(line.total),
          taxMinor: decimalToMinorUnits(line.total_tax ?? '0'),
          source: line,
        };
      })
    : [];
  const refunds = Array.isArray(record.refunds)
    ? record.refunds.map((item) => {
        const refund = asRecord(item);
        if (!refund || !Number.isInteger(refund.id) || typeof refund.total !== 'string')
          throw new Error('WOO_SCHEMA_INVALID:refund');
        return {
          externalRefundId: String(refund.id),
          amountMinor: decimalToMinorUnits(refund.total),
          reason: refund.reason ?? null,
          source: refund,
        };
      })
    : [];
  const normalized = {
    externalOrderId: String(record.id),
    orderNumber: record.number,
    remoteStatus: typeof record.status === 'string' ? record.status : 'unknown',
    currency: record.currency,
    grandTotalMinor: decimalToMinorUnits(record.total),
    createdAt: isoOrNull(record.date_created_gmt ?? record.date_created),
    modifiedAt: isoOrNull(record.date_modified_gmt ?? record.date_modified),
    customer: asRecord(record.billing) ?? {},
    billing: asRecord(record.billing) ?? {},
    shipping: asRecord(record.shipping) ?? {},
    lines,
    refunds,
    sourceJson: JSON.stringify(record),
  };
  const sourceHash = createHmac('sha256', 'woo-ops-normalizer-v1')
    .update(normalized.sourceJson)
    .digest('hex');
  return { ...normalized, sourceHash };
};

export const normalizeCatalogRecord = (
  kind: WooCatalogKind,
  value: unknown,
): Record<string, unknown> => {
  const record = asRecord(value);
  if (!record) throw new Error('WOO_SCHEMA_INVALID:record');
  const id = requiredInteger(record, 'id');
  if (kind === 'products') {
    if (typeof record.name !== 'string' || typeof record.type !== 'string') {
      throw new Error('WOO_SCHEMA_INVALID:product');
    }
    const variations = Array.isArray(record.variations) ? record.variations : [];
    return {
      externalProductId: id,
      externalVariationId: null,
      name: record.name,
      sku: typeof record.sku === 'string' ? record.sku : null,
      type: record.type,
      status: typeof record.status === 'string' ? record.status : 'unknown',
      categories: Array.isArray(record.categories) ? record.categories : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
      shippingClass: typeof record.shipping_class === 'string' ? record.shipping_class : null,
      attributes: Array.isArray(record.attributes) ? record.attributes : [],
      variations: variations.filter((item) => {
        const variation = asRecord(item);
        return variation !== null && Number.isInteger(variation.id);
      }),
      remoteCreatedAt: typeof record.date_created_gmt === 'string' ? record.date_created_gmt : null,
      remoteModifiedAt:
        typeof record.date_modified_gmt === 'string' ? record.date_modified_gmt : null,
      source: record,
    };
  }
  if (typeof record.name !== 'string') throw new Error(`WOO_SCHEMA_INVALID:${kind}`);
  return {
    externalId: id,
    name: record.name,
    slug: typeof record.slug === 'string' ? record.slug : null,
    source: record,
  };
};

export const catalogIdentity = (kind: WooCatalogKind, record: Record<string, unknown>): string => {
  if (kind === 'products') {
    const productId = String(record.externalProductId);
    const variationId = record.externalVariationId;
    return `product:${productId}:variation:${variationId === null ? 'base' : String(variationId)}`;
  }
  return `${kind}:${String(record.externalId)}`;
};

export const toCatalogItems = (page: WooCatalogPage): NormalizedCatalogItem[] => {
  const items: NormalizedCatalogItem[] = [];
  for (const value of page.items) {
    const record = value as Record<string, unknown>;
    if (page.kind === 'products') {
      const productId = String(record.externalProductId);
      const productJson = JSON.stringify(record);
      items.push({
        identity: catalogIdentity(page.kind, record),
        kind: 'product',
        externalId: productId,
        parentExternalId: null,
        name: String(record.name),
        sku: typeof record.sku === 'string' ? record.sku : null,
        sourceJson: productJson,
      });
      for (const variation of record.variations as Record<string, unknown>[]) {
        const variationId = String(variation.id);
        items.push({
          identity: `product:${productId}:variation:${variationId}`,
          kind: 'variation',
          externalId: variationId,
          parentExternalId: productId,
          name: String(variation.description ?? record.name),
          sku: typeof variation.sku === 'string' ? variation.sku : null,
          sourceJson: JSON.stringify(variation),
        });
      }
    } else {
      const externalId = String(record.externalId);
      items.push({
        identity: catalogIdentity(page.kind, record),
        kind:
          page.kind === 'shipping_classes'
            ? 'shipping_class'
            : (page.kind.slice(0, -1) as 'category' | 'tag'),
        externalId,
        parentExternalId: null,
        name: String(record.name),
        sku: null,
        sourceJson: JSON.stringify(record),
      });
    }
  }
  return items;
};

export class WooCommerceConnector implements ReadOnlyCommerceConnector {
  readonly platform = 'woocommerce';
  readonly capabilities: ConnectorCapabilities = { products: true, orders: true, webhooks: true };
  constructor(
    private readonly webhookSecret: string,
    private readonly storeUrl?: URL,
    private readonly credentials?: WooCredentials,
    private readonly request: typeof fetch = fetch,
  ) {}
  pullOrders(): AsyncIterable<unknown> {
    return this.pullRemote('orders');
  }
  pullProducts(): AsyncIterable<unknown> {
    return this.pullCatalog('products');
  }
  async *pullCatalog(
    kind: WooCatalogKind,
    perPage = 100,
    startPage = 1,
  ): AsyncIterable<WooCatalogPage> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new Error('WOO_PAGE_SIZE_INVALID');
    }
    const endpoint = `/wp-json/wc/v3/${kind}`;
    for (let page = startPage; ; page += 1) {
      const url = new URL(endpoint, this.storeUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      const response = await this.request(url, {
        headers: {
          authorization: `Basic ${Buffer.from(`${this.credentials.key}:${this.credentials.secret}`).toString('base64')}`,
          accept: 'application/json',
        },
      });
      if (response.status === 429) throw new Error('WOO_RATE_LIMITED');
      if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('WOO_SCHEMA_INVALID:page');
      const totalPages = Number(response.headers.get('x-wp-totalpages') ?? page);
      if (!Number.isInteger(totalPages) || totalPages < page)
        throw new Error('WOO_SCHEMA_INVALID:pagination');
      yield {
        kind,
        page,
        totalPages,
        items: body.map((item) => normalizeCatalogRecord(kind, item)),
      };
      if (page >= totalPages || body.length === 0) return;
    }
  }

  async syncCatalog(
    onPage: (page: WooCatalogPage, items: readonly NormalizedCatalogItem[]) => Promise<void>,
  ): Promise<void> {
    for (const kind of ['categories', 'tags', 'shipping_classes', 'products'] as const) {
      for await (const page of this.pullCatalog(kind)) await onPage(page, toCatalogItems(page));
    }
  }
  async *pullRemote(
    kind: WooOrderKind,
    perPage = 100,
    startPage = 1,
  ): AsyncIterable<readonly unknown[]> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100)
      throw new Error('WOO_PAGE_SIZE_INVALID');
    for (let page = startPage; ; page += 1) {
      const url = new URL(`/wp-json/wc/v3/${kind}`, this.storeUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      const response = await this.request(url, {
        headers: {
          authorization: `Basic ${Buffer.from(`${this.credentials.key}:${this.credentials.secret}`).toString('base64')}`,
          accept: 'application/json',
        },
      });
      if (response.status === 429) throw new Error('WOO_RATE_LIMITED');
      if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('WOO_SCHEMA_INVALID:page');
      yield body;
      const totalPages = Number(response.headers.get('x-wp-totalpages') ?? page);
      if (!Number.isInteger(totalPages) || totalPages < page)
        throw new Error('WOO_SCHEMA_INVALID:pagination');
      if (page >= totalPages || body.length === 0) return;
    }
  }
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<boolean> {
    return Promise.resolve(verifyWebhookSignature(rawBody, signature, this.webhookSecret));
  }
}
