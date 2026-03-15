// NOTE: Requires: npm install -D vitest supertest @types/supertest
// Run with: npx vitest run server/__tests__/auth.test.ts

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';
import { insertSession } from './setup.js';

// ── Required env vars — must be set before any import that loads config.ts ───
process.env.DB_PATH = ':memory:';
process.env.IMAGE_MOUNT_PATH = '/tmp/test-images';
process.env.APP_URL = 'http://localhost:3001';
process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.NODE_ENV = 'test';

// ── Module-level in-memory DB (proxy target) ─────────────────────────────────
let testDb: InstanceType<typeof Database>;

// Mock db singleton — proxy reads from testDb at call time so beforeEach can
// swap in a fresh instance between tests.
vi.mock('../lib/db.js', () => ({
  default: new Proxy({} as InstanceType<typeof Database>, {
    get(_target, prop) {
      return (testDb as any)[prop as string];
    },
  }),
}));

// Mock email service to avoid SMTP errors
vi.mock('../services/email.js', () => ({
  sendMagicLink: vi.fn().mockResolvedValue(undefined),
  sendInactivityReminder: vi.fn().mockResolvedValue(undefined),
  sendDailySummary: vi.fn().mockResolvedValue(undefined),
}));

// Mock scheduler so cron jobs don't start
vi.mock('../lib/scheduler.js', () => ({
  startScheduler: vi.fn(),
}));

// Mock scripts/import.ts to prevent auto-execution of runImport() at bottom of file
vi.mock('../scripts/import.js', () => ({
  importProgress: { status: 'idle', step: '', progress: 0, total: 0, message: '' },
  runImport: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic import AFTER mocks are set up
const { default: app } = await import('../index.js');
const request = (await import('supertest')).default;

// ── Cookie signing helper ─────────────────────────────────────────────────────
// Express cookie-parser signs cookies as "s:<value>.<hmac>".
// We use the admin/login endpoint to obtain a real signed cookie for auth tests.

async function getAdminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'admin@test.com', password: 'testpass123' });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('No set-cookie header returned from admin login');
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Auth API', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.exec(SCHEMA_SQL);
  });

  // ── Registration ────────────────────────────────────────────────────────────

  describe('POST /api/auth/register', () => {
    it('creates a new user and returns a success message', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'newuser@example.com', first_name: 'New', last_name: 'User' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/check your email/i);
    });

    it('returns 409 for a duplicate email', async () => {
      testDb
        .prepare(`INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`)
        .run('dupe@test.com', 'A', 'B');
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dupe@test.com', first_name: 'A', last_name: 'B' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'nolast@test.com', first_name: 'No' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', first_name: 'Bad', last_name: 'Email' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid email/i);
    });
  });

  // ── Login (magic link) ──────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('sends a magic link for a known email', async () => {
      testDb
        .prepare(`INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`)
        .run('known@test.com', 'Known', 'User');
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'known@test.com' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/check your email/i);
    });

    it('returns 404 for an unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@test.com' });
      expect(res.status).toBe(404);
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });
  });

  // ── Magic link verification ─────────────────────────────────────────────────

  describe('GET /api/auth/verify/:token', () => {
    it('redirects to /login?error=expired for an expired token', async () => {
      testDb
        .prepare(
          `INSERT INTO magic_links (email, token, expires_at, used)
           VALUES (?, ?, datetime('now', '-1 hour'), 0)`,
        )
        .run('u@test.com', 'expired-token-001');

      const res = await request(app).get('/api/auth/verify/expired-token-001');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=expired');
    });

    it('redirects to /login?error=expired for an already-used token', async () => {
      testDb
        .prepare(
          `INSERT INTO magic_links (email, token, expires_at, used)
           VALUES (?, ?, datetime('now', '+15 minutes'), 1)`,
        )
        .run('u@test.com', 'used-token-001');

      const res = await request(app).get('/api/auth/verify/used-token-001');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=expired');
    });

    it('redirects to /login?error=expired for an unknown token', async () => {
      const res = await request(app).get('/api/auth/verify/completely-unknown-token');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=expired');
    });

    it('redirects to /swipe and sets session cookie for a valid token', async () => {
      // Seed user and valid magic link
      const userResult = testDb
        .prepare(`INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`)
        .run('magicuser@test.com', 'Magic', 'User');
      testDb
        .prepare(
          `INSERT INTO magic_links (email, token, expires_at, used)
           VALUES (?, ?, datetime('now', '+15 minutes'), 0)`,
        )
        .run('magicuser@test.com', 'valid-magic-token-001');

      const res = await request(app).get('/api/auth/verify/valid-magic-token-001');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/swipe');
      // Should set a signed session cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(cookieStr).toMatch(/session_id/);
    });
  });

  // ── GET /api/auth/me ────────────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session cookie', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the authenticated user with a valid session', async () => {
      // Use admin login to get a real signed cookie
      const cookie = await getAdminCookie();
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.role).toBe('admin');
    });
  });

  // ── Admin password login ────────────────────────────────────────────────────

  describe('POST /api/auth/admin/login', () => {
    it('returns 200 with admin user for correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'admin@test.com', password: 'testpass123' });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
      expect(res.body.user.email).toBe('admin@test.com');
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'admin@test.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid credentials/i);
    });

    it('returns 401 for wrong email', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'notadmin@test.com', password: 'testpass123' });
      expect(res.status).toBe(401);
    });

    it('returns 400 when credentials are missing', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'admin@test.com' });
      expect(res.status).toBe(400);
    });

    it('sets a signed session cookie on successful login', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ email: 'admin@test.com', password: 'testpass123' });
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies[0] : cookies;
      expect(cookieStr).toMatch(/session_id/);
    });
  });

  // ── Logout ──────────────────────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('returns 401 without a session', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(401);
    });

    it('destroys the session and returns success', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Subsequent /me call with the same cookie should now return 401
      const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(meRes.status).toBe(401);
    });
  });
});
