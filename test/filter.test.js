const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { filterPayload, optedIn } = require('../src/filter');
const { redactEntry, REDACTED } = require('../src/redact');
const { enrichLogs } = require('../src/enrich');
const { handle } = require('../src/app');
const { MemoryStore } = require('../src/store/memory');
const { getAttr } = require('../src/otlp');

const logs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/logs.json'), 'utf8'));

const strAttr = (k, v) => ({ key: k, value: { stringValue: v } });
const intAttr = (k, v) => ({ key: k, value: { intValue: v } });

// A metrics resource entry, optionally opted in, for partition tests.
function metricEntry({ tracing, repo = 'acme/app' } = {}) {
  const attrs = [strAttr('repo', repo), strAttr('service.name', 'claude-code')];
  if (tracing !== undefined) attrs.push(strAttr('tracing', tracing));
  return { resource: { attributes: attrs }, scopeMetrics: [] };
}

test('optedIn recognises truthy opt-in values', () => {
  for (const v of ['yes', 'true', '1', 'on', 'ENABLED']) assert.ok(optedIn(v), v);
  for (const v of ['no', 'false', '0', 'off', '', undefined, null]) assert.ok(!optedIn(v), String(v));
});

test('filterPayload partitions opted-in (full) vs not (redacted)', () => {
  const payload = { resourceMetrics: [metricEntry({ tracing: 'yes', repo: 'acme/in' }), metricEntry({ repo: 'acme/out' })] };
  const { forwardEntries, redactEntries, tally } = filterPayload(payload, 'resourceMetrics', {});
  assert.equal(forwardEntries.length, 1);
  assert.equal(redactEntries.length, 1);
  assert.deepEqual(tally['acme/in'], { received: 1, forwarded: 1, redacted: 0, dropped: 0 });
  assert.deepEqual(tally['acme/out'], { received: 1, forwarded: 0, redacted: 1, dropped: 0 });
});

test('filterPayload drops non-opted when forwardRedacted=false', () => {
  const payload = { resourceMetrics: [metricEntry({ repo: 'acme/out' })] };
  const { redactEntries, tally } = filterPayload(payload, 'resourceMetrics', { forwardRedacted: false });
  assert.equal(redactEntries.length, 0);
  assert.deepEqual(tally['acme/out'], { received: 1, forwarded: 0, redacted: 0, dropped: 1 });
});

test('redactEntry strips prompt/tool content from spans, keeps structure', () => {
  const entry = {
    resource: { attributes: [] },
    scopeSpans: [{ spans: [
      { name: 'claude_code.interaction', attributes: [strAttr('user_prompt', 'secret prompt'), intAttr('user_prompt_length', 13)] },
      { name: 'claude_code.tool', attributes: [strAttr('tool_name', 'Bash'), strAttr('full_command', 'cat .env')],
        events: [{ name: 'tool.output' }, { name: 'gen_ai.request.attempt' }] },
    ] }],
  };
  redactEntry(entry, 'traces');
  const [interaction, tool] = entry.scopeSpans[0].spans;
  assert.equal(getAttr(interaction.attributes, 'user_prompt'), REDACTED);
  assert.equal(getAttr(interaction.attributes, 'user_prompt_length'), 13);   // metadata kept
  assert.equal(getAttr(tool.attributes, 'full_command'), REDACTED);
  assert.equal(getAttr(tool.attributes, 'tool_name'), 'Bash');               // safe attr kept
  assert.deepEqual(tool.events.map((e) => e.name), ['gen_ai.request.attempt']); // tool.output dropped
});

test('redactEntry drops raw-body records and redacts prompt/response/tool content in logs', () => {
  const rec = (name, extra = []) => ({ attributes: [strAttr('event.name', name), ...extra] });
  const entry = {
    resource: { attributes: [] },
    scopeLogs: [{ logRecords: [
      rec('api_request_body', [strAttr('body', '{"messages":[{"role":"user"...}')]),
      rec('api_response_body', [strAttr('body', '{"content":"..."}')]),
      rec('user_prompt', [strAttr('prompt', 'secret'), intAttr('prompt_length', 6)]),
      rec('assistant_response', [strAttr('response', 'the answer')]),
      // tool records survive (they exist content-off) but their content attrs are stripped
      rec('tool_decision', [strAttr('tool_name', 'Bash'), strAttr('tool_parameters', '{"full_command":"cat .env"}')]),
      rec('tool_result', [strAttr('tool_input', '{"command":"cat .env"}'), intAttr('duration_ms', 12)]),
      rec('api_request', [intAttr('input_tokens', 10)]),
    ] }],
  };
  redactEntry(entry, 'logs');
  const recs = entry.scopeLogs[0].logRecords;
  const names = recs.map((r) => getAttr(r.attributes, 'event.name'));
  assert.deepEqual(names, ['user_prompt', 'assistant_response', 'tool_decision', 'tool_result', 'api_request']);
  assert.equal(getAttr(recs[0].attributes, 'prompt'), REDACTED);
  assert.equal(getAttr(recs[0].attributes, 'prompt_length'), 6);   // metadata kept
  assert.equal(getAttr(recs[1].attributes, 'response'), REDACTED);
  assert.equal(getAttr(recs[2].attributes, 'tool_parameters'), REDACTED);
  assert.equal(getAttr(recs[2].attributes, 'tool_name'), 'Bash');  // safe attr kept
  assert.equal(getAttr(recs[3].attributes, 'tool_input'), REDACTED);
  assert.equal(getAttr(recs[3].attributes, 'duration_ms'), 12);    // metric kept
  assert.equal(getAttr(recs[4].attributes, 'input_tokens'), 10);
});

test('ingest: opted-in forwarded full, non-opted forwarded redacted (counters)', async () => {
  const store = new MemoryStore();
  const env = {};
  const payload = { resourceMetrics: [metricEntry({ tracing: 'yes', repo: 'acme/in' }), metricEntry({ repo: 'acme/out' })] };
  const res = await handle({ method: 'POST', path: '/v1/metrics', headers: {}, body: JSON.stringify(payload) }, { store, env });
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.forwarded, 1);
  assert.equal(parsed.redacted, 1);
  const stats = JSON.parse((await handle({ method: 'GET', path: '/admin/api/stats', headers: {}, body: '' }, { store, env })).body);
  assert.equal(stats.repos['acme/in'].metrics.forwarded, 1);
  assert.equal(stats.repos['acme/out'].metrics.redacted, 1);
});

test('enrichLogs names every record in the real captured logs fixture', () => {
  const copy = JSON.parse(JSON.stringify(logs));
  enrichLogs(copy);
  const named = copy.resourceLogs
    .flatMap((rl) => rl.scopeLogs || [])
    .flatMap((sl) => sl.logRecords || [])
    .every((lr) => typeof getAttr(lr.attributes, 'name') === 'string');
  assert.ok(named);
});

test('admin token gate', async () => {
  const store = new MemoryStore();
  const env = { ADMIN_TOKEN: 'secret' };
  assert.equal((await handle({ method: 'GET', path: '/admin/api/stats', headers: {}, body: '' }, { store, env })).status, 401);
  assert.equal((await handle({ method: 'GET', path: '/admin/api/stats', headers: { authorization: 'Bearer secret' }, body: '' }, { store, env })).status, 200);
  assert.equal((await handle({ method: 'GET', path: '/admin/api/stats?token=secret', headers: {}, body: '' }, { store, env })).status, 200);
});
