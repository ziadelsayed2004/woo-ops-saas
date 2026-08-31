import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  privateDocumentArtifactPath,
  readPrivateDocumentArtifact,
  writePrivateDocumentArtifact,
} from '../src/document-artifacts.js';

test('private batch artifacts reject traversal, symlink-like paths, and checksum tampering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-document-artifact-security-'));
  const accountId = randomUUID();
  const batchId = randomUUID();
  const artifactId = `order-${randomUUID()}`;
  const bytes = Buffer.from('private artifact fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    const stored = writePrivateDocumentArtifact(
      directory,
      accountId,
      batchId,
      artifactId,
      'pdf',
      bytes,
    );
    assert.equal(stored.checksum, digest);
    assert.deepEqual(readPrivateDocumentArtifact(directory, stored.relativePath, digest), bytes);
    assert.throws(
      () => privateDocumentArtifactPath(directory, `${accountId}/${batchId}/../outside.pdf`),
      /DOCUMENT_ARTIFACT_PATH_INVALID/,
    );
    assert.throws(
      () => privateDocumentArtifactPath(directory, `${accountId}/other/${artifactId}.exe`),
      /DOCUMENT_ARTIFACT_PATH_INVALID/,
    );
    assert.throws(
      () => readPrivateDocumentArtifact(directory, stored.relativePath, '0'.repeat(64)),
      /DOCUMENT_ARTIFACT_CHECKSUM_MISMATCH/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
