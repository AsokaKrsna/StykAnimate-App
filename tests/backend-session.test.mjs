import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { startBackend, probeBackend, sessionProof } = require('../desktop/backend.cjs');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('readiness rejects a loopback listener that cannot prove the session token', async () => {
  const token = randomBytes(16).toString('hex');
  const impostor = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, session: null }));
  });
  await new Promise(resolve => impostor.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${impostor.address().port}`;
  try {
    assert.equal(await probeBackend(origin), true, 'tokenless development servers keep the plain health check');
    assert.equal(await probeBackend(origin, token), false);
  } finally { impostor.close(); }
});

test('a token-protected codec refuses API requests without the session token', async (t) => {
  const token = randomBytes(16).toString('hex');
  let backend;
  try { backend = await startBackend({ appRoot, resourcesPath: appRoot, token }); }
  catch (error) { t.skip(`Python codec unavailable: ${error.message.split('\n')[0]}`); return; }
  try {
    const health = await (await fetch(`${backend.origin}/api/health`)).json();
    assert.equal(health.session, sessionProof(token));
    assert.equal((await fetch(`${backend.origin}/api/samples`)).status, 401);
    assert.equal((await fetch(`${backend.origin}/api/samples`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${backend.origin}/api/samples`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await fetch(`${backend.origin}/index.html`)).status, 200, 'the workspace page itself stays public to the window');
  } finally { backend.stop(); }
});
