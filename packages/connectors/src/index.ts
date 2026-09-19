export type ConnectorCapabilities = Readonly<{
  products: boolean;
  orders: boolean;
  webhooks: boolean;
}>;
export type ConnectorErrorCategory =
  | 'auth'
  | 'permission'
  | 'network'
  | 'rate'
  | 'remote'
  | 'schema'
  | 'normalization'
  | 'persistence'
  | 'unknown';
export type ConnectorHealth = Readonly<{
  status: 'healthy' | 'degraded';
  platformVersion: string | null;
  wordpressVersion: string | null;
  capabilities: ConnectorCapabilities;
  checkedAt: string;
  errorCategory: ConnectorErrorCategory | null;
}>;
export type ConnectorDiscovery = Readonly<{
  platform: string;
  apiBaseUrl: string;
  capabilities: ConnectorCapabilities;
}>;
export interface ReadOnlyCommerceConnector {
  readonly platform: string;
  readonly capabilities: ConnectorCapabilities;
  healthCheck(): Promise<ConnectorHealth>;
  discover(): Promise<ConnectorDiscovery>;
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
  assertPublicStoreUrl,
  createAuthorizationUrl,
  encryptCredentialEnvelope,
  decryptCredentialEnvelope,
  encryptSecretEnvelope,
  decryptSecretEnvelope,
  classifyWooError,
  verifyWebhookSignature,
  validateWooOrder,
} from './woocommerce.js';
export type {
  NormalizedCatalogItem,
  NormalizedOrder,
  WooCatalogKind,
  WooCatalogPage,
  WooOrderKind,
  WooCredentials,
  WooOrderValidation,
  CredentialEnvelope,
  WooPullOptions,
  WooOrderPage,
  WooShippingRate,
} from './woocommerce.js';
