// DynamoDB counters: production persistence. Single table, one item kind keyed
// by a partition key `pk = "counter#<label>"`, holding atomic per-signal tallies
// (`<signal>_received`, `<signal>_forwarded`, `<signal>_dropped`).
//
// Counters use UpdateItem ADD, which is atomic across concurrent Lambda
// invocations — no read-modify-write races. AWS SDK v3 ships in the Lambda
// Node runtime, so this needs no bundled dependency; the require is lazy so
// local dev (MemoryStore) doesn't need it installed. Holds only the dashboard
// counters.
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
      Object.entries(tally).map(([label, t]) => {
        // Build the atomic ADD expression from whatever counter keys are present
        // (received, forwarded, redacted, dropped) so it stays future-proof.
        const names = {};
        const values = { ':label': label };
        const adds = [];
        Object.keys(t).forEach((k, i) => {
          names[`#${i}`] = `${signal}_${k}`;
          values[`:${i}`] = t[k];
          adds.push(`#${i} :${i}`);
        });
        return this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk: `counter#${label}` },
            UpdateExpression: `ADD ${adds.join(', ')} SET label = :label`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          })
        );
      })
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
        const m = /^(traces|metrics|logs)_(received|forwarded|redacted|dropped)$/.exec(k);
        if (!m) continue;
        (signals[m[1]] ||= {})[m[2]] = Number(v);
      }
      repos[label] = signals;
    }
    return { repos };
  }
}

module.exports = { DynamoStore };
