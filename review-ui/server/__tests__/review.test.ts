// NOTE: Requires: npm install -D vitest supertest @types/supertest
// Run with: npx vitest run server/__tests__/review.test.ts

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';

// ── Required env vars ─────────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
process.env.IMAGE_MOUNT_PATH = '/tmp/test-images';
process.env.APP_URL = 'http://localhost:3001';
process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.NODE_ENV = 'test';

// ── DB proxy ──────────────────────────────────────────────────────────────────
let testDb: InstanceType<typeof Database>;

vi.mock('../lib/db.js', () => ({
  default: new Proxy({} as InstanceType<typeof Database>, {
    get(_target, prop) {
      return (testDb as any)[prop as string];
    },
  }),
}));

vi.mock('../services/email.js', () => ({
  sendMagicLink: vi.fn().mockResolvedValue(undefined),
  sendInactivityReminder: vi.fn().mockResolvedValue(undefined),
  sendDailySummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/scheduler.js', () => ({
  startScheduler: vi.fn(),
}));

vi.mock('../scripts/import.js', () => ({
  importProgress: { status: 'idle', step: '', progress: 0, total: 0, message: '' },
  runImport: vi.fn().mockResolvedValue(undefined),
}));

const { default: app } = await import('../index.js');
const request = (await import('supertest')).default;

// ── Session helpers ───────────────────────────────────────────────────────────

/** Login as admin and return the Set-Cookie header value. */
async function getAdminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'admin@test.com', password: 'testpass123' });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

/**
 * Register a reviewer, grab the magic link token from the DB, verify it,
 * and return the resulting signed session cookie.
 */
async function getReviewerCookie(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  // Register the reviewer
  await request(app)
    .post('/api/auth/register')
    .send({ email, first_name: firstName, last_name: lastName });

  // Grab the token directly from the in-memory DB
  const link = testDb
    .prepare(`SELECT token FROM magic_links WHERE email = ? ORDER BY id DESC LIMIT 1`)
    .get(email) as { token: string } | undefined;

  if (!link) throw new Error(`No magic link found for ${email}`);

  // Verify it to get a session cookie
  const verifyRes = await request(app).get(`/api/auth/verify/${link.token}`);
  const setCookie = verifyRes.headers['set-cookie'];
  if (!setCookie) throw new Error('No cookie after verify');
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function seedPlants() {
  testDb.prepare(`INSERT OR IGNORE INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
  testDb.prepare(`INSERT OR IGNORE INTO plants (id, common_name) VALUES (?, ?)`).run('fig', 'Fig');
}

function seedSwipeItem(imagePath: string, suggestedPlant = 'mango') {
  testDb.prepare(
    `INSERT OR IGNORE INTO review_queue (image_path, queue, status, suggested_plant_id, sort_key)
     VALUES (?, 'swipe', 'in_progress', ?, ?)`,
  ).run(imagePath, suggestedPlant, `000001:${suggestedPlant}:1:${imagePath}`);
}

function seedClassifyItem(imagePath: string) {
  testDb.prepare(
    `INSERT OR IGNORE INTO review_queue (image_path, queue, status, sort_key)
     VALUES (?, 'classify', 'in_progress', ?)`,
  ).run(imagePath, `classify:dir:${imagePath}`);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Review API', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.exec(SCHEMA_SQL);
    seedPlants();
  });

  // ── Authentication guard ────────────────────────────────────────────────────

  describe('Authentication guard', () => {
    it('POST /api/review/confirm returns 401 without a session', async () => {
      const res = await request(app)
        .post('/api/review/confirm')
        .send({ image_path: 'some.jpg' });
      expect(res.status).toBe(401);
    });

    it('POST /api/review/reject returns 401 without a session', async () => {
      const res = await request(app)
        .post('/api/review/reject')
        .send({ image_path: 'some.jpg' });
      expect(res.status).toBe(401);
    });

    it('POST /api/review/idk returns 401 without a session', async () => {
      const res = await request(app)
        .post('/api/review/idk')
        .send({ image_path: 'some.jpg' });
      expect(res.status).toBe(401);
    });

    it('POST /api/review/discard returns 401 without a session', async () => {
      const res = await request(app)
        .post('/api/review/discard')
        .send({ image_path: 'some.jpg', category: 'event' });
      expect(res.status).toBe(401);
    });

    it('POST /api/review/classify returns 401 without a session', async () => {
      const res = await request(app)
        .post('/api/review/classify')
        .send({ image_path: 'some.jpg', plant_id: 'mango' });
      expect(res.status).toBe(401);
    });
  });

  // ── Confirm ─────────────────────────────────────────────────────────────────

  describe('POST /api/review/confirm', () => {
    it('marks the item completed and returns success', async () => {
      const cookie = await getReviewerCookie('reviewer@test.com', 'Rev', 'One');
      seedSwipeItem('confirm_test.jpg');

      const res = await request(app)
        .post('/api/review/confirm')
        .set('Cookie', cookie)
        .send({ image_path: 'confirm_test.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = testDb
        .prepare(`SELECT status FROM review_queue WHERE image_path = ?`)
        .get('confirm_test.jpg') as any;
      expect(row.status).toBe('completed');
    });

    it('returns 400 when image_path is missing', async () => {
      const cookie = await getReviewerCookie('reviewer2@test.com', 'Rev', 'Two');
      const res = await request(app)
        .post('/api/review/confirm')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for a non-existent image_path', async () => {
      const cookie = await getReviewerCookie('reviewer3@test.com', 'Rev', 'Three');
      const res = await request(app)
        .post('/api/review/confirm')
        .set('Cookie', cookie)
        .send({ image_path: 'does_not_exist.jpg' });
      expect(res.status).toBe(404);
    });
  });

  // ── Reject ──────────────────────────────────────────────────────────────────

  describe('POST /api/review/reject', () => {
    it('marks the item completed and adds it to the classify queue', async () => {
      const cookie = await getReviewerCookie('rej@test.com', 'Rej', 'One');
      seedSwipeItem('reject_test.jpg');

      const res = await request(app)
        .post('/api/review/reject')
        .set('Cookie', cookie)
        .send({ image_path: 'reject_test.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Item is moved in-place to classify queue (image_path is UNIQUE in review_queue)
      const classifyRow = testDb
        .prepare(`SELECT queue, status FROM review_queue WHERE image_path = ?`)
        .get('reject_test.jpg') as any;
      expect(classifyRow).not.toBeNull();
      expect(classifyRow.queue).toBe('classify');
      expect(classifyRow.status).toBe('pending');
    });
  });

  // ── IDK ─────────────────────────────────────────────────────────────────────

  describe('POST /api/review/idk', () => {
    it('first vote increments idk_count to 1', async () => {
      const cookie = await getReviewerCookie('idk1@test.com', 'IDK', 'One');
      seedSwipeItem('idk_test.jpg');

      const res = await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie)
        .send({ image_path: 'idk_test.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.idk_count).toBe(1);
      expect(res.body.escalated).toBe(false);
    });

    it('same user voting twice keeps idk_count at 1', async () => {
      const cookie = await getReviewerCookie('idk2@test.com', 'IDK', 'Two');
      seedSwipeItem('idk_dedup.jpg');

      await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie)
        .send({ image_path: 'idk_dedup.jpg' });

      const res = await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie)
        .send({ image_path: 'idk_dedup.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.idk_count).toBe(1);
    });

    it('3 unique users escalates the item to classify queue with flagged_idk status', async () => {
      seedSwipeItem('idk_escalate.jpg');

      // Three separate reviewers vote IDK
      const cookie1 = await getReviewerCookie('escidk1@test.com', 'Esc', 'One');
      const cookie2 = await getReviewerCookie('escidk2@test.com', 'Esc', 'Two');
      const cookie3 = await getReviewerCookie('escidk3@test.com', 'Esc', 'Three');

      await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie1)
        .send({ image_path: 'idk_escalate.jpg' });

      await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie2)
        .send({ image_path: 'idk_escalate.jpg' });

      const res = await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie3)
        .send({ image_path: 'idk_escalate.jpg' });

      expect(res.status).toBe(200);
      expect(res.body.idk_count).toBe(3);
      expect(res.body.escalated).toBe(true);

      const row = testDb
        .prepare(`SELECT status, queue FROM review_queue WHERE image_path = ?`)
        .get('idk_escalate.jpg') as any;
      expect(row.status).toBe('flagged_idk');
      expect(row.queue).toBe('classify');
    });

    it('returns 404 for a non-existent image_path', async () => {
      const cookie = await getReviewerCookie('idk404@test.com', 'IDK', 'Missing');
      const res = await request(app)
        .post('/api/review/idk')
        .set('Cookie', cookie)
        .send({ image_path: 'does_not_exist.jpg' });
      expect(res.status).toBe(404);
    });
  });

  // ── Discard ─────────────────────────────────────────────────────────────────

  describe('POST /api/review/discard', () => {
    it('marks the item completed with the given category', async () => {
      const cookie = await getReviewerCookie('discard@test.com', 'Disc', 'One');
      seedSwipeItem('discard_test.jpg');

      const res = await request(app)
        .post('/api/review/discard')
        .set('Cookie', cookie)
        .send({ image_path: 'discard_test.jpg', category: 'event', notes: 'A festival photo' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dec = testDb
        .prepare(`SELECT action, discard_category, notes FROM review_decisions WHERE image_path = ?`)
        .get('discard_test.jpg') as any;
      expect(dec.action).toBe('discard');
      expect(dec.discard_category).toBe('event');
      expect(dec.notes).toBe('A festival photo');
    });

    it('returns 400 for an invalid discard category', async () => {
      const cookie = await getAdminCookie();
      seedSwipeItem('bad_category.jpg');

      const res = await request(app)
        .post('/api/review/discard')
        .set('Cookie', cookie)
        .send({ image_path: 'bad_category.jpg', category: 'NOT_VALID' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/category must be one of/i);
    });

    it('accepts all valid discard categories', async () => {
      const cookie = await getAdminCookie();
      const validCategories = ['event', 'graphics', 'travel', 'duplicate', 'poor_quality'];

      for (const category of validCategories) {
        const imagePath = `discard_valid_${category}.jpg`;
        seedSwipeItem(imagePath);
        const res = await request(app)
          .post('/api/review/discard')
          .set('Cookie', cookie)
          .send({ image_path: imagePath, category });
        expect(res.status).toBe(200);
      }
    });

    it('returns 400 when image_path or category is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/review/discard')
        .set('Cookie', cookie)
        .send({ image_path: 'nocat.jpg' });
      expect(res.status).toBe(400);
    });
  });

  // ── Classify ─────────────────────────────────────────────────────────────────

  describe('POST /api/review/classify', () => {
    it('classifies an item to a known plant', async () => {
      const cookie = await getReviewerCookie('classify@test.com', 'Class', 'One');
      seedClassifyItem('classify_test.jpg');

      const res = await request(app)
        .post('/api/review/classify')
        .set('Cookie', cookie)
        .send({ image_path: 'classify_test.jpg', plant_id: 'mango' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = testDb
        .prepare(`SELECT current_plant_id, status FROM review_queue WHERE image_path = ?`)
        .get('classify_test.jpg') as any;
      expect(row.current_plant_id).toBe('mango');
      expect(row.status).toBe('completed');
    });

    it('returns 404 for an unknown plant_id', async () => {
      const cookie = await getAdminCookie();
      seedClassifyItem('classify_badplant.jpg');

      const res = await request(app)
        .post('/api/review/classify')
        .set('Cookie', cookie)
        .send({ image_path: 'classify_badplant.jpg', plant_id: 'not-a-real-plant' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/plant not found/i);
    });

    it('returns 400 when plant_id is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/review/classify')
        .set('Cookie', cookie)
        .send({ image_path: 'img.jpg' });
      expect(res.status).toBe(400);
    });

    it('accepts a new_plant_request generated_id as plant_id', async () => {
      const cookie = await getAdminCookie();
      seedClassifyItem('classify_newplant.jpg');

      // Seed a new plant request
      const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
      testDb
        .prepare(
          `INSERT INTO new_plant_requests
           (common_name, category, requested_by, generated_id, status)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('Mystery Fruit', 'fruit', adminUser.id, 'new-mystery-fruit-9999', 'pending');

      const res = await request(app)
        .post('/api/review/classify')
        .set('Cookie', cookie)
        .send({ image_path: 'classify_newplant.jpg', plant_id: 'new-mystery-fruit-9999' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
