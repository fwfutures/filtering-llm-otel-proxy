// AWS Lambda adapter for a Function URL (or API Gateway HTTP API, payload v2).
// The store is created once per container and reused across invocations so the
// DynamoDB client and connections stay warm.
const { handle } = require('./app');
const { createStore } = require('./store');

let store;

exports.handler = async (event) => {
  store ||= createStore(process.env);

  // Function URL / APIGW v2 shape.
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';
  const path = event.rawQueryString ? `${rawPath}?${event.rawQueryString}` : rawPath;
  let body = event.body || '';
  if (event.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');

  const out = await handle({ method, path, headers: event.headers || {}, body }, { store, env: process.env });
  return {
    statusCode: out.status,
    headers: out.headers,
    body: out.body,
  };
};
