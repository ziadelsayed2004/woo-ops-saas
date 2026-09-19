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
    environment.NODE_ENV === 'production' && !configuredDataDirectory
      ? hostingerDomainRoot(workingDirectory)
      : undefined;
  const persistenceMode: PersistenceMode = configuredDataDirectory
    ? 'configured'
    : domainRoot
      ? 'hostinger-domain'
      : 'release-local';
  const dataDirectory = configuredDataDirectory
    ? resolve(workingDirectory, configuredDataDirectory)
    : domainRoot
      ? join(domainRoot, '.woo-ops-data')
      : resolve(workingDirectory, 'data');
  const databasePath = configuredDatabasePath
    ? resolve(workingDirectory, configuredDatabasePath)
    : join(dataDirectory, 'woo-ops.sqlite');
  const configuredPathsAreDurable =
    Boolean(configuredDataDirectory && isAbsolute(configuredDataDirectory)) &&
    (!configuredDatabasePath || isAbsolute(configuredDatabasePath));

  return {
    dataDirectory,
    databasePath,
    persistenceMode,
    durable:
      persistenceMode === 'hostinger-domain' ||
      (persistenceMode === 'configured' && configuredPathsAreDurable),
  };
};
