import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspacePatterns = ['packages', 'apps'];

const packageDirectories = workspacePatterns.flatMap((directory) => {
  const root = path.join(repositoryRoot, directory);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
});

const packages = packageDirectories
  .map((directory) => {
    const manifestPath = path.join(directory, 'package.json');
    if (!fs.existsSync(manifestPath)) return null;
    return {
      directory,
      manifestPath,
      manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    };
  })
  .filter((value) => value !== null);

const byName = new Map(packages.map((workspace) => [workspace.manifest.name, workspace]));

const dependenciesOf = (workspace) => {
  const dependencies = {
    ...workspace.manifest.dependencies,
    ...workspace.manifest.devDependencies,
    ...workspace.manifest.optionalDependencies,
  };
  return Object.keys(dependencies).filter((name) => byName.has(name));
};

export const workspaces = packages;
export const rootDirectory = repositoryRoot;

export function selectWorkspaces(filter) {
  if (!filter) return packages;
  const selected =
    byName.get(filter) ??
    packages.find((workspace) => path.basename(workspace.directory) === filter);
  if (!selected) throw new Error(`Unknown workspace: ${filter}`);
  return [selected];
}

export function dependencyFirst(selected = packages) {
  const includeDependencies = selected.length !== packages.length;
  const dependencies = new Set(selected);
  const collectDependencies = (workspace) => {
    for (const dependencyName of dependenciesOf(workspace)) {
      const dependency = byName.get(dependencyName);
      if (!dependency || dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      collectDependencies(dependency);
    }
  };
  if (includeDependencies) for (const workspace of selected) collectDependencies(workspace);

  const result = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (workspace) => {
    if (visited.has(workspace)) return;
    if (visiting.has(workspace))
      throw new Error(`Workspace dependency cycle at ${workspace.manifest.name}`);
    visiting.add(workspace);
    for (const dependencyName of dependenciesOf(workspace)) {
      const dependency = byName.get(dependencyName);
      if (dependency && dependencies.has(dependency)) visit(dependency);
    }
    visiting.delete(workspace);
    visited.add(workspace);
    result.push(workspace);
  };

  for (const workspace of packages) if (dependencies.has(workspace)) visit(workspace);
  return result;
}

export function workspaceByDirectory(directory) {
  return packages.find((workspace) => workspace.directory === directory);
}
