import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const directory = path.resolve('src/locales');
const read = (locale) =>
  JSON.parse(fs.readFileSync(path.join(directory, `${locale}.json`), 'utf8'));
const flatten = (value, prefix = '', output = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') output.set(pathKey, child);
    else flatten(child, pathKey, output);
  }
  return output;
};
const placeholders = (value) =>
  [...value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/gu)].map((match) => match[1]).sort();

test('Arabic and English translation catalogs have matching reviewable keys', () => {
  const ar = flatten(read('ar'));
  const en = flatten(read('en'));
  assert.deepEqual([...ar.keys()].sort(), [...en.keys()].sort());
  assert.ok(ar.size > 250);
  for (const key of ar.keys()) {
    assert.notEqual(ar.get(key)?.trim(), '', `${key} has empty Arabic copy`);
    assert.notEqual(en.get(key)?.trim(), '', `${key} has empty English copy`);
    assert.deepEqual(placeholders(ar.get(key)), placeholders(en.get(key)), key);
  }
});

test('interpolated copy exposes a named count placeholder in both locales', () => {
  const ar = read('ar');
  const en = read('en');
  assert.match(ar.outputDialog.selectedOrders, /\{\{count\}\}/u);
  assert.match(en.outputDialog.selectedOrders, /\{\{count\}\}/u);
});
