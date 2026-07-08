const { getAttr } = require('./otlp');

// Redact a NON-opted-in resource entry so it can still be forwarded to the sink
// for structural visibility (spans, tokens, cost, duration, model, tool names)
// without any prompt/response/tool content leaving the machine.
//
// The targets below are exactly the delta between a Claude Code trace with all
// content flags ON and one with them OFF (Claude Code's own default redaction) —
// determined empirically, not guessed. Redacting them reproduces the content-off
// shape regardless of what the client actually sent.
const REDACTED = '<REDACTED>';

// Attribute keys whose *value* is content — replaced with <REDACTED> in place.
// This is the complete set gated behind Claude Code's content flags, derived by
// diffing a full-content trace against a content-off one (see scripts note):
//   prompts/responses:  user_prompt (span), prompt / response (logs)
//   tool I/O:           full_command, bash_command, tool_parameters,
//                       tool_input, tool_output
//   other content-gated config:  hook_matcher, server_name
const DEFAULT_REDACT_ATTRS = [
  'user_prompt', 'prompt', 'response',
  'full_command', 'bash_command', 'tool_parameters', 'tool_input', 'tool_output',
  'hook_matcher', 'server_name',
];
// Whole log records (by event.name) that exist only to carry content — dropped.
const DEFAULT_DROP_LOG_EVENTS = ['api_request_body', 'api_response_body'];
// Span events (by name) that carry tool input/output content — dropped.
const DEFAULT_DROP_SPAN_EVENTS = ['tool.output', 'tool.input'];

function sets(env = {}) {
  const extra = (env.REDACT_ATTRS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    redactAttrs: new Set([...DEFAULT_REDACT_ATTRS, ...extra]),
    dropLogEvents: new Set(DEFAULT_DROP_LOG_EVENTS),
    dropSpanEvents: new Set(DEFAULT_DROP_SPAN_EVENTS),
  };
}

function redactAttrList(attributes, redactAttrs) {
  for (const a of attributes || []) {
    if (redactAttrs.has(a.key)) a.value = { stringValue: REDACTED };
  }
}

// Redact one resource entry in place, per signal. Metrics carry no content.
function redactEntry(entry, signal, env = {}) {
  const { redactAttrs, dropLogEvents, dropSpanEvents } = sets(env);

  if (signal === 'logs') {
    for (const sl of entry.scopeLogs || []) {
      sl.logRecords = (sl.logRecords || []).filter(
        (lr) => !dropLogEvents.has(getAttr(lr.attributes, 'event.name'))
      );
      for (const lr of sl.logRecords) {
        redactAttrList(lr.attributes, redactAttrs);
        // `body` on non-dropped records mirrors event.name (e.g. "claude_code.user_prompt"),
        // never content — leave it. Content bodies live on the dropped *_body records.
      }
    }
  } else if (signal === 'traces') {
    for (const ss of entry.scopeSpans || []) {
      for (const sp of ss.spans || []) {
        redactAttrList(sp.attributes, redactAttrs);
        if (Array.isArray(sp.events)) {
          sp.events = sp.events.filter((e) => !dropSpanEvents.has(e.name));
        }
      }
    }
  }
  return entry;
}

module.exports = { redactEntry, REDACTED, DEFAULT_REDACT_ATTRS };
