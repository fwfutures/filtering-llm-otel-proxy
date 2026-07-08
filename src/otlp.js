// Helpers for walking OTLP/JSON payloads (traces, metrics, logs).
//
// OTLP/HTTP JSON has one of three top-level shapes depending on the signal:
//   /v1/traces  -> { resourceSpans:   [ { resource, scopeSpans   } ] }
//   /v1/metrics -> { resourceMetrics: [ { resource, scopeMetrics } ] }
//   /v1/logs    -> { resourceLogs:    [ { resource, scopeLogs    } ] }
// Each "resource*" entry carries a `resource.attributes` list of {key,value}.
// We filter at that resource granularity: an entry is kept or dropped whole,
// which is correct because Claude Code stamps the repo on the resource.

const SIGNALS = {
  traces: { path: '/v1/traces', field: 'resourceSpans' },
  metrics: { path: '/v1/metrics', field: 'resourceMetrics' },
  logs: { path: '/v1/logs', field: 'resourceLogs' },
};

// Map an inbound request path to a signal descriptor (tolerant of prefixes).
function signalForPath(path) {
  const clean = (path || '').split('?')[0].replace(/\/+$/, '');
  for (const [name, sig] of Object.entries(SIGNALS)) {
    if (clean.endsWith(sig.path)) return { name, ...sig };
  }
  return null;
}

// Read a single OTLP attribute value ({stringValue}|{intValue}|...) as JS.
function attrValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  return undefined;
}

// Pull a named key out of an OTLP attributes array.
function getAttr(attributes, key) {
  if (!Array.isArray(attributes)) return undefined;
  const found = attributes.find((a) => a && a.key === key);
  return found ? attrValue(found.value) : undefined;
}

module.exports = { SIGNALS, signalForPath, attrValue, getAttr };
