import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const integerOrNull = (value: unknown): number | null =>
  Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;

const sumMinor = (items: readonly Record<string, unknown>[], key: string): string => {
  let total = 0n;
  for (const item of items) {
    const value = item[key];
    if (value === undefined || value === null || value === '') continue;
    total += BigInt(decimalToMinorUnits(value));
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
      collectedMinor: grandTotalMinor,
    },
    createdAt: isoOrNull(record.date_created_gmt ?? record.date_created),
    modifiedAt: isoOrNull(record.date_modified_gmt ?? record.date_modified),
    customer: asRecord(record.billing) ?? {},
    billing: asRecord(record.billing) ?? {},
    shipping: asRecord(record.shipping) ?? {},
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

  private async requestPage(url: URL): Promise<Response> {
    if (!this.storeUrl || !this.credentials) throw new Error('WOO_CONNECTION_NOT_CONFIGURED');
    await assertPublicStoreUrl(this.storeUrl, this.resolveHost);
    const response = await this.request(url, {
      method: 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.credentials?.key ?? ''}:${this.credentials?.secret ?? ''}`).toString('base64')}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) throw new Error('WOO_REDIRECT_BLOCKED');
    if (response.url) {
      const responseUrl = new URL(response.url);
      if (responseUrl.origin !== this.storeUrl.origin) throw new Error('WOO_ORIGIN_CHANGED');
    }
    return response;
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
    return response.json() as Promise<unknown>;
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
      const response = await this.requestPage(url);
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
      const totalPages = Number(response.headers.get('x-wp-totalpages') ?? page);
      if (!Number.isInteger(totalPages) || totalPages < page)
        throw new Error('WOO_SCHEMA_INVALID:pagination');
      yield { kind, page, totalPages, items: body };
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
