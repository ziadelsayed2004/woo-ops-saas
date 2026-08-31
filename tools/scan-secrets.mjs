import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const patterns = [
  { name: 'private key', expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u },
  { name: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/u },
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u },
  { name: 'Stripe live key', expression: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}\b/u },
  { name: 'Slack token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
];
const findings = [];
for (const file of trackedFiles) {
  if (!existsSync(file)) continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const content = bytes.toString('utf8');
  for (const pattern of patterns)
    if (pattern.expression.test(content)) findings.push(`${file}: ${pattern.name}`);
}
if (findings.length > 0) {
  console.error(`Potential secrets found:\n${findings.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed: ${trackedFiles.length} tracked text files inspected.`);
}
