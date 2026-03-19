// Run with: npx vitest run server/__tests__/nocodb-client.test.ts

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Required env vars ────────────────────────────────────────────────────────
process.env.NOCODB_URL = 'https://nocodb.test.local';
process.env.NOCODB_API_KEY = 'test-api-key-12345';
process.env.DB_PATH = ':memory:';
process.env.IMAGE_MOUNT_PATH = '/tmp/test-images';
process.env.APP_URL = 'http://localhost:3001';
process.env.COOKIE_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpass123';

// ── Mock the table IDs file ──────────────────────────────────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: {
      ...actual.default,
      readFileSync: (filePath: string, encoding?: string) => {
        if (filePath.includes('nocodb_table_ids.json')) {
          return JSON.stringify({
            Plants: 'tbl_plants_001',
            Varieties: 'tbl_varieties_002',
            Images: 'tbl_images_003',
            Documents: 'tbl_documents_004',
            Recipes: 'tbl_recipes_005',
            OCR_Extractions: 'tbl_ocr_006',
            Nutritional_Info: 'tbl_nutritional_007',
            Attachments: 'tbl_attachments_008',
          });
        }
        return actual.default.readFileSync(filePath, encoding);
      },
      mkdirSync: actual.default?.mkdirSync ?? vi.fn(),
    },
    readFileSync: (filePath: string, encoding?: string) => {
      if (filePath.includes('nocodb_table_ids.json')) {
        return JSON.stringify({
          Plants: 'tbl_plants_001',
          Varieties: 'tbl_varieties_002',
          Images: 'tbl_images_003',
          Documents: 'tbl_documents_004',
          Recipes: 'tbl_recipes_005',
          OCR_Extractions: 'tbl_ocr_006',
          Nutritional_Info: 'tbl_nutritional_007',
          Attachments: 'tbl_attachments_008',
        });
      }
      return actual.readFileSync(filePath, encoding);
    },
    mkdirSync: actual.mkdirSync ?? vi.fn(),
  };
});

// ── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set
const { nocodb } = await import('../lib/nocodb.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function textResponse(text: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: () => Promise.reject(new Error('Not JSON')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function emptyResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({}),
    json: () => Promise.reject(new Error('No body')),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NocoDB Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('calls GET with correct table ID URL', async () => {
      const listResult = {
        list: [{ Id: 1, Canonical_Name: 'Mango' }],
        pageInfo: { totalRows: 1, page: 1, pageSize: 25, isFirstPage: true, isLastPage: true },
      };
      mockFetch.mockResolvedValue(jsonResponse(listResult));

      const result = await nocodb.list('Plants');
      expect(result).toEqual(listResult);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_plants_001/records');
      expect(opts.method).toBe('GET');
      expect(opts.headers['xc-token']).toBe('test-api-key-12345');
    });

    it('appends where parameter', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Plants', { where: '(Category,eq,fruit)' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('where=%28Category%2Ceq%2Cfruit%29');
    });

    it('appends sort parameter', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Plants', { sort: '-Canonical_Name' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('sort=-Canonical_Name');
    });

    it('appends limit and offset parameters', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Plants', { limit: 10, offset: 20 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('appends fields parameter as comma-separated list', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Plants', { fields: ['Id', 'Canonical_Name', 'Category'] });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('fields=Id%2CCanonical_Name%2CCategory');
    });

    it('omits empty fields array', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Plants', { fields: [] });

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain('fields=');
    });

    it('builds URL without query params when no options given', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Varieties');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_varieties_002/records');
    });

    it('combines multiple parameters', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ list: [], pageInfo: {} }));

      await nocodb.list('Images', {
        where: '(Plant_Id,eq,mango)',
        sort: 'File_Path',
        limit: 50,
        offset: 100,
        fields: ['Id', 'File_Path'],
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('where=');
      expect(url).toContain('sort=');
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=100');
      expect(url).toContain('fields=');
    });

    it('throws on unknown table name', async () => {
      await expect(nocodb.list('NonExistentTable')).rejects.toThrow(/unknown nocodb table/i);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Internal Server Error', 500));

      await expect(nocodb.list('Plants')).rejects.toThrow(/failed.*500/i);
    });
  });

  // ── get() ──────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('calls GET with row ID in URL', async () => {
      const record = { Id: 42, Canonical_Name: 'Mango' };
      mockFetch.mockResolvedValue(jsonResponse(record));

      const result = await nocodb.get('Plants', 42);
      expect(result).toEqual(record);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_plants_001/records/42');
      expect(opts.method).toBe('GET');
    });

    it('accepts string row ID', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ Id: 'abc' }));

      await nocodb.get('Plants', 'abc');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/records/abc');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Not Found', 404));

      await expect(nocodb.get('Plants', 999)).rejects.toThrow(/failed.*404/i);
    });
  });

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('calls POST with JSON body for a single record', async () => {
      const created = { Id: 1, Canonical_Name: 'Fig' };
      mockFetch.mockResolvedValue(jsonResponse(created));

      const result = await nocodb.create('Plants', { Canonical_Name: 'Fig', Category: 'fruit' });
      expect(result).toEqual(created);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_plants_001/records');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ Canonical_Name: 'Fig', Category: 'fruit' });
    });

    it('calls POST with array body for bulk create', async () => {
      const created = [{ Id: 1 }, { Id: 2 }];
      mockFetch.mockResolvedValue(jsonResponse(created));

      const data = [{ Canonical_Name: 'Fig' }, { Canonical_Name: 'Mango' }];
      await nocodb.create('Plants', data);

      const [, opts] = mockFetch.mock.calls[0];
      expect(JSON.parse(opts.body)).toEqual(data);
    });

    it('sends correct headers', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ Id: 1 }));

      await nocodb.create('Plants', { Canonical_Name: 'Test' });

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['xc-token']).toBe('test-api-key-12345');
      expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Bad Request', 400));

      await expect(nocodb.create('Plants', {})).rejects.toThrow(/failed.*400/i);
    });
  });

  // ── update() ───────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('calls PATCH with row ID wrapped in array', async () => {
      mockFetch.mockResolvedValue(jsonResponse([{ Id: 42 }]));

      await nocodb.update('Plants', 42, { Description: 'Updated' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_plants_001/records');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual([{ Id: 42, Description: 'Updated' }]);
    });

    it('accepts string row ID', async () => {
      mockFetch.mockResolvedValue(jsonResponse([{}]));

      await nocodb.update('Plants', 'abc', { Description: 'Test' });

      const [, opts] = mockFetch.mock.calls[0];
      expect(JSON.parse(opts.body)).toEqual([{ Id: 'abc', Description: 'Test' }]);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Forbidden', 403));

      await expect(nocodb.update('Plants', 1, {})).rejects.toThrow(/failed.*403/i);
    });
  });

  // ── bulkUpdate() ───────────────────────────────────────────────────────────

  describe('bulkUpdate()', () => {
    it('calls PATCH with array of records', async () => {
      mockFetch.mockResolvedValue(jsonResponse([{ Id: 1 }, { Id: 2 }]));

      const records = [
        { Id: 1, Plant_Id: 'new-mango' },
        { Id: 2, Plant_Id: 'new-mango' },
      ];
      await nocodb.bulkUpdate('Varieties', records);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_varieties_002/records');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual(records);
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Server Error', 500));

      await expect(nocodb.bulkUpdate('Varieties', [{ Id: 1 }])).rejects.toThrow(/failed.*500/i);
    });
  });

  // ── delete() ───────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('calls DELETE with row ID in body array', async () => {
      mockFetch.mockResolvedValue(emptyResponse(200));

      await nocodb.delete('Plants', 42);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://nocodb.test.local/api/v2/tables/tbl_plants_001/records');
      expect(opts.method).toBe('DELETE');
      expect(JSON.parse(opts.body)).toEqual([{ Id: 42 }]);
    });

    it('accepts string row ID', async () => {
      mockFetch.mockResolvedValue(emptyResponse(200));

      await nocodb.delete('Varieties', 'abc');

      const [, opts] = mockFetch.mock.calls[0];
      expect(JSON.parse(opts.body)).toEqual([{ Id: 'abc' }]);
    });

    it('returns null for empty response body (non-JSON)', async () => {
      mockFetch.mockResolvedValue(emptyResponse(200));

      const result = await nocodb.delete('Plants', 1);
      expect(result).toBeNull();
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(textResponse('Not Found', 404));

      await expect(nocodb.delete('Plants', 999)).rejects.toThrow(/failed.*404/i);
    });
  });

  // ── getTableNames() ────────────────────────────────────────────────────────

  describe('getTableNames()', () => {
    it('returns all table names from the loaded table IDs file', () => {
      const names = nocodb.getTableNames();
      expect(names).toContain('Plants');
      expect(names).toContain('Varieties');
      expect(names).toContain('Images');
      expect(names).toContain('Documents');
      expect(names).toContain('Recipes');
      expect(names).toContain('OCR_Extractions');
      expect(names).toContain('Nutritional_Info');
      expect(names).toContain('Attachments');
    });
  });

  // ── Error handling edge cases ──────────────────────────────────────────────

  describe('Error handling', () => {
    it('includes method, URL, and status in error messages', async () => {
      mockFetch.mockResolvedValue(textResponse('Bad Gateway', 502));

      try {
        await nocodb.list('Plants');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('GET');
        expect(err.message).toContain('502');
        expect(err.message).toContain('Bad Gateway');
      }
    });

    it('handles JSON error response body', async () => {
      const errorBody = JSON.stringify({ msg: 'Invalid filter' });
      mockFetch.mockResolvedValue(textResponse(errorBody, 422));

      try {
        await nocodb.list('Plants', { where: 'invalid' });
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('422');
        expect(err.message).toContain('Invalid filter');
      }
    });

    it('returns JSON for successful JSON responses', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ Id: 1, Canonical_Name: 'Test' }));

      const result = await nocodb.get('Plants', 1);
      expect(result).toEqual({ Id: 1, Canonical_Name: 'Test' });
    });

    it('returns null for non-JSON success responses', async () => {
      // e.g., DELETE returns empty body
      mockFetch.mockResolvedValue(emptyResponse(200));

      const result = await nocodb.delete('Plants', 1);
      expect(result).toBeNull();
    });

    it('strips trailing slashes from base URL', async () => {
      // The module already loaded with NOCODB_URL = 'https://nocodb.test.local'
      // Verify no double slashes in requests
      mockFetch.mockResolvedValue(jsonResponse({ list: [] }));

      await nocodb.list('Plants');

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain('//api');
    });
  });
});
