import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogCategoryIdsSchema } from '../dist/index.js';

test('catalog category query accepts repeated bounded Woo IDs only', () => {
  assert.deepEqual(catalogCategoryIdsSchema.parse(undefined), []);
  assert.deepEqual(catalogCategoryIdsSchema.parse('4'), ['4']);
  assert.deepEqual(catalogCategoryIdsSchema.parse(['4', '5']), ['4', '5']);
  for (const value of ['0', 'abc', '4 OR 1=1', ['4', {}], Array(21).fill('4')]) {
    assert.equal(catalogCategoryIdsSchema.safeParse(value).success, false);
  }
});
