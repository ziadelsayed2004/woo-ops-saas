import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { healthResponseSchema } from '@woo-ops/contracts';
import { SqliteStore } from '@woo-ops/persistence';

const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.WOO_OPS_DATA_DIR ?? './data');
const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? `${dataDirectory}/woo-ops.sqlite`);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new SqliteStore(databasePath);
const app: Express = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((_request, response, next) => {
  response.setHeader('x-correlation-id', randomUUID());
  next();
});
app.get('/health', (_request, response) => {
  const body = healthResponseSchema.parse({
    status: 'ok',
    service: 'api',
    database: 'connected',
    version: '0.1.0',
  });
  response.json(body);
});
app.get('/api/v1/meta', (_request, response) =>
  response.json({ locale: 'ar-EG', direction: 'rtl', readOnlyConnector: true }),
);

app.listen(port, () => console.log(`Woo Ops API listening on ${port}`));

export { app, store };
