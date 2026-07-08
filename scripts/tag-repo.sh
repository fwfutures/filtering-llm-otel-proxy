#!/usr/bin/env bash
# tag-repo — run ONCE inside a repository to opt it into Claude Code tracing.
#
# The otel-filter proxy forwards a session only if its telemetry carries the
# opt-in resource attribute `tracing=yes`. This script writes that flag (plus a
# `repo=<org>/<repo>` label derived from the git origin remote, for the counters
# dashboard) into the repo's .claude/settings.json `env` block, which Claude
# Code exports before the OTel SDK starts. No launch wrapper, no per-developer
# setup — commit the file and every clone is opted in.
#
#   cd ~/dev/acme/web-app && /path/to/tag-repo.sh && git add .claude/settings.json
set -euo pipefail

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
let s = {};
try { s = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
s.env = s.env || {};
// Preserve any other resource attributes already configured; set tracing + repo.
const parts = (s.env.OTEL_RESOURCE_ATTRIBUTES || "")
  .split(",").map((x) => x.trim()).filter(Boolean)
  .filter((p) => !/^(tracing|repo)=/.test(p));
parts.push("tracing=yes", "repo=" + repo);
s.env.OTEL_RESOURCE_ATTRIBUTES = parts.join(",");
fs.writeFileSync(path, JSON.stringify(s, null, 2) + "\n");
console.log(JSON.stringify(s, null, 2));
' "$repo"

echo
echo "opted in: tracing=yes, repo=$repo  ->  .claude/settings.json"
echo "next: git add .claude/settings.json && commit"
