// NOTE: Requires: npm install -D vitest supertest @types/supertest
// Run with: npx vitest run server/__tests__/admin.test.ts

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

async function getAdminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'admin@test.com', password: 'testpass123' });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

async function getReviewerCookie(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ email, first_name: firstName, last_name: lastName });

  const link = testDb
    .prepare(`SELECT token FROM magic_links WHERE email = ? ORDER BY id DESC LIMIT 1`)
    .get(email) as { token: string } | undefined;

  if (!link) throw new Error(`No magic link found for ${email}`);

  const verifyRes = await request(app).get(`/api/auth/verify/${link.token}`);
  const setCookie = verifyRes.headers['set-cookie'];
  if (!setCookie) throw new Error('No cookie after verify');
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

function seedFullData() {
  // Plants
  testDb.prepare(`INSERT OR IGNORE INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
  testDb.prepare(`INSERT OR IGNORE INTO plants (id, common_name) VALUES (?, ?)`).run('fig', 'Fig');

  // Queue items
  testDb.prepare(
    `INSERT OR IGNORE INTO review_queue (image_path, queue, status, sort_key)
     VALUES ('img1.jpg', 'swipe', 'completed', 'aaa')`,
  ).run();
  testDb.prepare(
    `INSERT OR IGNORE INTO review_queue (image_path, queue, status, sort_key)
     VALUES ('img2.jpg', 'swipe', 'pending', 'bbb')`,
  ).run();
  testDb.prepare(
    `INSERT OR IGNORE INTO review_queue (image_path, queue, status, sort_key, idk_count)
     VALUES ('idk_img.jpg', 'classify', 'flagged_idk', 'ccc', 3)`,
  ).run();
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Admin API', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.exec(SCHEMA_SQL);
    seedFullData();
  });

  // ── Access control ──────────────────────────────────────────────────────────

  describe('Access control', () => {
    it('GET /api/admin/stats returns 401 without any session', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/stats returns 403 for a reviewer session', async () => {
      const reviewerCookie = await getReviewerCookie(
        'reviewer@test.com',
        'Review',
        'User',
      );
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin access required/i);
    });

    it('GET /api/admin/stats returns 200 for an admin session', async () => {
      const adminCookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.stats).toBeDefined();
    });

    it('GET /api/admin/log returns 403 for a reviewer', async () => {
      const reviewerCookie = await getReviewerCookie(
        'reviewer2@test.com',
        'Rev',
        'Two',
      );
      const res = await request(app)
        .get('/api/admin/log')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
    });

    it('GET /api/admin/idk-flagged returns 403 for a reviewer', async () => {
      const reviewerCookie = await getReviewerCookie(
        'reviewer3@test.com',
        'Rev',
        'Three',
      );
      const res = await request(app)
        .get('/api/admin/idk-flagged')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/stats ────────────────────────────────────────────────────

  describe('GET /api/admin/stats', () => {
    it('returns stats with expected shape', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);

      const { stats } = res.body;
      expect(typeof stats.swipe_pending).toBe('number');
      expect(typeof stats.swipe_completed).toBe('number');
      expect(typeof stats.classify_pending).toBe('number');
      expect(typeof stats.total_users).toBe('number');
      expect(typeof stats.idk_flagged_count).toBe('number');
    });

    it('reflects idk_flagged_count from flagged items in DB', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', cookie);
      // We seeded one flagged_idk item
      expect(res.body.stats.idk_flagged_count).toBeGreaterThanOrEqual(1);
    });

    it('reflects total_users count', async () => {
      // Admin user is created by the admin login; seed a reviewer too
      await getReviewerCookie('countme@test.com', 'Count', 'Me');
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', cookie);
      expect(res.body.stats.total_users).toBeGreaterThanOrEqual(2);
    });
  });

  // ── GET /api/admin/log ──────────────────────────────────────────────────────

  describe('GET /api/admin/log', () => {
    beforeEach(async () => {
      // Seed a decision so the log has something to return
      const adminCookie = await getAdminCookie();
      const adminUser = testDb
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .get('admin@test.com') as any;

      testDb.prepare(
        `INSERT OR IGNORE INTO review_decisions (image_path, user_id, action)
         VALUES ('img1.jpg', ?, 'confirm')`,
      ).run(adminUser.id);
    });

    it('returns paginated results with rows and total fields', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/log')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rows)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('respects page and limit query parameters', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/log?page=1&limit=5')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(5);
      expect(res.body.rows.length).toBeLessThanOrEqual(5);
    });

    it('filters by action query parameter', async () => {
      const cookie = await getAdminCookie();
      // Seed a reject decision
      const adminUser = testDb
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .get('admin@test.com') as any;
      testDb.prepare(
        `INSERT OR IGNORE INTO review_decisions (image_path, user_id, action)
         VALUES ('img2.jpg', ?, 'reject')`,
      ).run(adminUser.id);

      const res = await request(app)
        .get('/api/admin/log?action=confirm')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      // All returned rows should have action = 'confirm'
      for (const row of res.body.rows) {
        expect(row.action).toBe('confirm');
      }
    });

    it('returns empty rows when no decisions exist matching filter', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/log?action=idk')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.rows).toHaveLength(0);
    });

    it('each row contains expected fields', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/log')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      if (res.body.rows.length > 0) {
        const row = res.body.rows[0];
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('image_path');
        expect(row).toHaveProperty('action');
        expect(row).toHaveProperty('reviewer_name');
        expect(row).toHaveProperty('decided_at');
      }
    });
  });

  // ── GET /api/admin/idk-flagged ──────────────────────────────────────────────

  describe('GET /api/admin/idk-flagged', () => {
    it('returns only flagged_idk items', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/idk-flagged')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.images)).toBe(true);
      // All returned items should have flagged_idk status or idk_count >= 3
      for (const item of res.body.images) {
        const isFlagged = item.status === 'flagged_idk' || item.idk_count >= 3;
        expect(isFlagged).toBe(true);
      }
    });

    it('includes the seeded flagged item', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/idk-flagged')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const paths = res.body.images.map((i: any) => i.image_path);
      expect(paths).toContain('idk_img.jpg');
    });

    it('returns empty array when no flagged items exist', async () => {
      // Remove the seeded flagged item
      testDb.prepare(`DELETE FROM review_queue WHERE status = 'flagged_idk'`).run();
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/idk-flagged')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.images).toHaveLength(0);
    });
  });

  // ── GET /api/admin/leaderboard ──────────────────────────────────────────────

  describe('GET /api/admin/leaderboard', () => {
    it('returns leaderboard with full names for admin', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/leaderboard')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.leaderboard)).toBe(true);
    });

    it('returns 403 for a reviewer', async () => {
      const reviewerCookie = await getReviewerCookie(
        'lbreview@test.com',
        'LB',
        'Rev',
      );
      const res = await request(app)
        .get('/api/admin/leaderboard')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/users ────────────────────────────────────────────────────

  describe('GET /api/admin/users', () => {
    it('returns list of all users for admin', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it('returns 403 for a reviewer', async () => {
      const reviewerCookie = await getReviewerCookie(
        'usersrev@test.com',
        'Users',
        'Rev',
      );
      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
    });
  });

  // ── GET /api/admin/import-status ────────────────────────────────────────────

  describe('GET /api/admin/import-status', () => {
    it('returns import status object for admin', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/admin/import-status')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.counts).toBeDefined();
    });

    it('returns 403 for a reviewer', async () => {
      const reviewerCookie = await getReviewerCookie(
        'importrev@test.com',
        'Import',
        'Rev',
      );
      const res = await request(app)
        .get('/api/admin/import-status')
        .set('Cookie', reviewerCookie);
      expect(res.status).toBe(403);
    });
  });
});
