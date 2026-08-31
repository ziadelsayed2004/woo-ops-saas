import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const safeId = /^[A-Za-z0-9_-]{1,80}$/u;
const safeExportPath = /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.(?:csv|xlsx)$/u;
const MAX_EXPORT_FILE_BYTES = 100 * 1024 * 1024;

const insideRoot = (root: string, candidate: string): boolean => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
};

const assertPrivatePath = (root: string, candidate: string): void => {
  if (!insideRoot(root, candidate)) throw new Error('EXPORT_FILE_PATH_INVALID');
  const rootPath = resolve(root);
  const relativePath = relative(rootPath, resolve(candidate));
  const parts = relativePath.split(sep);
  let current = rootPath;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      if (index === parts.length - 1) return;
      throw new Error('EXPORT_FILE_PATH_INVALID');
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
      throw new Error('EXPORT_FILE_PATH_INVALID');
  }
};

const formatExtension = (format: 'csv' | 'xlsx'): string => format;

export const privateExportRelativePath = (
  accountId: string,
  batchId: string,
  format: 'csv' | 'xlsx',
): string => {
  if (!safeId.test(accountId) || !safeId.test(batchId)) throw new Error('EXPORT_FILE_PATH_INVALID');
  return `${accountId}/${batchId}.${formatExtension(format)}`;
};

export const privateExportPath = (root: string, relativePath: string): string => {
  if (relativePath.length > 220 || !safeExportPath.test(relativePath))
    throw new Error('EXPORT_FILE_PATH_INVALID');
  const candidate = resolve(root, relativePath);
  if (!insideRoot(root, candidate)) throw new Error('EXPORT_FILE_PATH_INVALID');
  return candidate;
};

const checksum = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const writePrivateExport = (
  root: string,
  accountId: string,
  batchId: string,
  format: 'csv' | 'xlsx',
  bytes: Uint8Array,
): { relativePath: string; byteSize: number; checksum: string } => {
  if (bytes.length < 1 || bytes.length > MAX_EXPORT_FILE_BYTES)
    throw new Error('EXPORT_FILE_SIZE_INVALID');
  const relativePath = privateExportRelativePath(accountId, batchId, format);
  const path = privateExportPath(root, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assertPrivatePath(root, path);
  const expectedChecksum = checksum(bytes);
  if (!existsSync(path)) writeFileSync(path, Buffer.from(bytes), { mode: 0o600, flag: 'wx' });
  const stored = readFileSync(path);
  if (checksum(stored) !== expectedChecksum) throw new Error('EXPORT_FILE_WRITE_CONFLICT');
  return { relativePath, byteSize: stored.byteLength, checksum: expectedChecksum };
};

export const readPrivateExport = (
  root: string,
  relativePath: string,
  expectedChecksum: string,
): Buffer => {
  if (!/^[a-f0-9]{64}$/iu.test(expectedChecksum)) throw new Error('EXPORT_CHECKSUM_INVALID');
  const path = privateExportPath(root, relativePath);
  assertPrivatePath(root, path);
  const bytes = readFileSync(path);
  if (checksum(bytes) !== expectedChecksum.toLowerCase())
    throw new Error('EXPORT_FILE_CHECKSUM_MISMATCH');
  return bytes;
};
