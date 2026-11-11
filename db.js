"use strict";

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

function defaultDbPath() {
  const env = (process.env.SQLITE_PATH || "").trim();
  if (env) return path.resolve(env);
  return path.join(__dirname, "data", "ledger.db");
}

function rowToObject(columns, values) {
  const obj = {};
  columns.forEach((c, i) => {
    obj[c] = values[i];
  });
  return obj;
}

class Database {
  constructor(filePath) {
    this.path = filePath || defaultDbPath();
    this.db = null;
  }

  async init() {
    const SQL = await initSqlJs();
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    if (fs.existsSync(this.path)) {
      const buf = fs.readFileSync(this.path);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('credit', 'debit')),
        amount REAL NOT NULL CHECK(amount > 0),
        note TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id INTEGER PRIMARY KEY,
        selected_plan_id INTEGER,
        FOREIGN KEY(selected_plan_id) REFERENCES plans(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
      CREATE INDEX IF NOT EXISTS idx_tx_plan ON transactions(plan_id);
      CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
    `);
    this.persist();
    return this;
  }

  persist() {
    const data = this.db.export();
    fs.writeFileSync(this.path, Buffer.from(data));
  }

  now() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const cols = stmt.getColumnNames();
      const values = stmt.get();
      stmt.free();
      return rowToObject(cols, values);
    }
    stmt.free();
    return null;
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const cols = stmt.getColumnNames();
    const rows = [];
    while (stmt.step()) {
      rows.push(rowToObject(cols, stmt.get()));
    }
    stmt.free();
    return rows;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    this.persist();
  }

  getSelectedPlanId(userId) {
    const row = this.get(
      "SELECT selected_plan_id FROM user_prefs WHERE user_id = ?",
      [userId]
    );
    return row && row.selected_plan_id != null
      ? Number(row.selected_plan_id)
      : null;
  }

  setSelectedPlan(userId, planId) {
    this.run(
      `INSERT INTO user_prefs(user_id, selected_plan_id) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET selected_plan_id = excluded.selected_plan_id`,
      [userId, planId]
    );
  }

  createPlan(userId, name) {
    name = String(name).trim();
    this.run(
      "INSERT INTO plans(user_id, name, created_at) VALUES (?, ?, ?)",
      [userId, name, this.now()]
    );
    const row = this.get("SELECT last_insert_rowid() AS id");
    const planId = Number(row.id);
    this.setSelectedPlan(userId, planId);
    return this.getPlan(userId, planId);
  }

  listPlans(userId) {
    return this.all(
      "SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC, id DESC",
      [userId]
    ).map((r) => ({ ...r, id: Number(r.id), user_id: Number(r.user_id) }));
  }

  getPlan(userId, planId) {
    const row = this.get(
      "SELECT * FROM plans WHERE id = ? AND user_id = ?",
      [planId, userId]
    );
    if (!row) return null;
    return { ...row, id: Number(row.id), user_id: Number(row.user_id) };
  }

  deletePlan(userId, planId) {
    const before = this.getPlan(userId, planId);
    if (!before) return false;
    this.run("DELETE FROM transactions WHERE plan_id = ? AND user_id = ?", [
      planId,
      userId,
    ]);
    this.run("DELETE FROM plans WHERE id = ? AND user_id = ?", [
      planId,
      userId,
    ]);
    const sel = this.getSelectedPlanId(userId);
    if (sel === planId) this.setSelectedPlan(userId, null);
    return true;
  }

  addTransaction(userId, planId, kind, amount, note) {
    if (kind !== "credit" && kind !== "debit") {
      throw new Error("kind must be credit or debit");
    }
    if (!this.getPlan(userId, planId)) {
      throw new Error("plan not found");
    }
    this.run(
      `INSERT INTO transactions(plan_id, user_id, kind, amount, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [planId, userId, kind, amount, note || null, this.now()]
    );
    const idRow = this.get("SELECT last_insert_rowid() AS id");
    return this.getTransaction(userId, Number(idRow.id));
  }

  listTransactions(userId, planId, limit = 10) {
    return this.all(
      `SELECT * FROM transactions
       WHERE plan_id = ? AND user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [planId, userId, limit]
    ).map((r) => ({
      ...r,
      id: Number(r.id),
      plan_id: Number(r.plan_id),
      amount: Number(r.amount),
    }));
  }

  getTransaction(userId, txId) {
    const row = this.get(
      "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
      [txId, userId]
    );
    if (!row) return null;
    return {
      ...row,
      id: Number(row.id),
      plan_id: Number(row.plan_id),
      amount: Number(row.amount),
    };
  }

  deleteTransaction(userId, txId) {
    const before = this.getTransaction(userId, txId);
    if (!before) return false;
    this.run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [
      txId,
      userId,
    ]);
    return true;
  }

  planTotals(userId, planId) {
    if (!this.getPlan(userId, planId)) {
      throw new Error("plan not found");
    }
    const row = this.get(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'credit' THEN amount ELSE 0 END), 0) AS credit,
         COALESCE(SUM(CASE WHEN kind = 'debit' THEN amount ELSE 0 END), 0) AS debit
       FROM transactions
       WHERE plan_id = ? AND user_id = ?`,
      [planId, userId]
    );
    const credit = Number(row.credit);
    const debit = Number(row.debit);
    return { credit, debit, balance: credit - debit };
  }
}

module.exports = { Database, defaultDbPath };
