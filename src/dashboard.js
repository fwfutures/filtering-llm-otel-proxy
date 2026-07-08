// Self-contained admin dashboard: read-only counters of what the proxy has
// forwarded vs dropped. Tracing is opt-in per repo (a resource attribute), so
// there is nothing to configure here — the dashboard just reports traffic.
function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OTel Filter — Admin</title>
<style>
  :root { color-scheme: light dark; --bg:#0d1117; --card:#161b22; --line:#30363d;
          --fg:#e6edf3; --mut:#8b949e; --ok:#3fb950; --drop:#f85149; --acc:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--fg); }
  header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex;
           align-items:baseline; gap:12px; flex-wrap:wrap; }
  h1 { font-size:18px; margin:0; }
  .mut { color:var(--mut); }
  main { max-width:960px; margin:0 auto; padding:24px; display:grid; gap:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--mut); margin:0 0 14px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th,td { text-align:right; padding:7px 10px; border-bottom:1px solid var(--line); }
  th:first-child,td:first-child { text-align:left; font-family:ui-monospace,monospace; }
  th { color:var(--mut); font-weight:600; font-size:12px; }
  .fwd { color:var(--ok); } .drp { color:var(--drop); } .red { color:var(--acc); }
  .kpis { display:flex; gap:28px; flex-wrap:wrap; }
  .kpi b { display:block; font-size:26px; }
  .kpi span { color:var(--mut); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  code { background:var(--bg); border:1px solid var(--line); border-radius:5px; padding:1px 6px; font-size:12.5px; }
  .hint { color:var(--mut); font-size:13px; margin:0; }
</style>
</head>
<body>
<header>
  <h1>OTel Filter</h1>
  <span class="mut">Claude Code &amp; LLM traces &rarr; Honeycomb &mdash; opt-in per repo</span>
</header>
<main>
  <section class="card">
    <h2>Totals</h2>
    <div class="kpis" id="kpis"></div>
  </section>
  <section class="card">
    <h2>How a repo opts in</h2>
    <p class="hint">Commit <code>.claude/settings.json</code> with
      <code>{ "env": { "OTEL_RESOURCE_ATTRIBUTES": "tracing=yes,repo=org/name" } }</code>.
      Opted-in repos are forwarded in full; every other repo is still forwarded but
      <span class="red">redacted</span> — structure, tokens, cost and timings only,
      no prompts or content. A developer can override per session via their own
      <code>OTEL_RESOURCE_ATTRIBUTES</code>.</p>
  </section>
  <section class="card">
    <h2>Counters by repo</h2>
    <table>
      <thead><tr><th>repo</th><th>received</th><th class="fwd">forwarded</th><th class="red">redacted</th><th class="drp">dropped</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </section>
</main>
<script>
  const TOKEN = new URLSearchParams(location.search).get('token') || '';
  const H = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  async function refresh() {
    const st = await fetch('admin/api/stats', { headers: H }).then((r) => r.json());
    let tr=0, tf=0, tx=0, td=0; const rows=[];
    for (const [repo, sigs] of Object.entries(st.repos).sort()) {
      let r=0,f=0,x=0,d=0;
      for (const s of Object.values(sigs)) { r+=s.received||0; f+=s.forwarded||0; x+=s.redacted||0; d+=s.dropped||0; }
      tr+=r; tf+=f; tx+=x; td+=d;
      rows.push('<tr><td>'+repo+'</td><td>'+r+'</td><td class="fwd">'+f+'</td><td class="red">'+x+'</td><td class="drp">'+d+'</td></tr>');
    }
    document.getElementById('rows').innerHTML = rows.join('') ||
      '<tr><td class="mut" colspan="5">No traffic yet.</td></tr>';
    document.getElementById('kpis').innerHTML =
      '<div class="kpi"><b>'+tr+'</b><span>received</span></div>' +
      '<div class="kpi"><b class="fwd">'+tf+'</b><span>forwarded</span></div>' +
      '<div class="kpi"><b class="red">'+tx+'</b><span>redacted</span></div>' +
      '<div class="kpi"><b class="drp">'+td+'</b><span>dropped</span></div>';
  }
  refresh(); setInterval(refresh, 4000);
</script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
