// DynamoDB store: production persistence. Single table, two item kinds keyed
// by a partition key `pk`:
//   pk = "whitelist"          -> { repos: StringSet }  (the allowlist)
//   pk = "counter#<repo>"     -> { <signal>_received: N, ... }  (atomic ADD)
//
// Counters use UpdateItem ADD, which is atomic across concurrent Lambda
// invocations — no read-modify-write races. AWS SDK v3 ships in the Lambda
// Node runtime, so this needs no bundled dependency; the require is lazy so
// local dev (MemoryStore) doesn't need it installed.
class DynamoStore {
  constructor({ table = process.env.TABLE_NAME, region = process.env.AWS_REGION } = {}) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    this.table = table;
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async getWhitelist() {
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { pk: 'whitelist' } })
    );
    const repos = res.Item && res.Item.repos;
    return repos ? [...repos].sort() : [];
  }

  async addRepo(repo) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: 'whitelist' },
        UpdateExpression: 'ADD repos :r',
        ExpressionAttributeValues: { ':r': new Set([repo]) },
      })
    );
  }

  async removeRepo(repo) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: 'whitelist' },
        UpdateExpression: 'DELETE repos :r',
        ExpressionAttributeValues: { ':r': new Set([repo]) },
      })
    );
  }

  async recordTally(signal, tally) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    await Promise.all(
      Object.entries(tally).map(([repo, t]) =>
        this.doc.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk: `counter#${repo}` },
            UpdateExpression:
              'ADD #r :recv, #f :fwd, #d :drop SET repo = :repo',
            ExpressionAttributeNames: {
              '#r': `${signal}_received`,
              '#f': `${signal}_forwarded`,
              '#d': `${signal}_dropped`,
            },
            ExpressionAttributeValues: {
              ':recv': t.received,
              ':fwd': t.forwarded,
              ':drop': t.dropped,
              ':repo': repo,
            },
          })
        )
      )
    );
  }

  async getStats() {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const res = await this.doc.send(
      new ScanCommand({ TableName: this.table })
    );
    const repos = {};
    for (const item of res.Items || []) {
      if (!String(item.pk).startsWith('counter#')) continue;
      const repo = item.repo || item.pk.slice('counter#'.length);
      const signals = {};
      for (const [k, v] of Object.entries(item)) {
        const m = /^(traces|metrics|logs)_(received|forwarded|dropped)$/.exec(k);
        if (!m) continue;
        (signals[m[1]] ||= { received: 0, forwarded: 0, dropped: 0 })[m[2]] = Number(v);
      }
      repos[repo] = signals;
    }
    return { repos };
  }
}

module.exports = { DynamoStore };
