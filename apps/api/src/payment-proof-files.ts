import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const safeId = /^[A-Za-z0-9_-]{1,80}$/u;
const safePath =
  /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.(?:jpg|png|pdf)$/u;
const MAX_BYTES = 5 * 1024 * 1024;

const extensionFor = (mimeType: string): 'jpg' | 'png' | 'pdf' => {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'application/pdf') return 'pdf';
  throw new Error('PAYMENT_PROOF_TYPE_INVALID');
};

const resolvedPath = (root: string, relativePath: string): string => {
  if (!safePath.test(relativePath)) throw new Error('PAYMENT_PROOF_PATH_INVALID');
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath);
  const child = relative(rootPath, candidate);
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('PAYMENT_PROOF_PATH_INVALID');
  return candidate;
};

const ensureDirectories = (root: string, accountId: string, orderId: string): void => {
  let current = resolve(root);
  if (!existsSync(current)) mkdirSync(current, { recursive: true, mode: 0o700 });
  for (const segment of [accountId, orderId]) {
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PAYMENT_PROOF_PATH_INVALID');
  }
};

export const writePaymentProof = (
  root: string,
  accountId: string,
  orderId: string,
  proofId: string,
  mimeType: string,
  bytes: Uint8Array,
): { relativePath: string; checksum: string; byteSize: number } => {
  if (![accountId, orderId, proofId].every((value) => safeId.test(value)))
    throw new Error('PAYMENT_PROOF_PATH_INVALID');
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_BYTES)
    throw new Error('PAYMENT_PROOF_SIZE_INVALID');
  const relativePath = `${accountId}/${orderId}/${proofId}.${extensionFor(mimeType)}`;
  const path = resolvedPath(root, relativePath);
  ensureDirectories(root, accountId, orderId);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
  return { relativePath, checksum, byteSize: bytes.length };
};

export const readPaymentProof = (
  root: string,
  relativePath: string,
  expectedChecksum: string,
): Buffer => {
  if (!/^[a-f0-9]{64}$/u.test(expectedChecksum)) throw new Error('PAYMENT_PROOF_INVALID');
  const bytes = readFileSync(resolvedPath(root, relativePath));
  if (createHash('sha256').update(bytes).digest('hex') !== expectedChecksum)
    throw new Error('PAYMENT_PROOF_CHECKSUM_MISMATCH');
  return bytes;
};
