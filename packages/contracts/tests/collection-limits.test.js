import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportMarkOrdersSchema,
  exportProfileVersionCreateSchema,
  manualOrderCreateSchema,
} from '../dist/index.js';

test('oversized bounded API collections fail before Zod visits their entries', () => {
  const cases = [
    [
      exportProfileVersionCreateSchema,
      { format: 'xlsx', rowMode: 'order', filenameTemplate: 'orders' },
      'columns',
      101,
    ],
    [exportMarkOrdersSchema, {}, 'orderIds', 5_001],
    [manualOrderCreateSchema, { currency: 'EGP' }, 'lines', 501],
    [
      manualOrderCreateSchema,
      { currency: 'EGP', lines: [{ name: 'Product', quantity: 1, unitPriceMinor: '100' }] },
      'tags',
      51,
    ],
  ];
  for (const [schema, input, key, length] of cases) {
    const entries = new Array(length);
    let visits = 0;
    Object.defineProperty(entries, 0, {
      get() {
        visits++;
        return null;
      },
    });
    const result = schema.safeParse({ ...input, [key]: entries });
    assert.equal(result.success, false, key);
    assert.ok(
      result.error.issues.some((issue) => issue.code === 'too_big' && issue.path[0] === key),
      key,
    );
    assert.equal(visits, 0, `${key} must be rejected before validating entries`);
  }
  assert.equal(exportMarkOrdersSchema.safeParse({ orderIds: ['order-1'] }).success, true);
  assert.equal(
    manualOrderCreateSchema.safeParse({
      currency: 'EGP',
      lines: [{ name: 'Product', quantity: 1, unitPriceMinor: '100' }],
    }).success,
    true,
  );
});
