const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { filterPayload, optedIn } = require('../src/filter');
const { enrichLogs } = require('../src/enrich');
const { handle } = require('../src/app');
const { MemoryStore } = require('../src/store/memory');
const { getAttr } = require('../src/otlp');

const metrics = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/metrics.json'), 'utf8'));
const logs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/logs.json'), 'utf8'));

// Clone a fixture and stamp tracing=<val> onto its resource attributes.
function withTracing(fixture, field, val) {
  const c = JSON.parse(JSON.stringify(fixture));
  const attrs = c[field][0].resource.attributes;
  if (val !== undefined) attrs.push({ key: 'tracing', value: { stringValue: val } });
  return c;
}

test('optedIn recognises truthy opt-in values', () => {
  for (const v of ['yes', 'true', '1', 'on', 'ENABLED', 'Yes']) assert.ok(optedIn(v), v);
  for (const v of ['no', 'false', '0', 'off', '', undefined, null]) assert.ok(!optedIn(v), String(v));
});

test('filterPayload forwards opted-in resources', () => {
  const payload = withTracing(metrics, 'resourceMetrics', 'yes');
  const { filtered, tally, keptCount } = filterPayload(payload, 'resourceMetrics', {});
  assert.equal(keptCount, 1);
  assert.equal(filtered.resourceMetrics.length, 1);
  // labelled by the repo attribute present in the captured fixture
  assert.deepEqual(tally['acme/some-service'], { received: 1, forwarded: 1, dropped: 0 });
});

test('filterPayload drops resources that did not opt in', () => {
  const { tally, keptCount } = filterPayload(metrics, 'resourceMetrics', {});
  assert.equal(keptCount, 0);
  assert.deepEqual(tally['acme/some-service'], { received: 1, forwarded: 0, dropped: 1 });
});

test('filterPayload drops explicit opt-out (tracing=no)', () => {
  const payload = withTracing(metrics, 'resourceMetrics', 'no');
  const { keptCount } = filterPayload(payload, 'resourceMetrics', {});
  assert.equal(keptCount, 0);
});

test('custom opt-in attribute name via optInKey', () => {
  const c = JSON.parse(JSON.stringify(metrics));
  c.resourceMetrics[0].resource.attributes.push({ key: 'observe', value: { stringValue: 'on' } });
  const { keptCount } = filterPayload(c, 'resourceMetrics', { optInKey: 'observe' });
  assert.equal(keptCount, 1);
});

test('untagged resources are labelled by service.name then (untagged)', () => {
  const stripped = { resourceMetrics: [{ resource: { attributes: [
    { key: 'service.name', value: { stringValue: 'claude-code' } },
  ] }, scopeMetrics: [] }] };
  const { tally } = filterPayload(stripped, 'resourceMetrics', {});
  assert.ok(tally['claude-code']);
});

test('ingest -> counters -> stats via handler (opted in => forwarded, dry-run sink)', async () => {
  const store = new MemoryStore();
  const env = {};
  const ingest = await handle(
    { method: 'POST', path: '/v1/metrics', headers: {}, body: JSON.stringify(withTracing(metrics, 'resourceMetrics', 'yes')) },
    { store, env }
  );
  assert.equal(ingest.status, 200);
  const parsed = JSON.parse(ingest.body);
  assert.equal(parsed.kept, 1);
  assert.match(parsed.sink.reason, /dry-run/);
  const stats = JSON.parse((await handle({ method: 'GET', path: '/admin/api/stats', headers: {}, body: '' }, { store, env })).body);
  assert.equal(stats.repos['acme/some-service'].metrics.forwarded, 1);
});

test('enrichLogs names every record in the real captured logs fixture', () => {
  const copy = JSON.parse(JSON.stringify(logs));
  enrichLogs(copy);
  const named = copy.resourceLogs
    .flatMap((rl) => rl.scopeLogs || [])
    .flatMap((sl) => sl.logRecords || [])
    .every((lr) => typeof getAttr(lr.attributes, 'name') === 'string');
  assert.ok(named, 'every log record in the fixture gets a name attribute');
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
