// Store factory. STORE=dynamo selects DynamoDB (production); anything else
// (default) uses the in-memory store. The store only holds counters now —
// tracing is opt-in per repo via a resource attribute, so there is no
// allowlist to persist.
const { MemoryStore } = require('./memory');

function createStore(env = process.env) {
  if ((env.STORE || '').toLowerCase() === 'dynamo') {
    const { DynamoStore } = require('./dynamo');
    return new DynamoStore({ table: env.TABLE_NAME, region: env.AWS_REGION });
  }
  return new MemoryStore();
}

module.exports = { createStore };
