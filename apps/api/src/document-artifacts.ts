import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export type PrivateDocumentExtension = 'pdf' | 'zip' | 'json';

const safeId = /^[A-Za-z0-9_-]{1,80}$/u;
const safePath =
  /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.(?:pdf|zip|json)$/u;
const MAX_BYTES = 100 * 1024 * 1024;

const insideRoot = (root: string, candidate: string): boolean => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
};

const assertPrivatePath = (root: string, candidate: string): void => {
  if (!insideRoot(root, candidate)) throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  const rootPath = resolve(root);
  const parts = relative(rootPath, resolve(candidate)).split(sep);
  let current = rootPath;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      if (index === parts.length - 1) return;
      throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
      throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  }
};

export const privateDocumentArtifactRelativePath = (
  accountId: string,
  batchId: string,
  artifactId: string,
  extension: PrivateDocumentExtension,
): string => {
  if (!safeId.test(accountId) || !safeId.test(batchId) || !safeId.test(artifactId))
    throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  return `${accountId}/${batchId}/${artifactId}.${extension}`;
};

export const privateDocumentArtifactPath = (root: string, relativePath: string): string => {
  if (relativePath.length > 280 || !safePath.test(relativePath))
    throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  const candidate = resolve(root, relativePath);
  if (!insideRoot(root, candidate)) throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  return candidate;
};

const checksum = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const assertDirectory = (path: string): void => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('DOCUMENT_ARTIFACT_PATH_INVALID');
};

const ensurePrivateDirectory = (root: string, accountId: string, batchId: string): void => {
  const rootPath = resolve(root);
  if (!existsSync(rootPath)) mkdirSync(rootPath, { recursive: true, mode: 0o700 });
  assertDirectory(rootPath);
  let current = rootPath;
  for (const segment of [accountId, batchId]) {
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    assertDirectory(current);
  }
};

export const writePrivateDocumentArtifact = (
  root: string,
  accountId: string,
  batchId: string,
  artifactId: string,
  extension: PrivateDocumentExtension,
  bytes: Uint8Array,
): { relativePath: string; byteSize: number; checksum: string } => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_BYTES)
    throw new Error('DOCUMENT_ARTIFACT_SIZE_INVALID');
  const relativePath = privateDocumentArtifactRelativePath(
    accountId,
    batchId,
    artifactId,
    extension,
  );
  const path = privateDocumentArtifactPath(root, relativePath);
  ensurePrivateDirectory(root, accountId, batchId);
  assertPrivatePath(root, path);
  const expectedChecksum = checksum(bytes);
  if (!existsSync(path)) writeFileSync(path, Buffer.from(bytes), { mode: 0o600, flag: 'wx' });
  const stored = readFileSync(path);
  if (checksum(stored) !== expectedChecksum) throw new Error('DOCUMENT_ARTIFACT_WRITE_CONFLICT');
  return { relativePath, byteSize: stored.byteLength, checksum: expectedChecksum };
};

export const readPrivateDocumentArtifact = (
  root: string,
  relativePath: string,
  expectedChecksum: string,
): Buffer => {
  if (!/^[a-f0-9]{64}$/iu.test(expectedChecksum))
    throw new Error('DOCUMENT_ARTIFACT_CHECKSUM_INVALID');
  const path = privateDocumentArtifactPath(root, relativePath);
  assertPrivatePath(root, path);
  const bytes = readFileSync(path);
  if (checksum(bytes) !== expectedChecksum.toLowerCase())
    throw new Error('DOCUMENT_ARTIFACT_CHECKSUM_MISMATCH');
  return bytes;
};
