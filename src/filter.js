const { getAttr } = require('./otlp');

// Opt-in tracing. A repo opts in by stamping an OTLP resource attribute
// (default `tracing`) with a truthy value — typically via a committed
// .claude/settings.json:  { "env": { "OTEL_RESOURCE_ATTRIBUTES": "tracing=yes" } }
// A developer can override per session with their own OTEL_RESOURCE_ATTRIBUTES.
//
// Opted-in resources are forwarded in full. Resources that did not opt in are
// still forwarded — but redacted (structure/metadata only, no prompts, no
// content) — unless forwardRedacted is false, in which case they are dropped.
const OPT_IN = new Set(['yes', 'true', '1', 'on', 'enabled']);

function optedIn(value) {
  return value != null && OPT_IN.has(String(value).trim().toLowerCase());
}

// Partition one OTLP payload's resource entries into the ones to forward in full
// and the ones to forward redacted. Pure: returns entry references plus a
// per-label tally the caller persists as counters. `repoKey` only labels the
// counters (falls back to service.name, then "(untagged)").
function filterPayload(payload, field, { optInKey = 'tracing', repoKey = 'repo', forwardRedacted = true } = {}) {
  const entries = Array.isArray(payload && payload[field]) ? payload[field] : [];
  const forwardEntries = [];
  const redactEntries = [];
  const tally = {};
  const bump = (label, k) => {
    const t = (tally[label] ||= { received: 0, forwarded: 0, redacted: 0, dropped: 0 });
    t[k] += 1;
  };

  for (const entry of entries) {
    const attrs = entry && entry.resource && entry.resource.attributes;
    const label = getAttr(attrs, repoKey) ?? getAttr(attrs, 'service.name') ?? '(untagged)';
    bump(label, 'received');
    if (optedIn(getAttr(attrs, optInKey))) {
      forwardEntries.push(entry);
      bump(label, 'forwarded');
    } else if (forwardRedacted) {
      redactEntries.push(entry);
      bump(label, 'redacted');
    } else {
      bump(label, 'dropped');
    }
  }

  return { forwardEntries, redactEntries, tally };
}

module.exports = { filterPayload, optedIn };
