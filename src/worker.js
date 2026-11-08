'use strict';
// The notifier. It never trusts a webhook: a webhook only schedules a check, and the
// stock API decides whether anyone gets an email.
const { renderEmail } = require('./email');

const BACKOFF_S = [5, 15, 30, 60, 120, 300, 600, 900];
const backoffMs = (n) => 1000 * BACKOFF_S[Math.min(Math.max(n, 1), BACKOFF_S.length) - 1];

class HttpError extends Error {
  constructor(status, body) { super(`HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`); this.status = status; }
}

function createWorker({ db, config, log }) {
  const inflight = new Set();
  let timer = null;
  let sweepTimer = null;
  let running = 0;
  let stopping = false;

  async function getStock(sku) {
    const res = await fetch(`${config.stockApiUrl}/${encodeURIComponent(sku)}`, {
      headers: { authorization: `Bearer ${config.stockApiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text);
    const data = JSON.parse(text);
    const quantity = Number(data.quantity);
    if (!Number.isFinite(quantity)) throw new Error('Stock API returned no quantity');
    return { ...data, quantity, available: quantity > 0 && data.in_stock !== false };
  }

  async function sendEmail(request, product) {
    const { subject, html, text } = renderEmail({ request, product, config });
    const res = await fetch(`${config.resendBaseUrl}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
        // Same key for every attempt at this request: if a "failed" send actually went
        // through (timeout after delivery), the provider drops the retry instead of re-sending.
        'idempotency-key': `restock-request-${request.id}`,
      },
      body: JSON.stringify({ from: config.emailFrom, to: [request.email], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, body);
    try { return JSON.parse(body).id || null; } catch { return null; }
  }

  // 4xx validation errors will never succeed on retry. Everything else (5xx, 429,
  // timeouts, auth/config problems) is retried.
  const isPermanent = (e) => e instanceof HttpError && [400, 422].includes(e.status);

  async function runCheck(job) {
    const key = job.sku.toLowerCase();
    if (inflight.has(key)) return;
    inflight.add(key);
    running++;
    try {
      let stock;
      try {
        stock = await getStock(job.sku);
      } catch (e) {
        const attempts = job.attempts + 1;
        db.rescheduleCheck(job, Date.now() + backoffMs(attempts), attempts);
        log('warn', `stock check failed for ${job.sku} (attempt ${attempts}): ${e.message}`);
        return;
      }
      db.verifyEvents(job.sku, stock.quantity);
      db.nameProduct(job.sku, stock.name);
      if (!stock.available) { db.finishCheck(job); return; }

      const claimed = db.claimWaiting(job.sku); // atomic: no two workers can claim the same row
      let retryAttempts = 0;
      for (const request of claimed) {
        if (stopping) { db.releaseForRetry(request.id, 'shutdown before send'); retryAttempts = Math.max(retryAttempts, 1); continue; }
        try {
          const emailId = await sendEmail(request, stock);
          db.markNotified(request.id, emailId, stock.name);
          log('info', `notified ${request.email} about ${request.sku}`);
        } catch (e) {
          if (isPermanent(e)) {
            db.markFailed(request.id, e.message);
            log('error', `email to ${request.email} rejected permanently: ${e.message}`);
          } else {
            const r = db.releaseForRetry(request.id, e.message);
            retryAttempts = Math.max(retryAttempts, r ? r.attempts : 1);
            log('warn', `email to ${request.email} failed, will retry: ${e.message}`);
          }
        }
      }
      // Retries go back through the stock check, so nobody is told "it's back" if it sold out again meanwhile.
      if (retryAttempts) db.rescheduleCheck(job, Date.now() + backoffMs(retryAttempts), job.attempts);
      else db.finishCheck(job);
    } catch (e) {
      log('error', `check for ${job.sku} crashed: ${e.stack || e}`);
      db.rescheduleCheck(job, Date.now() + backoffMs(job.attempts + 1), job.attempts + 1);
    } finally {
      inflight.delete(key);
      running--;
    }
  }

  async function tick() {
    if (stopping) return;
    try {
      const jobs = db.dueChecks(10).filter((j) => !inflight.has(j.sku.toLowerCase()));
      await Promise.all(jobs.map(runCheck));
    } catch (e) {
      log('error', `worker tick: ${e.stack || e}`);
    }
  }

  return {
    start() {
      const recovered = db.recover();
      if (recovered) log('info', `recovered ${recovered} SKU(s) that were mid-send at shutdown`);
      db.sweep();
      timer = setInterval(tick, 1000);
      sweepTimer = setInterval(() => { try { db.sweep(); } catch (e) { log('error', `sweep: ${e}`); } }, config.pollSeconds * 1000);
      setImmediate(tick);
    },
    kick: () => setImmediate(tick),
    async stop(graceMs = 8000) {
      stopping = true;
      clearInterval(timer);
      clearInterval(sweepTimer);
      const until = Date.now() + graceMs;
      while (running > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    },
    getStock,
  };
}

module.exports = { createWorker };
