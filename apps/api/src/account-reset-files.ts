import { existsSync, lstatSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const safeId = /^[A-Za-z0-9_-]{1,80}$/u;

export const purgeAccountPrivateFiles = (roots: readonly string[], accountId: string): void => {
  if (!safeId.test(accountId)) throw new Error('ACCOUNT_RESET_PATH_INVALID');
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, accountId);
    const pathFromRoot = relative(resolvedRoot, target);
    if (
      pathFromRoot === '' ||
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    )
      throw new Error('ACCOUNT_RESET_PATH_INVALID');
    if (!existsSync(target)) continue;
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('ACCOUNT_RESET_PATH_INVALID');
    rmSync(target, { recursive: true, force: true });
  }
};
