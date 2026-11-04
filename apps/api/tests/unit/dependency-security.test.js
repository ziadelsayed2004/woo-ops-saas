import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import express from 'express';

const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve('express'));
const proxyAddress = expressRequire('proxy-addr');

test('IPv4-mapped IPv6 proxy subnets do not trust unrelated IPv4 clients', () => {
  const trust = proxyAddress.compile('::ffff:10.0.0.0/104');
  assert.equal(trust('10.20.30.40'), true);
  assert.equal(trust('::ffff:10.20.30.40'), true);
  assert.equal(trust('203.0.113.20'), false);
  assert.equal(trust('127.0.0.1'), false);
  assert.equal(trust('::ffff:203.0.113.20'), false);
});

test('compressed JSON with later trailing bytes does not crash the request parser', async () => {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.post('/', (req, res) => res.json(req.body));
  app.get('/health', (_req, res) => res.sendStatus(200));
  app.use((error, _req, res, _next) => res.sendStatus(error.status || 500));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = server.address().port;
    const response = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'deflate',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.setTimeout(5_000, () => req.destroy(new Error('PARSER_REQUEST_TIMEOUT')));
      req.write(deflateSync(Buffer.from('{"ok":true}')));
      // A second HTTP chunk arrives after the decompressor has finished parsing JSON.
      setTimeout(() => req.end(Buffer.from('trailing compressed bytes')), 50);
    });
    assert.equal(response, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
