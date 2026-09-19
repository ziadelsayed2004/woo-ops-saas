import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { schemaVersion, SqliteDatabase } from '@woo-ops/persistence';

const manifestName = 'manifest.json';
const databaseName = 'database.sqlite';
const backupIdPattern = /^backup-[A-Za-z0-9_-]{20,180}$/u;
const relativeFilePattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
const maximumFiles = 10_000;
const maximumBytes = 1024 * 1024 * 1024;

export type BackupFileEntry = {
  path: string;
  byteSize: number;
  checksum: string;
};

export type BackupManifest = {
  formatVersion: 1;
  id: string;
  createdAt: string;
  applicationVersion: string;
  schemaVersion: number;
  database: { path: 'database.sqlite'; byteSize: number; checksum: string };
  files: BackupFileEntry[];
};

export type BackupOptions = {
  dataDirectory: string;
  databasePath: string;
  database: SqliteDatabase;
  retention?: number;
  maxFiles?: number;
  maxBytes?: number;
};

export type RestoreOptions = {
  dataDirectory: string;
  databasePath: string;
  backupId: string;
  dryRun?: boolean;
};

export type RestoreValidation = {
  manifest: BackupManifest;
  backupDirectory: string;
  databasePath: string;
  fileCount: number;
  totalBytes: number;
  validatedAt: string;
};

export type RestoreResult = RestoreValidation & {
  dryRun: boolean;
  restored: boolean;
};

type ManagedFile = { absolutePath: string; path: string; byteSize: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const inside = (root: string, candidate: string): boolean => {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath !== '..' && !relativePath.startsWith('..' + sep) && !relativePath.startsWith(sep)
  );
};

const privateDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not expose POSIX directory modes.
  }
};

const privateFile = (path: string): void => {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not expose POSIX file modes.
  }
};

const assertBackupId = (id: string): void => {
  if (!backupIdPattern.test(id) || id.includes('..')) throw new Error('BACKUP_ID_INVALID');
};

const backupRootFor = (dataDirectory: string): string => {
  const root = resolve(dataDirectory);
  const backupRoot = resolve(root, 'backups');
  if (!inside(root, backupRoot)) throw new Error('BACKUP_PATH_INVALID');
  return backupRoot;
};

const backupDirectoryFor = (dataDirectory: string, backupId: string): string => {
  assertBackupId(backupId);
  const root = backupRootFor(dataDirectory);
  const directory = resolve(root, backupId);
  if (!inside(root, directory)) throw new Error('BACKUP_PATH_INVALID');
  return directory;
};

const normalizedRelative = (value: string): string => value.split(sep).join('/');

const managedFilePath = (
  dataDirectory: string,
  candidate: string,
  databasePath: string,
  backupRoot: string,
): string | null => {
  const root = resolve(dataDirectory);
  const absolutePath = resolve(candidate);
  if (!inside(root, absolutePath) || absolutePath === resolve(databasePath)) return null;
  if (
    absolutePath === resolve(databasePath + '-wal') ||
    absolutePath === resolve(databasePath + '-shm') ||
    absolutePath === resolve(databasePath + '-journal')
  )
    return null;
  if (inside(backupRoot, absolutePath)) return null;
  return absolutePath;
};

const assertDataAndDatabasePaths = (dataDirectory: string, databasePath: string): void => {
  const root = resolve(dataDirectory);
  const database = resolve(databasePath);
  const backupRoot = backupRootFor(root);
  if (inside(backupRoot, database)) throw new Error('BACKUP_PATH_INVALID');
};

const collectManagedFiles = (
  dataDirectory: string,
  databasePath: string,
  maxFileCount = maximumFiles,
  maxByteCount = maximumBytes,
): ManagedFile[] => {
  const root = resolve(dataDirectory);
  const backupRoot = backupRootFor(root);
  const files: ManagedFile[] = [];
  let totalBytes = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === basename(backupRoot)) continue;
      if (entry.name.startsWith('.woo-ops-restore-')) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('BACKUP_SYMLINK_UNSUPPORTED');
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error('BACKUP_FILE_TYPE_UNSUPPORTED');
      const managedPath = managedFilePath(root, absolutePath, databasePath, backupRoot);
      if (!managedPath) continue;
      const byteSize = statSync(managedPath).size;
      files.push({
        absolutePath: managedPath,
        path: normalizedRelative(relative(root, managedPath)),
        byteSize,
      });
      totalBytes += byteSize;
      if (files.length > maxFileCount) throw new Error('BACKUP_FILE_COUNT_LIMIT');
      if (totalBytes > maxByteCount) throw new Error('BACKUP_SIZE_LIMIT');
    }
  };
  if (existsSync(root)) visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const checksumFile = (path: string): Promise<string> =>
  new Promise((resolveChecksum, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolveChecksum(hash.digest('hex')));
  });

const writeJsonAtomically = (path: string, value: unknown): void => {
  const temporaryPath = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  privateFile(temporaryPath);
  renameSync(temporaryPath, path);
  privateFile(path);
};

const schemaVersionFrom = (database: SqliteDatabase): number => {
  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number } | undefined;
  const version = Number(row?.version ?? 0);
  if (!Number.isInteger(version) || version < 1) throw new Error('BACKUP_SCHEMA_INVALID');
  return version;
};

const textValue = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error('BACKUP_MANIFEST_INVALID');
  return value;
};

const integerValue = (record: Record<string, unknown>, key: string, maximum: number): number => {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error('BACKUP_MANIFEST_INVALID');
  return value;
};

const checksumValue = (record: Record<string, unknown>, key: string): string => {
  const value = textValue(record, key);
  if (!/^[a-f0-9]{64}$/iu.test(value)) throw new Error('BACKUP_MANIFEST_INVALID');
  return value.toLowerCase();
};

const parseManifest = (value: unknown): BackupManifest => {
  if (!isRecord(value) || value.formatVersion !== 1) throw new Error('BACKUP_MANIFEST_INVALID');
  const id = textValue(value, 'id');
  assertBackupId(id);
  const createdAt = textValue(value, 'createdAt');
  if (Number.isNaN(Date.parse(createdAt))) throw new Error('BACKUP_MANIFEST_INVALID');
  const applicationVersion = textValue(value, 'applicationVersion');
  if (applicationVersion.length > 100 || createdAt.length > 80)
    throw new Error('BACKUP_MANIFEST_INVALID');
  const schema = integerValue(value, 'schemaVersion', schemaVersion);
  if (schema < 1) throw new Error('BACKUP_MANIFEST_INVALID');
  const database = value.database;
  if (!isRecord(database) || database.path !== databaseName)
    throw new Error('BACKUP_MANIFEST_INVALID');
  const databaseEntry = {
    path: databaseName as 'database.sqlite',
    byteSize: integerValue(database, 'byteSize', maximumBytes),
    checksum: checksumValue(database, 'checksum'),
  };
  if (!Array.isArray(value.files) || value.files.length > maximumFiles)
    throw new Error('BACKUP_MANIFEST_INVALID');
  const files = value.files.map((item): BackupFileEntry => {
    if (!isRecord(item)) throw new Error('BACKUP_MANIFEST_INVALID');
    const path = textValue(item, 'path');
    if (
      !relativeFilePattern.test(path) ||
      path.length > 500 ||
      path.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('BACKUP_MANIFEST_INVALID');
    return {
      path,
      byteSize: integerValue(item, 'byteSize', maximumBytes),
      checksum: checksumValue(item, 'checksum'),
    };
  });
  const uniquePaths = new Set(files.map((file) => file.path));
  if (uniquePaths.size !== files.length) throw new Error('BACKUP_MANIFEST_INVALID');
  return {
    formatVersion: 1,
    id,
    createdAt,
    applicationVersion,
    schemaVersion: schema,
    database: databaseEntry,
    files,
  };
};

const readManifest = (directory: string): BackupManifest => {
  try {
    return parseManifest(
      JSON.parse(readFileSync(resolve(directory, manifestName), 'utf8')) as unknown,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'BACKUP_MANIFEST_INVALID') throw error;
    throw new Error('BACKUP_MANIFEST_INVALID');
  }
};

const verifyRegularFile = async (
  path: string,
  byteSize: number,
  checksum: string,
): Promise<void> => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error('BACKUP_FILE_MISSING');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BACKUP_FILE_TYPE_UNSUPPORTED');
  if (stat.size !== byteSize || (await checksumFile(path)) !== checksum)
    throw new Error('BACKUP_CHECKSUM_MISMATCH');
};

const validateDatabase = (path: string, manifest: BackupManifest): void => {
  let database: SqliteDatabase | undefined;
  try {
    database = new SqliteDatabase(path, { readonly: true, fileMustExist: true });
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error('BACKUP_DATABASE_INTEGRITY_FAILED');
    const actualSchema = schemaVersionFrom(database);
    if (actualSchema !== manifest.schemaVersion || actualSchema > schemaVersion)
      throw new Error('BACKUP_SCHEMA_MISMATCH');
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length > 0) throw new Error('BACKUP_FOREIGN_KEY_INVALID');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BACKUP_')) throw error;
    throw new Error('BACKUP_DATABASE_INVALID');
  } finally {
    database?.close();
  }
};

export async function createBackup(options: BackupOptions): Promise<BackupManifest> {
  const dataDirectory = resolve(options.dataDirectory);
  const databasePath = resolve(options.databasePath);
  assertDataAndDatabasePaths(dataDirectory, databasePath);
  const retention = options.retention ?? 7;
  const maxFileCount = options.maxFiles ?? maximumFiles;
  const maxByteCount = options.maxBytes ?? maximumBytes;
  if (!Number.isInteger(retention) || retention < 1 || retention > 100)
    throw new Error('BACKUP_RETENTION_INVALID');
  if (!Number.isInteger(maxFileCount) || maxFileCount < 1 || maxFileCount > maximumFiles)
    throw new Error('BACKUP_FILE_COUNT_LIMIT');
  if (!Number.isSafeInteger(maxByteCount) || maxByteCount < 1 || maxByteCount > maximumBytes)
    throw new Error('BACKUP_SIZE_LIMIT');
  privateDirectory(dataDirectory);
  if (!existsSync(databasePath)) throw new Error('BACKUP_DATABASE_MISSING');
  const backupRoot = backupRootFor(dataDirectory);
  privateDirectory(backupRoot);
  const id =
    'backup-' +
    new Date()
      .toISOString()
      .replace(/[^0-9]/gu, '')
      .slice(0, 14) +
    '-' +
    randomUUID();
  const backupDirectory = backupDirectoryFor(dataDirectory, id);
  const filesDirectory = resolve(backupDirectory, 'files');
  privateDirectory(filesDirectory);
  const backupDatabasePath = resolve(backupDirectory, databaseName);
  try {
    await options.database.backup(backupDatabasePath);
    privateFile(backupDatabasePath);
    const managedFiles = collectManagedFiles(
      dataDirectory,
      databasePath,
      maxFileCount,
      maxByteCount,
    );
    const files: BackupFileEntry[] = [];
    for (const file of managedFiles) {
      const target = resolve(filesDirectory, file.path);
      if (!inside(filesDirectory, target)) throw new Error('BACKUP_PATH_INVALID');
      privateDirectory(dirname(target));
      copyFileSync(file.absolutePath, target);
      privateFile(target);
      files.push({
        path: file.path,
        byteSize: statSync(target).size,
        checksum: await checksumFile(target),
      });
    }
    const databaseEntry = {
      path: databaseName as 'database.sqlite',
      byteSize: statSync(backupDatabasePath).size,
      checksum: await checksumFile(backupDatabasePath),
    };
    if (databaseEntry.byteSize > maxByteCount) throw new Error('BACKUP_SIZE_LIMIT');
    const manifest: BackupManifest = {
      formatVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      applicationVersion: process.env.npm_package_version ?? '0.1.0',
      schemaVersion: schemaVersionFrom(options.database),
      database: databaseEntry,
      files,
    };
    writeJsonAtomically(resolve(backupDirectory, manifestName), manifest);
    await pruneBackups(dataDirectory, retention);
    return manifest;
  } catch (error) {
    rmSync(backupDirectory, { recursive: true, force: true });
    throw error;
  }
}

export const listBackups = (dataDirectory: string): BackupManifest[] => {
  const root = backupRootFor(dataDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && backupIdPattern.test(entry.name))
    .flatMap((entry) => {
      try {
        const manifest = readManifest(resolve(root, entry.name));
        return manifest.id === entry.name ? [manifest] : [];
      } catch {
        return [];
      }
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
};

export async function pruneBackups(dataDirectory: string, retention: number): Promise<string[]> {
  if (!Number.isInteger(retention) || retention < 1 || retention > 100)
    throw new Error('BACKUP_RETENTION_INVALID');
  const backups = listBackups(dataDirectory);
  const removed: string[] = [];
  for (const backup of backups.slice(retention)) {
    const directory = backupDirectoryFor(dataDirectory, backup.id);
    if (!inside(backupRootFor(dataDirectory), directory)) throw new Error('BACKUP_PATH_INVALID');
    rmSync(directory, { recursive: true, force: true });
    removed.push(backup.id);
  }
  return removed;
}

export async function validateBackup(options: RestoreOptions): Promise<RestoreValidation> {
  assertDataAndDatabasePaths(options.dataDirectory, options.databasePath);
  const backupDirectory = backupDirectoryFor(options.dataDirectory, options.backupId);
  const manifest = readManifest(backupDirectory);
  if (manifest.id !== options.backupId) throw new Error('BACKUP_MANIFEST_INVALID');
  const databasePath = resolve(backupDirectory, manifest.database.path);
  if (!inside(backupDirectory, databasePath)) throw new Error('BACKUP_PATH_INVALID');
  await verifyRegularFile(databasePath, manifest.database.byteSize, manifest.database.checksum);
  validateDatabase(databasePath, manifest);
  let totalBytes = manifest.database.byteSize;
  for (const file of manifest.files) {
    const path = resolve(backupDirectory, 'files', file.path);
    if (!inside(resolve(backupDirectory, 'files'), path)) throw new Error('BACKUP_PATH_INVALID');
    await verifyRegularFile(path, file.byteSize, file.checksum);
    totalBytes += file.byteSize;
    if (totalBytes > maximumBytes) throw new Error('BACKUP_SIZE_LIMIT');
  }
  return {
    manifest,
    backupDirectory,
    databasePath,
    fileCount: manifest.files.length,
    totalBytes,
    validatedAt: new Date().toISOString(),
  };
}

const moveIfPresent = (source: string, target: string): boolean => {
  if (!existsSync(source)) return false;
  privateDirectory(dirname(target));
  renameSync(source, target);
  return true;
};

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const validation = await validateBackup(options);
  if (options.dryRun !== false) return { ...validation, dryRun: true, restored: false };
  const dataDirectory = resolve(options.dataDirectory);
  const databasePath = resolve(options.databasePath);
  const operationId = randomUUID();
  const operationRoot = resolve(dataDirectory, '.woo-ops-restore-' + operationId);
  const filesStage = resolve(operationRoot, 'files');
  const previousFiles = resolve(operationRoot, 'previous-files');
  const databaseStage = resolve(
    dirname(databasePath),
    '.woo-ops-restore-' + operationId + '.sqlite',
  );
  const previousDatabase = resolve(
    dirname(databasePath),
    '.woo-ops-restore-' + operationId + '.previous.sqlite',
  );
  let databaseInstalled = false;
  let previousDatabaseCreated = false;
  const movedFiles: ManagedFile[] = [];
  try {
    privateDirectory(filesStage);
    privateDirectory(previousFiles);
    copyFileSync(validation.databasePath, databaseStage);
    privateFile(databaseStage);
    for (const file of validation.manifest.files) {
      const source = resolve(validation.backupDirectory, 'files', file.path);
      const target = resolve(filesStage, file.path);
      privateDirectory(dirname(target));
      copyFileSync(source, target);
      privateFile(target);
    }
    const currentFiles = collectManagedFiles(dataDirectory, databasePath);
    for (const file of currentFiles) {
      const target = resolve(previousFiles, file.path);
      privateDirectory(dirname(target));
      renameSync(file.absolutePath, target);
      movedFiles.push(file);
    }
    const currentSidecars = [
      databasePath + '-wal',
      databasePath + '-shm',
      databasePath + '-journal',
    ];
    const previousSidecars = [
      previousDatabase + '-wal',
      previousDatabase + '-shm',
      previousDatabase + '-journal',
    ];
    for (const [index, sidecar] of currentSidecars.entries()) {
      const previous = previousSidecars[index];
      if (previous) moveIfPresent(sidecar, previous);
    }
    previousDatabaseCreated = moveIfPresent(databasePath, previousDatabase);
    if (!existsSync(databaseStage)) throw new Error('BACKUP_DATABASE_MISSING');
    privateDirectory(dirname(databasePath));
    renameSync(databaseStage, databasePath);
    databaseInstalled = true;
    for (const file of validation.manifest.files) {
      const source = resolve(filesStage, file.path);
      const target = resolve(dataDirectory, file.path);
      privateDirectory(dirname(target));
      renameSync(source, target);
      privateFile(target);
    }
    rmSync(operationRoot, { recursive: true, force: true });
    rmSync(previousDatabase, { force: true });
    rmSync(previousDatabase + '-wal', { force: true });
    rmSync(previousDatabase + '-shm', { force: true });
    rmSync(previousDatabase + '-journal', { force: true });
    return { ...validation, dryRun: false, restored: true };
  } catch (error) {
    for (const file of validation.manifest.files)
      rmSync(resolve(dataDirectory, file.path), { force: true });
    if (databaseInstalled) {
      rmSync(databasePath, { force: true });
    }
    if (previousDatabaseCreated && existsSync(previousDatabase)) {
      moveIfPresent(previousDatabase, databasePath);
    }
    const currentSidecars = [
      databasePath + '-wal',
      databasePath + '-shm',
      databasePath + '-journal',
    ];
    const previousSidecars = [
      previousDatabase + '-wal',
      previousDatabase + '-shm',
      previousDatabase + '-journal',
    ];
    for (const [index, sidecar] of currentSidecars.entries()) {
      const previous = previousSidecars[index];
      if (previous) moveIfPresent(previous, sidecar);
    }
    for (const file of movedFiles) {
      const previous = resolve(previousFiles, file.path);
      if (existsSync(previous)) {
        privateDirectory(dirname(file.absolutePath));
        renameSync(previous, file.absolutePath);
      }
    }
    rmSync(operationRoot, { recursive: true, force: true });
    rmSync(databaseStage, { force: true });
    throw error instanceof Error ? error : new Error('BACKUP_RESTORE_FAILED');
  }
}
