// In-memory counters: the reference implementation of the storage contract.
// Used for local dev and tests. State is per-process, so it resets on cold
// start — fine for development, not for production (use DynamoStore there).
//
// Since tracing is opt-in per repo (a resource attribute), there is no
// allowlist to persist — the store only holds counters.
class MemoryStore {
  constructor() {
    // counters[label][signal] = { received, forwarded, dropped }
    this.counters = {};
  }

  // Apply a { label: {received,forwarded,dropped} } tally for one signal.
  async recordTally(signal, tally) {
    for (const [label, t] of Object.entries(tally)) {
      const r = (this.counters[label] ||= {});
      const s = (r[signal] ||= { received: 0, forwarded: 0, dropped: 0 });
      s.received += t.received;
      s.forwarded += t.forwarded;
      s.dropped += t.dropped;
    }
  }

  async getStats() {
    return { repos: this.counters };
  }
}

module.exports = { MemoryStore };
