// Forward a filtered OTLP/JSON payload to a downstream OTLP sink (Honeycomb).
//
// Honeycomb accepts OTLP/HTTP at https://api.honeycomb.io/v1/{traces,metrics,logs}
// authenticated with `x-honeycomb-team: <API_KEY>`. Metrics and logs are routed
// into a dataset named by `x-honeycomb-dataset`; traces are routed by
// service.name so the dataset header is optional there.
//
// Config (env):
//   HONEYCOMB_ENDPOINT  default https://api.honeycomb.io
//   HONEYCOMB_API_KEY   required to actually forward (dry-run without it)
//   HONEYCOMB_DATASET   dataset for metrics/logs (default "claude-code")
async function forward(signalName, payload, env = process.env) {
  const endpoint = (env.HONEYCOMB_ENDPOINT || 'https://api.honeycomb.io').replace(/\/+$/, '');
  const apiKey = env.HONEYCOMB_API_KEY;
  const dataset = env.HONEYCOMB_DATASET || 'claude-code';

  if (!apiKey) {
    return { forwarded: false, reason: 'no HONEYCOMB_API_KEY (dry-run)', status: 0 };
  }

  const headers = {
    'content-type': 'application/json',
    'x-honeycomb-team': apiKey,
  };
  if (signalName !== 'traces') headers['x-honeycomb-dataset'] = dataset;

  const res = await fetch(`${endpoint}/v1/${signalName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    return { forwarded: false, reason: `sink ${res.status}: ${body.slice(0, 200)}`, status: res.status };
  }
  return { forwarded: true, status: res.status };
}

module.exports = { forward };
