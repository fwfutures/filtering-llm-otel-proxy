// In-memory counters: the reference implementation of the storage contract.
// Used for local dev and tests. State is per-process, so it resets on cold
// start — fine for development, not for production (use DynamoStore there).
// The store holds only the dashboard counters.
class MemoryStore {
  constructor() {
    // counters[label][signal] = { received, forwarded, dropped }
    this.counters = {};
  }

  // Apply a { label: {received,forwarded,redacted,dropped} } tally for one signal.
  async recordTally(signal, tally) {
    for (const [label, t] of Object.entries(tally)) {
      const s = ((this.counters[label] ||= {})[signal] ||= {});
      for (const [k, v] of Object.entries(t)) s[k] = (s[k] || 0) + v;
    }
  }

  async getStats() {
    return { repos: this.counters };
  }
}

module.exports = { MemoryStore };
