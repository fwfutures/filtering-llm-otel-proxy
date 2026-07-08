const { getAttr } = require('./otlp');

// A whitelist entry is either an exact repo ("acme/foo") or a prefix
// pattern ending in "*" ("acme/*"). matchRepo returns the matching entry
// (for attribution) or null.
function matchRepo(repo, whitelist) {
  if (repo == null) return null;
  for (const entry of whitelist) {
    if (entry === repo) return entry;
    if (entry.endsWith('*') && repo.startsWith(entry.slice(0, -1))) return entry;
  }
  return null;
}

// Filter one OTLP payload down to the resource entries whose repo attribute
// is whitelisted. Pure and side-effect free: returns the kept payload plus a
// per-repo tally the caller persists as counters.
//
//   payload   parsed OTLP/JSON object
//   field     "resourceSpans" | "resourceMetrics" | "resourceLogs"
//   whitelist array of allowed repo entries
//   repoKey   resource attribute holding the repo (default "repo")
function filterPayload(payload, field, whitelist, repoKey = 'repo') {
  const entries = Array.isArray(payload && payload[field]) ? payload[field] : [];
  const kept = [];
  // tally[repo] = { received, forwarded, dropped }
  const tally = {};
  const bump = (repo, k) => {
    const t = (tally[repo] ||= { received: 0, forwarded: 0, dropped: 0 });
    t[k] += 1;
  };

  for (const entry of entries) {
    const attrs = entry && entry.resource && entry.resource.attributes;
    const repo = getAttr(attrs, repoKey) ?? '(unknown)';
    bump(repo, 'received');
    if (matchRepo(repo === '(unknown)' ? null : repo, whitelist)) {
      kept.push(entry);
      bump(repo, 'forwarded');
    } else {
      bump(repo, 'dropped');
    }
  }

  return { filtered: { ...payload, [field]: kept }, tally, keptCount: kept.length };
}

module.exports = { filterPayload, matchRepo };
