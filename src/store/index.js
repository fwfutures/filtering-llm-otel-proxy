// Store factory. STORE=dynamo selects DynamoDB (production); anything else
// (default) uses the in-memory store. Seed the memory store from WHITELIST
// (comma-separated) so local runs start with a useful allowlist.
const { MemoryStore } = require('./memory');

function createStore(env = process.env) {
  if ((env.STORE || '').toLowerCase() === 'dynamo') {
    const { DynamoStore } = require('./dynamo');
    return new DynamoStore({ table: env.TABLE_NAME, region: env.AWS_REGION });
  }
  const seed = (env.WHITELIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new MemoryStore(seed);
}

module.exports = { createStore };
