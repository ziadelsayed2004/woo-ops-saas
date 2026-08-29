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
