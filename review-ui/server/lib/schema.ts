export const SCHEMA_SQL = `
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    first_name     TEXT NOT NULL,
    last_name      TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'reviewer',
    last_active_at TEXT,
    last_reminded_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- Magic links
  CREATE TABLE IF NOT EXISTS magic_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_magic_token ON magic_links(token);

  -- Sessions
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- Review queue
  CREATE TABLE IF NOT EXISTS review_queue (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path         TEXT NOT NULL UNIQUE,
    source_path        TEXT,
    queue              TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending',
    current_plant_id   TEXT,
    suggested_plant_id TEXT,
    confidence         TEXT,
    match_type         TEXT,
    reasoning          TEXT,
    thumbnail_path     TEXT,
    file_size          INTEGER,
    sort_key           TEXT,
    source_directories TEXT,
    idk_count          INTEGER NOT NULL DEFAULT 0,
    locked_by          INTEGER REFERENCES users(id),
    locked_at          TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_queue_status ON review_queue(queue, status, sort_key);
  CREATE INDEX IF NOT EXISTS idx_queue_lock ON review_queue(status, locked_at);
  CREATE INDEX IF NOT EXISTS idx_queue_plant ON review_queue(current_plant_id);

  -- Review decisions
  CREATE TABLE IF NOT EXISTS review_decisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path       TEXT NOT NULL,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    action           TEXT NOT NULL,
    plant_id         TEXT,
    discard_category TEXT,
    notes            TEXT,
    decided_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_image ON review_decisions(image_path);
  CREATE INDEX IF NOT EXISTS idx_decisions_user ON review_decisions(user_id, decided_at);

  -- New plant requests
  CREATE TABLE IF NOT EXISTS new_plant_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    common_name         TEXT NOT NULL,
    botanical_name      TEXT,
    category            TEXT NOT NULL DEFAULT 'fruit',
    aliases             TEXT,
    requested_by        INTEGER NOT NULL REFERENCES users(id),
    status              TEXT NOT NULL DEFAULT 'pending',
    generated_id        TEXT NOT NULL,
    phase4b_rerun_needed INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    first_image_path    TEXT
  );

  -- Plants (read-only reference from plant_registry.json)
  CREATE TABLE IF NOT EXISTS plants (
    id              TEXT PRIMARY KEY,
    common_name     TEXT NOT NULL,
    botanical_names TEXT,
    aliases         TEXT,
    category        TEXT NOT NULL DEFAULT 'fruit'
  );
  CREATE INDEX IF NOT EXISTS idx_plants_name ON plants(common_name);

  -- OCR extractions
  CREATE TABLE IF NOT EXISTS ocr_extractions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_item_id   INTEGER REFERENCES review_queue(id),
    image_path      TEXT NOT NULL,
    title           TEXT,
    content_type    TEXT,
    extracted_text  TEXT,
    plant_associations TEXT,
    key_facts       TEXT,
    source_context  TEXT,
    reviewer_notes  TEXT,
    status          TEXT DEFAULT 'pending',
    reviewed_by     INTEGER REFERENCES users(id),
    reviewed_at     TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ocr_queue ON ocr_extractions(queue_item_id);
  CREATE INDEX IF NOT EXISTS idx_ocr_status ON ocr_extractions(status);

  -- Staff notes (Phase 8 browse UI)
  CREATE TABLE IF NOT EXISTS staff_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id    TEXT NOT NULL,
    variety_id  INTEGER,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notes_plant ON staff_notes(plant_id);

  -- Hero image preferences (Phase 8 browse UI)
  CREATE TABLE IF NOT EXISTS hero_images (
    plant_id    TEXT PRIMARY KEY,
    image_id    INTEGER NOT NULL,
    file_path   TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
