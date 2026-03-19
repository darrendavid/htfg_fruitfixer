import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load table IDs from the parsed output
const tableIdsPath = path.resolve(__dirname, '../../../content/parsed/nocodb_table_ids.json');
const tableIds: Record<string, string> = JSON.parse(fs.readFileSync(tableIdsPath, 'utf-8'));

function getTableId(tableName: string): string {
  const id = tableIds[tableName];
  if (!id) throw new Error(`Unknown NocoDB table: ${tableName}`);
  return id;
}

const baseUrl = config.NOCODB_URL.replace(/\/+$/, '');

async function request(method: string, url: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {
    'xc-token': config.NOCODB_API_KEY,
    'Content-Type': 'application/json',
  };

  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB ${method} ${url} failed (${res.status}): ${text}`);
  }

  // DELETE may return empty body
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return null;
}

export interface ListOptions {
  where?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
}

export interface ListResult<T = Record<string, any>> {
  list: T[];
  pageInfo: {
    totalRows: number;
    page: number;
    pageSize: number;
    isFirstPage: boolean;
    isLastPage: boolean;
  };
}

export const nocodb = {
  /** List records from a table with optional filtering, sorting, pagination */
  async list(tableName: string, opts: ListOptions = {}): Promise<ListResult> {
    const tableId = getTableId(tableName);
    const params = new URLSearchParams();
    if (opts.where) params.set('where', opts.where);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    if (opts.fields?.length) params.set('fields', opts.fields.join(','));
    const qs = params.toString();
    return request('GET', `/api/v2/tables/${tableId}/records${qs ? '?' + qs : ''}`);
  },

  /** Get a single record by row ID */
  async get(tableName: string, rowId: number | string): Promise<Record<string, any>> {
    const tableId = getTableId(tableName);
    return request('GET', `/api/v2/tables/${tableId}/records/${rowId}`);
  },

  /** Create one or more records */
  async create(tableName: string, data: Record<string, any> | Record<string, any>[]): Promise<any> {
    const tableId = getTableId(tableName);
    return request('POST', `/api/v2/tables/${tableId}/records`, data);
  },

  /** Update a record by row ID */
  async update(tableName: string, rowId: number | string, fields: Record<string, any>): Promise<any> {
    const tableId = getTableId(tableName);
    return request('PATCH', `/api/v2/tables/${tableId}/records`, [{ Id: rowId, ...fields }]);
  },

  /** Bulk update multiple records */
  async bulkUpdate(tableName: string, records: Array<Record<string, any>>): Promise<any> {
    const tableId = getTableId(tableName);
    return request('PATCH', `/api/v2/tables/${tableId}/records`, records);
  },

  /** Delete a record by row ID */
  async delete(tableName: string, rowId: number | string): Promise<any> {
    const tableId = getTableId(tableName);
    return request('DELETE', `/api/v2/tables/${tableId}/records`, [{ Id: rowId }]);
  },

  /** Get available table names */
  getTableNames(): string[] {
    return Object.keys(tableIds);
  },
};
