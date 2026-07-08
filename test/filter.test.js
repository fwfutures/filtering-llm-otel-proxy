const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { filterPayload, matchRepo } = require('../src/filter');
const { handle } = require('../src/app');
const { MemoryStore } = require('../src/store/memory');

const metrics = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/metrics.json'), 'utf8'));
const logs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/logs.json'), 'utf8'));

// The captured fixtures were produced with repo=acme/some-service.
test('matchRepo: exact and prefix', () => {
  assert.equal(matchRepo('acme/foo', ['acme/foo']), 'acme/foo');
  assert.equal(matchRepo('acme/foo', ['acme/*']), 'acme/*');
  assert.equal(matchRepo('outsider/foo', ['acme/*']), null);
  assert.equal(matchRepo(null, ['acme/*']), null);
});

test('filterPayload keeps whitelisted metrics resource', () => {
  const { filtered, tally, keptCount } = filterPayload(metrics, 'resourceMetrics', ['acme/some-service']);
  assert.equal(keptCount, 1);
  assert.equal(filtered.resourceMetrics.length, 1);
  assert.deepEqual(tally['acme/some-service'], { received: 1, forwarded: 1, dropped: 0 });
});

test('filterPayload drops non-whitelisted repo', () => {
  const { filtered, tally, keptCount } = filterPayload(metrics, 'resourceMetrics', ['acme/other']);
  assert.equal(keptCount, 0);
  assert.equal(filtered.resourceMetrics.length, 0);
  assert.deepEqual(tally['acme/some-service'], { received: 1, forwarded: 0, dropped: 1 });
});

test('filterPayload counts unknown repo as dropped', () => {
  const stripped = { resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [] }] };
  const { tally, keptCount } = filterPayload(stripped, 'resourceLogs', ['acme/*']);
  assert.equal(keptCount, 0);
  assert.deepEqual(tally['(unknown)'], { received: 1, forwarded: 0, dropped: 1 });
});

test('prefix whitelist matches the captured logs fixture', () => {
  const { keptCount } = filterPayload(logs, 'resourceLogs', ['acme/*']);
  assert.equal(keptCount, 1);
});

// End-to-end through the router with the in-memory store (no network: no
// HONEYCOMB_API_KEY => forward() dry-runs).
test('ingest -> counters -> stats via handler', async () => {
  const store = new MemoryStore(['acme/some-service']);
  const env = {};
  const ingest = await handle(
    { method: 'POST', path: '/v1/metrics', headers: {}, body: JSON.stringify(metrics) },
    { store, env }
  );
  assert.equal(ingest.status, 200);
  const parsed = JSON.parse(ingest.body);
  assert.equal(parsed.kept, 1);
  assert.equal(parsed.sink.forwarded, false); // dry-run
  assert.match(parsed.sink.reason, /dry-run/);

  const stats = JSON.parse((await handle({ method: 'GET', path: '/admin/api/stats', headers: {}, body: '' }, { store, env })).body);
  assert.equal(stats.repos['acme/some-service'].metrics.forwarded, 1);
});

test('admin whitelist add/remove roundtrip', async () => {
  const store = new MemoryStore();
  const env = {};
  await handle({ method: 'POST', path: '/admin/api/whitelist', headers: {}, body: JSON.stringify({ repo: 'acme/x' }) }, { store, env });
  let wl = JSON.parse((await handle({ method: 'GET', path: '/admin/api/whitelist', headers: {}, body: '' }, { store, env })).body);
  assert.deepEqual(wl.whitelist, ['acme/x']);
  await handle({ method: 'DELETE', path: '/admin/api/whitelist', headers: {}, body: JSON.stringify({ repo: 'acme/x' }) }, { store, env });
  wl = JSON.parse((await handle({ method: 'GET', path: '/admin/api/whitelist', headers: {}, body: '' }, { store, env })).body);
  assert.deepEqual(wl.whitelist, []);
});

test('admin token gate', async () => {
  const store = new MemoryStore();
  const env = { ADMIN_TOKEN: 'secret' };
  const denied = await handle({ method: 'GET', path: '/admin/api/stats', headers: {}, body: '' }, { store, env });
  assert.equal(denied.status, 401);
  const okHdr = await handle({ method: 'GET', path: '/admin/api/stats', headers: { authorization: 'Bearer secret' }, body: '' }, { store, env });
  assert.equal(okHdr.status, 200);
  const okQry = await handle({ method: 'GET', path: '/admin/api/stats?token=secret', headers: {}, body: '' }, { store, env });
  assert.equal(okQry.status, 200);
});
