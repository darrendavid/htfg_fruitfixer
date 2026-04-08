import { nocodb } from './nocodb.js';
import type { ListOptions } from './nocodb.js';

/** Fetch all pages of a NocoDB query, returning a flat array of all records */
export async function fetchAllPages<T = Record<string, any>>(
  tableName: string,
  opts: ListOptions,
  pageSize = 200
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  while (true) {
    const result = await nocodb.list(tableName, { ...opts, limit: pageSize, offset });
    results.push(...(result.list as T[]));
    if (result.pageInfo?.isLastPage || result.list.length === 0) break;
    offset += pageSize;
  }
  return results;
}

/** Batch bulkUpdate calls, at most batchSize records per call */
export async function batchedBulkUpdate(
  tableName: string,
  updates: Record<string, any>[],
  batchSize = 100
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    await nocodb.bulkUpdate(tableName, updates.slice(i, i + batchSize));
  }
}
