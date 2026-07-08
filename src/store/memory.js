// In-memory store: the reference implementation of the storage contract.
// Used for local dev and tests. State is per-process, so it resets on cold
// start — fine for development, not for production (use DynamoStore there).
class MemoryStore {
  constructor(seed = []) {
    this.whitelist = new Set(seed);
    // counters[repo][signal] = { received, forwarded, dropped }
    this.counters = {};
  }

  async getWhitelist() {
    return [...this.whitelist].sort();
  }

  async addRepo(repo) {
    this.whitelist.add(repo);
  }

  async removeRepo(repo) {
    this.whitelist.delete(repo);
  }

  // Apply a { repo: {received,forwarded,dropped} } tally for one signal.
  async recordTally(signal, tally) {
    for (const [repo, t] of Object.entries(tally)) {
      const r = (this.counters[repo] ||= {});
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
