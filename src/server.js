'use strict';
// Restocked: back-in-stock email alerts. Zero dependencies (Node 22+, built-in SQLite).
// Author: EPMnemon
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb } = require('./db');
const { createWorker } = require('./worker');
const { embedPage, adminPage, landingPage } = require('./views');
const { safeUrl } = require('./email');

const env = process.env;
const trimSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
const config = {
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  stockApiUrl: trimSlash(env.STOCK_API_URL),
  stockApiKey: env.STOCK_API_KEY || '',
  resendApiKey: env.RESEND_API_KEY || '',
  resendBaseUrl: trimSlash(env.RESEND_BASE_URL || 'https://api.resend.com'),
  webhookSecret: env.WEBHOOK_SECRET || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  emailFrom: env.EMAIL_FROM || 'Restocked <onboarding@resend.dev>',
  brandName: env.BRAND_NAME || 'Restocked',
  pollSeconds: Math.max(10, Number(env.POLL_SECONDS || 60)),
};

function log(level, msg) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg });
  (level === 'error' ? console.error : console.log)(line);
}

for (const k of ['STOCK_API_URL', 'STOCK_API_KEY', 'RESEND_API_KEY', 'WEBHOOK_SECRET', 'ADMIN_PASSWORD']) {
  if (!env[k]) log('warn', `${k} is not set${k === 'ADMIN_PASSWORD' ? ': /admin is disabled' : k === 'WEBHOOK_SECRET' ? ': all webhooks will be rejected' : ''}`);
}

const db = openDb(config.dataDir);
const worker = createWorker({ db, config, log });

// ---------------------------------------------------------------- helpers
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
// The embed is meant to be framed by any store; everything else is not.
const FRAMEABLE = { 'content-security-policy': "frame-ancestors *; default-src 'self'; img-src * data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'" };
const NOT_FRAMEABLE = { 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readPayload(req, limit = 16 * 1024) {
  const raw = await readBody(req, limit);
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { const v = JSON.parse(raw || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Constant-time compare that also hides length differences.
function secretEquals(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SKU_RE = /^[^\x00-\x1f\x7f<>"'`\\]{1,64}$/;
function validateRequest(body) {
  if (!body) return { error: 'invalid_body', message: 'Send JSON like {"email": "...", "sku": "..."}.' };
  const email = String(body.email ?? '').trim().toLowerCase();
  const sku = String(body.sku ?? '').trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'invalid_email', message: 'Please enter a valid email address.' };
  if (!SKU_RE.test(sku)) return { error: 'invalid_sku', message: 'Please enter a valid product SKU.' };
  const sourceUrl = body.source_url ? safeUrl(String(body.source_url).slice(0, 2000)) : null;
  return { email, sku, sourceUrl, bot: Boolean(body.website) };
}

function createRequest(v) {
  if (v.bot) return { status: 201, body: { status: 'waiting' } }; // honeypot filled: pretend success, store nothing
  const r = db.createRequest(v.email, v.sku, v.sourceUrl);
  if (r.duplicate) {
    return { status: 409, body: { error: 'duplicate', message: "You're already on the list for this product. We'll email you once it's back.", id: r.duplicate.id, status: r.duplicate.status } };
  }
  worker.kick();
  return { status: 201, body: { id: r.request.id, email: r.request.email, sku: r.request.sku, status: r.request.status, created_at: r.request.created_at } };
}

// Small cache so a busy product page doesn't hit the stock API on every view.
const productCache = new Map();
async function productInfo(sku) {
  const hit = productCache.get(sku.toLowerCase());
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  let data = null;
  try { data = await worker.getStock(sku); } catch { /* the form still works without product details */ }
  productCache.set(sku.toLowerCase(), { at: Date.now(), data });
  if (productCache.size > 2000) productCache.delete(productCache.keys().next().value);
  return data;
}
let demoCache = { at: 0, sku: null };
async function demoSku() {
  if (Date.now() - demoCache.at < 60_000) return demoCache.sku;
  let sku = null;
  try {
    const r = await fetch(config.stockApiUrl, { headers: { authorization: `Bearer ${config.stockApiKey}` }, signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.products || [];
    sku = (list.find((p) => Number(p.quantity) <= 0) || list[0] || {}).sku || null;
  } catch { /* no demo product */ }
  demoCache = { at: Date.now(), sku };
  return sku;
}

function checkAdmin(req, res) {
  if (!config.adminPassword) { send(res, 503, 'Admin is disabled. Set ADMIN_PASSWORD to enable it.', NOT_FRAMEABLE); return false; }
  const [scheme, b64] = String(req.headers.authorization || '').split(' ');
  const pass = scheme === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  if (secretEquals(pass, config.adminPassword)) return true;
  send(res, 401, 'Authentication required', { 'www-authenticate': `Basic realm="${config.brandName} admin", charset="UTF-8"`, ...NOT_FRAMEABLE });
  return false;
}

function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// ---------------------------------------------------------------- routes
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/healthz') return send(res, 200, 'ok');

  if (p === '/') {
    if (m !== 'GET' && m !== 'HEAD') return send(res, 405, 'Method not allowed');
    const html = landingPage({ origin: originOf(req), demoSku: await demoSku(), brand: config.brandName });
    return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', ...NOT_FRAMEABLE });
  }

  if (p === '/embed') {
    const sku = (url.searchParams.get('sku') || '').trim().slice(0, 64);
    const accent = url.searchParams.get('accent') || '';
    const product = sku && SKU_RE.test(sku) ? await productInfo(sku) : null;
    const page = (state, status = 200) => send(res, status, embedPage({ sku: SKU_RE.test(sku) ? sku : '', product, accent, state, brand: config.brandName }),
      { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...FRAMEABLE });
    if (m === 'GET' || m === 'HEAD') return page({});
    if (m === 'POST') { // no-JavaScript fallback: classic form post
      const body = await readPayload(req);
      const v = validateRequest(body);
      const state = { email: body?.email, sku: body?.sku, source_url: body?.source_url };
      if (v.error) return page({ ...state, error: v.message }, 400);
      const r = createRequest(v);
      return page({ ...state, ok: r.status === 201, duplicate: r.status === 409 }, r.status === 409 ? 200 : r.status);
    }
    return send(res, 405, 'Method not allowed');
  }

  if (p === '/api/requests') {
    if (m === 'OPTIONS') return send(res, 204, '', CORS);
    if (m !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, CORS);
    const v = validateRequest(await readPayload(req));
    if (v.error) return json(res, 400, v, CORS);
    const r = createRequest(v);
    return json(res, r.status, r.body, CORS);
  }

  if (p === '/webhooks/stock') {
    if (m !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    if (!secretEquals(req.headers['x-webhook-secret'], config.webhookSecret)) {
      log('warn', `rejected webhook with bad secret from ${req.socket.remoteAddress}`);
      return json(res, 401, { error: 'invalid_signature' });
    }
    const body = await readPayload(req, 64 * 1024);
    const eventId = body && typeof body.event_id === 'string' ? body.event_id.trim().slice(0, 200) : '';
    const sku = body && typeof body.sku === 'string' ? body.sku.trim() : '';
    if (!eventId || !SKU_RE.test(sku)) return json(res, 400, { error: 'invalid_payload', message: 'event_id and sku are required.' });
    const qty = Number.isFinite(Number(body.quantity)) ? Math.trunc(Number(body.quantity)) : null;
    const deliveries = db.recordEvent(eventId, sku, qty); // committed to disk before we answer 200
    if (deliveries === 1) worker.kick();
    return json(res, 200, { received: true, duplicate: deliveries > 1 });
  }

  if (p === '/admin') {
    if (!checkAdmin(req, res)) return;
    const status = ['open', 'waiting', 'notified', 'failed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '';
    const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const perPage = 50;
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
    const html = adminPage({
      stats: db.stats(), list: db.listRequests({ status, search, limit: perPage, offset: (page - 1) * perPage }),
      status, search, page, perPage, events: db.recentEvents(25), brand: config.brandName,
    });
    return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...NOT_FRAMEABLE });
  }

  return send(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (e.status === 413) return res.headersSent || json(res, 413, { error: 'body_too_large' });
    log('error', `${req.method} ${req.url}: ${e.stack || e}`);
    if (!res.headersSent) json(res, 500, { error: 'internal_error' });
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

worker.start();
server.listen(config.port, () => log('info', `${config.brandName} listening on :${config.port}, data in ${config.dataDir}`));

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `${sig}: finishing in-flight work`);
  server.close();
  await worker.stop();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
