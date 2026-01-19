// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
const LEASE_MS = Number(process.env.SESSION_LEASE_MS || 2 * 60 * 1000); // 2 minutes default

function toText(v) {
  return String(v ?? "").trim();
}
function toUpperText(v) {
  return toText(v).toUpperCase();
}
function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

// ----------------------------------------------------
// Startup check
// ----------------------------------------------------
pool
  .query("SELECT current_database()")
  .then((r) => console.log("DB:", r.rows[0].current_database))
  .catch((e) => console.error("DB connection failed:", e.message));

// ----------------------------------------------------
// Health check
// ----------------------------------------------------
app.get("/health", async (req, res) => {
  const r = await pool.query("SELECT 1 AS ok");
  res.json({ api: true, db: r.rows[0].ok === 1 });
});

// ====================================================
// ✅ REALTIME INNERBOX LOCKING + RESUME FLOW
// Requires these tables/constraints (IMPORTANT):
//
// 1) inbound_sessions (lock/session table)
//
// CREATE TABLE IF NOT EXISTS inbound_sessions (
//   id BIGSERIAL PRIMARY KEY,
//   outerbox_id TEXT NOT NULL,
//   innerbox_id TEXT NOT NULL,
//   expected_qty INT NOT NULL DEFAULT 0,
//   status TEXT NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS | CONFIRMED | ABANDONED
//   locked_by TEXT NOT NULL,
//   locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//   last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
//   confirmed_at TIMESTAMPTZ,
//   UNIQUE (outerbox_id, innerbox_id)
// );
//
// 2) inbound_items should have session_id + uniqueness
//
// ALTER TABLE inbound_items ADD COLUMN IF NOT EXISTS session_id BIGINT;
//
// CREATE UNIQUE INDEX IF NOT EXISTS inbound_items_serial_unique
//   ON inbound_items (serial_number);
//
// CREATE INDEX IF NOT EXISTS inbound_items_session_idx
//   ON inbound_items (session_id);
// ====================================================

// ----------------------------------------------------
// 1) CLAIM / RESUME a session (prevents 2 users scanning same innerbox)
// POST /api/inbounds/sessions/claim
// body: { outerBoxId, innerBoxId, expectedQty, packedBy }
// ----------------------------------------------------
app.post("/api/inbounds/sessions/claim", async (req, res) => {
  const outer = toText(req.body?.outerBoxId);
  const inner = toText(req.body?.innerBoxId);
  const packedBy = toText(req.body?.packedBy);
  const expectedQty = Math.max(0, toInt(req.body?.expectedQty, 0));

  if (!outer || !inner) {
    return res.status(400).json({ error: "outerBoxId and innerBoxId are required." });
  }
  if (!packedBy) {
    return res.status(400).json({ error: "packedBy (operator username) is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the session row if it exists
    const existing = await client.query(
      `
      SELECT *
      FROM inbound_sessions
      WHERE outerbox_id = $1 AND innerbox_id = $2
      FOR UPDATE
      `,
      [outer, inner]
    );

    // Create new session if not exists
    if (existing.rows.length === 0) {
      const created = await client.query(
        `
        INSERT INTO inbound_sessions
          (outerbox_id, innerbox_id, expected_qty, status, locked_by, locked_at, last_seen)
        VALUES
          ($1, $2, $3, 'IN_PROGRESS', $4, now(), now())
        RETURNING
          id,
          outerbox_id AS "outerBoxId",
          innerbox_id AS "innerBoxId",
          expected_qty AS "expectedQty",
          status,
          locked_by AS "lockedBy",
          locked_sku AS "lockedSku",
          locked_at AS "lockedAt",
          last_seen AS "lastSeen"
        `,
        [outer, inner, expectedQty, packedBy]
      );

      await client.query("COMMIT");
      return res.json({ session: created.rows[0], items: [] });
    }

    const s = existing.rows[0];

    if (s.status === "CONFIRMED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This InnerBox is already CONFIRMED." });
    }

    // Lease expiry logic (so locks don't live forever if browser closes)
    const lastSeenMs = new Date(s.last_seen).getTime();
    const leaseExpired = Date.now() - lastSeenMs > LEASE_MS;

    // If different user and lease not expired -> block
    if (s.locked_by !== packedBy && !leaseExpired) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `InnerBox is in progress by "${s.locked_by}".`,
        lockedBy: s.locked_by,
      });
    }

    // Resume (same operator) OR takeover (lease expired)
    const updated = await client.query(
      `
      UPDATE inbound_sessions
      SET
        locked_by = $2,
        expected_qty = CASE WHEN $3 > 0 THEN $3 ELSE expected_qty END,
        status = 'IN_PROGRESS',
        last_seen = now()
      WHERE id = $1
      RETURNING
        id,
        outerbox_id AS "outerBoxId",
        innerbox_id AS "innerBoxId",
        expected_qty AS "expectedQty",
        status,
        locked_by AS "lockedBy",
        locked_at AS "lockedAt",
        locked_sku AS "lockedSku", 
        last_seen AS "lastSeen"
      `,
      [s.id, packedBy, expectedQty]
    );

    const items = await client.query(
      `
      SELECT
        sku,
        serial_number AS "serial"
      FROM inbound_items
      WHERE session_id = $1
      ORDER BY id ASC
      `,
      [s.id]
    );

    await client.query("COMMIT");
    return res.json({ session: updated.rows[0], items: items.rows });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Server error", details: e.message });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------
// 2) HEARTBEAT (keeps lock alive while scanning)
// POST /api/inbounds/sessions/:id/heartbeat
// body: { packedBy }
// ----------------------------------------------------
app.post("/api/inbounds/sessions/:id/heartbeat", async (req, res) => {
  const id = toInt(req.params.id, 0);
  const packedBy = toText(req.body?.packedBy);

  if (!id) return res.status(400).json({ error: "Invalid session id." });
  if (!packedBy) return res.status(400).json({ error: "packedBy required." });

  const r = await pool.query(
    `
    UPDATE inbound_sessions
    SET last_seen = now()
    WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
    RETURNING id
    `,
    [id, packedBy]
  );

  if (!r.rows.length) return res.status(403).json({ error: "Not allowed (locked by another user or not in progress)." });
  return res.json({ ok: true });
});

// ----------------------------------------------------
// 3) SAVE EACH SCAN (SKU+Serial) immediately
// POST /api/inbounds/items
// body: { sessionId, sku, serialNumber, packedBy }
// ----------------------------------------------------
app.post("/api/inbounds/items", async (req, res) => {
  try {
    const sessionId = toInt(req.body?.sessionId, 0);
    const sku = toUpperText(req.body?.sku);
    const serialNumber = toUpperText(req.body?.serialNumber);
    const packedBy = toText(req.body?.packedBy);

    if (!sessionId || !sku || !serialNumber || !packedBy) {
      return res.status(400).json({ error: "sessionId, sku, serialNumber, packedBy are required." });
    }

    // Ensure session exists + in progress + locked by same operator
    const s = await pool.query(`SELECT * FROM inbound_sessions WHERE id = $1`, [sessionId]);
    if (!s.rows.length) return res.status(404).json({ error: "Session not found." });

    const session = s.rows[0];
    
    if (session.status !== "IN_PROGRESS") return res.status(409).json({ error: "Session is not IN_PROGRESS." });
    if (toText(session.locked_by) !== packedBy) return res.status(403).json({ error: "InnerBox is locked by another user." });
    // ✅ DB-enforced SKU lock
const incomingSku = sku; // already uppercased

if (!session.locked_sku) {
  // first item locks the SKU in DB
  await pool.query(
    `UPDATE inbound_sessions SET locked_sku = $2 WHERE id = $1`,
    [sessionId, incomingSku]
  );
} else {
  // subsequent items must match the locked SKU
  if (toUpperText(session.locked_sku) !== incomingSku) {
    return res.status(409).json({
      error: `SKU mismatch. Locked SKU is ${session.locked_sku}. You scanned ${incomingSku}`,
    });
  }
}


    // Insert item
    const q = `
      INSERT INTO inbound_items
        (session_id, outerbox_id, innerbox_id, sku, serial_number, packed_by)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        session_id AS "sessionId",
        outerbox_id AS "outerBoxId",
        innerbox_id AS "innerBoxId",
        sku,
        serial_number AS "serialNumber",
        packed_by AS "packedBy",
        created_at AS "createdAt";
    `;

    const values = [
      sessionId,
      toText(session.outerbox_id),
      toText(session.innerbox_id),
      sku,
      serialNumber,
      packedBy,
    ];

    const result = await pool.query(q, values);

    // Update heartbeat implicitly
    await pool.query(`UPDATE inbound_sessions SET last_seen = now() WHERE id = $1`, [sessionId]);

    return res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "Serial number already exists." });
    }
    return res.status(500).json({ error: "Server error", details: e.message });
  }
});

// ----------------------------------------------------
// 4) COMPLETE / CONFIRM a session (qty match) and unlock
// POST /api/inbounds/sessions/:id/complete
// body: { packedBy }
// ----------------------------------------------------
app.post("/api/inbounds/sessions/:id/complete", async (req, res) => {
  const id = toInt(req.params.id, 0);
  const packedBy = toText(req.body?.packedBy);

  if (!id) return res.status(400).json({ error: "Invalid session id." });
  if (!packedBy) return res.status(400).json({ error: "packedBy required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const s = await client.query(
      `
      SELECT * FROM inbound_sessions
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (!s.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session not found." });
    }

    const session = s.rows[0];
    if (session.status !== "IN_PROGRESS") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Session is not IN_PROGRESS." });
    }
    if (toText(session.locked_by) !== packedBy) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Locked by another user." });
    }

    const c = await client.query(
      `SELECT COUNT(*)::int AS c FROM inbound_items WHERE session_id = $1`,
      [id]
    );

    const scanned = c.rows[0].c;
    const expected = toInt(session.expected_qty, 0);

    if (expected <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Expected quantity not set." });
    }
    if (scanned !== expected) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `Quantity mismatch: scanned ${scanned} of ${expected}` });
    }

    const done = await client.query(
      `
      UPDATE inbound_sessions
      SET status = 'CONFIRMED',
          confirmed_at = now(),
          last_seen = now()
      WHERE id = $1
      RETURNING
        id,
        outerbox_id AS "outerBoxId",
        innerbox_id AS "innerBoxId",
        expected_qty AS "expectedQty",
        status,
        locked_by AS "lockedBy",
        confirmed_at AS "confirmedAt";
      `,
      [id]
    );

    await client.query("COMMIT");
    return res.json({ session: done.rows[0], scanned, expected });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Server error", details: e.message });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------
// OPTIONAL: Abandon a session (unlock it)
// POST /api/inbounds/sessions/:id/abandon
// body: { packedBy }
// ----------------------------------------------------
app.post("/api/inbounds/sessions/:id/abandon", async (req, res) => {
  const id = toInt(req.params.id, 0);
  const packedBy = toText(req.body?.packedBy);

  if (!id) return res.status(400).json({ error: "Invalid session id." });
  if (!packedBy) return res.status(400).json({ error: "packedBy required." });

  const r = await pool.query(
    `
    UPDATE inbound_sessions
    SET status = 'ABANDONED',
        last_seen = now()
    WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
    RETURNING id
    `,
    [id, packedBy]
  );

  if (!r.rows.length) return res.status(403).json({ error: "Not allowed." });
  return res.json({ ok: true });
});

// ====================================================
// ✅ Your OLD endpoints (keep if you still need them)
// Note: These operate directly on inbound_items, without session locking.
// You can keep READ/DELETE for admin/testing.
// ====================================================

// READ: list with optional filters
app.get("/api/inbounds", async (req, res) => {
  const { outerBoxId, innerBoxId, sku, serialNumber, limit = 50 } = req.query;

  const where = [];
  const values = [];
  let i = 1;

  if (outerBoxId) { where.push(`outerbox_id = $${i++}`); values.push(toText(outerBoxId)); }
  if (innerBoxId) { where.push(`innerbox_id = $${i++}`); values.push(toText(innerBoxId)); }
  if (sku) { where.push(`sku = $${i++}`); values.push(toUpperText(sku)); }
  if (serialNumber) { where.push(`serial_number = $${i++}`); values.push(toUpperText(serialNumber)); }

  values.push(Math.min(toInt(limit, 50) || 50, 200));

  const q = `
    SELECT
      id,
      session_id AS "sessionId",
      outerbox_id AS "outerBoxId",
      innerbox_id AS "innerBoxId",
      sku,
      serial_number AS "serialNumber",
      packed_by AS "packedBy",
      created_at AS "createdAt"
    FROM inbound_items
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT $${i};
  `;

  const result = await pool.query(q, values);
  res.json(result.rows);
});

// Validate SKU for current session (no serial needed)
app.post("/api/inbounds/sessions/:id/validate-sku", async (req, res) => {
  const id = toInt(req.params.id, 0);
  const packedBy = toText(req.body?.packedBy);
  const sku = toUpperText(req.body?.sku);

  if (!id) return res.status(400).json({ error: "Invalid session id." });
  if (!packedBy) return res.status(400).json({ error: "packedBy required." });
  if (!sku) return res.status(400).json({ error: "sku required." });

  const s = await pool.query(`SELECT * FROM inbound_sessions WHERE id = $1`, [id]);
  if (!s.rows.length) return res.status(404).json({ error: "Session not found." });

  const session = s.rows[0];
  if (session.status !== "IN_PROGRESS") return res.status(409).json({ error: "Session is not IN_PROGRESS." });
  if (toText(session.locked_by) !== packedBy) return res.status(403).json({ error: "Locked by another user." });

  // If lock exists, enforce it
  if (session.locked_sku && toUpperText(session.locked_sku) !== sku) {
    return res.status(409).json({
      error: `SKU mismatch. Locked SKU is ${session.locked_sku}. You scanned ${sku}`,
      lockedSku: toUpperText(session.locked_sku),
    });
  }

  // If no lock yet, allow SKU (do NOT lock here; keep lock on first item insert)
  return res.json({ ok: true, lockedSku: toUpperText(session.locked_sku || "") });
});


// DELETE by serial (optional)
app.delete("/api/inbounds/:serialNumber", async (req, res) => {
  const serialNumber = toUpperText(req.params.serialNumber);
  const result = await pool.query(
    "DELETE FROM inbound_items WHERE serial_number = $1",
    [serialNumber]
  );
  res.json({ deleted: result.rowCount });
});

// ----------------------------------------------------
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`✅ API running: http://localhost:${port}`));

app.post("/api/inbounds/sessions/:id/reset", async (req, res) => {
  const id = Number(req.params.id);
  const packedBy = String(req.body?.packedBy || "").trim();

  if (!id) return res.status(400).json({ error: "Invalid session id" });
  if (!packedBy) return res.status(400).json({ error: "packedBy required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock session row
    const s = await client.query(
      `SELECT * FROM inbound_sessions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!s.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Session not found" });
    }

    const session = s.rows[0];
    if (session.locked_by !== packedBy) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Locked by another user" });
    }
    if (session.status !== "IN_PROGRESS") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cannot reset a non-IN_PROGRESS session" });
    }

    // ✅ delete all scanned items for this session
    const del = await client.query(
      `DELETE FROM inbound_items WHERE session_id = $1`,
      [id]
    );

    // ✅ abandon the session (so it won’t resume)
    await client.query(
  `UPDATE inbound_sessions
   SET status = 'ABANDONED',
       last_seen = now(),
       locked_sku = NULL
   WHERE id = $1`,
  [id]
);


    await client.query("COMMIT");
    res.json({ ok: true, deletedItems: del.rowCount });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Server error", details: e.message });
  } finally {
    client.release();
  }
});
