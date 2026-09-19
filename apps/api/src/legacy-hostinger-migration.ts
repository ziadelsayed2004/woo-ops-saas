import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { RuntimePaths } from './runtime-paths.js';

const safeStat = (path: string): { isFile: () => boolean; mtimeMs: number } | null => {
  try {
    const result = statSync(path);
    return { isFile: () => result.isFile(), mtimeMs: Number(result.mtimeMs) };
  } catch {
    return null;
  }
};

/**
 * One-time recovery for the historic Hostinger configuration that placed SQLite below
 * hbuilds/<release>. The destination is never overwritten and candidates never escape hbuilds.
 */
export const migrateLegacyHostingerDatabase = (
  paths: RuntimePaths,
  environment: NodeJS.ProcessEnv = process.env,
): string | null => {
  if (paths.persistenceMode !== 'hostinger-domain' || existsSync(paths.databasePath)) return null;
  const configuredDatabase = environment.WOO_OPS_DATABASE?.trim();
  const configuredData = environment.WOO_OPS_DATA_DIR?.trim();
  if (
    (configuredDatabase && isAbsolute(configuredDatabase)) ||
    (configuredData && isAbsolute(configuredData))
  )
    return null;
  const domainRoot = dirname(paths.dataDirectory);
  const buildsRoot = join(domainRoot, 'hbuilds');
  if (!existsSync(buildsRoot)) return null;
  const repositories = [
    join(buildsRoot, 'source', 'repository'),
    ...readdirSync(buildsRoot, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? [join(buildsRoot, entry.name, 'source', 'repository')] : [],
    ),
  ];
  const candidates = repositories.flatMap((repository) => {
    const candidate = configuredDatabase
      ? resolve(repository, configuredDatabase)
      : join(
          configuredData ? resolve(repository, configuredData) : join(repository, 'data'),
          'woo-ops.sqlite',
        );
    const info = safeStat(candidate);
    return info?.isFile() && candidate !== paths.databasePath
      ? [{ path: candidate, modifiedAt: info.mtimeMs }]
      : [];
  });
  const latest = candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (!latest) return null;
  mkdirSync(dirname(paths.databasePath), { recursive: true });
  const temporaryDatabase = `${paths.databasePath}.migration`;
  copyFileSync(latest.path, temporaryDatabase);
  renameSync(temporaryDatabase, paths.databasePath);
  for (const suffix of ['-wal', '-shm']) {
    const source = `${latest.path}${suffix}`;
    if (existsSync(source)) copyFileSync(source, `${paths.databasePath}${suffix}`);
  }
  const legacyDataDirectory = dirname(latest.path);
  for (const name of [
    'private-documents',
    'private-exports',
    'private-payment-proofs',
    'backups',
  ]) {
    const source = join(legacyDataDirectory, name);
    const destination = join(paths.dataDirectory, name);
    if (existsSync(source) && !existsSync(destination))
      cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  }
  return latest.path;
};
