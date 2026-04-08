// Run with: npx vitest run server/__tests__/browse.test.ts

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';

// ── Required env vars — must be set before any import that loads config.ts ───
process.env.DB_PATH = ':memory:';
process.env.IMAGE_MOUNT_PATH = '/tmp/test-images';
process.env.APP_URL = 'http://localhost:3001';
process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.NOCODB_URL = 'https://nocodb.test.local';
process.env.NOCODB_API_KEY = 'test-nocodb-key';
process.env.NODE_ENV = 'test';

// ── Module-level in-memory DB (proxy target) ─────────────────────────────────
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

// ── Mock NocoDB client ───────────────────────────────────────────────────────
const mockNocodb = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  bulkUpdate: vi.fn(),
  delete: vi.fn(),
  getTableNames: vi.fn().mockReturnValue(['Plants', 'Varieties', 'Images', 'Documents', 'Recipes', 'OCR_Extractions', 'Nutritional_Info', 'Attachments']),
};

vi.mock('../lib/nocodb.js', () => ({
  nocodb: mockNocodb,
}));

// Mock readdirSync for hero image fallback
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    readdirSync: vi.fn().mockReturnValue(['hero.jpg', 'other.jpg']),
    default: {
      ...actual.default,
      mkdirSync: actual.mkdirSync ?? vi.fn(),
      readFileSync: actual.readFileSync ?? vi.fn(),
      readdirSync: vi.fn().mockReturnValue(['hero.jpg', 'other.jpg']),
    },
  };
});

// Dynamic import AFTER mocks are set up
const { default: app } = await import('../index.js');
const request = (await import('supertest')).default;

// ── Session helpers ──────────────────────────────────────────────────────────

async function getAdminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'admin@test.com', password: 'testpass123' });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('No set-cookie header returned from admin login');
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

// ── Default NocoDB mock responses ────────────────────────────────────────────

function defaultListResult(list: any[] = [], totalRows = 0) {
  return {
    list,
    pageInfo: {
      totalRows,
      page: 1,
      pageSize: 25,
      isFirstPage: true,
      isLastPage: true,
    },
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Browse API', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.exec(SCHEMA_SQL);
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authentication guard', () => {
    it('GET /api/browse returns 401 without a session', async () => {
      const res = await request(app).get('/api/browse');
      expect(res.status).toBe(401);
    });

    it('GET /api/browse/:id returns 401 without a session', async () => {
      const res = await request(app).get('/api/browse/mango');
      expect(res.status).toBe(401);
    });

    it('PATCH /api/browse/:id returns 401 without a session', async () => {
      const res = await request(app).patch('/api/browse/1').send({ Canonical_Name: 'Test' });
      expect(res.status).toBe(401);
    });

    it('POST /api/browse/create-plant returns 401 without a session', async () => {
      const res = await request(app).post('/api/browse/create-plant').send({ Canonical_Name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN-ONLY ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Admin-only access control', () => {
    it('PATCH /api/browse/:id returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-browse@test.com', 'Rev', 'Browse');
      const res = await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Test' });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/create-plant returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-create@test.com', 'Rev', 'Create');
      const res = await request(app)
        .post('/api/browse/create-plant')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Test Plant' });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/set-hero/:imageId returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-hero@test.com', 'Rev', 'Hero');
      const res = await request(app)
        .post('/api/browse/set-hero/1')
        .set('Cookie', cookie)
        .send({ plant_id: 'mango' });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/rotate-image/:id returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-rot@test.com', 'Rev', 'Rot');
      const res = await request(app)
        .post('/api/browse/rotate-image/1')
        .set('Cookie', cookie)
        .send({ rotation: 90 });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/exclude-image/:id returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-excl@test.com', 'Rev', 'Excl');
      const res = await request(app)
        .post('/api/browse/exclude-image/1')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/reassign-image/:id returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-reasn@test.com', 'Rev', 'Reasn');
      const res = await request(app)
        .post('/api/browse/reassign-image/1')
        .set('Cookie', cookie)
        .send({ plant_id: 'fig' });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/bulk-reassign-images returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-bulk@test.com', 'Rev', 'Bulk');
      const res = await request(app)
        .post('/api/browse/bulk-reassign-images')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2], plant_id: 'fig' });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/bulk-set-variety returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-bvar@test.com', 'Rev', 'BVar');
      const res = await request(app)
        .post('/api/browse/bulk-set-variety')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2], variety_id: 10 });
      expect(res.status).toBe(403);
    });

    it('POST /api/browse/set-image-variety/:id returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('rev-svar@test.com', 'Rev', 'SVar');
      const res = await request(app)
        .post('/api/browse/set-image-variety/1')
        .set('Cookie', cookie)
        .send({ variety_id: 10 });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET / — PLANT LIST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse', () => {
    it('returns plant list with pageInfo', async () => {
      const cookie = await getAdminCookie();
      const plants = [
        { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Category: 'fruit', Image_Count: 5 },
        { Id: 2, Id1: 'fig', Canonical_Name: 'Fig', Category: 'fruit', Image_Count: 3 },
      ];
      mockNocodb.list.mockResolvedValue(defaultListResult(plants, 2));

      const res = await request(app)
        .get('/api/browse')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plants).toHaveLength(2);
      expect(res.body.pageInfo).toBeDefined();
      expect(res.body.pageInfo.totalRows).toBe(2);
    });

    it('passes search parameter to NocoDB where clause', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?search=mango')
        .set('Cookie', cookie);

      // The first call should be one of the cross-table searches or the final Plants call
      // The last call should be the Plants list with the where clause
      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants' && c[1]?.where?.includes('mango'),
      );
      expect(plantCall).toBeDefined();
    });

    it('passes category filter to NocoDB', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?category=fruit')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall).toBeDefined();
      expect(plantCall![1].where).toContain('Category,eq,fruit');
    });

    it('handles sort parameter', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?sort=-name')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall![1].sort).toBe('-Canonical_Name');
    });

    it('handles sort=images parameter', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?sort=images')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall![1].sort).toBe('-Image_Count');
    });

    it('respects page and limit parameters', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?page=3&limit=10')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall![1].limit).toBe(10);
      expect(plantCall![1].offset).toBe(20); // (page 3 - 1) * 10
    });

    it('clamps limit to 200 max', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?limit=500')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall![1].limit).toBe(200);
    });

    it('clamps limit to 1 min', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse?limit=0')
        .set('Cookie', cookie);

      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall![1].limit).toBe(25); // 0 is falsy, falls through to default 25
    });

    it('enriches plants with hero_image from NocoDB Hero_Image_Path', async () => {
      const cookie = await getAdminCookie();
      const plants = [
        { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 5, Hero_Image_Path: 'mango/images/hero.jpg', Hero_Image_Rotation: 0 },
      ];
      mockNocodb.list.mockResolvedValue(defaultListResult(plants, 1));

      const res = await request(app)
        .get('/api/browse')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plants[0].hero_image).toBe('mango/images/hero.jpg');
    });

    it('cross-table search includes plant IDs from Documents, Recipes, OCR, Varieties', async () => {
      const cookie = await getAdminCookie();

      // Setup cross-table search results to return plant IDs
      mockNocodb.list.mockImplementation(async (table: string, opts?: any) => {
        if (table === 'Documents') return defaultListResult([{ Plant_Ids: '["mango"]' }], 1);
        if (table === 'Recipes') return defaultListResult([{ Plant_Ids: '["fig"]' }], 1);
        if (table === 'OCR_Extractions') return defaultListResult([], 0);
        if (table === 'Varieties') return defaultListResult([{ Plant_Id: 'avocado' }], 1);
        if (table === 'Plants') return defaultListResult([], 0);
        return defaultListResult([], 0);
      });

      await request(app)
        .get('/api/browse?search=tropical')
        .set('Cookie', cookie);

      // The final Plants call should contain cross-table IDs in the where clause
      const plantCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Plants',
      );
      expect(plantCall).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /search — CROSS-TABLE SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse/search', () => {
    it('returns empty results for empty query', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/browse/search')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ plants: [], varieties: [], documents: [], recipes: [], ocr: [] });
    });

    it('returns results across all tables', async () => {
      const cookie = await getAdminCookie();
      const plantList = [{ Id: 1, Canonical_Name: 'Mango' }];
      const varietyList = [{ Id: 1, Variety_Name: 'Haden' }];
      const docList = [{ Id: 1, Title: 'Mango Guide' }];
      const recipeList = [{ Id: 1, Title: 'Mango Salsa' }];
      const ocrList = [{ Id: 1, Extracted_Text: 'Mango growing info' }];

      mockNocodb.list.mockImplementation(async (table: string) => {
        if (table === 'Plants') return defaultListResult(plantList, 1);
        if (table === 'Varieties') return defaultListResult(varietyList, 1);
        if (table === 'Documents') return defaultListResult(docList, 1);
        if (table === 'Recipes') return defaultListResult(recipeList, 1);
        if (table === 'OCR_Extractions') return defaultListResult(ocrList, 1);
        return defaultListResult([], 0);
      });

      const res = await request(app)
        .get('/api/browse/search?q=mango')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plants).toHaveLength(1);
      expect(res.body.varieties).toHaveLength(1);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.recipes).toHaveLength(1);
      expect(res.body.ocr).toHaveLength(1);
    });

    it('handles NocoDB errors gracefully (returns empty arrays)', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockRejectedValue(new Error('NocoDB down'));

      const res = await request(app)
        .get('/api/browse/search?q=mango')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      // All results should be empty due to .catch() handlers
      expect(res.body.plants).toEqual([]);
      expect(res.body.varieties).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /plants-search — AUTOCOMPLETE SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse/plants-search', () => {
    it('returns empty array for empty query', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .get('/api/browse/plants-search')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns matching plants', async () => {
      const cookie = await getAdminCookie();
      const plants = [
        { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Category: 'fruit' },
      ];
      mockNocodb.list.mockResolvedValue(defaultListResult(plants, 1));

      const res = await request(app)
        .get('/api/browse/plants-search?q=man')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].Canonical_Name).toBe('Mango');
    });

    it('limits to 15 results and requests specific fields', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse/plants-search?q=test')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Plants', expect.objectContaining({
        limit: 15,
        fields: ['Id', 'Id1', 'Canonical_Name', 'Category'],
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /:id — PLANT DETAIL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse/:id', () => {
    it('fetches plant by numeric NocoDB row ID', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 5 };
      mockNocodb.get.mockResolvedValue(plant);
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      const res = await request(app)
        .get('/api/browse/1')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plant.Canonical_Name).toBe('Mango');
      expect(mockNocodb.get).toHaveBeenCalledWith('Plants', '1');
    });

    it('fetches plant by text slug (Id1)', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 3 };
      mockNocodb.list.mockImplementation(async (table: string, opts?: any) => {
        if (table === 'Plants' && opts?.where?.includes('Id1,eq,mango')) {
          return defaultListResult([plant], 1);
        }
        return defaultListResult([], 0);
      });

      const res = await request(app)
        .get('/api/browse/mango')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plant.Canonical_Name).toBe('Mango');
    });

    it('returns 404 when plant is not found by numeric ID', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.get.mockRejectedValue(new Error('Not found'));

      const res = await request(app)
        .get('/api/browse/999')
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/plant not found/i);
    });

    it('returns 404 when plant is not found by slug', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      const res = await request(app)
        .get('/api/browse/nonexistent-plant')
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/plant not found/i);
    });

    it('returns related data (varieties, nutritional, images, documents, etc.)', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 3 };
      const variety = { Id: 1, Variety_Name: 'Haden', Plant_Id: 'mango' };
      const image = { Id: 10, File_Path: 'plants/mango/images/img1.jpg', Plant_Id: 'mango' };
      const doc = { Id: 5, Title: 'Mango Guide', Plant_Ids: '["mango"]' };
      const recipe = { Id: 3, Title: 'Mango Salsa', Plant_Ids: '["mango"]' };

      mockNocodb.get.mockResolvedValue(plant);
      mockNocodb.list.mockImplementation(async (table: string) => {
        if (table === 'Varieties') return defaultListResult([variety], 1);
        if (table === 'Nutritional_Info') return defaultListResult([], 0);
        if (table === 'Images') return { list: [image], pageInfo: { totalRows: 1, isLastPage: true } };
        if (table === 'Documents') return defaultListResult([doc], 1);
        if (table === 'Attachments') return defaultListResult([], 0);
        if (table === 'Recipes') return defaultListResult([recipe], 1);
        if (table === 'OCR_Extractions') return defaultListResult([], 0);
        return defaultListResult([], 0);
      });

      const res = await request(app)
        .get('/api/browse/1')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.varieties).toHaveLength(1);
      expect(res.body.varieties[0].Variety_Name).toBe('Haden');
      expect(res.body.images.list).toHaveLength(1);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.recipes).toHaveLength(1);
      expect(res.body.notes).toBeDefined();
      expect(Array.isArray(res.body.notes)).toBe(true);
    });

    it('includes staff notes from local SQLite', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 0 };
      mockNocodb.get.mockResolvedValue(plant);
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      // Seed a staff note
      const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
      testDb.prepare(
        `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
      ).run('mango', adminUser.id, 'Great fruit for testing');

      const res = await request(app)
        .get('/api/browse/1')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.notes).toHaveLength(1);
      expect(res.body.notes[0].text).toBe('Great fruit for testing');
    });

    it('includes hero_image from NocoDB Hero_Image_Path', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 5, Hero_Image_Path: 'mango/images/best.jpg', Hero_Image_Rotation: 0 };
      mockNocodb.get.mockResolvedValue(plant);
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      const res = await request(app)
        .get('/api/browse/1')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.plant.hero_image).toBe('mango/images/best.jpg');
    });

    it('respects imageLimit and imageOffset parameters', async () => {
      const cookie = await getAdminCookie();
      const plant = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango', Image_Count: 100 };
      mockNocodb.get.mockResolvedValue(plant);
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse/1?imageLimit=10&imageOffset=20')
        .set('Cookie', cookie);

      const imageCall = mockNocodb.list.mock.calls.find(
        (c: any[]) => c[0] === 'Images',
      );
      expect(imageCall).toBeDefined();
      expect(imageCall![1].limit).toBe(10);
      expect(imageCall![1].offset).toBe(20);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH /:id — UPDATE PLANT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PATCH /api/browse/:id', () => {
    it('updates plant fields', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      const updated = { ...current, Description: 'A tropical fruit' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);
      mockNocodb.get.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);

      const res = await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Description: 'A tropical fruit' });
      expect(res.status).toBe(200);
      expect(mockNocodb.update).toHaveBeenCalledWith('Plants', 1, expect.objectContaining({
        Description: 'A tropical fruit',
      }));
    });

    it('returns 400 for no valid fields', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ invalid_field: 'nope' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no valid fields/i);
    });

    it('only passes allowed fields', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      const updated = { ...current, Category: 'nut' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);
      mockNocodb.get.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);

      await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Category: 'nut', secret_field: 'should be excluded' });

      expect(mockNocodb.update).toHaveBeenCalledWith('Plants', 1, expect.not.objectContaining({
        secret_field: 'should be excluded',
      }));
    });

    it('cascades slug change when Canonical_Name changes', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);
      // For cascade queries, return empty results
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Yellow Mango' });

      // Should cascade to related tables
      const cascadeCalls = mockNocodb.list.mock.calls.filter(
        (c: any[]) => ['Varieties', 'Images', 'Nutritional_Info', 'Growing_Notes', 'Documents', 'Recipes', 'OCR_Extractions', 'Attachments'].includes(c[0]),
      );
      expect(cascadeCalls.length).toBeGreaterThan(0);

      // Should update plant with new slug
      expect(mockNocodb.update).toHaveBeenCalledWith('Plants', 1, expect.objectContaining({
        Id1: 'yellow-mango',
        Canonical_Name: 'Yellow Mango',
      }));
    });

    it('updates local SQLite references on slug change', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      // Seed local data with old slug
      testDb.prepare(
        `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
      ).run('mango', (testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any).id, 'Test note');

      await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Yellow Mango' });

      // Verify local SQLite staff_notes updated (hero is now in NocoDB)
      const note = testDb.prepare(`SELECT plant_id FROM staff_notes WHERE plant_id = ?`).get('yellow-mango') as any;
      expect(note).toBeDefined();
    });

    it('cascades slug change to Varieties (simple Plant_Id field)', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);

      const varietyRecords = [{ Id: 10, Plant_Id: 'mango' }];
      mockNocodb.list.mockImplementation(async (table: string, opts?: any) => {
        if (table === 'Varieties' && opts?.where?.includes('mango')) {
          return defaultListResult(varietyRecords, 1);
        }
        return defaultListResult([], 0);
      });
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Yellow Mango' });

      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Varieties', [
        { Id: 10, Plant_Id: 'yellow-mango' },
      ]);
    });

    it('cascades slug change to Documents (JSON Plant_Ids field)', async () => {
      const cookie = await getAdminCookie();
      const current = { Id: 1, Id1: 'mango', Canonical_Name: 'Mango' };
      mockNocodb.get.mockResolvedValue(current);
      mockNocodb.update.mockResolvedValue(undefined);

      const docRecords = [{ Id: 20, Plant_Ids: '["mango","fig"]' }];
      mockNocodb.list.mockImplementation(async (table: string, opts?: any) => {
        if (table === 'Documents' && opts?.where?.includes('mango')) {
          return defaultListResult(docRecords, 1);
        }
        return defaultListResult([], 0);
      });
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      await request(app)
        .patch('/api/browse/1')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Yellow Mango' });

      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Documents', [
        { Id: 20, Plant_Ids: '["yellow-mango","fig"]' },
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /create-plant — CREATE NEW PLANT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/create-plant', () => {
    it('creates a new plant with auto-generated slug', async () => {
      const cookie = await getAdminCookie();
      const created = { Id: 99, Id1: 'star-fruit', Canonical_Name: 'Star Fruit', Category: 'fruit' };
      mockNocodb.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/browse/create-plant')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Star Fruit' });
      expect(res.status).toBe(201);
      expect(mockNocodb.create).toHaveBeenCalledWith('Plants', expect.objectContaining({
        Id1: 'star-fruit',
        Canonical_Name: 'Star Fruit',
        Category: 'fruit',
      }));
    });

    it('uses provided Id1 as slug', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.create.mockResolvedValue({ Id: 99 });

      await request(app)
        .post('/api/browse/create-plant')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Star Fruit', Id1: 'custom-slug' });

      expect(mockNocodb.create).toHaveBeenCalledWith('Plants', expect.objectContaining({
        Id1: 'custom-slug',
      }));
    });

    it('returns 400 when Canonical_Name is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/create-plant')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Canonical_Name required/i);
    });

    it('uses provided Category', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.create.mockResolvedValue({ Id: 99 });

      await request(app)
        .post('/api/browse/create-plant')
        .set('Cookie', cookie)
        .send({ Canonical_Name: 'Walnut', Category: 'nut' });

      expect(mockNocodb.create).toHaveBeenCalledWith('Plants', expect.objectContaining({
        Category: 'nut',
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /:plantId/images — PAGINATED IMAGES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse/:plantId/images', () => {
    it('returns paginated images', async () => {
      const cookie = await getAdminCookie();
      const images = [
        { Id: 1, File_Path: 'plants/mango/images/img1.jpg' },
        { Id: 2, File_Path: 'plants/mango/images/img2.jpg' },
      ];
      mockNocodb.list.mockResolvedValue({
        list: images,
        pageInfo: { totalRows: 2, isLastPage: true },
      });

      const res = await request(app)
        .get('/api/browse/mango/images?page=1&limit=50')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(2);
      expect(res.body.pageInfo).toBeDefined();
    });

    it('respects page and limit parameters', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse/mango/images?page=2&limit=10')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        limit: 10,
        offset: 10,
      }));
    });

    it('clamps limit to 200 max', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse/mango/images?limit=999')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        limit: 200,
      }));
    });

    it('fetches all images when all=true', async () => {
      const cookie = await getAdminCookie();
      // First page
      const page1 = {
        list: Array.from({ length: 200 }, (_, i) => ({ Id: i + 1 })),
        pageInfo: { totalRows: 250, isLastPage: false },
      };
      // Second page (last)
      const page2 = {
        list: Array.from({ length: 50 }, (_, i) => ({ Id: i + 201 })),
        pageInfo: { totalRows: 250, isLastPage: true },
      };
      mockNocodb.list
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const res = await request(app)
        .get('/api/browse/mango/images?all=true')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(250);
      expect(res.body.pageInfo.totalRows).toBe(250);
    });

    it('filters excluded images', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

      await request(app)
        .get('/api/browse/mango/images')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('Status,neq,hidden'),
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /set-hero/:imageId — SET HERO IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/set-hero/:imageId', () => {
    it('sets hero image in NocoDB Plants table', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.get.mockResolvedValue({ Id: 42, File_Path: 'plants/mango/images/best.jpg' });
      mockNocodb.list.mockResolvedValue(defaultListResult([{ Id: 1, Id1: 'mango' }], 1));

      const res = await request(app)
        .post('/api/browse/set-hero/42')
        .set('Cookie', cookie)
        .send({ plant_id: 'mango' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.file_path).toBe('plants/mango/images/best.jpg');

      // Hero should be stored in NocoDB via update call
      const updateCalls = mockNocodb.update.mock.calls.filter((c: any) => c[0] === 'Plants');
      expect(updateCalls.length).toBeGreaterThan(0);
      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate[2].Hero_Image_Path).toBe('mango/images/best.jpg');
    });

    it('replaces existing hero image', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.get.mockResolvedValue({ Id: 42, File_Path: 'new.jpg' });
      mockNocodb.list.mockResolvedValue(defaultListResult([{ Id: 1, Id1: 'mango' }], 1));

      const res = await request(app)
        .post('/api/browse/set-hero/42')
        .set('Cookie', cookie)
        .send({ plant_id: 'mango' });
      expect(res.status).toBe(200);

      const updateCalls = mockNocodb.update.mock.calls.filter((c: any) => c[0] === 'Plants');
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('returns 400 when plant_id is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/set-hero/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/plant_id is required/i);
    });

    it('returns 404 when image is not found', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.get.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/browse/set-hero/999')
        .set('Cookie', cookie)
        .send({ plant_id: 'mango' });
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /rotate-image/:id — ROTATE IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/rotate-image/:id', () => {
    it('sets rotation on image', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/rotate-image/42')
        .set('Cookie', cookie)
        .send({ rotation: 90 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rotation).toBe(90);
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', { Rotation: 90 });
    });

    it('normalizes rotation to 0-359 range', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/rotate-image/42')
        .set('Cookie', cookie)
        .send({ rotation: -90 });
      expect(res.status).toBe(200);
      expect(res.body.rotation).toBe(270);
    });

    it('normalizes rotation > 360', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/rotate-image/42')
        .set('Cookie', cookie)
        .send({ rotation: 450 });
      expect(res.status).toBe(200);
      expect(res.body.rotation).toBe(90);
    });

    it('defaults to 0 when rotation is not provided', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/rotate-image/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.rotation).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /exclude-image/:id — EXCLUDE IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/exclude-image/:id', () => {
    it('marks image as excluded', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/exclude-image/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', {
        Excluded: true,
        Needs_Review: false,
        Status: 'hidden',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /set-image-variety/:id — SET IMAGE VARIETY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/set-image-variety/:id', () => {
    it('sets variety_id on image', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/set-image-variety/42')
        .set('Cookie', cookie)
        .send({ variety_id: 10 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.variety_id).toBe(10);
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', { Variety_Id: 10 });
    });

    it('clears variety_id when variety_id is falsy', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/set-image-variety/42')
        .set('Cookie', cookie)
        .send({ variety_id: 0 });
      expect(res.status).toBe(200);
      expect(res.body.variety_id).toBeNull();
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', { Variety_Id: null });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /reassign-image/:id — REASSIGN IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/reassign-image/:id', () => {
    it('reassigns image to a different plant', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/reassign-image/42')
        .set('Cookie', cookie)
        .send({ plant_id: 'fig' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.plant_id).toBe('fig');
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', { Plant_Id: 'fig' });
    });

    it('returns 400 when plant_id is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/reassign-image/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/plant_id required/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /bulk-reassign-images — BULK REASSIGN
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/bulk-reassign-images', () => {
    it('reassigns multiple images', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/bulk-reassign-images')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2, 3], plant_id: 'fig' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(3);
      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Images', [
        { Id: 1, Plant_Id: 'fig' },
        { Id: 2, Plant_Id: 'fig' },
        { Id: 3, Plant_Id: 'fig' },
      ]);
    });

    it('returns 400 when image_ids is empty', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/bulk-reassign-images')
        .set('Cookie', cookie)
        .send({ image_ids: [], plant_id: 'fig' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when plant_id is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/bulk-reassign-images')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2] });
      expect(res.status).toBe(400);
    });

    it('batches updates in groups of 100', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      const imageIds = Array.from({ length: 150 }, (_, i) => i + 1);
      await request(app)
        .post('/api/browse/bulk-reassign-images')
        .set('Cookie', cookie)
        .send({ image_ids: imageIds, plant_id: 'fig' });

      expect(mockNocodb.bulkUpdate).toHaveBeenCalledTimes(2);
      // First batch: 100 items
      expect(mockNocodb.bulkUpdate.mock.calls[0][1]).toHaveLength(100);
      // Second batch: 50 items
      expect(mockNocodb.bulkUpdate.mock.calls[1][1]).toHaveLength(50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /bulk-set-variety — BULK SET VARIETY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/bulk-set-variety', () => {
    it('sets variety_id on multiple images', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/bulk-set-variety')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2, 3], variety_id: 10 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(3);
      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Images', [
        { Id: 1, Variety_Id: 10 },
        { Id: 2, Variety_Id: 10 },
        { Id: 3, Variety_Id: 10 },
      ]);
    });

    it('clears variety_id when variety_id is falsy', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/bulk-set-variety')
        .set('Cookie', cookie)
        .send({ image_ids: [1], variety_id: 0 });
      expect(res.status).toBe(200);
      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Images', [
        { Id: 1, Variety_Id: null },
      ]);
    });

    it('returns 400 when image_ids is empty', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/browse/bulk-set-variety')
        .set('Cookie', cookie)
        .send({ image_ids: [], variety_id: 10 });
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VARIETY CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Variety endpoints', () => {
    describe('GET /api/browse/:plantId/varieties-search', () => {
      it('returns empty array for empty query', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .get('/api/browse/mango/varieties-search')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });

      it('returns matching varieties', async () => {
        const cookie = await getAdminCookie();
        const varieties = [{ Id: 1, Variety_Name: 'Haden', Plant_Id: 'mango' }];
        mockNocodb.list.mockResolvedValue(defaultListResult(varieties, 1));

        const res = await request(app)
          .get('/api/browse/mango/varieties-search?q=had')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].Variety_Name).toBe('Haden');
      });

      it('filters by plant ID and query', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.list.mockResolvedValue(defaultListResult([], 0));

        await request(app)
          .get('/api/browse/mango/varieties-search?q=had')
          .set('Cookie', cookie);

        expect(mockNocodb.list).toHaveBeenCalledWith('Varieties', expect.objectContaining({
          where: expect.stringContaining('Plant_Id,eq,mango'),
        }));
        expect(mockNocodb.list).toHaveBeenCalledWith('Varieties', expect.objectContaining({
          where: expect.stringContaining('Variety_Name,like,%had%'),
        }));
      });
    });

    describe('POST /api/browse/:plantId/varieties', () => {
      it('creates a variety for a plant (admin)', async () => {
        const cookie = await getAdminCookie();
        const created = { Id: 1, Variety_Name: 'Haden', Plant_Id: 'mango' };
        mockNocodb.create.mockResolvedValue(created);

        const res = await request(app)
          .post('/api/browse/mango/varieties')
          .set('Cookie', cookie)
          .send({ Variety_Name: 'Haden' });
        expect(res.status).toBe(201);
        expect(mockNocodb.create).toHaveBeenCalledWith('Varieties', expect.objectContaining({
          Variety_Name: 'Haden',
          Plant_Id: 'mango',
        }));
      });
    });

    describe('PATCH /api/browse/varieties/:id', () => {
      it('updates a variety (admin)', async () => {
        const cookie = await getAdminCookie();
        const updated = { Id: 1, Variety_Name: 'Haden Updated' };
        mockNocodb.update.mockResolvedValue(undefined);
        mockNocodb.get.mockResolvedValue(updated);

        const res = await request(app)
          .patch('/api/browse/varieties/1')
          .set('Cookie', cookie)
          .send({ Variety_Name: 'Haden Updated' });
        expect(res.status).toBe(200);
        expect(mockNocodb.update).toHaveBeenCalledWith('Varieties', '1', { Variety_Name: 'Haden Updated' });
      });
    });

    describe('DELETE /api/browse/varieties/:id', () => {
      it('deletes a variety (admin)', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.delete.mockResolvedValue(undefined);

        const res = await request(app)
          .delete('/api/browse/varieties/1')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockNocodb.delete).toHaveBeenCalledWith('Varieties', '1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NUTRITIONAL CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Nutritional endpoints', () => {
    describe('POST /api/browse/:plantId/nutritional', () => {
      it('creates a nutritional record (admin)', async () => {
        const cookie = await getAdminCookie();
        const created = { Id: 1, Nutrient: 'Vitamin C', Amount: '100mg', Plant_Id: 'mango' };
        mockNocodb.create.mockResolvedValue(created);

        const res = await request(app)
          .post('/api/browse/mango/nutritional')
          .set('Cookie', cookie)
          .send({ Nutrient: 'Vitamin C', Amount: '100mg' });
        expect(res.status).toBe(201);
        expect(mockNocodb.create).toHaveBeenCalledWith('Nutritional_Info', expect.objectContaining({
          Nutrient: 'Vitamin C',
          Amount: '100mg',
          Plant_Id: 'mango',
        }));
      });
    });

    describe('PATCH /api/browse/nutritional/:id', () => {
      it('updates a nutritional record (admin)', async () => {
        const cookie = await getAdminCookie();
        const updated = { Id: 1, Amount: '200mg' };
        mockNocodb.update.mockResolvedValue(undefined);
        mockNocodb.get.mockResolvedValue(updated);

        const res = await request(app)
          .patch('/api/browse/nutritional/1')
          .set('Cookie', cookie)
          .send({ Amount: '200mg' });
        expect(res.status).toBe(200);
        expect(mockNocodb.update).toHaveBeenCalledWith('Nutritional_Info', '1', { Amount: '200mg' });
      });
    });

    describe('DELETE /api/browse/nutritional/:id', () => {
      it('deletes a nutritional record (admin)', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.delete.mockResolvedValue(undefined);

        const res = await request(app)
          .delete('/api/browse/nutritional/1')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockNocodb.delete).toHaveBeenCalledWith('Nutritional_Info', '1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTACHMENT CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Attachment endpoints', () => {
    describe('GET /api/browse/:plantId/attachments', () => {
      it('returns attachments for a plant', async () => {
        const cookie = await getAdminCookie();
        const attachments = [{ Id: 1, Title: 'Mango PDF', Plant_Ids: '["mango"]' }];
        mockNocodb.list.mockResolvedValue(defaultListResult(attachments, 1));

        const res = await request(app)
          .get('/api/browse/mango/attachments')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].Title).toBe('Mango PDF');
      });
    });

    describe('POST /api/browse/:plantId/attachments', () => {
      it('creates an attachment (admin)', async () => {
        const cookie = await getAdminCookie();
        const created = { Id: 1, Title: 'Research Paper' };
        mockNocodb.create.mockResolvedValue(created);

        const res = await request(app)
          .post('/api/browse/mango/attachments')
          .set('Cookie', cookie)
          .send({
            Title: 'Research Paper',
            File_Path: '/docs/paper.pdf',
            File_Type: 'application/pdf',
          });
        expect(res.status).toBe(201);
        expect(mockNocodb.create).toHaveBeenCalledWith('Attachments', expect.objectContaining({
          Title: 'Research Paper',
          File_Path: '/docs/paper.pdf',
          Plant_Ids: JSON.stringify(['mango']),
        }));
      });

      it('appends plant_id to existing Plant_Ids', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.create.mockResolvedValue({ Id: 1 });

        await request(app)
          .post('/api/browse/mango/attachments')
          .set('Cookie', cookie)
          .send({
            Title: 'Shared Doc',
            File_Path: '/docs/shared.pdf',
            Plant_Ids: '["fig"]',
          });

        expect(mockNocodb.create).toHaveBeenCalledWith('Attachments', expect.objectContaining({
          Plant_Ids: JSON.stringify(['fig', 'mango']),
        }));
      });
    });

    describe('PATCH /api/browse/attachments/:id', () => {
      it('updates an attachment (admin)', async () => {
        const cookie = await getAdminCookie();
        const updated = { Id: 1, Title: 'Updated Title' };
        mockNocodb.update.mockResolvedValue(undefined);
        mockNocodb.get.mockResolvedValue(updated);

        const res = await request(app)
          .patch('/api/browse/attachments/1')
          .set('Cookie', cookie)
          .send({ Title: 'Updated Title' });
        expect(res.status).toBe(200);
        expect(mockNocodb.update).toHaveBeenCalledWith('Attachments', '1', { Title: 'Updated Title' });
      });
    });

    describe('DELETE /api/browse/attachments/:id', () => {
      it('deletes an attachment (admin)', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.delete.mockResolvedValue(undefined);

        const res = await request(app)
          .delete('/api/browse/attachments/1')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockNocodb.delete).toHaveBeenCalledWith('Attachments', '1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Document endpoints', () => {
    describe('PATCH /api/browse/documents/:id', () => {
      it('updates a document (admin)', async () => {
        const cookie = await getAdminCookie();
        const updated = { Id: 1, Title: 'Updated Doc' };
        mockNocodb.update.mockResolvedValue(undefined);
        mockNocodb.get.mockResolvedValue(updated);

        const res = await request(app)
          .patch('/api/browse/documents/1')
          .set('Cookie', cookie)
          .send({ Title: 'Updated Doc' });
        expect(res.status).toBe(200);
        expect(mockNocodb.update).toHaveBeenCalledWith('Documents', '1', { Title: 'Updated Doc' });
      });
    });

    describe('DELETE /api/browse/documents/:id', () => {
      it('deletes a document (admin)', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.delete.mockResolvedValue(undefined);

        const res = await request(app)
          .delete('/api/browse/documents/1')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockNocodb.delete).toHaveBeenCalledWith('Documents', '1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OCR EXTRACTION CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('OCR extraction endpoints', () => {
    describe('PATCH /api/browse/ocr-extractions/:id', () => {
      it('updates an OCR extraction (admin)', async () => {
        const cookie = await getAdminCookie();
        const updated = { Id: 1, Extracted_Text: 'Updated text' };
        mockNocodb.update.mockResolvedValue(undefined);
        mockNocodb.get.mockResolvedValue(updated);

        const res = await request(app)
          .patch('/api/browse/ocr-extractions/1')
          .set('Cookie', cookie)
          .send({ Extracted_Text: 'Updated text' });
        expect(res.status).toBe(200);
        expect(mockNocodb.update).toHaveBeenCalledWith('OCR_Extractions', '1', { Extracted_Text: 'Updated text' });
      });
    });

    describe('DELETE /api/browse/ocr-extractions/:id', () => {
      it('deletes an OCR extraction (admin)', async () => {
        const cookie = await getAdminCookie();
        mockNocodb.delete.mockResolvedValue(undefined);

        const res = await request(app)
          .delete('/api/browse/ocr-extractions/1')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockNocodb.delete).toHaveBeenCalledWith('OCR_Extractions', '1');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTES CRUD (local SQLite)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Notes endpoints', () => {
    describe('GET /api/browse/:plantId/notes', () => {
      it('returns notes for a plant', async () => {
        const cookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'First note');
        testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'Second note');

        const res = await request(app)
          .get('/api/browse/mango/notes')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.notes).toHaveLength(2);
      });

      it('returns empty notes array when none exist', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .get('/api/browse/mango/notes')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.notes).toHaveLength(0);
      });

      it('filters by variety_id when provided', async () => {
        const cookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        testDb.prepare(
          `INSERT INTO staff_notes (plant_id, variety_id, user_id, text) VALUES (?, ?, ?, ?)`,
        ).run('mango', 10, adminUser.id, 'Variety note');
        testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'General note');

        const res = await request(app)
          .get('/api/browse/mango/notes?variety_id=10')
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.notes).toHaveLength(1);
        expect(res.body.notes[0].text).toBe('Variety note');
      });
    });

    describe('POST /api/browse/:plantId/notes', () => {
      it('creates a new note', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: 'This is a test note' });
        expect(res.status).toBe(201);
        expect(res.body.text).toBe('This is a test note');
        expect(res.body.plant_id).toBe('mango');
        expect(res.body.first_name).toBeDefined();
      });

      it('trims note text', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: '  spaces around  ' });
        expect(res.status).toBe(201);
        expect(res.body.text).toBe('spaces around');
      });

      it('returns 400 when text is empty', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: '' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/text is required/i);
      });

      it('returns 400 when text is missing', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({});
        expect(res.status).toBe(400);
      });

      it('returns 400 when text is only whitespace', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: '   ' });
        expect(res.status).toBe(400);
      });

      it('creates note with variety_id', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: 'Variety-specific note', variety_id: 42 });
        expect(res.status).toBe(201);
        expect(res.body.variety_id).toBe(42);
      });

      it('any authenticated user can create notes (not just admin)', async () => {
        const cookie = await getReviewerCookie('noter@test.com', 'Note', 'Writer');
        const res = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', cookie)
          .send({ text: 'Reviewer note' });
        expect(res.status).toBe(201);
        expect(res.body.text).toBe('Reviewer note');
      });
    });

    describe('PATCH /api/browse/notes/:id', () => {
      it('updates own note', async () => {
        const cookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        const result = testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'Original text');
        const noteId = Number(result.lastInsertRowid);

        const res = await request(app)
          .patch(`/api/browse/notes/${noteId}`)
          .set('Cookie', cookie)
          .send({ text: 'Updated text' });
        expect(res.status).toBe(200);
        expect(res.body.text).toBe('Updated text');
      });

      it('returns 400 for empty text', async () => {
        const cookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        const result = testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'Original');
        const noteId = Number(result.lastInsertRowid);

        const res = await request(app)
          .patch(`/api/browse/notes/${noteId}`)
          .set('Cookie', cookie)
          .send({ text: '' });
        expect(res.status).toBe(400);
      });

      it('returns 404 for non-existent note', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .patch('/api/browse/notes/99999')
          .set('Cookie', cookie)
          .send({ text: 'Updating nothing' });
        expect(res.status).toBe(404);
      });

      it('returns 403 when reviewer tries to edit another user note', async () => {
        // Create a note as admin
        const adminCookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        const result = testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'Admin note');
        const noteId = Number(result.lastInsertRowid);

        // Try to edit as reviewer
        const reviewerCookie = await getReviewerCookie('edit-other@test.com', 'Edit', 'Other');
        const res = await request(app)
          .patch(`/api/browse/notes/${noteId}`)
          .set('Cookie', reviewerCookie)
          .send({ text: 'Hijacked!' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/only edit your own/i);
      });

      it('admin can edit any note', async () => {
        // Create note as reviewer
        const reviewerCookie = await getReviewerCookie('note-owner@test.com', 'Note', 'Owner');
        const createRes = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', reviewerCookie)
          .send({ text: 'Reviewer wrote this' });
        const noteId = createRes.body.id;

        // Admin edits it
        const adminCookie = await getAdminCookie();
        const res = await request(app)
          .patch(`/api/browse/notes/${noteId}`)
          .set('Cookie', adminCookie)
          .send({ text: 'Admin edited this' });
        expect(res.status).toBe(200);
        expect(res.body.text).toBe('Admin edited this');
      });
    });

    describe('DELETE /api/browse/notes/:id', () => {
      it('deletes own note', async () => {
        const cookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        const result = testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'To be deleted');
        const noteId = Number(result.lastInsertRowid);

        const res = await request(app)
          .delete(`/api/browse/notes/${noteId}`)
          .set('Cookie', cookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const deleted = testDb.prepare(`SELECT * FROM staff_notes WHERE id = ?`).get(noteId);
        expect(deleted).toBeUndefined();
      });

      it('returns 404 for non-existent note', async () => {
        const cookie = await getAdminCookie();
        const res = await request(app)
          .delete('/api/browse/notes/99999')
          .set('Cookie', cookie);
        expect(res.status).toBe(404);
      });

      it('returns 403 when reviewer tries to delete another user note', async () => {
        const adminCookie = await getAdminCookie();
        const adminUser = testDb.prepare(`SELECT id FROM users WHERE email = ?`).get('admin@test.com') as any;
        const result = testDb.prepare(
          `INSERT INTO staff_notes (plant_id, user_id, text) VALUES (?, ?, ?)`,
        ).run('mango', adminUser.id, 'Admin note');
        const noteId = Number(result.lastInsertRowid);

        const reviewerCookie = await getReviewerCookie('del-other@test.com', 'Del', 'Other');
        const res = await request(app)
          .delete(`/api/browse/notes/${noteId}`)
          .set('Cookie', reviewerCookie);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/only delete your own/i);
      });

      it('admin can delete any note', async () => {
        const reviewerCookie = await getReviewerCookie('del-owner@test.com', 'Del', 'Owner');
        const createRes = await request(app)
          .post('/api/browse/mango/notes')
          .set('Cookie', reviewerCookie)
          .send({ text: 'Reviewer note' });
        const noteId = createRes.body.id;

        const adminCookie = await getAdminCookie();
        const res = await request(app)
          .delete(`/api/browse/notes/${noteId}`)
          .set('Cookie', adminCookie);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /restore-image/:id — RESTORE EXCLUDED IMAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/browse/restore-image/:id', () => {
    it('restores an excluded image', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/restore-image/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', {
        Excluded: false,
        Status: 'assigned',
      });
    });

    it('returns 403 for reviewer', async () => {
      const cookie = await getReviewerCookie('restore-rev@test.com', 'Restore', 'Rev');
      const res = await request(app)
        .post('/api/browse/restore-image/42')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(403);
    });

    it('returns 401 without session', async () => {
      const res = await request(app)
        .post('/api/browse/restore-image/42')
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /:plantId/images?showDeleted=true — SHOW DELETED IMAGES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/browse/:plantId/images?showDeleted=true', () => {
    it('includes excluded images when showDeleted=true', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue({
        list: [
          { Id: 1, File_Path: 'plants/fig/images/1.jpg', Excluded: false },
          { Id: 2, File_Path: 'plants/fig/images/2.jpg', Excluded: true },
        ],
        pageInfo: { totalRows: 2, page: 1, pageSize: 50, isFirstPage: true, isLastPage: true },
      });

      const res = await request(app)
        .get('/api/browse/fig/images?showDeleted=true')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(2);

      // The where clause should NOT include the Excluded filter
      const whereArg = mockNocodb.list.mock.calls[0][1]?.where;
      expect(whereArg).toBe('(Plant_Id,eq,fig)');
    });

    it('excludes deleted images by default', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue({
        list: [{ Id: 1, File_Path: 'plants/fig/images/1.jpg' }],
        pageInfo: { totalRows: 1, page: 1, pageSize: 50, isFirstPage: true, isLastPage: true },
      });

      const res = await request(app)
        .get('/api/browse/fig/images')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);

      // The where clause should include the Excluded filter
      const whereArg = mockNocodb.list.mock.calls[0][1]?.where;
      expect(whereArg).toContain('(Status,neq,hidden)');
    });

    it('works with showDeleted=true and all=true combined', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue({
        list: [
          { Id: 1, File_Path: 'plants/fig/images/1.jpg' },
          { Id: 2, File_Path: 'plants/fig/images/2.jpg', Excluded: true },
        ],
        pageInfo: { totalRows: 2, page: 1, pageSize: 200, isFirstPage: true, isLastPage: true },
      });

      const res = await request(app)
        .get('/api/browse/fig/images?showDeleted=true&all=true')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.list).toHaveLength(2);

      // The where clause should NOT include the Excluded filter
      const whereArg = mockNocodb.list.mock.calls[0][1]?.where;
      expect(whereArg).toBe('(Plant_Id,eq,fig)');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VARIETY_ID REFERENCE INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Variety_Id reference integrity', () => {
    it('images endpoint enriches Variety_Name from Variety_Id', async () => {
      const cookie = await getAdminCookie();
      const images = [
        { Id: 1, File_Path: 'plants/mango/images/1.jpg', Plant_Id: 'mango', Variety_Id: 10, Status: 'assigned' },
        { Id: 2, File_Path: 'plants/mango/images/2.jpg', Plant_Id: 'mango', Variety_Id: 20, Status: 'assigned' },
        { Id: 3, File_Path: 'plants/mango/images/3.jpg', Plant_Id: 'mango', Variety_Id: null, Status: 'assigned' },
      ];
      const varieties = [
        { Id: 10, Variety_Name: 'Haden' },
        { Id: 20, Variety_Name: 'Kent' },
      ];

      mockNocodb.list.mockImplementation(async (table: string) => {
        if (table === 'Images') return defaultListResult(images, 3);
        if (table === 'Varieties') return defaultListResult(varieties, 2);
        return defaultListResult([], 0);
      });

      const res = await request(app)
        .get('/api/browse/mango/images?all=true')
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.list[0].Variety_Name).toBe('Haden');
      expect(res.body.list[1].Variety_Name).toBe('Kent');
      expect(res.body.list[2].Variety_Name).toBeNull();
    });

    it('renaming a variety does NOT update Images (FK-based)', async () => {
      const cookie = await getAdminCookie();
      const updated = { Id: 1, Variety_Name: 'Haden Supreme' };
      mockNocodb.update.mockResolvedValue(undefined);
      mockNocodb.get.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/api/browse/varieties/1')
        .set('Cookie', cookie)
        .send({ Variety_Name: 'Haden Supreme' });
      expect(res.status).toBe(200);
      // update called once for Varieties, NOT for Images
      expect(mockNocodb.update).toHaveBeenCalledTimes(1);
      expect(mockNocodb.update).toHaveBeenCalledWith('Varieties', '1', { Variety_Name: 'Haden Supreme' });
      // bulkUpdate should NOT be called (no image cascade)
      expect(mockNocodb.bulkUpdate).not.toHaveBeenCalled();
    });

    it('merging varieties updates Variety_Id on images', async () => {
      const cookie = await getAdminCookie();
      const primary = { Id: 1, Variety_Name: 'Haden' };
      const imagesOfMerged = [{ Id: 100 }, { Id: 101 }];

      mockNocodb.get.mockResolvedValue(primary);
      mockNocodb.list.mockImplementation(async (table: string, opts: any) => {
        if (table === 'Images' && opts?.where?.includes('Variety_Id,eq,2')) {
          return defaultListResult(imagesOfMerged, 2);
        }
        return defaultListResult([], 0);
      });
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);
      mockNocodb.delete.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/varieties/merge')
        .set('Cookie', cookie)
        .send({ primary_id: 1, merge_ids: [2] });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Images should be updated with Variety_Id of primary
      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Images', [
        { Id: 100, Variety_Id: 1 },
        { Id: 101, Variety_Id: 1 },
      ]);
      // Merged variety should be deleted
      expect(mockNocodb.delete).toHaveBeenCalledWith('Varieties', 2);
    });

    it('set-image-variety with variety_id updates Variety_Id field', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.update.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/set-image-variety/42')
        .set('Cookie', cookie)
        .send({ variety_id: 15 });
      expect(res.status).toBe(200);
      expect(res.body.variety_id).toBe(15);
      expect(mockNocodb.update).toHaveBeenCalledWith('Images', '42', { Variety_Id: 15 });
    });

    it('bulk-set-variety with variety_id updates Variety_Id on all images', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.bulkUpdate.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/browse/bulk-set-variety')
        .set('Cookie', cookie)
        .send({ image_ids: [1, 2], variety_id: 5 });
      expect(res.status).toBe(200);
      expect(mockNocodb.bulkUpdate).toHaveBeenCalledWith('Images', [
        { Id: 1, Variety_Id: 5 },
        { Id: 2, Variety_Id: 5 },
      ]);
    });
  });
});
