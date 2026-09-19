import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export type PersistenceMode = 'configured' | 'hostinger-domain' | 'release-local';

export type RuntimePaths = {
  dataDirectory: string;
  databasePath: string;
  persistenceMode: PersistenceMode;
  durable: boolean;
};

const hostingerDomainRoot = (workingDirectory: string): string | undefined => {
  let current = resolve(workingDirectory);
  while (true) {
    if (basename(current).toLowerCase() === 'hbuilds') return dirname(current);
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export const resolveRuntimePaths = (
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): RuntimePaths => {
  const configuredDataDirectory = environment.WOO_OPS_DATA_DIR?.trim();
  const configuredDatabasePath = environment.WOO_OPS_DATABASE?.trim();
  const domainRoot =
    environment.NODE_ENV === 'production' ? hostingerDomainRoot(workingDirectory) : undefined;
  // Hostinger checks every deployment out below hbuilds/<release>. Relative overrides from
  // older deployments therefore point at disposable release storage. Treat those values as
  // legacy hints and anchor them at the stable domain root instead.
  const hasDurableConfiguredData = Boolean(
    configuredDataDirectory && isAbsolute(configuredDataDirectory),
  );
  const persistenceMode: PersistenceMode = hasDurableConfiguredData
    ? 'configured'
    : domainRoot
      ? 'hostinger-domain'
      : 'release-local';
  const dataDirectory = hasDurableConfiguredData
    ? resolve(workingDirectory, configuredDataDirectory as string)
    : domainRoot
      ? join(domainRoot, '.woo-ops-data')
      : resolve(workingDirectory, 'data');
  const databasePath =
    configuredDatabasePath && isAbsolute(configuredDatabasePath)
      ? resolve(workingDirectory, configuredDatabasePath)
      : join(dataDirectory, 'woo-ops.sqlite');
  // Relative legacy database overrides are ignored above and safely placed inside the
  // absolute data directory, so the effective path remains durable.
  const configuredPathsAreDurable = hasDurableConfiguredData;

  return {
    dataDirectory,
    databasePath,
    persistenceMode,
    durable:
      persistenceMode === 'hostinger-domain' ||
      (persistenceMode === 'configured' && configuredPathsAreDurable),
  };
};
