import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const safeId = /^[A-Za-z0-9_-]{1,80}$/u;

const insideRoot = (root: string, candidate: string): boolean => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
};

const assertPrivatePath = (root: string, candidate: string): void => {
  if (!insideRoot(root, candidate)) throw new Error('DOCUMENT_FILE_PATH_INVALID');
  const rootPath = resolve(root);
  let current = rootPath;
  const relativePath = relative(rootPath, resolve(candidate));
  for (const [index, part] of relativePath.split(sep).entries()) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      if (index === relativePath.split(sep).length - 1) return;
      throw new Error('DOCUMENT_FILE_PATH_INVALID');
    }
    if (
      stat.isSymbolicLink() ||
      (index < relativePath.split(sep).length - 1 && !stat.isDirectory())
    )
      throw new Error('DOCUMENT_FILE_PATH_INVALID');
  }
};

export const privateDocumentRelativePath = (accountId: string, fileId: string): string => {
  if (!safeId.test(accountId) || !safeId.test(fileId))
    throw new Error('DOCUMENT_FILE_PATH_INVALID');
  return `${accountId}/${fileId}.pdf`;
};

export const privateDocumentPath = (root: string, relativePath: string): string => {
  if (
    relativePath.length > 400 ||
    !/^[A-Za-z0-9_-]{1,80}(?:\/[A-Za-z0-9_-]{1,80})*\.pdf$/u.test(relativePath)
  )
    throw new Error('DOCUMENT_FILE_PATH_INVALID');
  const candidate = resolve(root, relativePath);
  if (!insideRoot(root, candidate)) throw new Error('DOCUMENT_FILE_PATH_INVALID');
  return candidate;
};

export const writePrivatePdf = (
  root: string,
  accountId: string,
  fileId: string,
  bytes: Uint8Array,
): { relativePath: string; byteSize: number; checksum: string } => {
  const relativePath = privateDocumentRelativePath(accountId, fileId);
  const path = privateDocumentPath(root, relativePath);
  if (bytes.length < 1 || bytes.length > 50 * 1024 * 1024)
    throw new Error('DOCUMENT_FILE_SIZE_INVALID');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assertPrivatePath(root, path);
  if (!existsSync(path)) writeFileSync(path, Buffer.from(bytes), { mode: 0o600, flag: 'wx' });
  const stored = readFileSync(path);
  const checksum = createHash('sha256').update(stored).digest('hex');
  if (checksum !== createHash('sha256').update(bytes).digest('hex'))
    throw new Error('DOCUMENT_FILE_WRITE_CONFLICT');
  return { relativePath, byteSize: stored.byteLength, checksum };
};

export const readPrivatePdf = (
  root: string,
  relativePath: string,
  expectedChecksum: string,
): Buffer => {
  const path = privateDocumentPath(root, relativePath);
  assertPrivatePath(root, path);
  const bytes = readFileSync(path);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== expectedChecksum) throw new Error('DOCUMENT_FILE_CHECKSUM_MISMATCH');
  return bytes;
};
