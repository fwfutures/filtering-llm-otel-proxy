// Self-contained admin dashboard: whitelist editor + live counters.
// No build step, no external assets — one inline HTML string. It talks to the
// /admin/api/* JSON endpoints and passes the admin token as a bearer header.
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
  .fwd { color:var(--ok); } .drp { color:var(--drop); }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  input,button { font:inherit; border-radius:7px; border:1px solid var(--line); padding:8px 12px; }
  input { background:var(--bg); color:var(--fg); flex:1; min-width:200px; }
  button { background:var(--acc); color:#04101f; border-color:transparent; cursor:pointer; font-weight:600; }
  button.ghost { background:transparent; color:var(--mut); }
  .chip { display:inline-flex; align-items:center; gap:8px; background:var(--bg);
          border:1px solid var(--line); border-radius:20px; padding:5px 8px 5px 12px; font-family:ui-monospace,monospace; font-size:13px; }
  .chip button { padding:0 6px; background:transparent; color:var(--mut); border:none; font-size:16px; line-height:1; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .kpis { display:flex; gap:28px; flex-wrap:wrap; }
  .kpi b { display:block; font-size:26px; }
  .kpi span { color:var(--mut); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
</style>
</head>
<body>
<header>
  <h1>OTel Filter</h1>
  <span class="mut">Claude Code &amp; LLM traces &rarr; Honeycomb, gated by repo allowlist</span>
</header>
<main>
  <section class="card">
    <h2>Totals</h2>
    <div class="kpis" id="kpis"></div>
  </section>
  <section class="card">
    <h2>Repo allowlist</h2>
    <div class="chips" id="chips"></div>
    <div class="row">
      <input id="repo" placeholder="acme/my-service  (or acme/* prefix)" />
      <button id="add">Add repo</button>
    </div>
  </section>
  <section class="card">
    <h2>Counters by repo</h2>
    <table>
      <thead><tr><th>repo</th><th>received</th><th class="fwd">forwarded</th><th class="drp">dropped</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </section>
</main>
<script>
  // Token from ?token=... in the URL, forwarded as a bearer header.
  const TOKEN = new URLSearchParams(location.search).get('token') || '';
  const H = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  const api = (p, opts={}) => fetch(p, { ...opts, headers: { ...H, ...(opts.headers||{}) } });

  function sumRow(sig) { return (sig.received||0); }
  async function refresh() {
    const [wl, st] = await Promise.all([
      api('admin/api/whitelist').then(r=>r.json()),
      api('admin/api/stats').then(r=>r.json()),
    ]);
    // chips
    document.getElementById('chips').innerHTML = wl.whitelist.length
      ? wl.whitelist.map(r => '<span class="chip">'+r+'<button data-r="'+r+'">&times;</button></span>').join('')
      : '<span class="mut">No repos yet — traces from every repo are dropped.</span>';
    document.querySelectorAll('.chip button').forEach(b =>
      b.onclick = () => api('admin/api/whitelist', { method:'DELETE',
        headers:{'content-type':'application/json'}, body:JSON.stringify({repo:b.dataset.r}) }).then(refresh));
    // counters + totals
    let tr=0, tf=0, td=0; const rows=[];
    for (const [repo, sigs] of Object.entries(st.repos).sort()) {
      let r=0,f=0,d=0;
      for (const s of Object.values(sigs)) { r+=s.received||0; f+=s.forwarded||0; d+=s.dropped||0; }
      tr+=r; tf+=f; td+=d;
      rows.push('<tr><td>'+repo+'</td><td>'+r+'</td><td class="fwd">'+f+'</td><td class="drp">'+d+'</td></tr>');
    }
    document.getElementById('rows').innerHTML = rows.join('') ||
      '<tr><td class="mut" colspan="4">No traffic yet.</td></tr>';
    document.getElementById('kpis').innerHTML =
      '<div class="kpi"><b>'+tr+'</b><span>received</span></div>' +
      '<div class="kpi"><b class="fwd">'+tf+'</b><span>forwarded</span></div>' +
      '<div class="kpi"><b class="drp">'+td+'</b><span>dropped</span></div>';
  }
  document.getElementById('add').onclick = () => {
    const el = document.getElementById('repo'); const repo = el.value.trim(); if (!repo) return;
    api('admin/api/whitelist', { method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({repo}) }).then(()=>{ el.value=''; refresh(); });
  };
  refresh(); setInterval(refresh, 4000);
</script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
