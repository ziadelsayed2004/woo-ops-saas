export type Origin = 'woo' | 'manual';
export type SyncPolicy = 'read-only' | 'never';
export type InventoryPolicy = 'observe' | 'ignore';
export type Money = { amountMinor: string; currency: string };
export type CanonicalOrderIdentity = {
  id: string;
  orderNumber: string;
  origin: Origin;
  externalOrderId?: string;
  syncPolicy: SyncPolicy;
  inventoryPolicy: InventoryPolicy;
};
export const manualOrderInvariant = (identity: CanonicalOrderIdentity): boolean =>
  identity.origin === 'manual' &&
  identity.syncPolicy === 'never' &&
  identity.inventoryPolicy === 'ignore' &&
  identity.externalOrderId === undefined;

export type EgyptianGovernorate = { code: string; ar: string; en: string };

const governorates = [
  ['EGALX', 'الإسكندرية', 'Alexandria'],
  ['EGASN', 'أسوان', 'Aswan'],
  ['EGAST', 'أسيوط', 'Asyut'],
  ['EGBA', 'البحر الأحمر', 'Red Sea'],
  ['EGBH', 'البحيرة', 'Beheira'],
  ['EGBNS', 'بني سويف', 'Beni Suef'],
  ['EGC', 'القاهرة', 'Cairo'],
  ['EGDK', 'الدقهلية', 'Dakahlia'],
  ['EGDT', 'دمياط', 'Damietta'],
  ['EGFYM', 'الفيوم', 'Faiyum'],
  ['EGGH', 'الغربية', 'Gharbia'],
  ['EGGZ', 'الجيزة', 'Giza'],
  ['EGIS', 'الإسماعيلية', 'Ismailia'],
  ['EGJS', 'جنوب سيناء', 'South Sinai'],
  ['EGKB', 'القليوبية', 'Qalyubia'],
  ['EGKFS', 'كفر الشيخ', 'Kafr el-Sheikh'],
  ['EGKN', 'قنا', 'Qena'],
  ['EGLX', 'الأقصر', 'Luxor'],
  ['EGMN', 'المنيا', 'Minya'],
  ['EGMNF', 'المنوفية', 'Monufia'],
  ['EGMT', 'مطروح', 'Matrouh'],
  ['EGPTS', 'بورسعيد', 'Port Said'],
  ['EGSHG', 'سوهاج', 'Sohag'],
  ['EGSHR', 'الشرقية', 'Sharqia'],
  ['EGSIN', 'شمال سيناء', 'North Sinai'],
  ['EGSUZ', 'السويس', 'Suez'],
  ['EGWAD', 'الوادي الجديد', 'New Valley'],
] as const;

export const EGYPTIAN_GOVERNORATES: readonly EgyptianGovernorate[] = governorates.map(
  ([code, ar, en]) => ({ code, ar, en }),
);

export const egyptianGovernorate = (value: unknown): EgyptianGovernorate | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/^EG-?/u, 'EG');
  return EGYPTIAN_GOVERNORATES.find((item) => item.code === normalized) ?? null;
};

export const egyptianGovernorateName = (value: unknown, locale: 'ar' | 'en' = 'ar'): string =>
  egyptianGovernorate(value)?.[locale] ?? (typeof value === 'string' ? value.trim() : '');
