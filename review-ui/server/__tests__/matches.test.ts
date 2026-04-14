// Run with: npx vitest run server/__tests__/matches.test.ts

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';

import path from 'path';

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
// CONTENT_ROOT is set so that the routes can derive PROJECT_ROOT and JSON paths.
// On Windows, path.resolve('/tmp/test/content', '..') → C:\tmp\test, so we use
// the actual resolved path to ensure our mocks match what the route code computes.
process.env.CONTENT_ROOT = '/tmp/test/content';

// Compute the actual paths the route code will derive (platform-aware)
const COMPUTED_PROJECT_ROOT = path.resolve('/tmp/test/content', '..');
const COMPUTED_LOST_IMAGES_PATH = path.resolve(COMPUTED_PROJECT_ROOT, 'content/parsed/lost_image_recovery.json');

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
  getTableNames: vi.fn().mockReturnValue([
    'Plants', 'Varieties', 'Images', 'Documents', 'Recipes',
    'OCR_Extractions', 'Nutritional_Info', 'Attachments',
  ]),
};

vi.mock('../lib/nocodb.js', () => ({
  nocodb: mockNocodb,
}));

// ── Mock fs — control existsSync and readFileSync per test ───────────────────
// The real fs is passed through for everything except the JSON files we control.
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    readdirSync: vi.fn().mockReturnValue([]),
    mkdirSync: vi.fn(),
    default: {
      ...actual.default,
      existsSync: (...args: any[]) => mockExistsSync(...args),
      readFileSync: (...args: any[]) => mockReadFileSync(...args),
      readdirSync: vi.fn().mockReturnValue([]),
      mkdirSync: vi.fn(),
    },
  };
});

// Dynamic import AFTER mocks are set up
const { default: app } = await import('../index.js');
const request = (await import('supertest')).default;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function getAdminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ email: 'admin@test.com', password: 'testpass123' });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('No set-cookie header returned from admin login');
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

// Sample lost image recovery JSON
const SAMPLE_LOST_IMAGES_JSON = JSON.stringify({
  lost_images: [
    {
      image_id: 100,
      plant_id: 'banana',
      plant_name: 'Banana',
      original_filepath: 'content/source/HawaiiFruit. Net/banana/img.jpg',
      source_directory: 'HawaiiFruit. Net/banana',
      old_file_path: 'content/pass_01/assigned/banana/images/img.jpg',
      new_file_path: 'content/pass_01/assigned/banana/images/img_1.jpg',
      variety_id: null,
      status: 'recovered',
    },
    {
      image_id: 200,
      plant_id: 'fig',
      plant_name: 'Fig',
      original_filepath: 'content/source/fig/f.jpg',
      source_directory: 'fig',
      old_file_path: 'content/pass_01/assigned/fig/images/f.jpg',
      new_file_path: 'content/pass_01/assigned/fig/images/f_1.jpg',
      variety_id: null,
      status: 'recovered',
    },
  ],
});

// The path the route code will derive for the lost images JSON
// Use the platform-resolved path computed at the top (handles Windows vs Unix differences)
const LOST_IMAGES_PATH = COMPUTED_LOST_IMAGES_PATH;

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Matches API', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.exec(SCHEMA_SQL);
    vi.clearAllMocks();

    // Default: all existsSync calls return false (no files on disk)
    mockExistsSync.mockReturnValue(false);

    // Default: readFileSync throws (shouldn't be called unless existsSync returns true)
    mockReadFileSync.mockImplementation((p: string) => {
      throw new Error(`readFileSync called unexpectedly for: ${p}`);
    });

    // Default NocoDB response
    mockNocodb.list.mockResolvedValue(defaultListResult());
    mockNocodb.get.mockResolvedValue(null);
    mockNocodb.create.mockResolvedValue({ Id: 999 });
    mockNocodb.update.mockResolvedValue({});
    mockNocodb.bulkUpdate.mockResolvedValue({});
    mockNocodb.delete.mockResolvedValue({});
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/matches/dismiss-lost-images
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/matches/dismiss-lost-images', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .send({ image_ids: [100] });
      expect(res.status).toBe(401);
    });

    it('returns 403 for reviewer', async () => {
      // Register a reviewer
      await request(app)
        .post('/api/auth/register')
        .send({ email: 'reviewer@test.com', first_name: 'Rev', last_name: 'User' });

      const link = testDb
        .prepare(`SELECT token FROM magic_links WHERE email = ? ORDER BY id DESC LIMIT 1`)
        .get('reviewer@test.com') as { token: string } | undefined;
      expect(link).toBeTruthy();

      const verifyRes = await request(app).get(`/api/auth/verify/${link!.token}`);
      const reviewerCookie = Array.isArray(verifyRes.headers['set-cookie'])
        ? verifyRes.headers['set-cookie'][0]
        : verifyRes.headers['set-cookie'];

      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', reviewerCookie)
        .send({ image_ids: [100] });
      expect(res.status).toBe(403);
    });

    it('returns 400 when image_ids is missing', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/image_ids/i);
    });

    it('returns 400 when image_ids is an empty array', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({ image_ids: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/image_ids/i);
    });

    it('inserts image IDs and returns success', async () => {
      const cookie = await getAdminCookie();
      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({ image_ids: [100, 200] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.dismissed).toBe(2);

      // Verify they are in SQLite
      const rows = testDb
        .prepare('SELECT image_id FROM recovered_dismissed ORDER BY image_id')
        .all() as { image_id: number }[];
      expect(rows.map(r => r.image_id)).toEqual([100, 200]);
    });

    it('is idempotent — second call with same IDs does not error', async () => {
      const cookie = await getAdminCookie();

      // First call
      const res1 = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({ image_ids: [100] });
      expect(res1.status).toBe(200);

      // Second call with same ID — INSERT OR IGNORE should silently skip
      const res2 = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({ image_ids: [100] });
      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.dismissed).toBe(1);

      // Still only one row in DB
      const rows = testDb
        .prepare('SELECT image_id FROM recovered_dismissed')
        .all() as { image_id: number }[];
      expect(rows.length).toBe(1);
    });

    it('inserts multiple IDs in a single call', async () => {
      const cookie = await getAdminCookie();
      const ids = [10, 20, 30, 40, 50];

      const res = await request(app)
        .post('/api/matches/dismiss-lost-images')
        .set('Cookie', cookie)
        .send({ image_ids: ids });

      expect(res.status).toBe(200);
      expect(res.body.dismissed).toBe(5);

      const rows = testDb
        .prepare('SELECT image_id FROM recovered_dismissed ORDER BY image_id')
        .all() as { image_id: number }[];
      expect(rows.map(r => r.image_id)).toEqual(ids);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/matches/lost-images (no plant param)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/matches/lost-images (no plant param)', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await request(app).get('/api/matches/lost-images');
      expect(res.status).toBe(401);
    });

    it('returns { total: 0, groups: [] } when JSON file does not exist', async () => {
      const cookie = await getAdminCookie();
      // mockExistsSync already returns false by default
      const res = await request(app)
        .get('/api/matches/lost-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.groups).toEqual([]);
    });

    it('returns groups from JSON when file exists', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string, enc?: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      const res = await request(app)
        .get('/api/matches/lost-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.groups).toHaveLength(2);

      const plantIds = res.body.groups.map((g: any) => g.plant_id);
      expect(plantIds).toContain('banana');
      expect(plantIds).toContain('fig');
    });

    it('excludes dismissed image IDs from total and groups', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // Dismiss image_id 100 (banana)
      testDb.prepare('INSERT INTO recovered_dismissed (image_id) VALUES (?)').run(100);

      const res = await request(app)
        .get('/api/matches/lost-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      // Only fig (200) should remain
      expect(res.body.total).toBe(1);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].plant_id).toBe('fig');
    });

    it('returns total: 0 and empty groups when all items are dismissed', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // Dismiss both
      testDb.prepare('INSERT INTO recovered_dismissed (image_id) VALUES (?)').run(100);
      testDb.prepare('INSERT INTO recovered_dismissed (image_id) VALUES (?)').run(200);

      const res = await request(app)
        .get('/api/matches/lost-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.groups).toEqual([]);
    });

    it('filters out non-recovered status items', async () => {
      const cookie = await getAdminCookie();

      const jsonWithMixed = JSON.stringify({
        lost_images: [
          { image_id: 100, plant_id: 'banana', plant_name: 'Banana', status: 'recovered',
            original_filepath: 'x.jpg', source_directory: 'x', old_file_path: 'x.jpg', new_file_path: 'x_1.jpg', variety_id: null },
          { image_id: 300, plant_id: 'mango', plant_name: 'Mango', status: 'pending',
            original_filepath: 'y.jpg', source_directory: 'y', old_file_path: 'y.jpg', new_file_path: 'y_1.jpg', variety_id: null },
        ],
      });

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return jsonWithMixed;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      const res = await request(app)
        .get('/api/matches/lost-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      // Only 'recovered' status items count
      expect(res.body.total).toBe(1);
      expect(res.body.groups[0].plant_id).toBe('banana');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/matches/lost-images?plant=banana
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/matches/lost-images?plant=banana', () => {
    it('returns items for the specified plant', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // NocoDB returns no live data for this batch
      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/lost-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plant_id).toBe('banana');
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].image_id).toBe(100);
    });

    it('enriches items with NocoDB File_Path when available', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // NocoDB returns a live record for image_id 100 with an updated File_Path
      mockNocodb.list.mockResolvedValue(defaultListResult([
        {
          Id: 100,
          File_Path: 'content/pass_01/assigned/banana/images/img_live.jpg',
          Plant_Id: 'banana',
          Status: 'assigned',
          Variety_Id: null,
          Caption: 'img live',
        },
      ], 1));

      const res = await request(app)
        .get('/api/matches/lost-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);

      const item = res.body.items[0];
      // Should use live File_Path from NocoDB, not JSON's new_file_path
      expect(item.new_file_path).toBe('content/pass_01/assigned/banana/images/img_live.jpg');
      expect(item.status).toBe('assigned');
    });

    it('falls back to JSON new_file_path when NocoDB has no record', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // NocoDB returns nothing
      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/lost-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      const item = res.body.items[0];
      // Falls back to JSON's new_file_path
      expect(item.new_file_path).toBe('content/pass_01/assigned/banana/images/img_1.jpg');
    });

    it('excludes dismissed items from plant-specific results', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      // Dismiss image_id 100 (the banana item)
      testDb.prepare('INSERT INTO recovered_dismissed (image_id) VALUES (?)').run(100);

      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/lost-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('returns empty for a plant not in the JSON', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/lost-images?plant=mango')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('calls nocodb.list with correct where clause for batch enrichment', async () => {
      const cookie = await getAdminCookie();

      mockExistsSync.mockImplementation((p: string) => p === LOST_IMAGES_PATH);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p === LOST_IMAGES_PATH) return SAMPLE_LOST_IMAGES_JSON;
        throw new Error(`unexpected readFileSync: ${p}`);
      });

      mockNocodb.list.mockResolvedValue(defaultListResult());

      await request(app)
        .get('/api/matches/lost-images?plant=banana')
        .set('Cookie', cookie);

      // Should have called nocodb.list with Id,in,100 (the banana image_id)
      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('100'),
      }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/matches/hidden-images?plant=fig
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/matches/hidden-images?plant=fig', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await request(app).get('/api/matches/hidden-images?plant=fig');
      expect(res.status).toBe(401);
    });

    it('returns all items via fetchAllPages when isLastPage:true', async () => {
      const cookie = await getAdminCookie();

      const figImages = Array.from({ length: 15 }, (_, i) => ({
        Id: i + 1,
        File_Path: `content/pass_01/assigned/fig/images/fig_${i + 1}.jpg`,
        Plant_Id: 'fig',
        Caption: `Fig ${i + 1}`,
        Original_Filepath: null,
        Size_Bytes: 12345,
        Variety_Id: null,
      }));

      mockNocodb.list.mockResolvedValue(defaultListResult(figImages, 15));

      const res = await request(app)
        .get('/api/matches/hidden-images?plant=fig')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plant_id).toBe('fig');
      expect(res.body.total).toBe(15);
      expect(res.body.items).toHaveLength(15);
    });

    it('fetches all pages when nocodb returns multiple pages (300 items)', async () => {
      const cookie = await getAdminCookie();

      // Simulate pagination: first call returns 200 items (not last page),
      // second call returns 100 items (last page)
      const page1Items = Array.from({ length: 200 }, (_, i) => ({
        Id: i + 1,
        File_Path: `content/pass_01/assigned/fig/images/fig_${i + 1}.jpg`,
        Plant_Id: 'fig',
        Caption: `Fig ${i + 1}`,
        Original_Filepath: null,
        Size_Bytes: 5000,
        Variety_Id: null,
      }));

      const page2Items = Array.from({ length: 100 }, (_, i) => ({
        Id: i + 201,
        File_Path: `content/pass_01/assigned/fig/images/fig_${i + 201}.jpg`,
        Plant_Id: 'fig',
        Caption: `Fig ${i + 201}`,
        Original_Filepath: null,
        Size_Bytes: 5000,
        Variety_Id: null,
      }));

      mockNocodb.list
        .mockResolvedValueOnce({
          list: page1Items,
          pageInfo: { totalRows: 300, page: 1, pageSize: 200, isFirstPage: true, isLastPage: false },
        })
        .mockResolvedValueOnce({
          list: page2Items,
          pageInfo: { totalRows: 300, page: 2, pageSize: 200, isFirstPage: false, isLastPage: true },
        });

      const res = await request(app)
        .get('/api/matches/hidden-images?plant=fig')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plant_id).toBe('fig');
      expect(res.body.total).toBe(300);
      expect(res.body.items).toHaveLength(300);
    });

    it('calls nocodb.list with correct where clause for plant', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult());

      await request(app)
        .get('/api/matches/hidden-images?plant=fig')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('fig'),
      }));
      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('hidden'),
      }));
    });

    it('uses __none__ plant to query images with no plant', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult(
        [{ Id: 999, File_Path: 'x.jpg', Plant_Id: null, Caption: 'no plant', Size_Bytes: 100, Variety_Id: null }],
        1,
      ));

      const res = await request(app)
        .get('/api/matches/hidden-images?plant=__none__')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plant_id).toBe('__none__');
      expect(res.body.total).toBe(1);
      // The where clause for __none__ should contain "blank"
      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('blank'),
      }));
    });

    it('returns empty items when nocodb has no hidden images for plant', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/hidden-images?plant=mango')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/matches/unmatched-images?plant=banana
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/matches/unmatched-images?plant=banana', () => {
    it('returns 401 without auth cookie', async () => {
      const res = await request(app).get('/api/matches/unmatched-images?plant=banana');
      expect(res.status).toBe(401);
    });

    it('calls nocodb.list with correct where clause for unmatched images', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult());

      await request(app)
        .get('/api/matches/unmatched-images?plant=banana')
        .set('Cookie', cookie);

      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('banana'),
      }));
      // Should filter on Variety_Id blank
      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('Variety_Id'),
      }));
      // Should exclude hidden and triage
      expect(mockNocodb.list).toHaveBeenCalledWith('Images', expect.objectContaining({
        where: expect.stringContaining('hidden'),
      }));
    });

    it('returns all items via fetchAllPages', async () => {
      const cookie = await getAdminCookie();

      const bananaImages = Array.from({ length: 10 }, (_, i) => ({
        Id: i + 1,
        File_Path: `content/pass_01/assigned/banana/images/b_${i + 1}.jpg`,
        Plant_Id: 'banana',
        Caption: `Banana ${i + 1}`,
        Original_Filepath: null,
        Source_Directory: 'banana',
        Size_Bytes: 8000,
      }));

      mockNocodb.list.mockResolvedValue(defaultListResult(bananaImages, 10));

      const res = await request(app)
        .get('/api/matches/unmatched-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.plant_id).toBe('banana');
      expect(res.body.total).toBe(10);
      expect(res.body.items).toHaveLength(10);
    });

    it('fetches all pages when nocodb paginates', async () => {
      const cookie = await getAdminCookie();

      const page1 = Array.from({ length: 25 }, (_, i) => ({
        Id: i + 1,
        File_Path: `content/pass_01/assigned/banana/images/b_${i + 1}.jpg`,
        Plant_Id: 'banana',
      }));
      const page2 = Array.from({ length: 5 }, (_, i) => ({
        Id: i + 26,
        File_Path: `content/pass_01/assigned/banana/images/b_${i + 26}.jpg`,
        Plant_Id: 'banana',
      }));

      mockNocodb.list
        .mockResolvedValueOnce({
          list: page1,
          pageInfo: { totalRows: 30, page: 1, pageSize: 25, isFirstPage: true, isLastPage: false },
        })
        .mockResolvedValueOnce({
          list: page2,
          pageInfo: { totalRows: 30, page: 2, pageSize: 25, isFirstPage: false, isLastPage: true },
        });

      const res = await request(app)
        .get('/api/matches/unmatched-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(30);
      expect(res.body.items).toHaveLength(30);
      expect(mockNocodb.list).toHaveBeenCalledTimes(2);
    });

    it('returns empty when no unmatched images exist for plant', async () => {
      const cookie = await getAdminCookie();
      mockNocodb.list.mockResolvedValue(defaultListResult());

      const res = await request(app)
        .get('/api/matches/unmatched-images?plant=banana')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    });

    it('returns grouped counts when no plant param is provided', async () => {
      const cookie = await getAdminCookie();

      mockNocodb.list.mockResolvedValue(defaultListResult([
        { Plant_Id: 'banana' },
        { Plant_Id: 'banana' },
        { Plant_Id: 'fig' },
      ], 3));

      const res = await request(app)
        .get('/api/matches/unmatched-images')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.groups).toHaveLength(2);

      const bananaGroup = res.body.groups.find((g: any) => g.plant_id === 'banana');
      expect(bananaGroup?.count).toBe(2);

      const figGroup = res.body.groups.find((g: any) => g.plant_id === 'fig');
      expect(figGroup?.count).toBe(1);
    });
  });
});
