#!/usr/bin/env bash
# tag-repo — write a repo's .claude/settings.json so that plain `claude` streams
# OpenTelemetry to your otel-filter proxy, fully configured and opted in.
#
# Claude Code reads .claude/settings.json and exports its `env` block before the
# OTel SDK starts, so one committed file is all a developer needs: clone the
# repo, run `claude`, and telemetry flows — no shell setup, no launch wrapper.
# The file carries the whole configuration:
#   - enables telemetry and span tracing (metrics, logs, traces)
#   - points at your proxy (OTEL_EXPORTER_OTLP_ENDPOINT)
#   - opts the repo in (tracing=yes) and labels it (repo=<org>/<repo>, from the
#     git origin remote)
#
# Usage — run once per repo, then commit the file:
#   tag-repo.sh --endpoint https://your-proxy.example.com [--content]
#   OTEL_ENDPOINT=https://your-proxy.example.com tag-repo.sh
#
#   --content   also capture prompt, response, and tool input/output text. This
#               sends source, secrets, and PII to your endpoint — enable only
#               with a privacy review.
set -euo pipefail

endpoint="${OTEL_ENDPOINT:-}"
content=0
while [ $# -gt 0 ]; do
  case "$1" in
    --endpoint) endpoint="${2:-}"; shift 2 ;;
    --content) content=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

url=$(git config --get remote.origin.url 2>/dev/null) || {
  echo "error: not a git repo, or no 'origin' remote" >&2; exit 1; }

# Normalise https and ssh remotes to "<org>/<repo>", dropping any .git suffix.
repo=$(printf '%s\n' "$url" \
  | sed -E 's#^git@[^:]+:#/#; s#^[a-z]+://[^/]+/##; s#\.git$##' \
  | awk -F/ 'NF>=2 { print $(NF-1)"/"$NF; next } { print $NF }')
[ -n "$repo" ] || { echo "error: could not derive repo from remote: $url" >&2; exit 1; }

mkdir -p .claude
node -e '
const fs = require("fs");
const path = ".claude/settings.json";
const repo = process.argv[1];
const endpoint = process.argv[2];
const content = process.argv[3] === "1";
let s = {};
try { s = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
s.env = s.env || {};
Object.assign(s.env, {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
});
if (endpoint) s.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
else if (!s.env.OTEL_EXPORTER_OTLP_ENDPOINT) s.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://<your-proxy-endpoint>";
if (content) Object.assign(s.env, {
  OTEL_LOG_USER_PROMPTS: "1",
  OTEL_LOG_ASSISTANT_RESPONSES: "1",
  OTEL_LOG_TOOL_DETAILS: "1",
  OTEL_LOG_TOOL_CONTENT: "1",
});
// Resource attributes: keep any others already set, (re)set tracing + repo.
const parts = (s.env.OTEL_RESOURCE_ATTRIBUTES || "")
  .split(",").map((x) => x.trim()).filter(Boolean).filter((p) => !/^(tracing|repo)=/.test(p));
parts.push("tracing=yes", "repo=" + repo);
s.env.OTEL_RESOURCE_ATTRIBUTES = parts.join(",");
fs.writeFileSync(path, JSON.stringify(s, null, 2) + "\n");
console.log(JSON.stringify(s, null, 2));
' "$repo" "$endpoint" "$content"

echo
echo "wrote .claude/settings.json  (repo=$repo, content=$([ "$content" = 1 ] && echo on || echo off))"
[ -n "$endpoint" ] || echo "note: replace the OTEL_EXPORTER_OTLP_ENDPOINT placeholder with your proxy URL"
echo "next: git add .claude/settings.json && commit — then plain 'claude' streams telemetry to the proxy"
