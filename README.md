# filtering-llm-otel-proxy

A tiny, dependency-free **OpenTelemetry (OTLP) filtering proxy** you run as an
AWS Lambda. It sits between your LLM tooling — [Claude
Code](https://docs.anthropic.com/en/docs/claude-code), the OpenTelemetry
OpenAI/Anthropic instrumentations, anything that speaks OTLP — and your
observability backend (this repo targets **Honeycomb**, but any OTLP sink
works).

Its one job: **only forward telemetry from repos that opted into tracing, and
drop the rest** — then show you a live count of what got forwarded vs dropped,
per repo.

> Why? When you turn on Claude Code telemetry across an org, every laptop starts
> shipping metrics and events. This proxy makes sure only repos that *chose* to
> be traced reach your paid backend — no rogue side-projects, no personal repos,
> no surprise ingest bill. Opting in is a one-line file committed to the repo;
> there's no central list to maintain.

```
  claude / other LLM tools ──OTLP/HTTP──▶  API Gateway ──▶  Lambda
                                                              │  resource.attributes.tracing == yes ?
                                                              ▼
                                                  ┌─ opted in ─▶  Honeycomb (OTLP)
                                                  └─ everything else ─▶  dropped
                                                       counters persisted (DynamoDB)
```

![Admin dashboard: per-repo received / forwarded / dropped counters](docs/dashboard.png)

<p align="center"><em>The admin dashboard: a read-only view of received / forwarded / dropped counters per repo.</em></p>

## How filtering works

A repo **opts into tracing** by stamping a resource attribute — `tracing=yes` —
onto its Claude Code telemetry. The clean, no-wrapper way is a committed
`.claude/settings.json` (see [Opting a repo in](#opting-a-repo-in)); Claude Code
exports it as `OTEL_RESOURCE_ATTRIBUTES` before the OTel SDK starts.

The proxy reads `resource.attributes.tracing` from every `resourceSpans` /
`resourceMetrics` / `resourceLogs` entry: if it's truthy (`yes`/`true`/`1`/`on`)
the resource is forwarded, otherwise it's dropped and counted. That's the whole
filter. A developer can override for a session with their own
`OTEL_RESOURCE_ATTRIBUTES`. Change the attribute name with `OPT_IN_ATTR`; a
separate `repo` attribute (if present) is used only to label the counters.

The proxy handles all three OTLP signals — `/v1/traces`, `/v1/metrics`,
`/v1/logs` — and passes each opted-in resource through untouched (it drops whole
non-opted-in resources, never individual fields).

## Opting a repo in

Claude Code does **not** derive a repo identifier on its own — with telemetry
enabled it emits `service.name=claude-code` and host/os attributes, nothing that
says which repo you're in (verified against `claude` 2.1.195). So a repo opts in
explicitly, via a committed **`.claude/settings.json`**. Claude Code reads it and
exports the `env` block *before* the OTel SDK starts, so the whole telemetry
setup can live in that one file: a developer clones the repo and runs plain
`claude` — no shell config, no launch wrapper — and telemetry streams to the
proxy.

```jsonc
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",     // spans / trace waterfalls
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://your-proxy.example.com",
    "OTEL_RESOURCE_ATTRIBUTES": "tracing=yes,repo=acme/web-app"
  }
}
```

`tracing=yes` is what the proxy forwards on; `repo=<org>/<repo>` just labels the
counters. Generate and commit this file in one step with the helper:

```bash
cd path/to/your/repo
/path/to/otel-filter/scripts/tag-repo.sh --endpoint https://your-proxy.example.com
git add .claude/settings.json && git commit -m "stream Claude Code telemetry"
```

Add `--content` to also capture prompts, responses, and tool I/O (see
[content capture](#content-capture-prompts-responses-tool-io) — it sends source
and PII to your endpoint). The helper derives `repo` from the git origin remote.

Only repos that carry `tracing=yes` are forwarded; everything else is dropped and
counted. A developer can override for one session with their own
`OTEL_RESOURCE_ATTRIBUTES` (e.g. `tracing=no` to opt out).

> Prefer central control? Put everything except `OTEL_RESOURCE_ATTRIBUTES` in
> org-wide **managed settings** (deployed by IT), and let each repo's
> `.claude/settings.json` carry just `"OTEL_RESOURCE_ATTRIBUTES": "tracing=yes,repo=…"`.
> Same result; the endpoint and content policy stay centrally owned.

## What each variable does

The reference for the values used above.

**Telemetry + signals:**

| Variable | Value | Effect |
|----------|-------|--------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | master switch |
| `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` | `otlp` | export metrics (`claude_code.token.usage`, `.cost.usage`, …) and log events (`user_prompt`, `api_request`, `assistant_response`, …) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | also `http/protobuf`, `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | your proxy URL | base for `/v1/{metrics,logs,traces}` |

**Full distributed traces** — the Honeycomb waterfalls (root
`claude_code.interaction` → `claude_code.llm_request` / `claude_code.tool` spans
with `gen_ai.*` semantic conventions):

| Variable | Value | Effect |
|----------|-------|--------|
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` | `1` | beta flag that enables span tracing |
| `OTEL_TRACES_EXPORTER` | `otlp` | export spans |

Tracing is **not plan-gated** — it works on any plan, gated only by this beta
opt-in. (Claude Cowork / office-agents telemetry is a separate, Team/Enterprise,
admin-portal-configured surface.)

### Content capture (prompts, responses, tool I/O)

Redacted by default; opt in per signal (the helper's `--content` flag sets the
first four):

| Variable | Default | Adds |
|----------|---------|------|
| `OTEL_LOG_USER_PROMPTS` | off | user prompt text (`user_prompt` attr on the interaction span) |
| `OTEL_LOG_ASSISTANT_RESPONSES` | off | model response text (`assistant_response` log record) |
| `OTEL_LOG_TOOL_DETAILS` | off | tool names, arguments, commands (`full_command` attr) |
| `OTEL_LOG_TOOL_CONTENT` | off | tool input/output (`tool.output` span event; needs tracing on) |
| `OTEL_LOG_RAW_API_BODIES` | off | full Messages API request/response JSON (`api_request_body` / `api_response_body` log records) |

Gotchas learned the hard way:

- **The content flags do not cascade.** `OTEL_LOG_RAW_API_BODIES=1` alone still
  leaves `user_prompt` and `assistant_response` `<REDACTED>` — set
  `OTEL_LOG_USER_PROMPTS=1` and `OTEL_LOG_ASSISTANT_RESPONSES=1` explicitly for
  the readable text.
- **Content leaves your machine only to your OTLP endpoint — never to Anthropic.**
  It can contain source, secrets, and PII; enable deliberately, and rely on the
  opt-in to scope which repos send it.
- **Bodies can truncate** (`body_truncated=true`) for large contexts.

The response text and raw bodies arrive on the **logs** signal but carry the same
`trace_id`/`span_id` as their `llm_request` span, so Honeycomb ties them to the
trace — use the trace's **View events** to read them inline.

## Quick start (local, zero dependencies)

```bash
npm test        # unit + e2e tests against captured Claude Code payloads
npm start       # serves OTLP + the admin dashboard on :4318
open http://localhost:4318/admin
```

`npm start` uses the in-memory store — no AWS, no database. Point any OTLP
exporter (with `tracing=yes` in its resource attributes) at
`http://localhost:4318` and watch the counters move.

## Deploy to AWS

Two paths — both create the same thing (Lambda + DynamoDB + a **public API
Gateway** OTLP endpoint).

**AWS SAM:**
```bash
sam deploy --guided --template infra/template.yaml \
  --parameter-overrides HoneycombApiKey=$HONEYCOMB_API_KEY AdminToken=$(openssl rand -hex 16)
```

**Plain AWS CLI** (no SAM required — this is the script this repo was tested
with):
```bash
HONEYCOMB_API_KEY=... bash infra/deploy-cli.sh
```

### A note on the public endpoint

The simplest front door is a **Lambda Function URL**, but many enterprise AWS
orgs block public Function URLs with an SCP on `lambda:FunctionUrlAuthType`. So
this repo fronts the Lambda with an **API Gateway HTTP API** instead — public,
unauthenticated, and not caught by that guardrail. The OTLP ingest paths are
open (exporters can't send credentials); the `/admin` dashboard and API are
gated by a bearer token (`ADMIN_TOKEN`).

## Configuration

| Env | Purpose | Default |
|-----|---------|---------|
| `STORE` | `dynamo` for production (counters), else in-memory | in-memory |
| `TABLE_NAME` | DynamoDB table (when `STORE=dynamo`) | — |
| `OPT_IN_ATTR` | resource attribute a repo sets to opt into tracing | `tracing` |
| `REPO_ATTR` | resource attribute used only to label the counters | `repo` |
| `HONEYCOMB_API_KEY` | ingest key; **absent = dry-run** (filter & count, don't send) | — |
| `HONEYCOMB_DATASET` | dataset for metrics/logs | `claude-code` |
| `HONEYCOMB_ENDPOINT` | OTLP sink base URL (use `api.eu1.honeycomb.io` for EU) | `https://api.honeycomb.io` |
| `ADMIN_TOKEN` | bearer token gating `/admin*` (blank = open) | open |
| `ENRICH_SPAN_EVENT_NAMES` | name span-correlated log records so Honeycomb doesn't show "unspecified" (see below); set `0` to disable | on |

Forwarding to any other OTLP backend is a one-file change in
[`src/forward.js`](src/forward.js).

### Span-event naming

Claude Code sends its content records (`user_prompt`, `api_request_body`,
`api_response_body`, `assistant_response`, tool events) on the **logs** signal
with a `trace_id`/`span_id`, so Honeycomb renders them as **span events** on the
trace waterfall. But their identifier lives in `body`/`event.name`, not in the
`name` field Honeycomb uses for the span-event label — so out of the box they
all show as **"unspecified"**. You can't fix this in Honeycomb (the label is
data-driven). The proxy does it instead: [`src/enrich.js`](src/enrich.js) copies
`event.name` → `name` on each log record before forwarding, so the waterfall
reads `user_prompt`, `api_response_body`, `tool_result`, … Additive only — it
never overwrites an existing `name`. Disable with `ENRICH_SPAN_EVENT_NAMES=0`.

## Persistence options

Opt-in lives in each repo's `.claude/settings.json` (in Git), so the proxy is
almost stateless — it persists only the dashboard **counters**, behind a tiny
interface (`recordTally / getStats`) under [`src/store/`](src/store/). Two are
implemented; the rest are drop-in.

| Option | Counters | VPC? | Notes |
|--------|----------|------|-------|
| **DynamoDB** ✅ *(default, implemented)* | atomic `ADD` increments, no races | No | Best fit for Lambda: serverless, pay-per-request, SDK already in the runtime. |
| **In-memory** ✅ *(implemented)* | object | No | Dev/tests only — resets on cold start. |
| **CloudWatch EMF** | ✅ (as metrics) | No | Emit dropped/forwarded as metrics for alarms/dashboards; no table at all. |
| **Upstash Redis / Momento** | `INCR` atomic | No | HTTP/serverless Redis, no VPC. |
| **RDS / Aurora Serverless v2** | `UPDATE … +1` | Yes | Only if you already run Postgres/MySQL; adds VPC + cold-start cost. |

Counters are approximate operational stats, not billing-grade — losing them on a
cold start (in-memory) is harmless.

**Recommendation:** DynamoDB. Or, if you don't need a live per-repo dashboard,
drop the table entirely and emit **CloudWatch EMF** counts for alarms instead.

## Project layout

```
src/
  otlp.js        OTLP/JSON attribute + signal helpers
  filter.js      pure opt-in filter — tracing=yes ? forward : drop (unit-tested)
  enrich.js      name span-correlated log records (Honeycomb span events)
  forward.js     POST filtered payload to the OTLP sink (Honeycomb)
  app.js         framework-agnostic router (ingest + admin)
  dashboard.js   inline admin HTML (read-only counters, no build step)
  server.js      local http adapter
  lambda.js      API Gateway / Function URL adapter
  store/         memory (default) · dynamo · factory  (counters only)
scripts/
  tag-repo.sh    write .claude/settings.json to opt a repo into tracing
test/            node --test, runs against real captured Claude Code payloads
infra/           SAM template + plain-CLI deploy script
```

## License

MIT.

---

**For AI engineering and operations support, contact [Freshwater
Futures](https://freshwaterfutures.com).**
