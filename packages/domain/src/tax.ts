/** Woo core tax configuration, read-only and snapshotted before local order creation. */
export type TaxAddress = { country: string; state: string; city: string; postcode: string };
export type StoreTaxRate = {
  id: string;
  country: string;
  state: string;
  postcodes: string[];
  cities: string[];
  rate: string;
  name: string;
  priority: number;
  order: number;
  compound: boolean;
  shipping: boolean;
  taxClass: string;
};
export type StoreTaxPolicy = {
  version: 1;
  enabled: boolean;
  currency: string;
  pricesIncludeTax: boolean;
  roundAtSubtotal: boolean;
  basedOn: 'shipping' | 'billing' | 'base';
  shippingTaxClass: string;
  taxClasses: string[];
  base: TaxAddress;
  rates: StoreTaxRate[];
};
export type TaxProductLine = {
  quantity: number;
  unitPriceMinor: string;
  discountMinor?: string;
  taxStatus: 'taxable' | 'shipping' | 'none';
  taxClass: string;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('STORE_TAX_POLICY_INVALID');
  return value as Record<string, unknown>;
};
const string = (value: unknown, max = 120): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('STORE_TAX_POLICY_INVALID');
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('STORE_TAX_POLICY_INVALID');
  return value;
};
const strings = (value: unknown, max: number): string[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error('STORE_TAX_POLICY_INVALID');
  return value.map((item) => string(item));
};
export const taxAddress = (value: unknown): TaxAddress => {
  const input = record(value);
  return {
    country: string(input.country ?? '', 2).toUpperCase(),
    state: string(input.state ?? '').toUpperCase(),
    city: string(input.city ?? '').toUpperCase(),
    postcode: string(input.postcode ?? '')
      .toUpperCase()
      .replace(/\s/g, ''),
  };
};
export const validateStoreTaxPolicy = (value: unknown): StoreTaxPolicy => {
  const input = record(value);
  if (
    input.version !== 1 ||
    !['shipping', 'billing', 'base'].includes(String(input.basedOn)) ||
    !Array.isArray(input.rates) ||
    input.rates.length > 2000 ||
    input.currency !== 'EGP'
  )
    throw new Error('STORE_TAX_POLICY_INVALID');
  const rates = input.rates.map((value): StoreTaxRate => {
    const rate = record(value);
    if (
      !/^\d{1,18}$/.test(String(rate.id)) ||
      !/^\d{1,3}(?:\.\d{1,6})?$/.test(String(rate.rate)) ||
      !Number.isInteger(rate.priority) ||
      Number(rate.priority) < 1 ||
      Number(rate.priority) > 1000 ||
      !Number.isInteger(rate.order) ||
      Number(rate.order) < 0
    )
      throw new Error('STORE_TAX_POLICY_INVALID');
    return {
      id: String(rate.id),
      ...taxAddress({ country: rate.country, state: rate.state }),
      postcodes: strings(rate.postcodes, 500),
      cities: strings(rate.cities, 500),
      rate: String(rate.rate),
      name: string(rate.name),
      priority: Number(rate.priority),
      order: Number(rate.order),
      compound: boolean(rate.compound),
      shipping: boolean(rate.shipping),
      taxClass: string(rate.taxClass),
    };
  });
  if (new Set(rates.map((rate) => rate.id)).size !== rates.length)
    throw new Error('STORE_TAX_POLICY_INVALID');
  return {
    version: 1,
    enabled: boolean(input.enabled),
    currency: 'EGP',
    pricesIncludeTax: boolean(input.pricesIncludeTax),
    roundAtSubtotal: boolean(input.roundAtSubtotal),
    basedOn: input.basedOn as StoreTaxPolicy['basedOn'],
    shippingTaxClass: string(input.shippingTaxClass),
    taxClasses: strings(input.taxClasses, 50),
    base: taxAddress(input.base),
    rates,
  };
};

const minor = (value: string): bigint => {
  if (!/^\d{1,18}$/.test(value)) throw new Error('MANUAL_ORDER_AMOUNT_INVALID');
  return BigInt(value);
};
// Woo calculates taxes at four decimal places in major units, then rounds at line/subtotal level.
const SCALE = 100n;
const RATE_SCALE = 100_000_000n;
const divide = (value: bigint, denominator: bigint, halfDown = false): bigint => {
  const quotient = value / denominator;
  const remainder = value % denominator;
  return (
    quotient +
    (remainder * 2n > denominator || (!halfDown && remainder * 2n === denominator) ? 1n : 0n)
  );
};
const percent = (rate: string): bigint => {
  const [whole = '0', fraction = ''] = rate.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
};
const normalizedState = (state: string, country: string): string =>
  country === 'EG' && state.startsWith('EG') ? state.slice(2) : state;
const postcodeMatches = (pattern: string, value: string): boolean => {
  const normalized = pattern.toUpperCase().replace(/\s/g, '');
  const range = /^(\d+)\.\.\.(\d+)$/.exec(normalized);
  if (range)
    return (
      /^\d+$/.test(value) &&
      BigInt(value) >= BigInt(range[1]!) &&
      BigInt(value) <= BigInt(range[2]!)
    );
  return new RegExp(
    `^${normalized
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  ).test(value);
};
export const matchingTaxRates = (
  policy: StoreTaxPolicy,
  address: TaxAddress,
  taxClass: string,
): StoreTaxRate[] => {
  if (!policy.enabled || !address.country) return [];
  const rates = policy.rates
    .filter(
      (rate) =>
        rate.taxClass === taxClass &&
        (!rate.country || rate.country === address.country) &&
        (!rate.state ||
          normalizedState(rate.state, address.country) ===
            normalizedState(address.state, address.country)) &&
        (!rate.postcodes.length ||
          rate.postcodes.some((pattern) => postcodeMatches(pattern, address.postcode))) &&
        (!rate.cities.length ||
          rate.cities.some((city) => city.toUpperCase() === address.city.toUpperCase())),
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Number(Boolean(b.country)) - Number(Boolean(a.country)) ||
        Number(Boolean(b.state)) - Number(Boolean(a.state)) ||
        b.postcodes.length - a.postcodes.length ||
        b.cities.length - a.cities.length ||
        (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
    );
  const priorities = new Set<number>();
  return rates.filter((rate) => {
    if (priorities.has(rate.priority)) return false;
    priorities.add(rate.priority);
    return true;
  });
};
const taxAmounts = (
  price: bigint,
  rates: StoreTaxRate[],
  inclusive: boolean,
): Map<string, bigint> => {
  const result = new Map<string, bigint>();
  if (inclusive) {
    let net = price;
    for (const rate of [...rates].reverse().filter((rate) => rate.compound)) {
      const amount = divide(net * percent(rate.rate), RATE_SCALE + percent(rate.rate));
      result.set(rate.id, amount);
      net -= amount;
    }
    const regular = rates.filter((rate) => !rate.compound);
    const denominator = RATE_SCALE + regular.reduce((sum, rate) => sum + percent(rate.rate), 0n);
    for (const rate of regular) result.set(rate.id, divide(net * percent(rate.rate), denominator));
  } else {
    let total = 0n;
    for (const rate of rates.filter((rate) => !rate.compound)) {
      const amount = divide(price * percent(rate.rate), RATE_SCALE);
      result.set(rate.id, amount);
      total += amount;
    }
    for (const rate of rates.filter((rate) => rate.compound)) {
      const amount = divide((price + total) * percent(rate.rate), RATE_SCALE);
      result.set(rate.id, amount);
      total += amount;
    }
  }
  return result;
};
const sum = (values: Iterable<bigint>): bigint =>
  [...values].reduce((total, amount) => total + amount, 0n);
const allocate = (amount: bigint, weights: bigint[]): bigint[] => {
  const total = sum(weights);
  if (amount > total || amount < 0n) throw new Error('MANUAL_ORDER_DISCOUNT_INVALID');
  if (!total) return weights.map(() => 0n);
  const shares = weights.map((weight) => (amount * weight) / total);
  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (amount * weight) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  let remaining = amount - sum(shares);
  for (const item of byRemainder) {
    if (!remaining) break;
    shares[item.index] = shares[item.index]! + 1n;
    remaining -= 1n;
  }
  return shares;
};

export type StoreTaxCalculation = ReturnType<typeof calculateStoreTaxes>;
export function calculateStoreTaxes(
  policyInput: StoreTaxPolicy,
  input: {
    lines: readonly TaxProductLine[];
    billing: TaxAddress;
    shipping: TaxAddress;
    shippingMinor: string;
    shippingTaxable: boolean;
    discountMinor: string;
    feesMinor: string;
  },
) {
  const policy = validateStoreTaxPolicy(policyInput);
  if (!input.lines.length || input.lines.length > 500)
    throw new Error('MANUAL_ORDER_LINES_INVALID');
  const location =
    policy.basedOn === 'base'
      ? policy.base
      : policy.basedOn === 'billing'
        ? input.billing
        : input.shipping;
  const lines = input.lines.map((line) => {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 100000 ||
      !['taxable', 'shipping', 'none'].includes(line.taxStatus)
    )
      throw new Error('MANUAL_ORDER_LINE_INVALID');
    const taxable = line.taxStatus === 'taxable' && policy.enabled;
    const price = minor(line.unitPriceMinor) * BigInt(line.quantity) * SCALE;
    const baseTax =
      taxable && policy.pricesIncludeTax
        ? sum(
            taxAmounts(price, matchingTaxRates(policy, policy.base, line.taxClass), true).values(),
          )
        : 0n;
    const subtotal = divide(price - baseTax, SCALE);
    const discount = minor(line.discountMinor ?? '0');
    if (discount > subtotal) throw new Error('MANUAL_ORDER_DISCOUNT_INVALID');
    return {
      subtotal,
      preciseSubtotal: price - baseTax,
      discount,
      taxClass: line.taxClass,
      taxable,
    };
  });
  const discounts = allocate(
    minor(input.discountMinor),
    lines.map((line) => line.subtotal - line.discount),
  );
  const rawTaxes = lines.map((line, index) =>
    taxAmounts(
      // A fully discounted rounded subtotal must never produce a negative fraction.
      line.subtotal === line.discount + discounts[index]!
        ? 0n
        : line.preciseSubtotal - (line.discount + discounts[index]!) * SCALE,
      line.taxable ? matchingTaxRates(policy, location, line.taxClass) : [],
      false,
    ),
  );
  const taxableClasses = new Set(
    input.lines.filter((line) => line.taxStatus !== 'none').map((line) => line.taxClass),
  );
  const shippingClass =
    policy.shippingTaxClass === 'inherit'
      ? (['', ...policy.taxClasses].find((taxClass) => taxableClasses.has(taxClass)) ?? null)
      : policy.shippingTaxClass;
  const shippingRates =
    input.shippingTaxable && policy.enabled && shippingClass !== null
      ? matchingTaxRates(policy, location, shippingClass).filter((rate) => rate.shipping)
      : [];
  const shippingTaxes = taxAmounts(minor(input.shippingMinor) * SCALE, shippingRates, false);
  const allTaxes = [...rawTaxes, shippingTaxes];
  const rounded = allTaxes.map(() => new Map<string, bigint>());
  const ids = new Set(allTaxes.flatMap((taxes) => [...taxes.keys()]));
  for (const id of ids) {
    const values = allTaxes.map((taxes) => taxes.get(id) ?? 0n);
    if (policy.roundAtSubtotal) {
      const target = divide(sum(values), SCALE, policy.pricesIncludeTax);
      const floors = values.map((value) => value / SCALE);
      let remainder = target - sum(floors);
      const ranked = values
        .map((value, index) => ({ index, remainder: value % SCALE }))
        .sort((a, b) =>
          a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
        );
      for (const item of ranked) {
        if (!remainder) break;
        floors[item.index] = floors[item.index]! + 1n;
        remainder -= 1n;
      }
      floors.forEach((amount, index) => rounded[index]!.set(id, amount));
    } else
      values.forEach((value, index) =>
        rounded[index]!.set(id, divide(value, SCALE, policy.pricesIncludeTax)),
      );
  }
  const subtotal = sum(lines.map((line) => line.subtotal));
  const discount = sum(lines.map((line, index) => line.discount + discounts[index]!));
  const tax = sum(rounded.flatMap((taxes) => [...taxes.values()]));
  return {
    lines: lines.map((line, index) => ({
      unitPriceMinor: divide(
        line.preciseSubtotal,
        BigInt(input.lines[index]!.quantity) * SCALE,
      ).toString(),
      subtotalMinor: line.subtotal.toString(),
      discountMinor: (line.discount + discounts[index]!).toString(),
      totalMinor: (line.subtotal - line.discount - discounts[index]!).toString(),
      taxMinor: sum(rounded[index]!.values()).toString(),
      taxes: [...rounded[index]!].map(([rateId, amount]) => ({
        rateId,
        amountMinor: amount.toString(),
      })),
    })),
    amounts: {
      merchandiseSubtotalMinor: subtotal.toString(),
      discountMinor: discount.toString(),
      merchandiseNetMinor: (subtotal - discount).toString(),
      shippingCollectedMinor: input.shippingMinor,
      shippingTaxMinor: sum(rounded.at(-1)!.values()).toString(),
      taxMinor: tax.toString(),
      feesMinor: input.feesMinor,
      grandTotalMinor: (
        subtotal -
        discount +
        minor(input.shippingMinor) +
        tax +
        minor(input.feesMinor)
      ).toString(),
      collectedMinor: (
        subtotal -
        discount +
        minor(input.shippingMinor) +
        tax +
        minor(input.feesMinor)
      ).toString(),
    },
    taxLines: [...ids].map((id) => ({
      rateId: id,
      label: policy.rates.find((rate) => rate.id === id)?.name ?? '',
      taxTotalMinor: sum(rounded.slice(0, -1).map((taxes) => taxes.get(id) ?? 0n)).toString(),
      shippingTaxTotalMinor: (rounded.at(-1)!.get(id) ?? 0n).toString(),
    })),
    location,
  };
}
