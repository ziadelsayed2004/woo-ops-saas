import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EGYPTIAN_GOVERNORATES, egyptianGovernorate } from '@woo-ops/domain';
import type {
  ConnectorCapabilities,
  ConnectorDiscovery,
  ConnectorErrorCategory,
  ConnectorHealth,
  ReadOnlyCommerceConnector,
} from './index.js';

export type WooCredentials = { key: string; secret: string };
export type WooCatalogKind = 'products' | 'categories' | 'tags' | 'shipping_classes';
export type WooOrderKind = 'orders' | 'refunds';
export type WooOrderPage = Readonly<{
  kind: WooOrderKind;
  page: number;
  totalPages: number;
  items: readonly unknown[];
}>;
export type WooCatalogPage = {
  kind: WooCatalogKind;
  page: number;
  totalPages: number;
  items: readonly unknown[];
};
export type WooShippingRate = Readonly<{
  zoneId: string;
  methodId: string;
  title: string;
  stateCode: string;
  amountMinor: string;
  currency: 'EGP';
}>;
type WooRemoteExportStatus = Readonly<{
  id: number;
  key: '_wc_customer_order_csv_export_is_exported';
  status: 'exported' | 'not_exported' | 'unknown';
  source:
    | 'extension_api'
    | 'taxonomy'
    | 'legacy_meta'
    | 'legacy_order_meta'
    | 'legacy_post_meta'
    | 'unavailable';
  bridgeVersion: string;
}>;
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
  createdVia: string | null;
  channel: string | null;
  posLocation: string | null;
  externalCustomerId: string | null;
  currency: string;
  grandTotalMinor: string;
  customerNote?: string | null;
  amounts: Readonly<{
    merchandiseSubtotalMinor: string;
    discountMinor: string;
    merchandiseNetMinor: string;
    shippingCollectedMinor: string;
    taxMinor: string;
    feesMinor: string;
    refundMinor: string;
    grandTotalMinor: string;
    collectedMinor: string;
  }>;
  createdAt: string | null;
  modifiedAt: string | null;
  customer: Record<string, unknown>;
  billing: Record<string, unknown>;
  shipping: Record<string, unknown>;
  payment: Record<string, unknown>;
  shippingMethod: Record<string, unknown>;
  paymentMethodId: string | null;
  paymentMethodTitle: string | null;
  paymentStatus: string | null;
  paidAt: string | null;
  shippingMethodId: string | null;
  shippingMethodTitle: string | null;
  shippingCarrier: string | null;
  shippingCollectedMinor: string;
  taxLines: readonly Record<string, unknown>[];
  feeLines: readonly Record<string, unknown>[];
  couponLines: readonly Record<string, unknown>[];
  shippingLines: readonly Record<string, unknown>[];
  lines: readonly Record<string, unknown>[];
  refunds: readonly Record<string, unknown>[];
  quantityTotal: number;
  productIds: readonly string[];
  variationIds: readonly string[];
  skus: readonly string[];
  categories: readonly string[];
  authors: readonly string[];
  tags: readonly string[];
  couponCodes: readonly string[];
  metadata: readonly Record<string, unknown>[];
  remoteExportStatus: string | null;
  remoteExportStatusKey: string | null;
  remoteExportStatusSource: string | null;
  remoteExportBridgeVersion: string | null;
  exceptionState: string | null;
  sourceTimezone: string | null;
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

export type WooPullOptions = Readonly<{
  modifiedAfter?: string;
  modifiedBefore?: string;
  after?: string;
  before?: string;
  orderby?: 'date' | 'modified' | 'id';
  order?: 'asc' | 'desc';
}>;

const envelopeFields = (value: unknown): CredentialEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CREDENTIAL_ENVELOPE_INVALID');
  const record = value as Record<string, unknown>;
  if (
    record.algorithm !== 'aes-256-gcm' ||
    typeof record.keyVersion !== 'string' ||
    !record.keyVersion ||
    typeof record.iv !== 'string' ||
    typeof record.tag !== 'string' ||
    typeof record.ciphertext !== 'string'
  )
    throw new Error('CREDENTIAL_ENVELOPE_INVALID');
  return {
    algorithm: 'aes-256-gcm',
    keyVersion: record.keyVersion,
    iv: record.iv,
    tag: record.tag,
    ciphertext: record.ciphertext,
  };
};

const encryptionKey = (secret: string): Buffer => {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY_INVALID');
  return key;
};

const encryptEnvelope = (
  plaintext: string,
  secret: string,
  keyVersion: string,
): CredentialEnvelope => {
  if (!plaintext || plaintext.length > 4096) throw new Error('CREDENTIAL_VALUE_INVALID');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    keyVersion,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};

const hostWithoutBrackets = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

const privateIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return true;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && second >= 18 && second <= 19) ||
    first >= 224
  );
};

const isPrivateHost = (hostname: string): boolean => {
  const host = hostWithoutBrackets(hostname).toLowerCase().replace(/\.$/u, '');
  const version = isIP(host);
  if (version === 4) return privateIpv4(host);
  if (version === 6) {
    return (
      host === '::1' ||
      host.startsWith('::ffff:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/u.test(host)
    );
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  );
};

const assertSafeStoreUrl = (url: URL): void => {
  if (url.protocol !== 'https:') throw new Error('CONNECTOR_HTTPS_REQUIRED');
  if (url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('CONNECTOR_URL_UNSAFE');
  if (isPrivateHost(url.hostname)) throw new Error('CONNECTOR_PRIVATE_HOST');
};

type HostResolver = (hostname: string) => Promise<readonly { address: string }[]>;

const defaultHostResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export const assertPublicStoreUrl = async (
  url: URL,
  resolveHost: HostResolver = defaultHostResolver,
): Promise<void> => {
  assertSafeStoreUrl(url);
  let addresses: readonly { address: string }[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new Error('CONNECTOR_HOST_UNRESOLVED');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateHost(address)))
    throw new Error('CONNECTOR_PRIVATE_HOST');
};

export const canonicalizeStoreUrl = (input: string): URL => {
  const url = new URL(input.trim());
  assertSafeStoreUrl(url);
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
};

export const createAuthorizationUrl = (
  storeUrl: URL,
  input: { state: string; returnUrl: string; callbackUrl: string; appName?: string },
): string => {
  assertSafeStoreUrl(storeUrl);
  const url = new URL('/wc-auth/v1/authorize', storeUrl);
  url.searchParams.set('app_name', input.appName ?? 'Woo Ops');
  url.searchParams.set('scope', 'read');
  url.searchParams.set('user_id', input.state);
  url.searchParams.set('return_url', input.returnUrl);
  url.searchParams.set('callback_url', input.callbackUrl);
  return url.toString();
};

export const encryptCredentialEnvelope = (
  credentials: WooCredentials,
  secret: string,
  keyVersion = 'v1',
): CredentialEnvelope => {
  if (
    !credentials ||
    typeof credentials.key !== 'string' ||
    typeof credentials.secret !== 'string' ||
    credentials.key.length < 1 ||
    credentials.secret.length < 1 ||
    credentials.key.length > 256 ||
    credentials.secret.length > 256
  )
    throw new Error('CREDENTIALS_INVALID');
  return encryptEnvelope(JSON.stringify(credentials), secret, keyVersion);
};

export const encryptSecretEnvelope = (
  value: string,
  secret: string,
  keyVersion = 'v1',
): CredentialEnvelope => encryptEnvelope(value, secret, keyVersion);

export const decryptSecretEnvelope = (value: unknown, secret: string): string => {
  const envelope = envelopeFields(value);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    if (!plaintext || plaintext.length > 4096) throw new Error('CREDENTIAL_VALUE_INVALID');
    return plaintext;
  } catch (error) {
    if (error instanceof Error && error.message === 'CREDENTIAL_VALUE_INVALID') throw error;
    throw new Error('CREDENTIAL_DECRYPTION_FAILED');
  }
};

export const decryptCredentialEnvelope = (value: unknown, secret: string): WooCredentials => {
  try {
    const parsed = JSON.parse(decryptSecretEnvelope(value, secret)) as unknown;
    const record =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (
      !record ||
      typeof record.key !== 'string' ||
      typeof record.secret !== 'string' ||
      record.key.length < 1 ||
      record.secret.length < 1 ||
      record.key.length > 256 ||
      record.secret.length > 256
    )
      throw new Error('CREDENTIALS_INVALID');
    return {
      key: record.key,
      secret: record.secret,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'CREDENTIALS_INVALID') throw error;
    throw new Error('CREDENTIAL_DECRYPTION_FAILED');
  }
};

export const classifyWooError = (error: unknown): ConnectorErrorCategory => {
  const message = error instanceof Error ? error.message : String(error);
  if (/WOO_HTTP_(401|403)/u.test(message) || /WOO_AUTH/u.test(message)) return 'auth';
  if (/WOO_HTTP_404|WOO_FORBIDDEN|WOO_PERMISSION/u.test(message)) return 'permission';
  if (/WOO_RATE_LIMITED|WOO_HTTP_429/u.test(message)) return 'rate';
  if (/WOO_HTTP_5\d\d/u.test(message)) return 'remote';
  if (/WOO_SCHEMA|WOO_MONEY|WOO_DATE/u.test(message)) return 'schema';
  if (/CONNECTOR_|WOO_CONNECTION/u.test(message)) return 'network';
  if (/fetch failed|network|timeout|socket|econn/u.test(message)) return 'network';
  return 'unknown';
};

export const verifyWebhookSignature = (
  rawBody: Uint8Array,
  signature: string,
  secret: string,
): boolean => {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/u.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const received = Buffer.from(signature, 'base64');
  const calculated = Buffer.from(expected, 'base64');
  return received.length === calculated.length && timingSafeEqual(received, calculated);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const WOO_REMOTE_EXPORT_META_KEY = '_wc_customer_order_csv_export_is_exported' as const;
const WOO_REMOTE_EXPORT_STATUS_PATH = '/wp-json/wc/v3/woo-ops/export-status';

const wooOrderIds = (items: readonly unknown[]): number[] =>
  items.flatMap((item) => {
    const record = asRecord(item);
    return record && Number.isSafeInteger(record.id) && Number(record.id) > 0
      ? [Number(record.id)]
      : [];
  });

const parseRemoteExportStatuses = (value: unknown): readonly WooRemoteExportStatus[] | null => {
  const body = asRecord(value);
  if (
    body?.version !== 1 ||
    typeof body.bridgeVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(body.bridgeVersion) ||
    !Array.isArray(body.items) ||
    body.items.length > 100
  )
    return null;
  const statuses: WooRemoteExportStatus[] = [];
  for (const raw of body.items) {
    const item = asRecord(raw);
    if (
      !item ||
      !Number.isSafeInteger(item.id) ||
      Number(item.id) <= 0 ||
      item.key !== WOO_REMOTE_EXPORT_META_KEY ||
      (item.status !== 'exported' && item.status !== 'not_exported' && item.status !== 'unknown') ||
      ![
        'extension_api',
        'taxonomy',
        'legacy_meta',
        'legacy_order_meta',
        'legacy_post_meta',
        'unavailable',
      ].includes(String(item.source))
    )
      return null;
    statuses.push({
      id: Number(item.id),
      key: WOO_REMOTE_EXPORT_META_KEY,
      status: item.status,
      source: item.source as WooRemoteExportStatus['source'],
      bridgeVersion: body.bridgeVersion,
    });
  }
  return statuses;
};

const overlayRemoteExportStatuses = (
  items: readonly unknown[],
  statuses: readonly WooRemoteExportStatus[],
): readonly unknown[] => {
  const byId = new Map(statuses.map((status) => [status.id, status]));
  return items.map((raw) => {
    const order = asRecord(raw);
    const status = order && Number.isSafeInteger(order.id) ? byId.get(Number(order.id)) : undefined;
    if (!order || !status) return raw;
    const metadata = Array.isArray(order.meta_data)
      ? order.meta_data.filter((entry) => {
          const meta = asRecord(entry);
          return meta?.key !== WOO_REMOTE_EXPORT_META_KEY;
        })
      : [];
    return {
      ...order,
      meta_data: [
        ...metadata,
        {
          key: status.key,
          value: {
            status: status.status,
            source: status.source,
            bridgeVersion: status.bridgeVersion,
          },
        },
      ],
    };
  });
};

const canonicalRemoteExportStatus = (
  value: unknown,
): 'exported' | 'not_exported' | 'unknown' | null => {
  if (typeof value === 'boolean') return value ? 'exported' : 'not_exported';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
  if (['1', 'true', 'yes', 'exported'].includes(normalized)) return 'exported';
  if (['0', 'false', 'no', 'not_exported', 'unexported'].includes(normalized))
    return 'not_exported';
  if (['unknown', 'unavailable', 'not_exposed'].includes(normalized)) return 'unknown';
  return null;
};

const requiredInteger = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`WOO_SCHEMA_INVALID:${key}`);
  return Number(value);
};

const MAX_WOO_TOTAL_PAGES = 100_000;

/**
 * WordPress returns `X-WP-TotalPages: 0` for an empty collection. A missing
 * header can also be caused by a proxy, so only the current response is then
 * considered known instead of guessing another page.
 */
const wooTotalPages = (response: Response, page: number, itemCount: number): number => {
  const raw = response.headers.get('x-wp-totalpages');
  if (raw === null) return page;
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) throw new Error('WOO_SCHEMA_INVALID:pagination');
  const totalPages = Number(value);
  if (!Number.isSafeInteger(totalPages) || totalPages > MAX_WOO_TOTAL_PAGES)
    throw new Error('WOO_SCHEMA_INVALID:pagination');
  if (totalPages === 0) {
    if (page !== 1 || itemCount !== 0) throw new Error('WOO_SCHEMA_INVALID:pagination');
    return 0;
  }
  if (totalPages < page) throw new Error('WOO_SCHEMA_INVALID:pagination');
  return totalPages;
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

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const integerOrNull = (value: unknown): number | null =>
  Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;

const sumMinor = (items: readonly Record<string, unknown>[], key: string): string => {
  let total = 0n;
  for (const item of items) {
    const value = item[key];
    if (value === undefined || value === null || value === '') continue;
    const minorValue = typeof value === 'string' ? value : String(value);
    if (!/^-?\d+$/u.test(minorValue)) throw new Error('WOO_MONEY_INVALID');
    total += BigInt(minorValue);
  }
  return total.toString();
};

const uniqueTexts = (values: readonly unknown[]): string[] => [
  ...new Set(
    values.flatMap((value) => {
      if (typeof value === 'string' && value.trim()) return [value.trim()];
      if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
      const record = asRecord(value);
      return record && typeof record.name === 'string' && record.name.trim()
        ? [record.name.trim()]
        : [];
    }),
  ),
];

const safeTransactionReference = (value: unknown): string | null => {
  const text = textOrNull(value);
  return text ? `****${text.slice(-4)}` : null;
};

export const normalizeWooOrder = (value: unknown): NormalizedOrder => {
  const record = asRecord(value);
  if (!record || !Number.isInteger(record.id) || typeof record.number !== 'string')
    throw new Error('WOO_SCHEMA_INVALID:order');
  if (typeof record.currency !== 'string' || typeof record.total !== 'string')
    throw new Error('WOO_SCHEMA_INVALID:order_amounts');
  const rawLines = Array.isArray(record.line_items) ? record.line_items : [];
  const lines = rawLines.map((item) => {
    const line = asRecord(item);
    if (
      !line ||
      !Number.isInteger(line.id) ||
      !Number.isInteger(line.quantity) ||
      typeof line.total !== 'string'
    )
      throw new Error('WOO_SCHEMA_INVALID:line');
    const subtotalMinor = decimalToMinorUnits(line.subtotal ?? '0');
    const totalMinor = decimalToMinorUnits(line.total);
    const lineDiscount = BigInt(subtotalMinor) - BigInt(totalMinor);
    return {
      externalLineId: String(line.id),
      productId: Number.isInteger(line.product_id) ? line.product_id : null,
      variationId: Number.isInteger(line.variation_id) ? line.variation_id : null,
      sku: typeof line.sku === 'string' ? line.sku : null,
      name: typeof line.name === 'string' ? line.name : '',
      quantity: line.quantity,
      subtotalMinor,
      discountMinor: lineDiscount > 0n ? lineDiscount.toString() : '0',
      totalMinor,
      taxMinor: decimalToMinorUnits(line.total_tax ?? '0'),
      productSnapshot: {
        name: typeof line.name === 'string' ? line.name : '',
        sku: typeof line.sku === 'string' ? line.sku : null,
        categories: Array.isArray(line.categories) ? line.categories : [],
        authors: Array.isArray(line.authors) ? line.authors : [],
        attributes: Array.isArray(line.meta_data) ? line.meta_data : [],
      },
      source: line,
    };
  });
  const rawRefunds = Array.isArray(record.refunds) ? record.refunds : [];
  const refunds = rawRefunds.map((item) => {
    const refund = asRecord(item);
    if (!refund || !Number.isInteger(refund.id) || typeof refund.total !== 'string')
      throw new Error('WOO_SCHEMA_INVALID:refund');
    return {
      externalRefundId: String(refund.id),
      amountMinor: decimalToMinorUnits(refund.total),
      reason: refund.reason ?? null,
      lineAllocations: Array.isArray(refund.line_items) ? refund.line_items : [],
      source: refund,
    };
  });
  const rawShippingLines = Array.isArray(record.shipping_lines) ? record.shipping_lines : [];
  const shippingLines = rawShippingLines.map((item) => {
    const line = asRecord(item);
    if (!line) throw new Error('WOO_SCHEMA_INVALID:shipping_line');
    return {
      id: integerOrNull(line.id),
      methodId: textOrNull(line.method_id),
      methodTitle: textOrNull(line.method_title),
      instanceId: textOrNull(line.instance_id),
      totalMinor: decimalToMinorUnits(line.total ?? '0'),
      taxMinor: decimalToMinorUnits(line.total_tax ?? '0'),
      source: line,
    };
  });
  const rawFeeLines = Array.isArray(record.fee_lines) ? record.fee_lines : [];
  const feeLines = rawFeeLines.map((item) => {
    const line = asRecord(item);
    if (!line) throw new Error('WOO_SCHEMA_INVALID:fee_line');
    return {
      id: integerOrNull(line.id),
      name: textOrNull(line.name),
      taxClass: textOrNull(line.tax_class),
      totalMinor: decimalToMinorUnits(line.total ?? '0'),
      taxMinor: decimalToMinorUnits(line.total_tax ?? '0'),
      source: line,
    };
  });
  const rawCouponLines = Array.isArray(record.coupon_lines) ? record.coupon_lines : [];
  const couponLines = rawCouponLines.map((item) => {
    const line = asRecord(item);
    if (!line) throw new Error('WOO_SCHEMA_INVALID:coupon_line');
    return {
      id: integerOrNull(line.id),
      code: textOrNull(line.code),
      discountMinor: decimalToMinorUnits(line.discount ?? '0'),
      discountTaxMinor: decimalToMinorUnits(line.discount_tax ?? '0'),
      source: line,
    };
  });
  const rawTaxLines = Array.isArray(record.tax_lines) ? record.tax_lines : [];
  const taxLines = rawTaxLines.map((item) => {
    const line = asRecord(item);
    if (!line) throw new Error('WOO_SCHEMA_INVALID:tax_line');
    return {
      id: integerOrNull(line.id),
      rateId: integerOrNull(line.rate_id),
      label: textOrNull(line.label),
      taxTotalMinor: decimalToMinorUnits(line.tax_total ?? '0'),
      shippingTaxTotalMinor: decimalToMinorUnits(line.shipping_tax_total ?? '0'),
      source: line,
    };
  });
  const rawMeta = Array.isArray(record.meta_data) ? record.meta_data : [];
  const metadata = rawMeta.flatMap((item) => {
    const meta = asRecord(item);
    return meta && typeof meta.key === 'string' ? [{ key: meta.key, value: meta.value }] : [];
  });
  const remoteExportKeys = new Set([
    '_order_export_status',
    'order_export_status',
    '_wc_order_export_status',
    'wc_order_export_status',
    '_wc_export_status',
    'wc_export_status',
    '_export_status',
    'export_status',
    '_order_exported',
    'order_exported',
    '_wc_order_exported',
    'wc_order_exported',
    '_woo_order_exported',
    'woo_order_exported',
    '_wc_customer_order_csv_export_is_exported',
    'wc_customer_order_csv_export_is_exported',
    '_wc_customer_order_xml_export_is_exported',
    'wc_customer_order_xml_export_is_exported',
  ]);
  const remoteExportMetadata =
    metadata.find((item) => item.key.trim().toLowerCase() === WOO_REMOTE_EXPORT_META_KEY) ??
    metadata.find((item) => remoteExportKeys.has(item.key.trim().toLowerCase()));
  const remoteExportValue = asRecord(remoteExportMetadata?.value);
  const remoteExportScalar =
    remoteExportValue?.status ?? remoteExportValue?.state ?? remoteExportMetadata?.value;
  const remoteExportStatus = canonicalRemoteExportStatus(remoteExportScalar);
  const remoteExportStatusKey = remoteExportMetadata?.key ?? null;
  const remoteExportStatusSource = textOrNull(remoteExportValue?.source);
  const remoteExportBridgeVersion = textOrNull(remoteExportValue?.bridgeVersion);
  const merchandiseSubtotalMinor = sumMinor(lines, 'subtotalMinor');
  const discountMinor =
    typeof record.discount_total === 'string'
      ? decimalToMinorUnits(record.discount_total)
      : sumMinor(couponLines, 'discountMinor');
  const merchandiseNetMinor = (BigInt(merchandiseSubtotalMinor) - BigInt(discountMinor)).toString();
  const shippingCollectedMinor =
    typeof record.shipping_total === 'string'
      ? decimalToMinorUnits(record.shipping_total)
      : sumMinor(shippingLines, 'totalMinor');
  const taxMinor =
    typeof record.total_tax === 'string'
      ? decimalToMinorUnits(record.total_tax)
      : (
          BigInt(sumMinor(lines, 'taxMinor')) +
          BigInt(sumMinor(shippingLines, 'taxMinor')) +
          BigInt(sumMinor(feeLines, 'taxMinor'))
        ).toString();
  const feesMinor = sumMinor(feeLines, 'totalMinor');
  const refundMinor = sumMinor(refunds, 'amountMinor');
  const grandTotalMinor = decimalToMinorUnits(record.total);
  const paymentMethodId = textOrNull(record.payment_method);
  const paymentMethodTitle = textOrNull(record.payment_method_title);
  const paymentStatus =
    textOrNull(record.payment_status) ?? (record.status === 'completed' ? 'paid' : null);
  const paidAt = isoOrNull(record.date_paid_gmt ?? record.date_paid);
  const shippingMethodId = textOrNull(shippingLines[0]?.methodId);
  const shippingMethodTitle = textOrNull(shippingLines[0]?.methodTitle);
  const shippingCarrier = textOrNull(record.shipping_carrier) ?? shippingMethodTitle;
  const products = lines.map((line) => line.productSnapshot as Record<string, unknown>);
  const productIds = uniqueTexts(
    lines.map((line) => (line.productId === null ? null : String(line.productId))),
  );
  const variationIds = uniqueTexts(
    lines.map((line) => (line.variationId === null ? null : String(line.variationId))),
  );
  const skus = uniqueTexts(lines.map((line) => line.sku));
  const categories = uniqueTexts(
    products.flatMap((product) => (Array.isArray(product.categories) ? product.categories : [])),
  );
  const authors = uniqueTexts(
    products.flatMap((product) => (Array.isArray(product.authors) ? product.authors : [])),
  );
  const tags = uniqueTexts(Array.isArray(record.tags) ? record.tags : []);
  const couponCodes = uniqueTexts(couponLines.map((line) => line.code));
  const quantityTotal = lines.reduce((total, line) => total + Number(line.quantity), 0);
  const createdVia = textOrNull(record.created_via);
  const posLocation =
    textOrNull(record.pos_location) ??
    textOrNull(metadata.find((item) => item.key === 'pos_location')?.value);
  const channel = textOrNull(record.channel) ?? createdVia;
  const sourceTimezone = textOrNull(record.timezone) ?? textOrNull(record.source_timezone);
  const exceptionState = textOrNull(record.exception_state);
  const normalizeAddress = (value: unknown): Record<string, unknown> => {
    const raw = asRecord(value) ?? {};
    const state = typeof raw.state === 'string' ? raw.state : null;
    const governorate = egyptianGovernorate(state);
    return {
      ...raw,
      stateCode: governorate?.code ?? state,
      governorateNameAr: governorate?.ar ?? state,
      governorateNameEn: governorate?.en ?? state,
    };
  };
  const absoluteRefundMinor = BigInt(refundMinor) < 0n ? -BigInt(refundMinor) : BigInt(refundMinor);
  const isCollected =
    paidAt !== null || ['processing', 'completed', 'refunded'].includes(String(record.status));
  const normalized = {
    externalOrderId: String(record.id),
    orderNumber: record.number,
    remoteStatus: typeof record.status === 'string' ? record.status : 'unknown',
    createdVia,
    channel,
    posLocation,
    externalCustomerId: integerOrNull(record.customer_id)?.toString() ?? null,
    currency: record.currency,
    grandTotalMinor,
    amounts: {
      merchandiseSubtotalMinor,
      discountMinor,
      merchandiseNetMinor,
      shippingCollectedMinor,
      taxMinor,
      feesMinor,
      refundMinor,
      grandTotalMinor,
      collectedMinor: isCollected
        ? (BigInt(grandTotalMinor) - absoluteRefundMinor).toString()
        : '0',
    },
    createdAt: isoOrNull(record.date_created_gmt ?? record.date_created),
    customerNote: textOrNull(record.customer_note),
    modifiedAt: isoOrNull(record.date_modified_gmt ?? record.date_modified),
    customer: normalizeAddress(record.billing),
    billing: normalizeAddress(record.billing),
    shipping: normalizeAddress(record.shipping),
    payment: {
      methodId: paymentMethodId,
      title: paymentMethodTitle,
      status: paymentStatus,
      paidAt,
      transactionReferenceMasked: safeTransactionReference(record.transaction_id),
    },
    shippingMethod: {
      methodId: shippingMethodId,
      title: shippingMethodTitle,
      carrier: shippingCarrier,
      collectedMinor: shippingCollectedMinor,
    },
    paymentMethodId,
    paymentMethodTitle,
    paymentStatus,
    paidAt,
    shippingMethodId,
    shippingMethodTitle,
    shippingCarrier,
    shippingCollectedMinor,
    taxLines,
    feeLines,
    couponLines,
    shippingLines,
    lines,
    refunds,
    quantityTotal,
    productIds,
    variationIds,
    skus,
    categories,
    authors,
    tags,
    couponCodes,
    metadata,
    remoteExportStatus,
    remoteExportStatusKey,
    remoteExportStatusSource,
    remoteExportBridgeVersion,
    exceptionState,
    sourceTimezone,
    sourceJson: JSON.stringify(record),
  };
  const sourceHash = createHmac('sha256', 'woo-ops-normalizer-v1')
    .update(normalized.sourceJson)
    .digest('hex');
  return { ...normalized, sourceHash };
};

export type WooOrderValidation =
  | { status: 'accepted'; value: NormalizedOrder }
  | { status: 'quarantined'; reason: 'schema-drift' };

export const validateWooOrder = (value: unknown): WooOrderValidation => {
  try {
    return { status: 'accepted', value: normalizeWooOrder(value) };
  } catch (error) {
    if (error instanceof Error && /^WOO_(?:SCHEMA|MONEY|DATE)_/u.test(error.message))
      return { status: 'quarantined', reason: 'schema-drift' };
    throw error;
  }
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
      variations: variations.flatMap((item) => {
        if (Number.isInteger(item)) return [{ id: Number(item) }];
        const variation = asRecord(item);
        return variation !== null && Number.isInteger(variation.id) ? [variation] : [];
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
            : page.kind === 'categories'
              ? 'category'
              : 'tag',
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
    private readonly resolveHost: HostResolver = defaultHostResolver,
  ) {}

  private async requestPage(url: URL, retryNotFound = true): Promise<Response> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    await assertPublicStoreUrl(this.storeUrl, this.resolveHost);
    const requestOptions: RequestInit = {
      method: 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.credentials?.key ?? ''}:${this.credentials?.secret ?? ''}`).toString('base64')}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'manual',
    };
    let response = await this.request(url, requestOptions);
    // Some shared hosts strip the Authorization header before PHP sees it. WooCommerce
    // explicitly supports HTTPS query-string authentication for that environment. Retry
    // only official Woo REST paths, on the same origin, and only after an auth-like failure.
    if (
      ([401, 403].includes(response.status) || (retryNotFound && response.status === 404)) &&
      url.origin === this.storeUrl.origin &&
      url.pathname.startsWith('/wp-json/wc/v3/')
    ) {
      const fallbackUrl = new URL(url);
      fallbackUrl.searchParams.set('consumer_key', this.credentials.key);
      fallbackUrl.searchParams.set('consumer_secret', this.credentials.secret);
      response = await this.request(fallbackUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'manual',
      });
    }
    if (response.status >= 300 && response.status < 400) throw new Error('WOO_REDIRECT_BLOCKED');
    if (response.url) {
      const responseUrl = new URL(response.url);
      if (responseUrl.origin !== this.storeUrl.origin) throw new Error('WOO_ORIGIN_CHANGED');
    }
    return response;
  }

  private async readRemoteExportStatuses(items: readonly unknown[]): Promise<readonly unknown[]> {
    if (!this.storeUrl || items.length === 0) return items;
    const ids = wooOrderIds(items);
    if (ids.length === 0) return items;
    const url = new URL(WOO_REMOTE_EXPORT_STATUS_PATH, this.storeUrl);
    url.searchParams.set('ids', ids.slice(0, 100).join(','));
    try {
      const response = await this.requestPage(url, false);
      if (!response.ok) return items;
      const statuses = parseRemoteExportStatuses((await response.json()) as unknown);
      return statuses === null ? items : overlayRemoteExportStatuses(items, statuses);
    } catch {
      // The companion is optional. Network, authorization, older-plugin and schema
      // failures leave the standard immutable Woo payload untouched and therefore
      // surface as "not exposed" rather than inventing an export state.
      return items;
    }
  }
  async healthCheck(): Promise<ConnectorHealth> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    const response = await this.requestPage(new URL('/wp-json/wc/v3/system_status', this.storeUrl));
    if (response.status === 401 || response.status === 403)
      throw new Error(`WOO_AUTH_${response.status}`);
    if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
    const body: unknown = await response.json();
    const record = asRecord(body);
    if (!record) throw new Error('WOO_SCHEMA_INVALID:system_status');
    const environment = asRecord(record.environment);
    const wordpressVersion =
      typeof environment?.wp_version === 'string' ? environment.wp_version : null;
    const platformVersion = typeof record.version === 'string' ? record.version : null;
    return {
      status: 'healthy',
      platformVersion,
      wordpressVersion,
      capabilities: this.capabilities,
      checkedAt: new Date().toISOString(),
      errorCategory: null,
    };
  }

  async discover(): Promise<ConnectorDiscovery> {
    if (!this.storeUrl) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    await this.healthCheck();
    return {
      platform: this.platform,
      apiBaseUrl: new URL('/wp-json/wc/v3', this.storeUrl).toString(),
      capabilities: this.capabilities,
    };
  }
  pullOrders(): AsyncIterable<unknown> {
    return this.pullRemote('orders');
  }
  async pullOrder(externalOrderId: string): Promise<unknown> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    if (!/^\d{1,18}$/u.test(externalOrderId)) throw new Error('WOO_ORDER_ID_INVALID');
    const url = new URL(
      `/wp-json/wc/v3/orders/${encodeURIComponent(externalOrderId)}`,
      this.storeUrl,
    );
    const response = await this.requestPage(url);
    if (response.status === 429) throw new Error('WOO_RATE_LIMITED');
    if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
    const order = (await response.json()) as unknown;
    const [withStatus] = await this.readRemoteExportStatuses([order]);
    return withStatus ?? order;
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
    const endpointByKind: Record<WooCatalogKind, string> = {
      products: '/wp-json/wc/v3/products',
      categories: '/wp-json/wc/v3/products/categories',
      tags: '/wp-json/wc/v3/products/tags',
      shipping_classes: '/wp-json/wc/v3/products/shipping_classes',
    };
    const endpoint = endpointByKind[kind];
    for (let page = startPage; ; page += 1) {
      const url = new URL(endpoint, this.storeUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      const response = await this.requestPage(url);
      if (response.status === 429) throw new Error('WOO_RATE_LIMITED');
      if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('WOO_SCHEMA_INVALID:page');
      const totalPages = wooTotalPages(response, page, body.length);
      const items = body.map((item) => normalizeCatalogRecord(kind, item));
      if (kind === 'products') {
        for (const [index, raw] of body.entries()) {
          const product = asRecord(raw);
          const normalized = items[index];
          if (!product || !normalized) continue;
          const variationRefs = Array.isArray(product.variations) ? product.variations : [];
          if (!variationRefs.some((value) => Number.isInteger(value))) continue;
          const productId = requiredInteger(product, 'id');
          const variations: unknown[] = [];
          for (let variationPage = 1; ; variationPage += 1) {
            const variationUrl = new URL(
              `/wp-json/wc/v3/products/${productId}/variations`,
              this.storeUrl,
            );
            variationUrl.searchParams.set('page', String(variationPage));
            variationUrl.searchParams.set('per_page', '100');
            const variationResponse = await this.requestPage(variationUrl);
            if (variationResponse.status === 429) throw new Error('WOO_RATE_LIMITED');
            if (!variationResponse.ok) throw new Error(`WOO_HTTP_${variationResponse.status}`);
            const variationBody: unknown = await variationResponse.json();
            if (!Array.isArray(variationBody)) throw new Error('WOO_SCHEMA_INVALID:variations');
            variations.push(...variationBody);
            const variationPages = wooTotalPages(
              variationResponse,
              variationPage,
              variationBody.length,
            );
            if (variationPage >= variationPages || variationBody.length === 0) break;
          }
          normalized.variations = variations;
        }
      }
      yield {
        kind,
        page,
        totalPages,
        items,
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

  async readEgyptShippingRates(): Promise<readonly WooShippingRate[]> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    const zonesResponse = await this.requestPage(
      new URL('/wp-json/wc/v3/shipping/zones', this.storeUrl),
    );
    if (zonesResponse.status === 429) throw new Error('WOO_RATE_LIMITED');
    if (zonesResponse.status === 404) return [];
    if (!zonesResponse.ok) throw new Error(`WOO_HTTP_${zonesResponse.status}`);
    const zones: unknown = await zonesResponse.json();
    if (!Array.isArray(zones)) throw new Error('WOO_SCHEMA_INVALID:shipping_zones');
    const rates: WooShippingRate[] = [];
    for (const rawZone of zones) {
      const zone = asRecord(rawZone);
      if (!zone || !Number.isInteger(zone.id)) continue;
      const zoneId = String(zone.id);
      const [locationsResponse, methodsResponse] = await Promise.all([
        this.requestPage(
          new URL(`/wp-json/wc/v3/shipping/zones/${zoneId}/locations`, this.storeUrl),
        ),
        this.requestPage(new URL(`/wp-json/wc/v3/shipping/zones/${zoneId}/methods`, this.storeUrl)),
      ]);
      if (!locationsResponse.ok || !methodsResponse.ok) continue;
      const locations: unknown = await locationsResponse.json();
      const methods: unknown = await methodsResponse.json();
      if (!Array.isArray(locations) || !Array.isArray(methods)) continue;
      const stateCodes = [
        ...new Set(
          locations.flatMap((rawLocation) => {
            const location = asRecord(rawLocation);
            if (location?.type === 'country' && location.code === 'EG')
              return EGYPTIAN_GOVERNORATES.map((item) => item.code);
            if (location?.type !== 'state' || typeof location.code !== 'string') return [];
            const match = /^EG:(EG)?([A-Z]{1,4})$/u.exec(location.code.toUpperCase());
            return match?.[2] ? [`EG${match[2]}`] : [];
          }),
        ),
      ];
      for (const rawMethod of methods) {
        const method = asRecord(rawMethod);
        const settings = asRecord(method?.settings);
        const cost = asRecord(settings?.cost);
        if (
          method?.enabled !== true ||
          method.method_id !== 'flat_rate' ||
          typeof cost?.value !== 'string' ||
          !/^\d+(?:\.\d{1,2})?$/u.test(cost.value)
        )
          continue;
        const methodId = String(method.instance_id ?? method.id ?? `${zoneId}:flat_rate`);
        const title =
          typeof method.title === 'string' && method.title.trim()
            ? method.title.trim().slice(0, 120)
            : 'Flat rate';
        for (const stateCode of stateCodes)
          rates.push({
            zoneId,
            methodId,
            title,
            stateCode,
            amountMinor: decimalToMinorUnits(cost.value),
            currency: 'EGP',
          });
      }
    }
    return rates;
  }
  async *pullOrderPages(
    kind: WooOrderKind,
    perPage = 100,
    startPage = 1,
    options: WooPullOptions = {},
  ): AsyncIterable<WooOrderPage> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100)
      throw new Error('WOO_PAGE_SIZE_INVALID');
    for (let page = startPage; ; page += 1) {
      const url = new URL(`/wp-json/wc/v3/${kind}`, this.storeUrl);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));
      if (options.modifiedAfter !== undefined)
        url.searchParams.set('modified_after', options.modifiedAfter);
      if (options.modifiedBefore !== undefined)
        url.searchParams.set('modified_before', options.modifiedBefore);
      if (options.after !== undefined) url.searchParams.set('after', options.after);
      if (options.before !== undefined) url.searchParams.set('before', options.before);
      if (options.orderby !== undefined) url.searchParams.set('orderby', options.orderby);
      if (options.order !== undefined) url.searchParams.set('order', options.order);
      const response = await this.requestPage(url);
      if (response.status === 429) throw new Error('WOO_RATE_LIMITED');
      if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('WOO_SCHEMA_INVALID:page');
      const totalPages = wooTotalPages(response, page, body.length);
      const items = kind === 'orders' ? await this.readRemoteExportStatuses(body) : body;
      yield { kind, page, totalPages, items };
      if (page >= totalPages || body.length === 0) return;
    }
  }
  async *pullRemote(
    kind: WooOrderKind,
    perPage = 100,
    startPage = 1,
    options: WooPullOptions = {},
  ): AsyncIterable<readonly unknown[]> {
    for await (const page of this.pullOrderPages(kind, perPage, startPage, options))
      yield page.items;
  }
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<boolean> {
    return Promise.resolve(verifyWebhookSignature(rawBody, signature, this.webhookSecret));
  }
}
