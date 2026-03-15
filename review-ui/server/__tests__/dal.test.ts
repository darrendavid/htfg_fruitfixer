// NOTE: Requires: npm install -D vitest
// Run with: npx vitest run server/__tests__/dal.test.ts

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../lib/schema.js';

// ── In-memory DB that the mocked module will proxy to ────────────────────────
let testDb: InstanceType<typeof Database>;

// vi.mock is hoisted — the factory closure captures `testDb` by reference so
// each beforeEach can swap in a fresh instance before dal functions run.
vi.mock('../lib/db.js', () => ({
  default: new Proxy({} as InstanceType<typeof Database>, {
    get(_target, prop) {
      return (testDb as any)[prop as string];
    },
  }),
}));

// Import dal AFTER the mock is declared (Vitest hoists vi.mock above imports).
const dal = await import('../lib/dal.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedUsers(db: InstanceType<typeof Database>) {
  const u1 = db.prepare(
    `INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`,
  ).run('u1@test.com', 'User', 'One');
  const u2 = db.prepare(
    `INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`,
  ).run('u2@test.com', 'User', 'Two');
  const u3 = db.prepare(
    `INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`,
  ).run('u3@test.com', 'User', 'Three');
  return {
    u1Id: Number(u1.lastInsertRowid),
    u2Id: Number(u2.lastInsertRowid),
    u3Id: Number(u3.lastInsertRowid),
  };
}

function seedSwipeItem(db: InstanceType<typeof Database>, imagePath = 'img1.jpg') {
  db.prepare(
    `INSERT INTO review_queue (image_path, queue, status, sort_key)
     VALUES (?, 'swipe', 'pending', ?)`,
  ).run(imagePath, `000001:mango:1:${imagePath}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DAL — Queue operations', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
    seedUsers(testDb);
    seedSwipeItem(testDb);
  });

  it('getNextPendingItem returns null when queue is empty', () => {
    // Clear the seeded item
    testDb.prepare(`DELETE FROM review_queue`).run();
    const item = dal.getNextPendingItem('swipe', 1);
    expect(item).toBeNull();
  });

  it('getNextPendingItem locks an item for the requesting user', () => {
    const item = dal.getNextPendingItem('swipe', 1);
    expect(item).not.toBeNull();
    expect(item!.status).toBe('in_progress');
    expect(item!.locked_by).toBe(1);
  });

  it('getNextPendingItem returns null when only locked items remain', () => {
    // Lock the only item
    dal.getNextPendingItem('swipe', 1);
    // Second call from another user gets nothing
    const item = dal.getNextPendingItem('swipe', 2);
    expect(item).toBeNull();
  });

  it('getNextPendingItem expires stale locks (older than 5 minutes)', () => {
    // Manually insert a stale in_progress item
    testDb.prepare(`DELETE FROM review_queue`).run();
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key, locked_by, locked_at)
       VALUES ('stale.jpg', 'swipe', 'in_progress', 'aaa', 1, datetime('now', '-10 minutes'))`,
    ).run();

    // getNextPendingItem should expire the stale lock and pick it up
    const item = dal.getNextPendingItem('swipe', 2);
    expect(item).not.toBeNull();
    expect(item!.image_path).toBe('stale.jpg');
    expect(item!.locked_by).toBe(2);
  });

  it('releaseItem resets status back to pending', () => {
    const item = dal.getNextPendingItem('swipe', 1);
    dal.releaseItem(item!.id);
    const row = testDb.prepare(`SELECT status, locked_by FROM review_queue WHERE id = ?`).get(item!.id) as any;
    expect(row.status).toBe('pending');
    expect(row.locked_by).toBeNull();
  });

  it('getQueueStats returns accurate counts', () => {
    const stats = dal.getQueueStats();
    expect(stats.swipe_pending).toBe(1);
    expect(stats.swipe_in_progress).toBe(0);
    expect(stats.swipe_completed).toBe(0);
  });

  it('expireStaleLocks returns change count', () => {
    // No stale locks yet
    const count = dal.expireStaleLocks();
    expect(count).toBe(0);
  });
});

describe('DAL — IDK escalation', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
    seedUsers(testDb);
    seedSwipeItem(testDb);
  });

  it('idkItem increments idk_count on first vote', () => {
    const result = dal.idkItem('img1.jpg', 1);
    expect(result.idk_count).toBe(1);
    expect(result.escalated).toBe(false);
  });

  it('idkItem does not duplicate vote for same user', () => {
    dal.idkItem('img1.jpg', 1);
    const result = dal.idkItem('img1.jpg', 1); // same user again
    expect(result.idk_count).toBe(1); // count unchanged
    expect(result.escalated).toBe(false);
  });

  it('idkItem counts votes from different users separately', () => {
    dal.idkItem('img1.jpg', 1);
    const result = dal.idkItem('img1.jpg', 2);
    expect(result.idk_count).toBe(2);
    expect(result.escalated).toBe(false);
  });

  it('idkItem escalates to classify queue at idk_count >= 3', () => {
    dal.idkItem('img1.jpg', 1);
    dal.idkItem('img1.jpg', 2);
    const result = dal.idkItem('img1.jpg', 3);

    expect(result.idk_count).toBe(3);
    expect(result.escalated).toBe(true);

    const row = testDb.prepare(`SELECT status, queue FROM review_queue WHERE image_path = ?`).get('img1.jpg') as any;
    expect(row.status).toBe('flagged_idk');
    expect(row.queue).toBe('classify');
  });

  it('idkItem throws for unknown image_path', () => {
    expect(() => dal.idkItem('nonexistent.jpg', 1)).toThrow(/not found/i);
  });

  it('idkItem inserts a decision record for each unique vote', () => {
    dal.idkItem('img1.jpg', 1);
    dal.idkItem('img1.jpg', 2);
    const rows = testDb.prepare(
      `SELECT * FROM review_decisions WHERE image_path = ? AND action = 'idk'`,
    ).all('img1.jpg') as any[];
    expect(rows).toHaveLength(2);
  });
});

describe('DAL — Review actions', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('fig', 'Fig');
    seedUsers(testDb);
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, suggested_plant_id, sort_key)
       VALUES ('img1.jpg', 'swipe', 'in_progress', 'mango', 'aaa')`,
    ).run();
  });

  it('confirmItem marks item completed and logs decision', () => {
    dal.confirmItem('img1.jpg', 1);
    const row = testDb.prepare(`SELECT status FROM review_queue WHERE image_path = ?`).get('img1.jpg') as any;
    expect(row.status).toBe('completed');
    const dec = testDb.prepare(`SELECT action, plant_id FROM review_decisions WHERE image_path = ?`).get('img1.jpg') as any;
    expect(dec.action).toBe('confirm');
    expect(dec.plant_id).toBe('mango');
  });

  it('confirmItem throws for unknown image_path', () => {
    expect(() => dal.confirmItem('no.jpg', 1)).toThrow(/not found/i);
  });

  it('rejectItem moves item to classify queue with pending status', () => {
    dal.rejectItem('img1.jpg', 1);
    // Item is moved in-place from swipe to classify (image_path is UNIQUE in review_queue)
    const row = testDb.prepare(`SELECT queue, status FROM review_queue WHERE image_path = ?`).get('img1.jpg') as any;
    expect(row).not.toBeNull();
    expect(row.queue).toBe('classify');
    expect(row.status).toBe('pending');
  });

  it('classifyItem sets current_plant_id and logs decision', () => {
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key)
       VALUES ('classify1.jpg', 'classify', 'in_progress', 'bbb')`,
    ).run();
    dal.classifyItem('classify1.jpg', 'fig', 1);
    const row = testDb.prepare(`SELECT current_plant_id, status FROM review_queue WHERE image_path = ?`).get('classify1.jpg') as any;
    expect(row.current_plant_id).toBe('fig');
    expect(row.status).toBe('completed');
  });

  it('discardItem marks completed and logs discard_category', () => {
    dal.discardItem('img1.jpg', 'poor_quality', 'Too blurry', 1);
    const row = testDb.prepare(`SELECT status FROM review_queue WHERE image_path = ?`).get('img1.jpg') as any;
    expect(row.status).toBe('completed');
    const dec = testDb.prepare(`SELECT action, discard_category, notes FROM review_decisions WHERE image_path = ?`).get('img1.jpg') as any;
    expect(dec.action).toBe('discard');
    expect(dec.discard_category).toBe('poor_quality');
    expect(dec.notes).toBe('Too blurry');
  });
});

describe('DAL — Plant operations', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
    testDb.prepare(`INSERT INTO plants (id, common_name, aliases) VALUES (?, ?, ?)`).run('mango-var', 'Mango Variety', null);
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('citrus', 'Citrus');
  });

  it('searchPlants returns prefix matches ranked first', () => {
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('citrus-mango', 'Citrus Mango Blend');
    const results = dal.searchPlants('mango');
    expect(results.length).toBeGreaterThan(0);
    // First result should start with 'mango' (prefix match, rank_order = 0)
    expect(results[0].common_name.toLowerCase()).toMatch(/^mango/);
  });

  it('searchPlants returns empty array for no match', () => {
    const results = dal.searchPlants('zzzznotaplant');
    expect(results).toEqual([]);
  });

  it('searchPlants limits results to 10', () => {
    for (let i = 0; i < 15; i++) {
      testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run(`mango-${i}`, `Mango ${i}`);
    }
    const results = dal.searchPlants('mango');
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('getAllPlants returns all plants sorted by common_name', () => {
    const plants = dal.getAllPlants();
    expect(plants.length).toBe(3);
    const names = plants.map(p => p.common_name);
    expect(names).toEqual([...names].sort());
  });

  it('getPlantById returns correct plant', () => {
    const plant = dal.getPlantById('mango');
    expect(plant).not.toBeNull();
    expect(plant!.common_name).toBe('Mango');
  });

  it('getPlantById returns null for unknown id', () => {
    const plant = dal.getPlantById('unknown-id');
    expect(plant).toBeNull();
  });
});

describe('DAL — User operations', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(
      `INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`,
    ).run('alice@test.com', 'Alice', 'Smith');
  });

  it('getUserByEmail returns user for known email', () => {
    const user = dal.getUserByEmail('alice@test.com');
    expect(user).not.toBeNull();
    expect(user!.first_name).toBe('Alice');
  });

  it('getUserByEmail returns null for unknown email', () => {
    const user = dal.getUserByEmail('nobody@test.com');
    expect(user).toBeNull();
  });

  it('createUser inserts and returns new user', () => {
    const user = dal.createUser('newuser@test.com', 'New', 'User');
    expect(user.email).toBe('newuser@test.com');
    expect(user.role).toBe('reviewer');
  });

  it('upsertAdminUser creates admin when not existing', () => {
    const admin = dal.upsertAdminUser('admin@test.com', 'Admin');
    expect(admin.role).toBe('admin');
    expect(admin.email).toBe('admin@test.com');
  });

  it('upsertAdminUser upgrades existing user to admin role', () => {
    dal.upsertAdminUser('alice@test.com', 'Alice');
    const user = dal.getUserByEmail('alice@test.com');
    expect(user!.role).toBe('admin');
  });
});

describe('DAL — Import operations', () => {
  beforeEach(() => {
    testDb = freshDb();
  });

  it('bulkInsertQueueItems inserts records and returns count', () => {
    const items = [
      { image_path: 'new1.jpg', queue: 'swipe', status: 'pending', sort_key: 'aaa' },
      { image_path: 'new2.jpg', queue: 'classify', status: 'pending', sort_key: 'bbb' },
    ];
    const count = dal.bulkInsertQueueItems(items);
    expect(count).toBe(2);
  });

  it('bulkInsertQueueItems is idempotent (INSERT OR IGNORE)', () => {
    const items = [{ image_path: 'new1.jpg', queue: 'swipe', status: 'pending', sort_key: 'aaa' }];
    const count1 = dal.bulkInsertQueueItems(items);
    const count2 = dal.bulkInsertQueueItems(items);
    expect(count1).toBe(1);
    expect(count2).toBe(0);
  });

  it('getImportCounts reflects current DB state', () => {
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES (?, 'swipe', 'pending', 'aaa')`,
    ).run('img1.jpg');
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES (?, 'classify', 'pending', 'bbb')`,
    ).run('img2.jpg');

    const counts = dal.getImportCounts();
    expect(counts.plants).toBe(1);
    expect(counts.swipe).toBe(1);
    expect(counts.classify).toBe(1);
    expect(counts.total).toBe(2);
  });
});

describe('DAL — Admin / stats', () => {
  beforeEach(() => {
    testDb = freshDb();
    testDb.prepare(`INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`).run('r1@test.com', 'Alice', 'Smith');
    testDb.prepare(`INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`).run('r2@test.com', 'Bob', 'Jones');
    testDb.prepare(`INSERT INTO plants (id, common_name) VALUES (?, ?)`).run('mango', 'Mango');
  });

  it('getAdminStats includes total_users and idk_flagged_count', () => {
    const stats = dal.getAdminStats();
    expect(stats.total_users).toBe(2);
    expect(typeof stats.idk_flagged_count).toBe('number');
  });

  it('getAdminLog returns rows and total', () => {
    // Seed a decision
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img.jpg', 'swipe', 'completed', 'aaa')`,
    ).run();
    testDb.prepare(
      `INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img.jpg', 1, 'confirm')`,
    ).run();

    const { rows, total } = dal.getAdminLog(1, 50, {});
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('confirm');
  });

  it('getAdminLog filters by action', () => {
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img1.jpg', 'swipe', 'completed', 'aaa')`,
    ).run();
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img2.jpg', 'swipe', 'completed', 'bbb')`,
    ).run();
    testDb.prepare(`INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img1.jpg', 1, 'confirm')`).run();
    testDb.prepare(`INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img2.jpg', 1, 'reject')`).run();

    const { rows, total } = dal.getAdminLog(1, 50, { action: 'confirm' });
    expect(total).toBe(1);
    expect(rows[0].action).toBe('confirm');
  });

  it('getIdkFlagged returns items with flagged_idk status', () => {
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key, idk_count)
       VALUES ('flagged.jpg', 'classify', 'flagged_idk', 'aaa', 3)`,
    ).run();
    const items = dal.getIdkFlagged();
    expect(items.length).toBe(1);
    expect(items[0].image_path).toBe('flagged.jpg');
  });

  it('getUserStats returns zeros for user with no decisions', () => {
    const stats = dal.getUserStats(1);
    expect(stats.today_count).toBe(0);
    expect(stats.all_time_count).toBe(0);
    expect(stats.rank).toBe(1);
  });

  it('getLeaderboard returns entries ranked by decision count', () => {
    // User 1 makes 2 decisions, user 2 makes 1
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img1.jpg', 'swipe', 'completed', 'aaa')`,
    ).run();
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img2.jpg', 'swipe', 'completed', 'bbb')`,
    ).run();
    testDb.prepare(
      `INSERT INTO review_queue (image_path, queue, status, sort_key) VALUES ('img3.jpg', 'swipe', 'completed', 'ccc')`,
    ).run();
    testDb.prepare(`INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img1.jpg', 1, 'confirm')`).run();
    testDb.prepare(`INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img2.jpg', 1, 'confirm')`).run();
    testDb.prepare(`INSERT INTO review_decisions (image_path, user_id, action) VALUES ('img3.jpg', 2, 'confirm')`).run();

    const board = dal.getLeaderboard(false);
    expect(board[0].rank).toBe(1);
    expect(board[0].count).toBe(2);
    expect(board[1].rank).toBe(2);
    expect(board[1].count).toBe(1);
  });
});
