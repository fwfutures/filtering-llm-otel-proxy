// DynamoDB counters: production persistence. Single table, one item kind keyed
// by a partition key `pk = "counter#<label>"`, holding atomic per-signal tallies
// (`<signal>_received`, `<signal>_forwarded`, `<signal>_dropped`).
//
// Counters use UpdateItem ADD, which is atomic across concurrent Lambda
// invocations — no read-modify-write races. AWS SDK v3 ships in the Lambda
// Node runtime, so this needs no bundled dependency; the require is lazy so
// local dev (MemoryStore) doesn't need it installed.
//
// Tracing is opt-in per repo (a resource attribute), so there is no allowlist
// to persist — this store only holds counters.
class DynamoStore {
  constructor({ table = process.env.TABLE_NAME, region = process.env.AWS_REGION } = {}) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    this.table = table;
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async recordTally(signal, tally) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await Promise.all(
      Object.entries(tally).map(([label, t]) =>
        this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk: `counter#${label}` },
            UpdateExpression: 'ADD #r :recv, #f :fwd, #d :drop SET label = :label',
            ExpressionAttributeNames: {
              '#r': `${signal}_received`,
              '#f': `${signal}_forwarded`,
              '#d': `${signal}_dropped`,
            },
            ExpressionAttributeValues: {
              ':recv': t.received,
              ':fwd': t.forwarded,
              ':drop': t.dropped,
              ':label': label,
            },
          })
        )
      )
    );
  }

  async getStats() {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const res = await this.doc.send(new ScanCommand({ TableName: this.table }));
    const repos = {};
    for (const item of res.Items || []) {
      if (!String(item.pk).startsWith('counter#')) continue;
      const label = item.label || item.pk.slice('counter#'.length);
      const signals = {};
      for (const [k, v] of Object.entries(item)) {
        const m = /^(traces|metrics|logs)_(received|forwarded|dropped)$/.exec(k);
        if (!m) continue;
        (signals[m[1]] ||= { received: 0, forwarded: 0, dropped: 0 })[m[2]] = Number(v);
      }
      repos[label] = signals;
    }
    return { repos };
  }
}

module.exports = { DynamoStore };
