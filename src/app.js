// Framework-agnostic core. handle() takes a normalized request and returns a
// normalized response, so the same logic serves both the local HTTP server and
// the Lambda Function URL adapter.
const { signalForPath, getAttr } = require('./otlp');
const { filterPayload } = require('./filter');
const { enrichLogs } = require('./enrich');
const { forward } = require('./forward');
const { dashboardHtml } = require('./dashboard');

const json = (status, obj) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

// Admin routes require the bearer token when ADMIN_TOKEN is set. The token may
// arrive as `Authorization: Bearer <t>` (API calls) or `?token=<t>` (page load,
// since a browser navigation can't set headers).
function authed(req, env) {
  const want = env.ADMIN_TOKEN;
  if (!want) return true;
  const hdr = req.headers['authorization'] || req.headers['Authorization'] || '';
  const bearer = hdr.replace(/^Bearer\s+/i, '');
  const qtok = new URLSearchParams((req.path.split('?')[1]) || '').get('token');
  return bearer === want || qtok === want;
}

async function handle(req, deps) {
  const { store, env = process.env } = deps;
  const path = (req.path || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const method = (req.method || 'GET').toUpperCase();

  // --- OTLP ingest -------------------------------------------------------
  const sig = signalForPath(req.path);
  if (sig && method === 'POST') {
    let payload;
    try {
      payload = JSON.parse(req.body || '{}');
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    const { filtered, tally, keptCount } = filterPayload(payload, sig.field, {
      optInKey: env.OPT_IN_ATTR || 'tracing',
      repoKey: env.REPO_ATTR || 'repo',
    });
    await store.recordTally(sig.name, tally);

    let result = { forwarded: false, reason: 'nothing opted in', status: 0 };
    if (keptCount > 0) {
      // Name span-correlated log records so Honeycomb doesn't show "unspecified".
      if (sig.name === 'logs' && (env.ENRICH_SPAN_EVENT_NAMES || '1') !== '0') enrichLogs(filtered);
      result = await forward(sig.name, filtered, env);
    }
    // Always 200/partial-success to the client: OTLP exporters retry on 5xx,
    // and a resource not opting into tracing is not a transport failure.
    return json(200, { signal: sig.name, kept: keptCount, tally, sink: result });
  }

  // --- Admin: dashboard page --------------------------------------------
  if ((path === '/' || path === '/admin') && method === 'GET') {
    if (!authed(req, env)) return json(401, { error: 'unauthorized' });
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: dashboardHtml() };
  }

  // --- Admin: JSON API ---------------------------------------------------
  if (path.startsWith('/admin/api/')) {
    if (!authed(req, env)) return json(401, { error: 'unauthorized' });
    if (path === '/admin/api/stats' && method === 'GET') {
      return json(200, await store.getStats());
    }
  }

  if (path === '/health') return json(200, { ok: true });
  return json(404, { error: 'not found', path });
}

module.exports = { handle };
