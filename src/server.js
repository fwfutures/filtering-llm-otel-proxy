// Local dev / container adapter: plain Node http server over the core handler.
// Same code path the Lambda uses, so what you test locally is what deploys.
const http = require('node:http');
const { handle } = require('./app');
const { createStore } = require('./store');

function createServer(env = process.env) {
  const store = createStore(env);
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const out = await handle(
          { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') },
          { store, env }
        );
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      }
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4318);
  createServer().listen(port, () => console.log(`otel-filter listening on :${port}  (admin: http://localhost:${port}/admin)`));
}

module.exports = { createServer };
