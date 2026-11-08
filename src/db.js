'use strict';
// Persistence. SQLite (built into Node 22) in WAL mode: every state change is
// committed to disk before we acknowledge it, so a restart loses nothing.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const OPEN = "('waiting','sending')";

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'restocked.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS requests (
      id           INTEGER PRIMARY KEY,
      email        TEXT NOT NULL,
      sku          TEXT NOT NULL COLLATE NOCASE,
      status       TEXT NOT NULL DEFAULT 'waiting',   -- waiting | sending | notified | failed
      source_url   TEXT,
      product_name TEXT,
      created_at   TEXT NOT NULL,
      notified_at  TEXT,
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      email_id     TEXT
    );
    -- One open request per customer per product, enforced by the database, not by app code.
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests (email, sku) WHERE status IN ${OPEN};
    CREATE INDEX IF NOT EXISTS requests_sku_status ON requests (sku, status);

    -- Every webhook delivery we accepted. event_id is the dedupe key.
    CREATE TABLE IF NOT EXISTS events (
      event_id          TEXT PRIMARY KEY,
      sku               TEXT NOT NULL COLLATE NOCASE,
      claimed_quantity  INTEGER,
      deliveries        INTEGER NOT NULL DEFAULT 1,
      received_at       TEXT NOT NULL,
      verified_quantity INTEGER,
      verified_at       TEXT
    );

    -- Durable work queue: "go and check the stock API for this SKU".
    -- version changes on every enqueue, so a job is only removed if nothing new arrived meanwhile.
    CREATE TABLE IF NOT EXISTS checks (
      sku      TEXT PRIMARY KEY COLLATE NOCASE,
      run_at   INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      version  INTEGER NOT NULL DEFAULT 1
    );
  `);

  const now = () => new Date().toISOString();
  const q = (sql) => db.prepare(sql);

  const s = {
    insertRequest: q(`INSERT INTO requests (email, sku, source_url, created_at) VALUES (?, ?, ?, ?) RETURNING *`),
    findOpen: q(`SELECT * FROM requests WHERE email = ? AND sku = ? AND status IN ${OPEN}`),
    hasWaiting: q(`SELECT 1 FROM requests WHERE sku = ? AND status = 'waiting' LIMIT 1`),
    claim: q(`UPDATE requests SET status = 'sending' WHERE sku = ? AND status = 'waiting' RETURNING *`),
    notified: q(`UPDATE requests SET status = 'notified', notified_at = ?, email_id = ?, product_name = COALESCE(?, product_name), last_error = NULL, attempts = attempts + 1 WHERE id = ? AND status = 'sending'`),
    release: q(`UPDATE requests SET status = 'waiting', attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'sending' RETURNING attempts`),
    failed: q(`UPDATE requests SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ? AND status = 'sending'`),
    recoverSending: q(`UPDATE requests SET status = 'waiting' WHERE status = 'sending' RETURNING sku`),
    waitingSkus: q(`SELECT DISTINCT sku FROM requests WHERE status = 'waiting'`),

    insertEvent: q(`INSERT INTO events (event_id, sku, claimed_quantity, received_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (event_id) DO UPDATE SET deliveries = deliveries + 1 RETURNING deliveries`),
    verifyEvents: q(`UPDATE events SET verified_quantity = ?, verified_at = ? WHERE sku = ? AND verified_at IS NULL`),
    nameProduct: q(`UPDATE requests SET product_name = ? WHERE sku = ? AND product_name IS NULL`),

    enqueueNow: q(`INSERT INTO checks (sku, run_at) VALUES (?, ?)
                   ON CONFLICT (sku) DO UPDATE SET run_at = MIN(run_at, excluded.run_at), version = version + 1`),
    enqueueIfAbsent: q(`INSERT OR IGNORE INTO checks (sku, run_at) VALUES (?, ?)`),
    dueChecks: q(`SELECT * FROM checks WHERE run_at <= ? ORDER BY run_at LIMIT ?`),
    reschedule: q(`UPDATE checks SET run_at = ?, attempts = ? WHERE sku = ? AND version = ?`),
    doneCheck: q(`DELETE FROM checks WHERE sku = ? AND version = ?`),

    counts: q(`SELECT status, COUNT(*) AS n FROM requests GROUP BY status`),
    recentEvents: q(`SELECT * FROM events ORDER BY received_at DESC LIMIT ?`),
  };

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return {
    close: () => db.close(),

    // Returns { request } or { duplicate: existingRow }.
    createRequest(email, sku, sourceUrl) {
      return tx(() => {
        const existing = s.findOpen.get(email, sku);
        if (existing) return { duplicate: existing };
        const request = s.insertRequest.get(email, sku, sourceUrl || null, now());
        s.enqueueNow.run(sku, Date.now());
        return { request };
      });
    },

    // Records a webhook delivery. Returns the delivery count (1 = first time we've seen this event).
    recordEvent(eventId, sku, quantity) {
      return tx(() => {
        const { deliveries } = s.insertEvent.get(eventId, sku, quantity, now());
        if (deliveries === 1 && s.hasWaiting.get(sku)) s.enqueueNow.run(sku, Date.now());
        return deliveries;
      });
    },

    verifyEvents: (sku, qty) => s.verifyEvents.run(qty, now(), sku),
    nameProduct: (sku, name) => name && s.nameProduct.run(String(name).slice(0, 200), sku),
    claimWaiting: (sku) => s.claim.all(sku),
    markNotified: (id, emailId, productName) => s.notified.run(now(), emailId, productName || null, id),
    releaseForRetry: (id, err) => s.release.get(String(err).slice(0, 500), id),
    markFailed: (id, err) => s.failed.run(String(err).slice(0, 500), id),

    dueChecks: (limit) => s.dueChecks.all(Date.now(), limit),
    rescheduleCheck: (job, runAt, attempts) => s.reschedule.run(runAt, attempts, job.sku, job.version),
    finishCheck: (job) => s.doneCheck.run(job.sku, job.version),

    // After a crash: anything mid-send goes back to waiting and gets re-checked.
    recover() {
      return tx(() => {
        const skus = new Set(s.recoverSending.all().map((r) => r.sku));
        for (const sku of skus) s.enqueueNow.run(sku, Date.now());
        return skus.size;
      });
    },

    // Safety net for missed webhooks: make sure every SKU with waiting customers gets checked.
    sweep() {
      const skus = s.waitingSkus.all().map((r) => r.sku);
      for (const sku of skus) s.enqueueIfAbsent.run(sku, Date.now());
      return skus.length;
    },

    stats() {
      const out = { waiting: 0, sending: 0, notified: 0, failed: 0 };
      for (const r of s.counts.all()) out[r.status] = r.n;
      return out;
    },

    listRequests({ status, search, limit = 50, offset = 0 }) {
      const where = [];
      const args = [];
      if (status === 'open') where.push(`status IN ${OPEN}`);
      else if (status) { where.push('status = ?'); args.push(status); }
      if (search) { where.push('(email LIKE ? OR sku LIKE ? OR product_name LIKE ?)'); const p = `%${search}%`; args.push(p, p, p); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM requests ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM requests ${w}`).get(...args);
      return { rows, total: n };
    },

    recentEvents: (limit = 25) => s.recentEvents.all(limit),
  };
}

module.exports = { openDb };
