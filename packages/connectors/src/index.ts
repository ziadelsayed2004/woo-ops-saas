export type ConnectorCapabilities = Readonly<{
  products: boolean;
  orders: boolean;
  webhooks: boolean;
}>;
export interface ReadOnlyCommerceConnector {
  readonly platform: string;
  readonly capabilities: ConnectorCapabilities;
  pullOrders(): AsyncIterable<unknown>;
  pullProducts(): AsyncIterable<unknown>;
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<boolean>;
}

export {
  catalogIdentity,
  decimalToMinorUnits,
  normalizeCatalogRecord,
  normalizeWooOrder,
  toCatalogItems,
  WooCommerceConnector,
  canonicalizeStoreUrl,
  createAuthorizationUrl,
  encryptCredentialEnvelope,
  verifyWebhookSignature,
} from './woocommerce.js';
export type {
  NormalizedCatalogItem,
  NormalizedOrder,
  WooCatalogKind,
  WooCatalogPage,
  WooOrderKind,
  WooCredentials,
} from './woocommerce.js';
