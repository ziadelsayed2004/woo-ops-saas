import { createCipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ConnectorCapabilities, ReadOnlyCommerceConnector } from './index.js';

export type WooCredentials = { key: string; secret: string };
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

export class WooCommerceConnector implements ReadOnlyCommerceConnector {
  readonly platform = 'woocommerce';
  readonly capabilities: ConnectorCapabilities = { products: true, orders: true, webhooks: true };
  constructor(private readonly webhookSecret: string) {}
  pullOrders(): AsyncIterable<unknown> {
    return (async function* () {})();
  }
  pullProducts(): AsyncIterable<unknown> {
    return (async function* () {})();
  }
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<boolean> {
    return Promise.resolve(verifyWebhookSignature(rawBody, signature, this.webhookSecret));
  }
}
