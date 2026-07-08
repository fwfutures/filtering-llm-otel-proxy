const { getAttr } = require('./otlp');

// Opt-in tracing. A repo opts in by stamping an OTLP resource attribute
// (default `tracing`) with a truthy value — typically via a committed
// .claude/settings.json:  { "env": { "OTEL_RESOURCE_ATTRIBUTES": "tracing=yes" } }
// A developer can override per session with their own OTEL_RESOURCE_ATTRIBUTES.
// Everything not opted in is dropped.
const OPT_IN = new Set(['yes', 'true', '1', 'on', 'enabled']);

function optedIn(value) {
  return value != null && OPT_IN.has(String(value).trim().toLowerCase());
}

// Filter one OTLP payload down to the resource entries that opted into tracing.
// Pure and side-effect free: returns the kept payload plus a per-label tally
// the caller persists as counters. `repoKey` is only a label for the dashboard
// (falls back to service.name, then "(untagged)") — it is NOT the filter key.
function filterPayload(payload, field, { optInKey = 'tracing', repoKey = 'repo' } = {}) {
  const entries = Array.isArray(payload && payload[field]) ? payload[field] : [];
  const kept = [];
  const tally = {};
  const bump = (label, k) => {
    const t = (tally[label] ||= { received: 0, forwarded: 0, dropped: 0 });
    t[k] += 1;
  };

  for (const entry of entries) {
    const attrs = entry && entry.resource && entry.resource.attributes;
    const label = getAttr(attrs, repoKey) ?? getAttr(attrs, 'service.name') ?? '(untagged)';
    bump(label, 'received');
    if (optedIn(getAttr(attrs, optInKey))) {
      kept.push(entry);
      bump(label, 'forwarded');
    } else {
      bump(label, 'dropped');
    }
  }

  return { filtered: { ...payload, [field]: kept }, tally, keptCount: kept.length };
}

module.exports = { filterPayload, optedIn };
