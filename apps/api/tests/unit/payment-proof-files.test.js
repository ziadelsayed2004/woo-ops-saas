import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readPaymentProof, writePaymentProof } from '../../src/payment-proof-files.js';

test('payment proofs are private, checksum bound, size bounded and path safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'woo-proof-'));
  try {
    const bytes = Buffer.from('safe proof');
    const stored = writePaymentProof(root, 'account-1', 'order-1', 'proof-1', 'image/png', bytes);
    assert.deepEqual(readPaymentProof(root, stored.relativePath, stored.checksum), bytes);
    assert.throws(
      () => readPaymentProof(root, stored.relativePath, 'a'.repeat(64)),
      /PAYMENT_PROOF_CHECKSUM_MISMATCH/,
    );
    assert.throws(
      () => writePaymentProof(root, '../escape', 'order-1', 'proof-2', 'image/png', bytes),
      /PAYMENT_PROOF_PATH_INVALID/,
    );
    assert.throws(
      () => writePaymentProof(root, 'account-1', 'order-1', 'proof-3', 'text/html', bytes),
      /PAYMENT_PROOF_TYPE_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
