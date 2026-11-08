'use strict';
const { esc, formatPrice, safeUrl } = require('./email');

const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;
const hex = (v, d) => (/^[0-9a-f]{6}$/i.test(String(v || '')) ? `#${v}` : d);

// ---------------------------------------------------------------- embed
function embedPage({ sku, product, accent, state = {}, brand }) {
  const a = hex(accent, '#14532d');
  const name = product?.name || '';
  const price = product ? formatPrice(product.price, product.currency) : '';
  const done = state.ok || state.duplicate;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notify me when it's back</title>
<style>
:root{--a:${a};--text:#18181b;--muted:#5f5f69;--line:#d9d9de;--bg:#fff;--soft:#f6f6f4;--bad:#b42318}
*{box-sizing:border-box}html,body{margin:0;background:transparent}
body{font:15px/1.45 ${FONT};color:var(--text);-webkit-font-smoothing:antialiased}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:18px;max-width:440px}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
h1{font-size:18px;line-height:1.3;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 14px;font-size:14px}
.product{display:flex;gap:12px;align-items:center;background:var(--soft);border-radius:10px;padding:8px;margin:0 0 14px}
.product img{width:48px;height:48px;border-radius:8px;object-fit:cover;flex:none;background:#e7e7e4}
.product b{display:block;font-size:14px;line-height:1.3}.product span{font-size:13px;color:var(--muted)}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.row{display:flex;gap:8px;flex-wrap:wrap}
input[type=email],input[type=text]{flex:1 1 200px;min-width:0;font:inherit;font-size:16px;color:var(--text);background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 22%,transparent)}
input[aria-invalid=true]{border-color:var(--bad)}
button{flex:1 0 auto;font:inherit;font-size:15px;font-weight:650;color:#fff;background:var(--a);border:0;border-radius:10px;padding:11px 18px;cursor:pointer;transition:filter .15s,transform .05s}
button:hover{filter:brightness(1.12)}button:active{transform:translateY(1px)}button[disabled]{opacity:.65;cursor:progress}
.sku{margin-bottom:12px}
.fine{font-size:12px;color:var(--muted);margin:10px 0 0}
.err{color:var(--bad);font-size:13px;margin:8px 0 0;min-height:0}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.done{display:flex;gap:12px;align-items:flex-start}
.tick{flex:none;width:34px;height:34px;border-radius:50%;background:color-mix(in srgb,var(--a) 14%,#fff);display:grid;place-items:center;color:var(--a)}
.done h1{margin-top:4px}
.hidden{display:none}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:s .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>
<div class="card" id="card">
  <div id="form-view" class="${done ? 'hidden' : ''}">
    <p class="eyebrow">Sold out</p>
    <h1>Get an email when it's back</h1>
    <p class="sub">We'll send you one email the moment it's restocked. That's it.</p>
    ${name ? `<div class="product">${safeUrl(product.image) ? `<img src="${esc(product.image)}" alt="" loading="lazy">` : ''}<div><b>${esc(name)}</b><span>${price ? `${esc(price)} · ` : ''}SKU ${esc(sku)}</span></div></div>` : ''}
    <form id="f" method="post" action="/embed${sku ? `?sku=${encodeURIComponent(sku)}` : ''}${accent ? `${sku ? '&' : '?'}accent=${encodeURIComponent(accent)}` : ''}" novalidate>
      ${sku ? `<input type="hidden" name="sku" value="${esc(sku)}">` : `<div class="sku"><label for="skuin">Product SKU</label><div class="row"><input id="skuin" name="sku" type="text" placeholder="e.g. TEE-ORG-BLK-L" required maxlength="64" value="${esc(state.sku || '')}"></div></div>`}
      <label for="email">Email address</label>
      <div class="row">
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required maxlength="254" value="${esc(state.email || '')}">
        <button id="b" type="submit">Notify me</button>
      </div>
      <input type="hidden" name="source_url" id="src" value="${esc(state.source_url || '')}">
      <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="err" id="err" role="alert">${esc(state.error || '')}</p>
      <p class="fine">No marketing, no newsletter. Your email is only used for this alert.</p>
    </form>
  </div>
  <div id="done-view" class="${done ? '' : 'hidden'}" role="status" aria-live="polite">
    <div class="done">
      <div class="tick" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
      <div>
        <h1 id="done-title">${state.duplicate ? "You're already on the list" : "You're on the list"}</h1>
        <p class="sub" id="done-text">We'll email <b id="done-email">${esc(state.email || '')}</b> once, as soon as ${name ? esc(name) : 'it'} is back in stock.</p>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  var f=document.getElementById('f'),b=document.getElementById('b'),err=document.getElementById('err'),email=document.getElementById('email');
  var src=document.getElementById('src'); if(!src.value){ try{ src.value=document.referrer||''; }catch(e){} }
  function resize(){ try{ parent.postMessage({type:'restocked:resize',height:document.getElementById('card').offsetHeight+2},'*'); }catch(e){} }
  window.addEventListener('load',resize); new ResizeObserver(resize).observe(document.body);
  function show(dup,addr){
    document.getElementById('done-title').textContent=dup?"You're already on the list":"You're on the list";
    document.getElementById('done-email').textContent=addr;
    document.getElementById('form-view').classList.add('hidden');
    document.getElementById('done-view').classList.remove('hidden');
  }
  f.addEventListener('submit',function(ev){
    ev.preventDefault(); err.textContent=''; email.removeAttribute('aria-invalid');
    var data={email:email.value.trim(),sku:f.elements.sku.value.trim(),source_url:src.value,website:f.elements.website.value};
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(data.email)){ err.textContent='Please enter a valid email address.'; email.setAttribute('aria-invalid','true'); email.focus(); return; }
    if(!data.sku){ err.textContent='Please enter the product SKU.'; return; }
    b.disabled=true; b.innerHTML='<span class="spin"></span>Saving';
    fetch('/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {s:r.status,j:j}; }); })
      .then(function(r){
        if(r.s===201) return show(false,data.email);
        if(r.s===409) return show(true,data.email);
        err.textContent=(r.j&&r.j.message)||'Something went wrong. Please try again.';
      })
      .catch(function(){ err.textContent='Could not reach the server. Check your connection and try again.'; })
      .finally(function(){ b.disabled=false; b.textContent='Notify me'; });
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- shared shell (admin + landing)
function shell(title, body, { brand }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(brand)}</title>
<style>
:root{--bg:#f6f6f3;--card:#fff;--text:#18181b;--muted:#63636e;--line:#e4e4e0;--a:#14532d;--a-soft:#dcfce7;--warn:#92400e;--warn-soft:#fef3c7;--bad:#b42318;--bad-soft:#fee4e2;--info:#1d4ed8;--info-soft:#dbeafe}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ${FONT};-webkit-font-smoothing:antialiased}
a{color:var(--a)}
header.top{background:var(--card);border-bottom:1px solid var(--line)}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:56px}
.logo{display:flex;align-items:center;gap:8px;font-weight:750;font-size:16px;color:var(--text);text-decoration:none}
.logo i{width:22px;height:22px;border-radius:6px;background:var(--a);display:grid;place-items:center;color:#fff;font-style:normal;font-size:13px}
main{padding:28px 0 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px}
.muted{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.stat span{color:var(--muted);font-size:13px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:20px;overflow:hidden}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line)}
.tabs{display:flex;gap:4px;flex-wrap:wrap}.tabs a{padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--muted);font-weight:600}
.tabs a.on{background:var(--bg);color:var(--text)}
form.search{display:flex;gap:6px}
input[type=search]{font:inherit;border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:220px;background:#fff}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:7px 12px;background:var(--a);color:#fff;cursor:pointer}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}
td.wrapcell{white-space:normal;min-width:180px}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:650;background:#fbfbfa}
tr:last-child td{border-bottom:0}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:650}
.pill.waiting{background:var(--warn-soft);color:var(--warn)}.pill.sending{background:var(--info-soft);color:var(--info)}
.pill.notified{background:var(--a-soft);color:var(--a)}.pill.failed{background:var(--bad-soft);color:var(--bad)}
.pill.grey{background:var(--bg);color:var(--muted)}
.err{color:var(--bad);font-size:12px;max-width:280px;white-space:normal;margin-top:2px}
.empty{padding:36px;text-align:center;color:var(--muted)}
.pager{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-top:1px solid var(--line);color:var(--muted)}
.grid2{display:grid;grid-template-columns:1.1fr .9fr;gap:20px;align-items:start}
pre.snip{background:#18181b;color:#e4e4e7;border-radius:10px;padding:14px;overflow-x:auto;font:12.5px/1.6 ui-monospace,Menlo,Consolas,monospace;margin:0}
.hero{padding:28px 0 8px}.hero h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:0 0 10px;max-width:640px}
.hero p{font-size:16px;color:var(--muted);max-width:600px;margin:0}
ul.points{padding:0;margin:0;list-style:none}ul.points li{padding:10px 0;border-bottom:1px solid var(--line)}ul.points li:last-child{border:0}
ul.points b{display:block}
@media (max-width:820px){.stats{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.hero h1{font-size:28px}}
</style></head><body>
<header class="top"><div class="wrap"><a class="logo" href="/"><i>↺</i>${esc(brand)}</a><nav><a href="/admin">Admin</a></nav></div></header>
<main><div class="wrap">${body}</div></main>
<script>
document.querySelectorAll('time[datetime]').forEach(function(t){
  var d=new Date(t.getAttribute('datetime')); if(isNaN(d)) return;
  var s=Math.round((Date.now()-d)/1000), rel;
  if(s<45) rel='just now'; else if(s<3600) rel=Math.round(s/60)+' min ago'; else if(s<86400) rel=Math.round(s/3600)+' h ago';
  else rel=d.toLocaleDateString(undefined,{day:'numeric',month:'short'});
  t.textContent=rel; t.title=d.toLocaleString();
});
</script>
</body></html>`;
}

const time = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(iso.replace('T', ' ').slice(0, 16))}</time>` : '<span class="muted">—</span>');

// ---------------------------------------------------------------- admin
function adminPage({ stats, list, status, search, page, perPage, events, brand }) {
  const tab = (key, label, n) => {
    const qs = new URLSearchParams({ ...(key ? { status: key } : {}), ...(search ? { q: search } : {}) }).toString();
    return `<a class="${(status || '') === key ? 'on' : ''}" href="/admin${qs ? `?${qs}` : ''}">${label}${n !== undefined ? ` <span class="muted">${n}</span>` : ''}</a>`;
  };
  const total = stats.waiting + stats.sending + stats.notified + stats.failed;
  const rows = list.rows.map((r) => `<tr>
    <td>${esc(r.email)}</td>
    <td class="wrapcell">${r.product_name ? `${esc(r.product_name)}<br>` : ''}<code>${esc(r.sku)}</code></td>
    <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span>${r.last_error && r.status !== 'notified' ? `<div class="err" title="${esc(r.last_error)}">${esc(r.last_error.slice(0, 90))}</div>` : ''}</td>
    <td>${time(r.created_at)}</td>
    <td>${time(r.notified_at)}</td>
    <td>${r.attempts || 0}</td>
  </tr>`).join('');
  const pages = Math.max(1, Math.ceil(list.total / perPage));
  const pageLink = (p) => `/admin?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { q: search } : {}), page: String(p) })}`;

  const ev = events.map((e) => {
    const verified = e.verified_at == null ? '<span class="pill grey">not checked</span>'
      : e.verified_quantity > 0 ? `<span class="pill notified">confirmed · ${e.verified_quantity}</span>`
        : '<span class="pill failed">not confirmed · 0</span>';
    return `<tr><td><code>${esc(e.event_id)}</code></td><td><code>${esc(e.sku)}</code></td><td>${e.claimed_quantity ?? '—'}</td>
      <td>${verified}</td><td>${e.deliveries > 1 ? `<span class="pill sending">×${e.deliveries} · dupes ignored</span>` : '1'}</td><td>${time(e.received_at)}</td></tr>`;
  }).join('');

  return shell('Restock requests', `
  <h1>Restock requests</h1>
  <p class="muted">Every customer who asked to hear about a sold-out product, and whether we've told them.</p>
  <div class="stats">
    <div class="stat"><b>${total}</b><span>Total requests</span></div>
    <div class="stat"><b>${stats.waiting + stats.sending}</b><span>Waiting for restock</span></div>
    <div class="stat"><b>${stats.notified}</b><span>Notified</span></div>
    <div class="stat"><b>${stats.failed}</b><span>Undeliverable</span></div>
  </div>
  <section class="panel">
    <div class="bar">
      <nav class="tabs">${tab('', 'All', total)}${tab('open', 'Waiting', stats.waiting + stats.sending)}${tab('notified', 'Notified', stats.notified)}${tab('failed', 'Undeliverable', stats.failed)}</nav>
      <form class="search" method="get" action="/admin">${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}<input type="search" name="q" value="${esc(search || '')}" placeholder="Search email, SKU or product"><button>Search</button></form>
    </div>
    <div class="scroll"><table>
      <thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Requested</th><th>Notified</th><th>Attempts</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="empty">${search || status ? 'No requests match this filter.' : 'No requests yet. They appear here as soon as a customer uses the form.'}</td></tr>`}</tbody>
    </table></div>
    ${pages > 1 ? `<div class="pager"><span>Page ${page} of ${pages} · ${list.total} requests</span><span>${page > 1 ? `<a href="${pageLink(page - 1)}">← Newer</a>` : ''} ${page < pages ? `&nbsp; <a href="${pageLink(page + 1)}">Older →</a>` : ''}</span></div>` : ''}
  </section>
  <section class="panel">
    <div class="bar"><h2 style="margin:0">Webhook log</h2><span class="muted">Webhooks only trigger a check. The stock API decides who gets emailed.</span></div>
    <div class="scroll"><table>
      <thead><tr><th>Event</th><th>SKU</th><th>Claimed qty</th><th>Stock API said</th><th>Deliveries</th><th>Received</th></tr></thead>
      <tbody>${ev || '<tr><td colspan="6" class="empty">No webhooks received yet.</td></tr>'}</tbody>
    </table></div>
  </section>`, { brand });
}

// ---------------------------------------------------------------- landing
function landingPage({ origin, demoSku, brand }) {
  const src = `${origin}/embed${demoSku ? `?sku=${encodeURIComponent(demoSku)}` : ''}`;
  const snippet = `<iframe src="${src}"
  title="Back-in-stock alert" style="width:100%;max-width:440px;border:0" height="300"
  id="restocked"></iframe>
<script>
  addEventListener('message', function (e) {
    if (e.data && e.data.type === 'restocked:resize')
      document.getElementById('restocked').height = e.data.height;
  });
</script>`;
  return shell('Back-in-stock alerts', `
  <section class="hero">
    <h1>Turn "sold out" into a sale when it's back.</h1>
    <p>Drop one iframe on any product page. Shoppers leave their email, and the moment the stock API confirms a restock they get one email. Not zero, not two.</p>
  </section>
  <div class="grid2" style="margin-top:28px">
    <section class="panel" style="padding:20px">
      <h2>Live demo</h2>
      <p class="muted" style="margin-top:-6px">This is the embed exactly as a store would show it${demoSku ? `, for <code>${esc(demoSku)}</code>` : ''}.</p>
      <iframe id="restocked" src="${esc(src)}" title="Back-in-stock alert" style="width:100%;max-width:440px;border:0" height="300"></iframe>
      <h2 style="margin-top:20px">Add it to a product page</h2>
      <pre class="snip">${esc(snippet)}</pre>
    </section>
    <section class="panel" style="padding:20px">
      <h2>How delivery stays exactly-once</h2>
      <ul class="points">
        <li><b>Webhooks are hints</b><span class="muted">A webhook only schedules a check. The stock API has the final say, so phantom restocks email nobody.</span></li>
        <li><b>Duplicate events are dropped</b><span class="muted">Each event ID is stored once. Retries and simultaneous deliveries are acknowledged and ignored.</span></li>
        <li><b>Atomic claims</b><span class="muted">A request moves to "sending" in one database update, so two workers can't both email the same person.</span></li>
        <li><b>Retries are safe</b><span class="muted">Failed sends back off and retry with the same idempotency key, so a send that secretly succeeded isn't repeated.</span></li>
        <li><b>Restarts lose nothing</b><span class="muted">Everything is in SQLite on disk. On boot, interrupted sends are re-checked and every waiting SKU is polled, which also catches webhooks that never arrived.</span></li>
      </ul>
      <p style="margin-bottom:0"><a href="/admin">Open the admin →</a></p>
    </section>
  </div>
  <script>addEventListener('message',function(e){if(e.data&&e.data.type==='restocked:resize')document.getElementById('restocked').height=e.data.height;});</script>`, { brand });
}

module.exports = { embedPage, adminPage, landingPage };
