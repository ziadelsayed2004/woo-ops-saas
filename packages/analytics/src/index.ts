export type AnalyticsSource = 'woo' | 'manual' | 'combined';
export type OrderSource = Exclude<AnalyticsSource, 'combined'>;
export type CostRuleScope = 'product' | 'variation' | 'shipping' | 'payment' | 'return';
export type MetricSource = AnalyticsSource;
export type MetricValue = { amountMinor: string; currency: string; formula: string };

export type CostRule = {
  id: string;
  scope: CostRuleScope;
  key: string;
  currency: string;
  amountMinor: string;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  active: boolean;
};

export type AnalyticsOrder = Record<string, unknown>;
export type LineCostSnapshot = {
  lineId: string;
  ruleId: string | null;
  source: string;
  effectiveAt: string | null;
  quantity: number;
  unitCostMinor: string;
  totalCostMinor: string;
};

export type MetricTotals = {
  grossSalesMinor: string;
  discountMinor: string;
  netMerchandiseMinor: string;
  shippingCollectedMinor: string;
  taxMinor: string;
  refundsMinor: string;
  collectedRevenueMinor: string;
  cogsMinor: string;
  actualShippingCostMinor: string;
  paymentFeesMinor: string;
  returnCostMinor: string;
  contributionProfitMinor: string;
};

export type OrderMetricResult = {
  included: boolean;
  excludedReason: string | null;
  currency: string;
  source: OrderSource;
  date: string;
  orderId: string;
  lineCount: number;
  totals: MetricTotals;
  lineSnapshots: readonly LineCostSnapshot[];
  dimensions: Record<string, unknown>;
};

export type AnalyticsFact = {
  date: string;
  currency: string;
  source: OrderSource;
  dimensions: Record<string, unknown>;
  orderCount: number;
  lineCount: number;
  totals: MetricTotals;
};

export type AnalyticsOptions = {
  timezone?: string;
  excludedStatuses?: readonly string[];
};

export const DEFAULT_EXCLUDED_STATUSES = ['cancelled', 'failed', 'trash'] as const;
export const METRIC_DEFINITIONS = [
  {
    key: 'grossSalesMinor',
    label: 'Gross sales',
    formula: 'sum(line subtotal before discounts)',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'discountMinor',
    label: 'Discounts',
    formula: 'sum(line and order discounts)',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'netMerchandiseMinor',
    label: 'Net merchandise sales',
    formula: 'gross sales - discounts',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'shippingCollectedMinor',
    label: 'Shipping collected',
    formula: 'sum(order shipping collected)',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'taxMinor',
    label: 'Tax',
    formula: 'sum(order tax)',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'refundsMinor',
    label: 'Refunds',
    formula: 'absolute sum of refund amounts',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'collectedRevenueMinor',
    label: 'Collected revenue',
    formula: 'grand total - refunds',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'cogsMinor',
    label: 'COGS',
    formula: 'sum(line quantity × immutable unit cost snapshot)',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'actualShippingCostMinor',
    label: 'Actual shipping cost',
    formula: 'remote actual cost, otherwise effective shipping cost rule',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'paymentFeesMinor',
    label: 'Payment fees',
    formula: 'effective payment cost rule by payment method',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'returnCostMinor',
    label: 'Return cost',
    formula: 'effective return cost rule when a refund exists',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
  {
    key: 'contributionProfitMinor',
    label: 'Contribution profit',
    formula:
      'net merchandise sales + shipping collected - refunds - COGS - actual shipping cost - payment fees - return cost',
    excludedStatuses: [...DEFAULT_EXCLUDED_STATUSES],
  },
] as const;

const metricKeys = [
  'grossSalesMinor',
  'discountMinor',
  'netMerchandiseMinor',
  'shippingCollectedMinor',
  'taxMinor',
  'refundsMinor',
  'collectedRevenueMinor',
  'cogsMinor',
  'actualShippingCostMinor',
  'paymentFeesMinor',
  'returnCostMinor',
  'contributionProfitMinor',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const minor = (value: unknown): bigint => {
  if (typeof value === 'string' && /^-?\d{1,18}$/u.test(value)) return BigInt(value);
  return 0n;
};
const positiveMinor = (value: unknown): bigint => {
  const amount = minor(value);
  return amount < 0n ? -amount : amount;
};
const minorText = (value: bigint): string => value.toString();
const emptyTotals = (): MetricTotals => ({
  grossSalesMinor: '0',
  discountMinor: '0',
  netMerchandiseMinor: '0',
  shippingCollectedMinor: '0',
  taxMinor: '0',
  refundsMinor: '0',
  collectedRevenueMinor: '0',
  cogsMinor: '0',
  actualShippingCostMinor: '0',
  paymentFeesMinor: '0',
  returnCostMinor: '0',
  contributionProfitMinor: '0',
});
const addTotals = (left: MetricTotals, right: MetricTotals): MetricTotals => {
  const result = emptyTotals();
  for (const key of metricKeys) result[key] = minorText(minor(left[key]) + minor(right[key]));
  return result;
};
const orderSource = (order: AnalyticsOrder): OrderSource =>
  order.origin === 'manual' ? 'manual' : 'woo';
const orderCurrency = (order: AnalyticsOrder): string => {
  const currency = text(order.currency)?.toUpperCase() ?? '';
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('ANALYTICS_CURRENCY_INVALID');
  return currency;
};
const normalizedOrder = (order: AnalyticsOrder): Record<string, unknown> =>
  isRecord(order.normalized) ? order.normalized : order;
const orderDate = (order: AnalyticsOrder): string => {
  const normalized = normalizedOrder(order);
  const value =
    text(normalized.createdAt) ??
    text(normalized.modifiedAt) ??
    text(order.remoteCreatedAt) ??
    text(order.createdAt);
  if (!value || Number.isNaN(Date.parse(value))) throw new Error('ANALYTICS_DATE_INVALID');
  return new Date(value).toISOString();
};
export const dateKeyInTimezone = (iso: string, timezone: string): string => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new Error('ANALYTICS_TIMEZONE_INVALID');
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const ruleMatches = (
  rule: CostRule,
  scope: CostRuleScope,
  key: string,
  currency: string,
  at: string,
): boolean =>
  rule.active &&
  rule.scope === scope &&
  (rule.key === key || rule.key === '*') &&
  rule.currency === currency &&
  rule.effectiveFrom <= at &&
  (rule.effectiveTo === null || at < rule.effectiveTo);
const resolveRule = (
  rules: readonly CostRule[],
  scope: CostRuleScope,
  key: string,
  currency: string,
  at: string,
): CostRule | null => {
  const candidates = rules.filter((rule) => ruleMatches(rule, scope, key, currency, at));
  candidates.sort((left, right) => {
    const exact = Number(right.key === key) - Number(left.key === key);
    return (
      exact ||
      right.effectiveFrom.localeCompare(left.effectiveFrom) ||
      right.version - left.version ||
      right.id.localeCompare(left.id)
    );
  });
  return candidates[0] ?? null;
};
const lineValue = (line: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) if (line[key] !== undefined && line[key] !== null) return line[key];
  return undefined;
};
const lineKey = (line: Record<string, unknown>, keys: readonly string[]): string =>
  text(lineValue(line, keys)) ?? '*';
const textValues = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const candidate =
      text(item.id) ??
      text(item.externalId) ??
      text(item.slug) ??
      text(item.name) ??
      text(item.label);
    return candidate && candidate.trim() ? [candidate.trim()] : [];
  });
};
const lineId = (line: Record<string, unknown>, index: number): string =>
  text(line.lineId) ?? text(line.id) ?? `line-${index + 1}`;
const lineSnapshotsFromOrder = (
  order: AnalyticsOrder,
  rules: readonly CostRule[],
  at: string,
  currency: string,
): { snapshots: LineCostSnapshot[]; cogs: bigint } => {
  const normalized = normalizedOrder(order);
  const lines = Array.isArray(normalized.lines) ? normalized.lines : [];
  const snapshots: LineCostSnapshot[] = [];
  let cogs = 0n;
  for (const [index, value] of lines.entries()) {
    if (!isRecord(value)) continue;
    const line = value;
    const quantityValue = line.quantity;
    const quantity =
      typeof quantityValue === 'number' && Number.isInteger(quantityValue) && quantityValue > 0
        ? quantityValue
        : 0;
    const existing = isRecord(line.costSnapshot) ? line.costSnapshot : null;
    const productKey = lineKey(line, ['productId', 'externalProductId', 'productRef']);
    const variationKey = lineKey(line, ['variationId', 'externalVariationId']);
    const rule =
      resolveRule(rules, 'variation', variationKey, currency, at) ??
      resolveRule(rules, 'product', productKey, currency, at);
    const existingUnit = existing ? minor(existing.unitCostMinor) : 0n;
    const unit =
      existing && existing.unitCostMinor !== undefined ? existingUnit : minor(rule?.amountMinor);
    const total =
      existing && existing.totalCostMinor !== undefined
        ? minor(existing.totalCostMinor)
        : unit * BigInt(quantity);
    const snapshot: LineCostSnapshot = {
      lineId: lineId(line, index),
      ruleId: text(existing?.ruleId) ?? rule?.id ?? null,
      source: text(existing?.source) ?? rule?.source ?? (existing ? 'order' : 'missing'),
      effectiveAt: text(existing?.effectiveAt) ?? rule?.effectiveFrom ?? null,
      quantity,
      unitCostMinor: minorText(unit),
      totalCostMinor: minorText(total),
    };
    snapshots.push(snapshot);
    cogs += total;
  }
  return { snapshots, cogs };
};
const dimensionsFor = (order: AnalyticsOrder, source: OrderSource): Record<string, unknown> => {
  const normalized = normalizedOrder(order);
  const shippingMethod = isRecord(normalized.shippingMethod) ? normalized.shippingMethod : {};
  const shippingAddress = isRecord(normalized.shipping)
    ? normalized.shipping
    : isRecord(normalized.shippingAddress)
      ? normalized.shippingAddress
      : {};
  const payment = isRecord(normalized.payment) ? normalized.payment : {};
  const lines = Array.isArray(normalized.lines) ? normalized.lines : [];
  const products = lines
    .filter(isRecord)
    .map((line) => ({
      product: lineValue(line, ['productId', 'externalProductId', 'productRef']) ?? null,
      variation: lineValue(line, ['variationId', 'externalVariationId']) ?? null,
      sku: text(line.sku),
      name: text(line.name),
      categories: textValues(line.categories ?? line.category ?? line.categoryId),
      authors: textValues(line.authors ?? line.author ?? line.authorId),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const categories = [...new Set(products.flatMap((product) => product.categories))].sort();
  const authors = [...new Set(products.flatMap((product) => product.authors))].sort();
  return {
    source,
    store: order.connectionId ?? normalized.connectionId ?? null,
    channel: normalized.channel ?? null,
    pos: normalized.posLocation ?? normalized.pos ?? null,
    location: normalized.location ?? null,
    remoteStatus: order.remoteStatus ?? normalized.remoteStatus ?? null,
    localStatus: order.localStatus ?? normalized.localStatus ?? null,
    exportState: order.exportState ?? null,
    governorate:
      shippingAddress.state ?? shippingAddress.governorate ?? shippingAddress.region ?? null,
    shippingMethod: shippingMethod.methodId ?? shippingMethod.title ?? null,
    paymentMethod: payment.methodId ?? payment.method ?? null,
    categories,
    authors,
    products,
  };
};
export const dimensionsFingerprint = (dimensions: Record<string, unknown>): string =>
  JSON.stringify(dimensions);

export const calculateOrderMetrics = (
  order: AnalyticsOrder,
  rules: readonly CostRule[] = [],
  options: AnalyticsOptions = {},
): OrderMetricResult => {
  const normalized = normalizedOrder(order);
  const source = orderSource(order);
  const date = orderDate(order);
  const currency = orderCurrency(order);
  const status = String(
    order.remoteStatus ??
      order.localStatus ??
      normalized.remoteStatus ??
      normalized.localStatus ??
      '',
  ).toLowerCase();
  const excludedStatuses = options.excludedStatuses ?? DEFAULT_EXCLUDED_STATUSES;
  if (excludedStatuses.map((item) => item.toLowerCase()).includes(status)) {
    return {
      included: false,
      excludedReason: `status:${status}`,
      currency,
      source,
      date,
      orderId: text(order.id) ?? text(order.orderNumber) ?? 'unknown',
      lineCount: Array.isArray(normalized.lines) ? normalized.lines.length : 0,
      totals: emptyTotals(),
      lineSnapshots: [],
      dimensions: dimensionsFor(order, source),
    };
  }
  const amounts = isRecord(normalized.amounts) ? normalized.amounts : normalized;
  const lines = Array.isArray(normalized.lines) ? normalized.lines.filter(isRecord) : [];
  const lineGross = lines.reduce((total, line) => total + minor(line.subtotalMinor), 0n);
  const gross = lineGross === 0n ? minor(amounts.merchandiseSubtotalMinor) : lineGross;
  const discount = minor(amounts.discountMinor);
  const netMerchandise =
    amounts.merchandiseNetMinor !== undefined
      ? minor(amounts.merchandiseNetMinor)
      : gross - discount;
  const shippingCollected = minor(amounts.shippingCollectedMinor);
  const tax = minor(amounts.taxMinor);
  const refunds =
    Array.isArray(normalized.refunds) && normalized.refunds.length > 0
      ? normalized.refunds.reduce(
          (total, refund) => (isRecord(refund) ? total + positiveMinor(refund.amountMinor) : total),
          0n,
        )
      : positiveMinor(amounts.refundMinor);
  const grandTotal = minor(amounts.grandTotalMinor);
  const payment = isRecord(normalized.payment) ? normalized.payment : {};
  const wooCollected =
    text(payment.paidAt) !== null || ['processing', 'completed', 'refunded'].includes(status);
  const collected =
    source === 'woo'
      ? wooCollected
        ? grandTotal - refunds
        : 0n
      : amounts.collectedMinor !== undefined
        ? minor(amounts.collectedMinor)
        : grandTotal - refunds;
  const { snapshots, cogs } = lineSnapshotsFromOrder(order, rules, date, currency);
  const shippingMethod = isRecord(normalized.shippingMethod) ? normalized.shippingMethod : {};
  const actualShipping =
    shippingMethod.actualCostMinor !== undefined && shippingMethod.actualCostMinor !== null
      ? minor(shippingMethod.actualCostMinor)
      : minor(
          resolveRule(
            rules,
            'shipping',
            lineKey(shippingMethod, ['methodId', 'carrier']),
            currency,
            date,
          )?.amountMinor,
        );
  const paymentFees = minor(
    resolveRule(rules, 'payment', lineKey(payment, ['methodId', 'method']), currency, date)
      ?.amountMinor,
  );
  const returnRule = resolveRule(rules, 'return', '*', currency, date);
  const returnCost = refunds > 0n ? minor(returnRule?.amountMinor) : 0n;
  const contribution =
    netMerchandise + shippingCollected - refunds - cogs - actualShipping - paymentFees - returnCost;
  return {
    included: true,
    excludedReason: null,
    currency,
    source,
    date,
    orderId: text(order.id) ?? text(order.orderNumber) ?? 'unknown',
    lineCount: lines.length,
    totals: {
      grossSalesMinor: minorText(gross),
      discountMinor: minorText(discount),
      netMerchandiseMinor: minorText(netMerchandise),
      shippingCollectedMinor: minorText(shippingCollected),
      taxMinor: minorText(tax),
      refundsMinor: minorText(refunds),
      collectedRevenueMinor: minorText(collected),
      cogsMinor: minorText(cogs),
      actualShippingCostMinor: minorText(actualShipping),
      paymentFeesMinor: minorText(paymentFees),
      returnCostMinor: minorText(returnCost),
      contributionProfitMinor: minorText(contribution),
    },
    lineSnapshots: snapshots,
    dimensions: dimensionsFor(order, source),
  };
};

export const aggregateDailyFacts = (
  orders: readonly AnalyticsOrder[],
  rules: readonly CostRule[] = [],
  options: AnalyticsOptions = {},
): {
  facts: readonly AnalyticsFact[];
  excluded: number;
  snapshots: readonly LineCostSnapshot[];
} => {
  const timezone = options.timezone ?? 'UTC';
  const facts = new Map<string, AnalyticsFact>();
  const snapshots: LineCostSnapshot[] = [];
  let excluded = 0;
  for (const order of orders) {
    const result = calculateOrderMetrics(order, rules, options);
    if (!result.included) {
      excluded += 1;
      continue;
    }
    snapshots.push(...result.lineSnapshots);
    const date = dateKeyInTimezone(result.date, timezone);
    const dimensionKey = dimensionsFingerprint(result.dimensions);
    const key = `${date}|${result.currency}|${result.source}|${dimensionKey}`;
    const existing = facts.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.lineCount += result.lineCount;
      existing.totals = addTotals(existing.totals, result.totals);
    } else {
      facts.set(key, {
        date,
        currency: result.currency,
        source: result.source,
        dimensions: result.dimensions,
        orderCount: 1,
        lineCount: result.lineCount,
        totals: result.totals,
      });
    }
  }
  return {
    facts: [...facts.values()].sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.currency.localeCompare(right.currency) ||
        left.source.localeCompare(right.source) ||
        dimensionsFingerprint(left.dimensions).localeCompare(
          dimensionsFingerprint(right.dimensions),
        ),
    ),
    excluded,
    snapshots,
  };
};

export const totalsFromFacts = (facts: readonly AnalyticsFact[]): MetricTotals =>
  facts.reduce((totals, fact) => addTotals(totals, fact.totals), emptyTotals());

export const metricDefinitions = (): readonly (typeof METRIC_DEFINITIONS)[number][] =>
  METRIC_DEFINITIONS;
