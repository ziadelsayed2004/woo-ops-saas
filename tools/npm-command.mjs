import fs from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const npmCli =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

// Windows cannot spawn a .cmd shim with shell:false. Invoke npm's CLI through Node so every
// repository runner has the same safe, cross-platform process boundary.
export const npmCommand =
  isWindows && fs.existsSync(npmCli) ? process.execPath : isWindows ? 'npm.cmd' : 'npm';
export const npmPrefixArgs = isWindows && npmCommand === process.execPath ? [npmCli] : [];
export const npmArgs = (args = []) => [...npmPrefixArgs, ...args];
