'use strict';
// End-to-end test against the challenge's own test harness, run locally.
//   HARNESS=/path/to/back-in-stock-challenge/harness/server.js npm test
// Starts the harness and this app, then checks the things the brief says will be poked at.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const HARNESS = process.env.HARNESS;
if (!HARNESS || !fs.existsSync(HARNESS)) { console.error('Set HARNESS to the path of harness/server.js'); process.exit(2); }

const HP = 4100, AP = 4200;
const H = `http://127.0.0.1:${HP}`, A = `http://127.0.0.1:${AP}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restocked-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
let app = null;
let creds = null;
let passed = 0;

function start(file, env, name) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  procs.push(p);
  return p;
}
async function waitUp(url) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await sleep(100); }
  throw new Error(`${url} did not come up`);
}
function startApp() {
  app = start(path.join(__dirname, '..', 'src', 'server.js'), {
    PORT: String(AP), DATA_DIR: path.join(tmp, 'app'), STOCK_API_URL: creds.STOCK_API_URL, STOCK_API_KEY: creds.STOCK_API_KEY,
    RESEND_API_KEY: creds.RESEND_API_KEY, RESEND_BASE_URL: creds.RESEND_BASE_URL, WEBHOOK_SECRET: creds.WEBHOOK_SECRET,
    ADMIN_PASSWORD: 'admin-test-pass', POLL_SECONDS: '10',
  }, 'app');
  return waitUp(`${A}/healthz`);
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const form = (url, obj) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj) });
const testApi = (action, body) => post(`${H}/api/test/${action}`, body, { authorization: `Bearer ${creds.STOCK_API_KEY}` }).then((r) => r.json());
const hook = (body, secret = creds.WEBHOOK_SECRET) => post(`${A}/webhooks/stock`, body, secret === null ? {} : { 'x-webhook-secret': secret });
function harnessDb() { return JSON.parse(fs.readFileSync(path.join(tmp, 'harness', 'db.json'), 'utf8')); }
function emailsTo(addr) {
  const c = Object.values(harnessDb().candidates)[0];
  return c.emails.filter((e) => e.to.includes(addr));
}
async function eventually(fn, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) { try { return await fn(); } catch (e) { if (Date.now() > until) throw e; await sleep(250); } }
}
async function soldOutSku() {
  const r = await fetch(`${creds.STOCK_API_URL}`, { headers: { authorization: `Bearer ${creds.STOCK_API_KEY}` } }).then((x) => x.json());
  return r.products;
}
let skuN = 0;
async function setStock(sku, quantity) { await form(`${H}/c/${creds.token}/stock`, { sku, quantity: String(quantity) }); }
const freshSku = async () => { const s = `TEST-${Date.now().toString(36)}-${++skuN}`; await setStock(s, 0); return s; };
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

(async () => {
  start(HARNESS, { PORT: String(HP), DATA_DIR: path.join(tmp, 'harness'), SIM_INTERVAL_SECONDS: '100000', PUBLIC_URL: H }, 'harness');
  await waitUp(`${H}/healthz`);
  const signup = await form(`${H}/signup`, { name: 'e2e', profile: '' });
  const token = signup.headers.get('location').split('/').pop();
  const dash = await (await fetch(`${H}/c/${token}`)).text();
  creds = { token };
  for (const k of ['STOCK_API_URL', 'STOCK_API_KEY', 'RESEND_API_KEY', 'RESEND_BASE_URL', 'WEBHOOK_SECRET']) creds[k] = dash.match(new RegExp(`${k}=(\\S+)`))[1];
  await startApp();
  await form(`${H}/c/${token}/baseurl`, { baseUrl: A });
  await form(`${H}/c/${token}/sim`, { action: 'stop' });
  console.log('Restocked e2e');

  await test('rejects invalid input', async () => {
    assert.equal((await post(`${A}/api/requests`, { email: 'nope', sku: 'X' })).status, 400);
    assert.equal((await post(`${A}/api/requests`, { email: 'a@b.co' })).status, 400);
    assert.equal((await post(`${A}/api/requests`, '{not json')).status, 400);
  });

  await test('no duplicate open requests, even 20 at once and with different email casing', async () => {
    const sku = await freshSku();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post(`${A}/api/requests`, { email: i % 2 ? 'Dup@Example.com' : 'dup@example.com', sku })));
    const codes = rs.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 201).length, 1);
    assert.equal(codes.filter((c) => c === 409).length, 19);
  });

  await test('webhook with wrong or missing secret is rejected', async () => {
    assert.equal((await hook({ event_id: 'evt_bad', sku: 'X', quantity: 5 }, 'wrong')).status, 401);
    assert.equal((await hook({ event_id: 'evt_bad', sku: 'X', quantity: 5 }, null)).status, 401);
  });

  await test('phantom restock (webhook says back, stock API says 0) sends nothing', async () => {
    const sku = await freshSku();
    assert.equal((await post(`${A}/api/requests`, { email: 'phantom@example.com', sku })).status, 201);
    await testApi('phantom', { sku, quantity: 9 });
    await sleep(2500);
    assert.equal(emailsTo('phantom@example.com').length, 0);
  });

  await test('restock delivered twice at the same time -> exactly one email per customer', async () => {
    const sku = await freshSku();
    for (const e of ['twice1@example.com', 'twice2@example.com']) assert.equal((await post(`${A}/api/requests`, { email: e, sku })).status, 201);
    await testApi('restock', { sku, quantity: 4, twice: true });
    await eventually(() => { assert.equal(emailsTo('twice1@example.com').length, 1); assert.equal(emailsTo('twice2@example.com').length, 1); });
    await sleep(1500);
    assert.equal(emailsTo('twice1@example.com').length, 1);
  });

  await test('same event hammered 10x concurrently -> one email', async () => {
    const sku = await freshSku();
    await post(`${A}/api/requests`, { email: 'storm@example.com', sku });
    await setStock(sku, 3);
    const rs = await Promise.all(Array.from({ length: 10 }, () => hook({ event_id: `evt_storm_${sku}`, sku, quantity: 3 })));
    assert.ok(rs.every((r) => r.status === 200));
    await eventually(() => assert.equal(emailsTo('storm@example.com').length, 1));
    await sleep(1500);
    assert.equal(emailsTo('storm@example.com').length, 1);
  });

  await test('email provider returns 500 twice -> retried, customer gets exactly one email', async () => {
    const sku = await freshSku();
    await post(`${A}/api/requests`, { email: 'flaky@example.com', sku });
    await form(`${H}/c/${creds.token}/fail`, { n: '2' });
    await testApi('restock', { sku, quantity: 6, twice: false });
    await eventually(() => {
      const accepted = emailsTo('flaky@example.com').filter((e) => e.status === 'accepted');
      assert.equal(accepted.length, 1);
    }, 30_000);
    assert.equal(emailsTo('flaky@example.com').filter((e) => e.status.startsWith('failed')).length, 2);
  });

  await test('request for an item that is in stock right now -> emailed straight away, once', async () => {
    const sku = await freshSku();
    await setStock(sku, 7);
    assert.equal((await post(`${A}/api/requests`, { email: 'instock@example.com', sku })).status, 201);
    await eventually(() => assert.equal(emailsTo('instock@example.com').length, 1));
  });

  await test('restart: app killed, restock happens while down with no webhook, email arrives after boot', async () => {
    const sku = await freshSku();
    await post(`${A}/api/requests`, { email: 'restart@example.com', sku });
    await sleep(300);
    app.kill('SIGKILL');
    await new Promise((r) => app.once('exit', r));
    await setStock(sku, 5); // no webhook at all
    await startApp();
    await eventually(() => assert.equal(emailsTo('restart@example.com').length, 1), 15_000);
    // and the request is still remembered: a second signup is a duplicate only while open
    assert.equal((await post(`${A}/api/requests`, { email: 'restart@example.com', sku })).status, 201);
  });

  await test('notified customers are not re-emailed when the item restocks again', async () => {
    const sku = await freshSku();
    await post(`${A}/api/requests`, { email: 'again@example.com', sku });
    await testApi('restock', { sku, quantity: 3, twice: false });
    await eventually(() => assert.equal(emailsTo('again@example.com').length, 1));
    await testApi('sellout', { sku });
    await testApi('restock', { sku, quantity: 3, twice: false });
    await sleep(2500);
    assert.equal(emailsTo('again@example.com').length, 1);
  });

  await test('admin is password protected and lists requests with notified time', async () => {
    assert.equal((await fetch(`${A}/admin`)).status, 401);
    const auth = { authorization: `Basic ${Buffer.from('x:wrong').toString('base64')}` };
    assert.equal((await fetch(`${A}/admin`, { headers: auth })).status, 401);
    const ok = await fetch(`${A}/admin?status=notified`, { headers: { authorization: `Basic ${Buffer.from('admin:admin-test-pass').toString('base64')}` } });
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.ok(html.includes('again@example.com'));
    assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  });

  await test('embed can be framed by any site and works without JavaScript', async () => {
    const r = await fetch(`${A}/embed?sku=TEE-ORG-BLK-L`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors \*/);
    assert.equal(r.headers.get('x-frame-options'), null);
    const nojs = await form(`${A}/embed?sku=NOJS-1`, { email: 'nojs@example.com', sku: 'NOJS-1' });
    assert.equal(nojs.status, 201);
    assert.match(await nojs.text(), /on the list/);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('\nFAILED:', e); process.exitCode = 1; })
  .finally(() => { for (const p of procs) p.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); });
