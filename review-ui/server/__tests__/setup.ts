// NOTE: This project requires the following packages to run tests:
//   npm install -D vitest supertest @types/supertest
// They are not yet listed in package.json devDependencies.

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';

// ── In-memory DB factory ──────────────────────────────────────────────────────

export function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

// ── Seed standard test data ───────────────────────────────────────────────────

export function seedTestData(db: InstanceType<typeof Database>) {
  // Plants
  db.prepare(`INSERT INTO plants (id, common_name, category) VALUES (?, ?, ?)`).run('mango', 'Mango', 'fruit');
  db.prepare(`INSERT INTO plants (id, common_name, category) VALUES (?, ?, ?)`).run('fig', 'Fig', 'fruit');
  db.prepare(`INSERT INTO plants (id, common_name, category) VALUES (?, ?, ?)`).run('avocado', 'Avocado', 'fruit');

  // Users
  const r1 = db.prepare(
    `INSERT INTO users (email, first_name, last_name, role) VALUES (?, ?, ?, ?)`,
  ).run('reviewer1@test.com', 'Alice', 'Smith', 'reviewer');

  const r2 = db.prepare(
    `INSERT INTO users (email, first_name, last_name, role) VALUES (?, ?, ?, ?)`,
  ).run('reviewer2@test.com', 'Bob', 'Jones', 'reviewer');

  const r3 = db.prepare(
    `INSERT INTO users (email, first_name, last_name, role) VALUES (?, ?, ?, ?)`,
  ).run('reviewer3@test.com', 'Carol', 'Lee', 'reviewer');

  const admin = db.prepare(
    `INSERT INTO users (email, first_name, last_name, role) VALUES (?, ?, ?, ?)`,
  ).run('admin@test.com', 'Admin', 'User', 'admin');

  // Swipe queue items
  for (let i = 0; i < 10; i++) {
    db.prepare(
      `INSERT INTO review_queue (image_path, queue, status, suggested_plant_id, sort_key)
       VALUES (?, 'swipe', 'pending', 'mango', ?)`,
    ).run(`images/swipe/img${i}.jpg`, `000001:mango:1:images/swipe/img${i}.jpg`);
  }

  // Classify queue items
  for (let i = 0; i < 5; i++) {
    db.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key)
       VALUES (?, 'classify', 'pending', ?)`,
    ).run(`images/classify/img${i}.jpg`, `classify:dir:images/classify/img${i}.jpg`);
  }

  return {
    reviewer1Id: Number(r1.lastInsertRowid),
    reviewer2Id: Number(r2.lastInsertRowid),
    reviewer3Id: Number(r3.lastInsertRowid),
    adminId: Number(admin.lastInsertRowid),
  };
}

// ── Session helper ────────────────────────────────────────────────────────────
// Inserts a session row directly into the DB and returns the raw session ID.
// In route tests, combine with a cookie-signing approach (see auth.test.ts).

export function insertSession(
  db: InstanceType<typeof Database>,
  userId: number,
  sessionId: string,
): void {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(
    sessionId,
    userId,
    expiresAt,
  );
}
