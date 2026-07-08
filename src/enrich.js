const { getAttr } = require('./otlp');

// Give span-correlated log records a display name in Honeycomb.
//
// Claude Code emits its content records (api_request_body, api_response_body,
// user_prompt, assistant_response, tool events, …) on the LOGS signal. When a
// record carries trace_id + span_id, Honeycomb renders it as a SPAN EVENT on
// the trace waterfall — but a span event's label comes from a `name` field,
// which these records don't set (the identifier lives in `body` and in an
// `event.name` attribute instead). The result is a wall of "unspecified" span
// events. We copy `event.name` (falling back to `body`) into a `name`
// attribute so they show up as "api_response_body", "user_prompt", etc.
//
// Additive only: never overwrites an existing `name`, never removes anything.
function enrichLogs(payload) {
  const groups = Array.isArray(payload && payload.resourceLogs) ? payload.resourceLogs : [];
  for (const rl of groups) {
    for (const sl of rl.scopeLogs || []) {
      for (const lr of sl.logRecords || []) {
        const attrs = (lr.attributes ||= []);
        if (attrs.some((a) => a.key === 'name')) continue;
        let name = getAttr(attrs, 'event.name');
        if (!name && lr.body && typeof lr.body.stringValue === 'string') {
          // body is "claude_code.<event>"; strip the prefix for a cleaner label.
          name = lr.body.stringValue.replace(/^claude_code\./, '');
        }
        if (name) attrs.push({ key: 'name', value: { stringValue: String(name) } });
      }
    }
  }
  return payload;
}

module.exports = { enrichLogs };
