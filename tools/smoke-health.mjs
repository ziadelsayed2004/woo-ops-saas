const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const response = await fetch(`${baseUrl}/health`);
if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);
const body = await response.json();
if (body.status !== 'ok' || body.database !== 'connected')
  throw new Error(`Unhealthy response: ${JSON.stringify(body)}`);
console.log(`Health OK: ${body.service} ${body.version}`);
