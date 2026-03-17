import db from './db.js';
import type {
  User, QueueItem, ReviewDecision, NewPlantRequest, Plant,
  QueueStats, AdminStats, LeaderboardEntry, UserStats, CompletionLogRow,
  OcrExtraction,
} from '../types.js';

// ─── Private Helpers ─────────────────────────────────────────────────────────

function _updateLastActive(userId: number): void {
  db.prepare(`
    UPDATE users SET last_active_at = datetime('now') WHERE id = ?
  `).run(userId);
}

// ─── Queue Operations ────────────────────────────────────────────────────────

export function getNextPendingItem(queue: string, userId: number): QueueItem | null {
  // Transaction: expire stale locks (locked_at older than 5 minutes → reset to pending)
  // then find next pending item, lock it for this user, return it
  const lockItem = db.transaction((q: string, uid: number) => {
    // Expire stale locks
    db.prepare(`
      UPDATE review_queue
      SET status = 'pending', locked_by = NULL, locked_at = NULL
      WHERE status = 'in_progress'
        AND locked_at < datetime('now', '-5 minutes')
    `).run();

    // Find next pending item
    const item = db.prepare(`
      SELECT * FROM review_queue
      WHERE queue = ? AND status = 'pending'
      ORDER BY sort_key ASC
      LIMIT 1
    `).get(q) as QueueItem | undefined;

    if (!item) return null;

    // Lock it
    db.prepare(`
      UPDATE review_queue
      SET status = 'in_progress', locked_by = ?, locked_at = datetime('now')
      WHERE id = ?
    `).run(uid, item.id);

    return { ...item, status: 'in_progress', locked_by: uid };
  });

  return lockItem(queue, userId);
}

export function releaseItem(id: number): void {
  db.prepare(`
    UPDATE review_queue
    SET status = 'pending', locked_by = NULL, locked_at = NULL
    WHERE id = ?
  `).run(id);
}

export function getQueueStats(): QueueStats {
  // Aggregate counts per (queue × status)
  const statusRows = db.prepare(`
    SELECT queue, status, COUNT(*) as count
    FROM review_queue
    GROUP BY queue, status
  `).all() as Array<{ queue: string; status: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of statusRows) {
    counts[`${row.queue}_${row.status}`] = row.count;
  }

  // Decision counts by action
  const actionRows = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM review_decisions
    GROUP BY action
  `).all() as Array<{ action: string; count: number }>;

  const decisions_by_action: Record<string, number> = {};
  for (const row of actionRows) {
    decisions_by_action[row.action] = row.count;
  }

  // Today's counts by user
  const todayRows = db.prepare(`
    SELECT rd.user_id, u.first_name, u.last_name, COUNT(*) as count
    FROM review_decisions rd
    JOIN users u ON rd.user_id = u.id
    WHERE date(rd.decided_at) = date('now')
    GROUP BY rd.user_id
  `).all() as Array<{ user_id: number; first_name: string; last_name: string; count: number }>;

  // New plant rerun count
  const rerunCount = (db.prepare(`
    SELECT COUNT(*) as count FROM new_plant_requests WHERE phase4b_rerun_needed = 1
  `).get() as { count: number }).count;

  return {
    swipe_pending: counts['swipe_pending'] || 0,
    swipe_in_progress: counts['swipe_in_progress'] || 0,
    swipe_completed: counts['swipe_completed'] || 0,
    classify_pending: counts['classify_pending'] || 0,
    classify_in_progress: counts['classify_in_progress'] || 0,
    classify_completed: counts['classify_completed'] || 0,
    classify_flagged_idk: counts['classify_flagged_idk'] || 0,
    ocr_review_pending: counts['ocr_review_pending'] || 0,
    ocr_review_in_progress: counts['ocr_review_in_progress'] || 0,
    ocr_review_completed: counts['ocr_review_completed'] || 0,
    decisions_by_action,
    today_by_user: todayRows,
    new_plant_rerun_count: rerunCount,
  };
}

export function expireStaleLocks(): number {
  const result = db.prepare(`
    UPDATE review_queue
    SET status = 'pending', locked_by = NULL, locked_at = NULL
    WHERE status = 'in_progress'
      AND locked_at < datetime('now', '-5 minutes')
  `).run();
  return result.changes;
}

// ─── Review Operations ───────────────────────────────────────────────────────

export function confirmItem(imagePath: string, userId: number): void {
  db.transaction(() => {
    const item = db.prepare(`SELECT * FROM review_queue WHERE image_path = ?`).get(imagePath) as QueueItem | undefined;
    if (!item) throw new Error(`Queue item not found: ${imagePath}`);

    db.prepare(`
      UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
      WHERE image_path = ?
    `).run(imagePath);

    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action, plant_id)
      VALUES (?, ?, 'confirm', ?)
    `).run(imagePath, userId, item.suggested_plant_id || item.current_plant_id);

    _updateLastActive(userId);
  })();
}

export function rejectItem(imagePath: string, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
      WHERE image_path = ?
    `).run(imagePath);

    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action)
      VALUES (?, ?, 'reject')
    `).run(imagePath, userId);

    // Move to classify queue (update in place — image_path is UNIQUE in review_queue)
    db.prepare(`
      UPDATE review_queue
      SET queue = 'classify', status = 'pending',
          sort_key = 'classify:rejected:' || image_path,
          locked_by = NULL, locked_at = NULL
      WHERE image_path = ? AND queue != 'classify'
    `).run(imagePath);

    _updateLastActive(userId);
  })();
}

export function classifyItem(imagePath: string, plantId: string, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL,
             current_plant_id = ?
      WHERE image_path = ?
    `).run(plantId, imagePath);

    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action, plant_id)
      VALUES (?, ?, 'classify', ?)
    `).run(imagePath, userId, plantId);

    _updateLastActive(userId);
  })();
}

export function ignoreItem(imagePath: string, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
      WHERE image_path = ?
    `).run(imagePath);

    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action)
      VALUES (?, ?, 'ignore')
    `).run(imagePath, userId);

    _updateLastActive(userId);
  })();
}

export function discardItem(imagePath: string, category: string, notes: string | null, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
      WHERE image_path = ?
    `).run(imagePath);

    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action, discard_category, notes)
      VALUES (?, ?, 'discard', ?, ?)
    `).run(imagePath, userId, category, notes);

    _updateLastActive(userId);
  })();
}

export function idkItem(imagePath: string, userId: number): { idk_count: number; escalated: boolean } {
  return db.transaction(() => {
    // Check if user already voted IDK for this image
    const alreadyVoted = db.prepare(`
      SELECT id FROM review_decisions
      WHERE image_path = ? AND user_id = ? AND action = 'idk'
    `).get(imagePath, userId);

    const currentItem = db.prepare(`
      SELECT idk_count, queue FROM review_queue WHERE image_path = ?
    `).get(imagePath) as { idk_count: number; queue: string } | undefined;

    if (!currentItem) throw new Error(`Queue item not found: ${imagePath}`);

    if (alreadyVoted) {
      return { idk_count: currentItem.idk_count, escalated: false };
    }

    // Insert IDK decision
    db.prepare(`
      INSERT INTO review_decisions (image_path, user_id, action)
      VALUES (?, ?, 'idk')
    `).run(imagePath, userId);

    // Increment idk_count
    db.prepare(`
      UPDATE review_queue SET idk_count = idk_count + 1 WHERE image_path = ?
    `).run(imagePath);

    const newCount = currentItem.idk_count + 1;
    let escalated = false;

    // Escalate if >= 3 IDK votes AND currently in swipe queue
    if (newCount >= 3 && currentItem.queue === 'swipe') {
      db.prepare(`
        UPDATE review_queue
        SET status = 'flagged_idk', queue = 'classify',
            locked_by = NULL, locked_at = NULL
        WHERE image_path = ?
      `).run(imagePath);
      escalated = true;
    }

    _updateLastActive(userId);
    return { idk_count: newCount, escalated };
  })();
}

// ─── Plant Operations ────────────────────────────────────────────────────────

export function searchPlants(query: string): Plant[] {
  const like = `%${query}%`;
  const prefixLike = `${query}%`;

  // Union plants table + new_plant_requests, prefix matches first
  const rows = db.prepare(`
    SELECT id, common_name, botanical_names, aliases, category,
           CASE WHEN common_name LIKE ? THEN 0 ELSE 1 END as rank_order
    FROM plants
    WHERE common_name LIKE ? OR botanical_names LIKE ? OR aliases LIKE ?
    UNION
    SELECT generated_id as id, common_name, botanical_name as botanical_names,
           aliases, category,
           CASE WHEN common_name LIKE ? THEN 0 ELSE 1 END as rank_order
    FROM new_plant_requests
    WHERE (common_name LIKE ? OR aliases LIKE ?)
      AND status IN ('pending', 'approved')
    ORDER BY rank_order ASC, common_name ASC
    LIMIT 10
  `).all(prefixLike, like, like, like, prefixLike, like, like) as Array<Plant & { rank_order: number }>;

  return rows.map(({ rank_order: _, ...plant }) => plant);
}

export function getAllPlants(): Plant[] {
  return db.prepare(`SELECT * FROM plants ORDER BY common_name ASC`).all() as Plant[];
}

export function getPlantById(id: string): Plant | null {
  return (db.prepare(`SELECT * FROM plants WHERE id = ?`).get(id) as Plant | undefined) ?? null;
}

export function createNewPlantRequest(data: {
  common_name: string;
  botanical_name?: string;
  category?: string;
  aliases?: string;
  requested_by: number;
  first_image_path?: string;
}): NewPlantRequest {
  const slug = data.common_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const generatedId = `new-${slug}-${Date.now()}`;

  const result = db.prepare(`
    INSERT INTO new_plant_requests
      (common_name, botanical_name, category, aliases, requested_by, generated_id, first_image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.common_name,
    data.botanical_name || null,
    data.category || 'fruit',
    data.aliases || null,
    data.requested_by,
    generatedId,
    data.first_image_path || null,
  );

  return db.prepare(`SELECT * FROM new_plant_requests WHERE id = ?`).get(result.lastInsertRowid) as NewPlantRequest;
}

// ─── User / Stats Operations ─────────────────────────────────────────────────

export function getUserByEmail(email: string): User | null {
  return (db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as User | undefined) ?? null;
}

export function getUserById(id: number): User | null {
  return (db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined) ?? null;
}

export function createUser(email: string, firstName: string, lastName: string): User {
  const result = db.prepare(`
    INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)
  `).run(email, firstName, lastName);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid) as User;
}

export function upsertAdminUser(email: string, firstName: string): User {
  const existing = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as User | undefined;
  if (existing) {
    db.prepare(`UPDATE users SET role = 'admin', first_name = ? WHERE email = ?`).run(firstName, email);
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as User;
  }
  const result = db.prepare(`
    INSERT INTO users (email, first_name, last_name, role) VALUES (?, ?, '', 'admin')
  `).run(email, firstName);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid) as User;
}

export function updateLastActive(userId: number): void {
  db.prepare(`UPDATE users SET last_active_at = datetime('now') WHERE id = ?`).run(userId);
}

export function getUserStats(userId: number): UserStats {
  const today_count = (db.prepare(`
    SELECT COUNT(*) as count FROM review_decisions
    WHERE user_id = ? AND date(decided_at) = date('now')
  `).get(userId) as { count: number }).count;

  const all_time_count = (db.prepare(`
    SELECT COUNT(*) as count FROM review_decisions WHERE user_id = ?
  `).get(userId) as { count: number }).count;

  const rank = (db.prepare(`
    SELECT COUNT(*) + 1 as rank
    FROM (
      SELECT user_id, COUNT(*) as total
      FROM review_decisions
      GROUP BY user_id
      HAVING total > ?
    )
  `).get(all_time_count) as { rank: number }).rank;

  return { today_count, all_time_count, rank };
}

export function getLeaderboard(fullNames: boolean): LeaderboardEntry[] {
  const rows = db.prepare(`
    SELECT rd.user_id,
           u.first_name, u.last_name,
           COUNT(*) as count
    FROM review_decisions rd
    JOIN users u ON rd.user_id = u.id
    GROUP BY rd.user_id
    ORDER BY count DESC
  `).all() as Array<{ user_id: number; first_name: string; last_name: string; count: number }>;

  return rows.map((row, i) => ({
    rank: i + 1,
    user_id: row.user_id,
    display_name: fullNames
      ? `${row.first_name} ${row.last_name}`.trim()
      : `${row.first_name[0] || '?'}.${row.last_name[0] || '?'}.`,
    count: row.count,
  }));
}

export function getAdminStats(): AdminStats {
  const stats = getQueueStats();

  const idk_flagged_count = (db.prepare(`
    SELECT COUNT(*) as count FROM review_queue
    WHERE status = 'flagged_idk' OR (queue = 'classify' AND idk_count >= 3)
  `).get() as { count: number }).count;

  const total_users = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number }).count;

  return { ...stats, idk_flagged_count, total_users };
}

export function getAdminLog(
  page: number,
  limit: number,
  filters: { action?: string; user_id?: number; date_from?: string; date_to?: string },
): { rows: CompletionLogRow[]; total: number } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.action) {
    conditions.push('rd.action = ?');
    params.push(filters.action);
  }
  if (filters.user_id) {
    conditions.push('rd.user_id = ?');
    params.push(filters.user_id);
  }
  if (filters.date_from) {
    conditions.push('date(rd.decided_at) >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push('date(rd.decided_at) <= ?');
    params.push(filters.date_to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`
    SELECT COUNT(*) as count FROM review_decisions rd ${where}
  `).get(...params) as { count: number }).count;

  const offset = (page - 1) * limit;
  const rows = db.prepare(`
    SELECT rd.id, rd.image_path, rq.thumbnail_path,
           rd.action, rd.plant_id,
           u.first_name || ' ' || u.last_name as reviewer_name,
           rd.decided_at
    FROM review_decisions rd
    JOIN users u ON rd.user_id = u.id
    LEFT JOIN review_queue rq ON rd.image_path = rq.image_path
    ${where}
    ORDER BY rd.decided_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as CompletionLogRow[];

  return { rows, total };
}

export function getIdkFlagged(): QueueItem[] {
  return db.prepare(`
    SELECT * FROM review_queue
    WHERE status = 'flagged_idk' OR (queue = 'classify' AND idk_count >= 3)
    ORDER BY idk_count DESC
  `).all() as QueueItem[];
}

export function getAllUsers(): User[] {
  return db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as User[];
}

// ─── OCR Review Operations ──────────────────────────────────────────────────

export function getNextOcrItem(userId: number): { item: QueueItem; ocr: OcrExtraction } | null {
  return db.transaction((uid: number) => {
    // Expire stale locks
    db.prepare(`
      UPDATE review_queue
      SET status = 'pending', locked_by = NULL, locked_at = NULL
      WHERE status = 'in_progress'
        AND locked_at < datetime('now', '-5 minutes')
        AND queue = 'ocr_review'
    `).run();

    // Find next pending ocr_review item
    const item = db.prepare(`
      SELECT * FROM review_queue
      WHERE queue = 'ocr_review' AND status = 'pending'
      ORDER BY sort_key ASC
      LIMIT 1
    `).get() as QueueItem | undefined;

    if (!item) return null;

    // Lock it
    db.prepare(`
      UPDATE review_queue
      SET status = 'in_progress', locked_by = ?, locked_at = datetime('now')
      WHERE id = ?
    `).run(uid, item.id);

    // Get linked OCR extraction
    const ocr = db.prepare(`
      SELECT * FROM ocr_extractions WHERE queue_item_id = ?
    `).get(item.id) as OcrExtraction | undefined;

    if (!ocr) return null;

    return { item: { ...item, status: 'in_progress', locked_by: uid }, ocr };
  })(userId);
}

export function getOcrExtraction(queueItemId: number): OcrExtraction | null {
  return (db.prepare(`
    SELECT * FROM ocr_extractions WHERE queue_item_id = ?
  `).get(queueItemId) as OcrExtraction | undefined) ?? null;
}

export function updateOcrExtraction(id: number, updates: {
  title?: string | null;
  extracted_text?: string | null;
  key_facts?: string | null;
  plant_associations?: string | null;
  source_context?: string | null;
  reviewer_notes?: string | null;
}): void {
  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.extracted_text !== undefined) { fields.push('extracted_text = ?'); values.push(updates.extracted_text); }
  if (updates.key_facts !== undefined) { fields.push('key_facts = ?'); values.push(updates.key_facts); }
  if (updates.plant_associations !== undefined) { fields.push('plant_associations = ?'); values.push(updates.plant_associations); }
  if (updates.source_context !== undefined) { fields.push('source_context = ?'); values.push(updates.source_context); }
  if (updates.reviewer_notes !== undefined) { fields.push('reviewer_notes = ?'); values.push(updates.reviewer_notes); }

  if (fields.length === 0) return;

  values.push(id as unknown as string);
  db.prepare(`UPDATE ocr_extractions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function approveOcrExtraction(id: number, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE ocr_extractions
      SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(userId, id);

    const ocr = db.prepare(`SELECT queue_item_id, image_path FROM ocr_extractions WHERE id = ?`).get(id) as { queue_item_id: number; image_path: string } | undefined;
    if (ocr) {
      db.prepare(`
        UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
        WHERE id = ?
      `).run(ocr.queue_item_id);

      db.prepare(`
        INSERT INTO review_decisions (image_path, user_id, action, notes)
        VALUES (?, ?, 'ocr_approve', NULL)
      `).run(ocr.image_path, userId);
    }

    _updateLastActive(userId);
  })();
}

export function rejectOcrExtraction(id: number, userId: number): void {
  db.transaction(() => {
    db.prepare(`
      UPDATE ocr_extractions
      SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(userId, id);

    const ocr = db.prepare(`SELECT queue_item_id, image_path FROM ocr_extractions WHERE id = ?`).get(id) as { queue_item_id: number; image_path: string } | undefined;
    if (ocr) {
      db.prepare(`
        UPDATE review_queue SET status = 'completed', locked_by = NULL, locked_at = NULL
        WHERE id = ?
      `).run(ocr.queue_item_id);

      db.prepare(`
        INSERT INTO review_decisions (image_path, user_id, action, notes)
        VALUES (?, ?, 'ocr_reject', NULL)
      `).run(ocr.image_path, userId);
    }

    _updateLastActive(userId);
  })();
}

export function getOcrStats(): { pending: number; approved: number; rejected: number; total: number } {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM ocr_extractions GROUP BY status
  `).all() as Array<{ status: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.count;

  const pending = counts['pending'] || 0;
  const approved = counts['approved'] || 0;
  const rejected = counts['rejected'] || 0;
  return { pending, approved, rejected, total: pending + approved + rejected };
}

export function bulkInsertOcrExtractions(items: Partial<OcrExtraction>[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ocr_extractions
      (queue_item_id, image_path, title, content_type, extracted_text,
       plant_associations, key_facts, source_context, reviewer_notes, status)
    VALUES
      (@queue_item_id, @image_path, @title, @content_type, @extracted_text,
       @plant_associations, @key_facts, @source_context, @reviewer_notes, @status)
  `);

  const insertMany = db.transaction((rows: Partial<OcrExtraction>[]) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run({
        queue_item_id: row.queue_item_id ?? null,
        image_path: row.image_path ?? '',
        title: row.title ?? null,
        content_type: row.content_type ?? null,
        extracted_text: row.extracted_text ?? null,
        plant_associations: row.plant_associations ?? null,
        key_facts: row.key_facts ?? null,
        source_context: row.source_context ?? null,
        reviewer_notes: row.reviewer_notes ?? null,
        status: row.status ?? 'pending',
      });
      count += result.changes;
    }
    return count;
  });

  return insertMany(items);
}

// ─── Import Operations ───────────────────────────────────────────────────────

export function bulkInsertQueueItems(items: Partial<QueueItem>[]): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO review_queue
      (image_path, source_path, queue, status, current_plant_id, suggested_plant_id,
       confidence, match_type, reasoning, thumbnail_path, file_size, sort_key, source_directories)
    VALUES
      (@image_path, @source_path, @queue, @status, @current_plant_id, @suggested_plant_id,
       @confidence, @match_type, @reasoning, @thumbnail_path, @file_size, @sort_key, @source_directories)
  `);

  const insertMany = db.transaction((rows: Partial<QueueItem>[]) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run({
        image_path: row.image_path ?? '',
        source_path: row.source_path ?? null,
        queue: row.queue ?? 'swipe',
        status: row.status ?? 'pending',
        current_plant_id: row.current_plant_id ?? null,
        suggested_plant_id: row.suggested_plant_id ?? null,
        confidence: row.confidence ?? null,
        match_type: row.match_type ?? null,
        reasoning: row.reasoning ?? null,
        thumbnail_path: row.thumbnail_path ?? null,
        file_size: row.file_size ?? null,
        sort_key: row.sort_key ?? null,
        source_directories: row.source_directories ?? null,
      });
      count += result.changes;
    }
    return count;
  });

  return insertMany(items);
}

export function bulkInsertPlants(plants: Plant[]): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO plants (id, common_name, botanical_names, aliases, category)
    VALUES (@id, @common_name, @botanical_names, @aliases, @category)
  `);

  const insertMany = db.transaction((rows: Plant[]) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run(row);
      count += result.changes;
    }
    return count;
  });

  return insertMany(plants);
}

export function getImportCounts(): { plants: number; swipe: number; classify: number; ocr_review: number; total: number } {
  const plants = (db.prepare(`SELECT COUNT(*) as count FROM plants`).get() as { count: number }).count;
  const swipe = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'swipe'`).get() as { count: number }).count;
  const classify = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'classify'`).get() as { count: number }).count;
  const ocr_review = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'ocr_review'`).get() as { count: number }).count;
  return { plants, swipe, classify, ocr_review, total: swipe + classify + ocr_review };
}
