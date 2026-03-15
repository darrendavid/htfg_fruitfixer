# Phase 5: Human Review UI — Detailed Task List

## Overview

28 granular, independently executable tasks. Each is scoped for a single subagent invocation (30 min to 1.5 hours), specifies exact files to create/modify, inputs, outputs, and dependencies.

- **Total tasks**: 28
- **Critical path**: T01 → T02 → T04 → T07 → T06 → T09 → T12 → T21 → T22 → T27 → T28 (11 steps)
- **Maximum parallelism**: 6 tasks simultaneously (Stage 4 UI group)

**Tech stack**: Vite + React 18 + TypeScript + ShadCN/ui, Express.js, SQLite (better-sqlite3), Nodemailer, node-cron, Docker

**App location**: `d:/Sandbox/Homegrown/htfg_fruit/review-ui/` (new subproject)

---

## Conventions

| Convention | Detail |
|------------|--------|
| **Agent types** | `main-session`, `backend-api-developer`, `test-writer` |
| **File paths** | Relative to `review-ui/` unless prefixed with full repo root |
| **Source data** | `d:/Sandbox/Homegrown/htfg_fruit/content/parsed/` (read-only, bind-mounted at `/data/images`) |
| **SQLite DB** | `review-ui/data/db/review.db` (bind-mounted at `/data/db/review.db`) |

---

## Dependency Graph

```
T01 (Scaffold)
  ├── T02 (Express Server) ──────────────────────────────────────────────────────────┐
  │     └── T04 (SQLite Schema) ──┬── T05 (Auth Middleware) ──────────────────────┐ │
  │                                ├── T07 (Email Service) ──┬── T06 (Auth API) ──┤ │
  │                                │                          └── T08 (Cron Jobs)  │ │
  │                                └── T09 (DAL) ──┬── T10 (Import Script) ───────┤ │
  │                                                  ├── T11 (Queue API) ──────────┤ │
  │                                                  ├── T12 (Review API) ─────────┤ │
  │                                                  └── T13 (Plants+Admin API) ───┤ │
  │                                                                                │ │
  └── T03 (ShadCN Init) ── T14 (UI Requirements) ──┬── T15 (Shared+AuthGuards) ──┤ │
                                                     ├── T16 (Login/Register UI) ──┤ │
                                                     ├── T17 (Swipe Screen) ───────┤ │
                                                     ├── T18 (Classify Screen) ────┤ │
                                                     ├── T19 (Leaderboard Screen) ─┤ │
                                                     └── T20 (Admin Dashboard) ────┤ │
                                                                                   │ │
                           ┌───────────────────────────────────────────────────────┘ │
                           v                                                          │
                    T21 (API Client) ── T22 (Routing + Wiring) ──┬── T24 (FE Tests) │
                                                                   └── T25 (UX Polish)│
                    T23 (Backend Tests)                                               │
                    T26 (Docker Config) ────────────────────────────────────────────-┘
                    T27 (Import) ── T28 (Verification)
```

---

## Stage 1: Foundation (Sequential Start)

---

### T01 — Project Scaffold

| Field | Value |
|-------|-------|
| **ID** | T01 |
| **Agent** | `main-session` |
| **Dependencies** | None |

**Objective**: Initialize the `review-ui/` subproject with all dependencies and directory structure.

**Actions**:

1. Initialize Vite project:
   ```bash
   cd "d:/Sandbox/Homegrown/htfg_fruit"
   npm create vite@latest review-ui -- --template react-ts
   cd review-ui
   ```

2. Install runtime dependencies:
   ```bash
   npm install express better-sqlite3 sharp react-swipeable react-router-dom nodemailer node-cron cookie-parser
   ```

3. Install dev dependencies:
   ```bash
   npm install -D @types/express @types/better-sqlite3 @types/node @types/nodemailer @types/cookie-parser
   npm install -D tailwindcss @tailwindcss/vite tsx concurrently
   ```

4. Configure `tsconfig.json`:
   - Path alias: `"@/*": ["./src/*"]`
   - `"moduleResolution": "bundler"`

5. Add `tsconfig.server.json`:
   - `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`
   - Include: `["server/**/*.ts"]`, `"outDir": "./dist/server"`

6. Add npm scripts to `package.json`:
   ```json
   {
     "dev": "vite",
     "dev:server": "tsx watch server/index.ts",
     "dev:all": "concurrently \"npm:dev\" \"npm:dev:server\"",
     "build": "vite build && tsc -p tsconfig.server.json",
     "start": "node dist/server/index.js",
     "import": "tsx server/scripts/import.ts",
     "test": "vitest run",
     "test:watch": "vitest"
   }
   ```

7. Create directory structure:
   ```
   review-ui/
     src/
       components/
         ui/            # ShadCN auto-generated
         layout/
         auth/
         swipe/
         classify/
         leaderboard/
         admin/
         images/
       hooks/
       lib/
       pages/
       types/
       test/
     server/
       routes/
       lib/
       middleware/
       services/
       scripts/
       data/
       __tests__/
     data/
       db/              # SQLite DB (gitignored)
   ```

8. Create `review-ui/.env.example`:
   ```
   # App
   IMAGE_MOUNT_PATH=d:/Sandbox/Homegrown/htfg_fruit/content/parsed
   DB_PATH=./data/db/review.db
   PORT=3001
   APP_URL=http://localhost:3001
   COOKIE_SECRET=change-me-to-a-random-secret-min-32-chars

   # Admin account (credentials for the admin login page)
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=change-me

   # SMTP (external mail server for magic links, reminders, daily summary)
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_SECURE=true
   SMTP_USER=authuser@example.com
   SMTP_PASS=change-me
   SMTP_FROM=noreply@hawaiifruit.net

   # Reminders
   REMINDER_INACTIVE_DAYS=3
   ```

9. Create `review-ui/.gitignore`: node_modules, dist, data/db, *.db, .env

**Files created**: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `.env.example`, `.gitignore`, `src/main.tsx`, `src/App.tsx` (placeholder)

**Verification**: `npm run dev` shows React placeholder in browser.

---

### T02 — Express Server Setup

| Field | Value |
|-------|-------|
| **ID** | T02 |
| **Agent** | `main-session` |
| **Dependencies** | T01 |

**Objective**: Create the Express server with static middleware, cookie parsing, and all API route stubs (including auth stubs).

**Actions**:

1. Create `server/config.ts`:
   - Validate and export: `PORT`, `DB_PATH`, `IMAGE_MOUNT_PATH` (required), `APP_URL`, `COOKIE_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, all `SMTP_*` vars, `REMINDER_INACTIVE_DAYS` (default: 3)
   - Fail fast with descriptive error if required vars missing

2. Create `server/index.ts`:
   - JSON body parser (1MB limit)
   - `cookie-parser` middleware initialized with `config.COOKIE_SECRET`
   - Static middleware:
     - `/images/*` → `config.IMAGE_MOUNT_PATH` (read-only intent)
     - `/thumbnails/*` → `.thumbnails/` subdirectory of IMAGE_MOUNT_PATH
   - Mount API routes:
     - `/api/auth` → `routes/auth.ts`
     - `/api/queue` → `routes/queue.ts`
     - `/api/review` → `routes/review.ts`
     - `/api/plants` → `routes/plants.ts`
     - `/api/admin` → `routes/admin.ts`
     - `/api/leaderboard` → `routes/leaderboard.ts`
     - `/api/me` → `routes/me.ts`
   - In production: serve `dist/client/` as static files
   - SPA fallback for non-API GETs
   - Global JSON error handler

3. Create stub route files (all return 501):
   - `server/routes/auth.ts` — POST `/register`, POST `/login`, GET `/verify/:token`, POST `/logout`, GET `/me`, POST `/admin/login`
   - `server/routes/queue.ts` — GET `/next`, GET `/stats`, POST `/:id/release`
   - `server/routes/review.ts` — POST `/confirm`, `/reject`, `/classify`, `/discard`, `/idk`
   - `server/routes/plants.ts` — GET `/`, GET `/:id/reference-images`, POST `/new`, GET `/csv-candidates`
   - `server/routes/admin.ts` — GET `/stats`, GET `/leaderboard`, GET `/log`, GET `/idk-flagged`, GET `/users`, POST `/import`, GET `/import-status`
   - `server/routes/leaderboard.ts` — GET `/`
   - `server/routes/me.ts` — GET `/stats`

4. Update `vite.config.ts` with dev proxy for all `/api`, `/images`, `/thumbnails` paths to port 3001

**Files created**: `server/index.ts`, `server/config.ts`, all route stubs

**Verification**: `npm run dev:server` starts on 3001. All stub routes return 501.

---

### T03 — ShadCN/ui Initialization

| Field | Value |
|-------|-------|
| **ID** | T03 |
| **Agent** | `main-session` |
| **Dependencies** | T01 |
| **Parallel with** | T02 |

**Objective**: Initialize ShadCN/ui with Tailwind CSS and install the full component set needed across all screens.

**Actions**:

1. Run `npx shadcn@latest init` (New York style, Slate base color, CSS variables enabled)

2. Install all components needed for all screens in one pass:
   ```bash
   npx shadcn@latest add button card badge input dialog progress separator skeleton \
     command radio-group select textarea sonner label form alert alert-dialog tabs
   ```

3. Customize `src/index.css`:
   - Add semantic tokens: `--color-confirm` (green), `--color-reject` (red), `--color-pending` (amber), `--color-auto` (blue)
   - Light theme only

**Files created**: `components.json`, `src/components/ui/*.tsx`, `src/index.css`, `src/lib/utils.ts`

**Verification**: ShadCN Button renders with styling in dev browser.

---

## Stage 2: Auth & Email (Sequential — must complete before UI work)

---

### T04 — SQLite Schema

| Field | Value |
|-------|-------|
| **ID** | T04 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T02 |

**Objective**: Create the complete SQLite schema (7 tables) with all indexes and a typed `db` singleton. This is the foundation for all other backend tasks.

**Critical context**: HTFG Review UI project. NOT Holualectrons. Use `better-sqlite3` (synchronous API). WAL mode required.

**Actions**:

1. Create `server/lib/schema.ts` — export `SCHEMA_SQL` with all CREATE TABLE IF NOT EXISTS and CREATE INDEX statements:

   ```sql
   -- Users
   CREATE TABLE users (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     email          TEXT NOT NULL UNIQUE,
     first_name     TEXT NOT NULL,
     last_name      TEXT NOT NULL,
     role           TEXT NOT NULL DEFAULT 'reviewer',
     last_active_at TEXT,
     last_reminded_at TEXT,
     created_at     TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE UNIQUE INDEX idx_users_email ON users(email);

   -- Magic links
   CREATE TABLE magic_links (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     email      TEXT NOT NULL,
     token      TEXT NOT NULL UNIQUE,
     expires_at TEXT NOT NULL,
     used       INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_magic_token ON magic_links(token);

   -- Sessions
   CREATE TABLE sessions (
     id         TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id),
     expires_at TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);

   -- Review queue
   CREATE TABLE review_queue (
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
   CREATE INDEX idx_queue_status ON review_queue(queue, status, sort_key);
   CREATE INDEX idx_queue_lock ON review_queue(status, locked_at);
   CREATE INDEX idx_queue_plant ON review_queue(current_plant_id);

   -- Review decisions
   CREATE TABLE review_decisions (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     image_path       TEXT NOT NULL,
     user_id          INTEGER NOT NULL REFERENCES users(id),
     action           TEXT NOT NULL,
     plant_id         TEXT,
     discard_category TEXT,
     notes            TEXT,
     decided_at       TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_decisions_image ON review_decisions(image_path);
   CREATE INDEX idx_decisions_user ON review_decisions(user_id, decided_at);

   -- New plant requests
   CREATE TABLE new_plant_requests (
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
   CREATE TABLE plants (
     id              TEXT PRIMARY KEY,
     common_name     TEXT NOT NULL,
     botanical_names TEXT,
     aliases         TEXT,
     category        TEXT NOT NULL DEFAULT 'fruit'
   );
   CREATE INDEX idx_plants_name ON plants(common_name);
   ```

2. Create `server/lib/db.ts`:
   - Import `better-sqlite3`
   - `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })`
   - Initialize DB, set `PRAGMA journal_mode = WAL`
   - Run `SCHEMA_SQL`
   - Export singleton `db`

3. Create `server/types.ts` with TypeScript interfaces for all DB rows:
   - `User`, `MagicLink`, `Session`
   - `QueueItem` (with `locked_by: number | null`, `idk_count: number`)
   - `ReviewDecision` (with `user_id: number`, action includes `'idk'`)
   - `NewPlantRequest` (with `requested_by: number`)
   - `Plant`
   - API response types: `QueueStats`, `AdminStats`, `LeaderboardEntry`, `UserStats`

**Files created**: `server/lib/schema.ts`, `server/lib/db.ts`, `server/types.ts`

**Verification**: `tsx server/lib/db.ts` creates DB with all 7 tables. Confirm with SQLite client.

---

### T05 — Auth Middleware

| Field | Value |
|-------|-------|
| **ID** | T05 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04 |
| **Parallel with** | T07, T09 |

**Objective**: Build Express middleware for session validation and role enforcement. All protected routes depend on this.

**Actions**:

1. Create `server/middleware/auth.ts`:

   **`requireAuth` middleware**:
   - Read `session_id` from `req.signedCookies.session_id`
   - If missing → `401 { error: "Authentication required" }`
   - Query `sessions` table: `SELECT s.*, u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')`
   - If no result → `401 { error: "Session expired or invalid" }`
   - Attach `req.user = { id, email, first_name, last_name, role }` to request
   - Continue with `next()`

   **`requireAdmin` middleware** (use AFTER `requireAuth`):
   - Check `req.user.role === 'admin'`
   - If not → `403 { error: "Admin access required" }`
   - Continue with `next()`

   **`optionalAuth` middleware** (for public routes that benefit from user context):
   - Same as `requireAuth` but calls `next()` even if no session (sets `req.user = null`)

2. Create `server/middleware/index.ts`:
   - Export `requireAuth`, `requireAdmin`, `optionalAuth`

3. Add `req.user` type to Express Request in `server/types.ts`:
   ```typescript
   declare global {
     namespace Express {
       interface Request {
         user?: { id: number; email: string; first_name: string; last_name: string; role: string };
       }
     }
   }
   ```

4. Apply middleware to all route stubs in `server/index.ts`:
   - Auth routes (`/api/auth`): no middleware (public)
   - All other `/api/*` routes: `requireAuth` applied at router level
   - `/api/admin/*` routes: `requireAdmin` applied at router level
   - Static image routes (`/images/*`, `/thumbnails/*`): `requireAuth` applied

**Files created**: `server/middleware/auth.ts`, `server/middleware/index.ts`
**Files modified**: `server/types.ts`, `server/index.ts`

**Verification**: Add `requireAuth` to a test route, confirm 401 without cookie, 200 with valid session cookie.

---

### T06 — Auth API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T06 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04, T07 (email service needed to send magic links) |

**Objective**: Implement all authentication endpoints: registration, magic link login, token verification, logout, and admin password login.

**Actions**:

Implement `server/routes/auth.ts`:

1. **`POST /api/auth/register`** (public):
   - Body: `{ email: string, first_name: string, last_name: string }`
   - Validate all 3 fields present; validate email format
   - Check if `users` table already has this email → `409 { error: "Email already registered" }`
   - Insert user: `INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)`
   - Generate magic link token: `crypto.randomUUID()`
   - Insert into `magic_links`: email, token, `expires_at = datetime('now', '+15 minutes')`
   - Call `emailService.sendMagicLink(email, first_name, token)` (from T07)
   - Return `200 { message: "Check your email for a login link" }`

2. **`POST /api/auth/login`** (public):
   - Body: `{ email: string }`
   - If user not found in `users` table → `404 { error: "No account found for this email. Please register first." }`
   - Generate magic link (same as above, insert into `magic_links`)
   - Call `emailService.sendMagicLink(email, first_name, token)`
   - Return `200 { message: "Check your email for a login link" }`

3. **`GET /api/auth/verify/:token`** (public):
   - Look up token in `magic_links` where `used=0` AND `expires_at > datetime('now')`
   - If not found or expired → redirect to `/login?error=expired`
   - Look up user by email
   - Mark token `used=1`
   - Create session: `INSERT INTO sessions (id, user_id, expires_at) VALUES (uuid, user_id, datetime('now', '+30 days'))`
   - Set cookie: `res.cookie('session_id', sessionId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', signed: true, maxAge: 30 * 24 * 60 * 60 * 1000 })`
   - Redirect to `/swipe`

4. **`POST /api/auth/logout`** (session required via `requireAuth`):
   - Delete session from DB: `DELETE FROM sessions WHERE id = ?`
   - `res.clearCookie('session_id')`
   - Return `200 { success: true }`

5. **`GET /api/auth/me`** (session required):
   - Return `200 { user: req.user }` (id, email, first_name, last_name, role)

6. **`POST /api/auth/admin/login`** (public):
   - Body: `{ email: string, password: string }`
   - Compare against `config.ADMIN_EMAIL` and `config.ADMIN_PASSWORD` (exact string match — no bcrypt needed)
   - If no match → `401 { error: "Invalid credentials" }`
   - Upsert admin user in `users` table with `role='admin'` (INSERT OR REPLACE approach, or check existence first)
   - Create session (same as verify) with admin user's id
   - Set session cookie
   - Return `200 { user: { email, first_name: 'Admin', last_name: '', role: 'admin' } }`

**Files modified**: `server/routes/auth.ts` (replace 501 stubs)

**Verification**: POST register → email queued. POST login with registered email → email queued. GET verify with valid token → sets cookie, redirects. POST admin/login with env creds → sets cookie.

---

### T07 — Email Service

| Field | Value |
|-------|-------|
| **ID** | T07 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T02 (needs config) |
| **Parallel with** | T04, T05 |

**Objective**: Build the Nodemailer email service with SMTP transport and templates for magic links, inactivity reminders, and daily admin summary.

**Actions**:

1. Create `server/services/email.ts`:

   **SMTP transport initialization**:
   - Create `nodemailer.createTransport({ host, port, secure, auth: { user, pass } })` from config
   - Export `transporter`
   - Graceful degradation: if SMTP not configured (empty host), log a warning and skip sending (return mock success). This allows the app to run without email in development.

   **`sendMagicLink(email: string, firstName: string, token: string): Promise<void>`**:
   - Subject: "HTFG Review — Your Login Link"
   - HTML template:
     ```html
     <p>Hi {firstName},</p>
     <p>Click the link below to sign in to HTFG Image Review. This link expires in 15 minutes.</p>
     <p><a href="{APP_URL}/api/auth/verify/{token}">Sign in to HTFG Review</a></p>
     <p>If you didn't request this, you can ignore this email.</p>
     ```
   - From: `config.SMTP_FROM`

   **`sendInactivityReminder(email: string, firstName: string, daysSinceActive: number): Promise<void>`**:
   - Subject: "HTFG Review — We miss you!"
   - Brief friendly message noting they haven't reviewed in N days, with a CTA link to `APP_URL`

   **`sendDailySummary(stats: DailySummaryStats): Promise<void>`**:
   - To: `config.ADMIN_EMAIL`
   - Subject: "HTFG Review — Daily Summary {YYYY-MM-DD}"
   - HTML table containing:
     - Total reviews completed today (by action type: confirm, reject, classify, discard, idk)
     - Per-reviewer breakdown (name + count)
     - Queue progress percentages (swipe X%, classify Y%)
     - New plants created today
     - Images escalated via IDK today
     - Link to admin dashboard: `APP_URL/admin`

2. Create `server/services/index.ts` — re-export `emailService`

**Files created**: `server/services/email.ts`, `server/services/index.ts`

**Verification**: Call `sendMagicLink` with test values; confirm email arrives (or mock log appears if SMTP not configured). Confirm template renders valid HTML.

---

### T08 — Scheduled Tasks

| Field | Value |
|-------|-------|
| **ID** | T08 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T07 (email service), T04 (schema for querying users) |
| **Parallel with** | T06, T09 |

**Objective**: Implement node-cron scheduled jobs for inactivity reminders and daily admin summary emails.

**Actions**:

1. Create `server/lib/scheduler.ts`:

   **Inactivity reminder job** (runs once per day at 09:00):
   - Query: `SELECT * FROM users WHERE role='reviewer' AND (last_reminded_at IS NULL OR last_reminded_at < datetime('now', '-{DAYS} days')) AND (last_active_at IS NULL OR last_active_at < datetime('now', '-{DAYS} days'))` where DAYS = `config.REMINDER_INACTIVE_DAYS`
   - For each matching user: call `emailService.sendInactivityReminder(user.email, user.first_name, daysSince)`
   - Update `last_reminded_at = datetime('now')` for each user emailed
   - Log count sent

   **Daily summary job** (runs at 18:00 every day):
   - Query stats for the current day:
     - Decision counts by action (from `review_decisions` WHERE `decided_at >= date('now')`)
     - Per-reviewer breakdown (JOIN users)
     - Queue progress counts
     - New plants created today
     - IDK escalations today
   - Call `emailService.sendDailySummary(stats)`

2. Create `server/lib/scheduler.ts`:
   - Use `node-cron` syntax: `cron.schedule('0 9 * * *', inactivityJob)`
   - Export `startScheduler()` function
   - Both jobs catch and log errors without crashing

3. Call `startScheduler()` from `server/index.ts` on startup (after DB is initialized)

**Files created**: `server/lib/scheduler.ts`
**Files modified**: `server/index.ts` (add `startScheduler()` call)

**Verification**: Set cron to `* * * * *` temporarily, confirm job runs without error. Confirm email functions are called with correct data shape.

---

## Stage 3: Data Layer (Parallel after T04)

---

### T09 — Data Access Layer

| Field | Value |
|-------|-------|
| **ID** | T09 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T04 |
| **Parallel with** | T05, T07, T08 |

**Objective**: Build the typed data access layer using `better-sqlite3` prepared statements. All `reviewer` string parameters from the original design are replaced with `user_id: number` from session.

**Critical context**: HTFG Review UI — NOT Holualectrons. Synchronous `better-sqlite3` API. All write operations use transactions. IDK votes only increment `idk_count` if the user hasn't already cast an IDK for that image.

**Actions**:

Create `server/lib/dal.ts` with the following method groups:

**Queue operations**:
- `getNextPendingItem(queue: string, userId: number): QueueItem | null` — transaction: expire stale locks (locked_at < 5 min ago → set pending), find next `pending` item ordered by sort_key, set `status='in_progress'`, `locked_by=userId`, `locked_at=now`, return item
- `releaseItem(id: number): void` — set `status='pending'`, clear locked_by, locked_at
- `getQueueStats(): QueueStats` — aggregate counts per (queue × status), decision counts by action, today's counts by user, new_plant_requests rerun count
- `expireStaleLocks(): number` — inline within getNextPendingItem (see above); also exported for cron/cleanup

**Review operations** (all update `users.last_active_at = datetime('now')` for the acting user):
- `confirmItem(imagePath: string, userId: number): void` — transaction: mark completed, insert review_decision with action='confirm', plant_id from suggested_plant_id || current_plant_id, update last_active_at
- `rejectItem(imagePath: string, userId: number): void` — transaction: mark completed, insert decision with action='reject', if no existing classify-queue entry for this image then insert one with queue='classify', status='pending', update last_active_at
- `classifyItem(imagePath: string, plantId: string, userId: number): void` — mark completed, insert decision action='classify', update last_active_at
- `discardItem(imagePath: string, category: string, notes: string | null, userId: number): void` — mark completed, insert decision action='discard', update last_active_at
- `idkItem(imagePath: string, userId: number): { idk_count: number, escalated: boolean }` — transaction:
  - Check if user already cast IDK for this image: `SELECT id FROM review_decisions WHERE image_path=? AND user_id=? AND action='idk'`
  - If already voted → return `{ idk_count: current, escalated: false }` (no-op)
  - Insert review_decision with action='idk'
  - Increment `idk_count` on review_queue
  - If new `idk_count >= 3` AND queue='swipe': update `status='flagged_idk'`, queue='classify'
  - Update last_active_at
  - Return `{ idk_count: new_count, escalated: new_count >= 3 }`

**Plant operations**:
- `searchPlants(query: string): Plant[]` — `SELECT ... FROM plants WHERE common_name LIKE ? OR botanical_names LIKE ? OR aliases LIKE ? UNION ... FROM new_plant_requests WHERE common_name LIKE ? AND status IN ('pending','approved')` — both queries use `'%' || query || '%'`; prefix matches ranked first with `ORDER BY CASE WHEN common_name LIKE ? THEN 0 ELSE 1 END`; LIMIT 10
- `getAllPlants(): Plant[]`
- `getPlantById(id: string): Plant | null`
- `createNewPlantRequest(data): NewPlantRequest` — generate slug from common_name, INSERT

**User/stats operations**:
- `getUserByEmail(email: string): User | null`
- `getUserById(id: number): User | null`
- `createUser(email, firstName, lastName): User`
- `upsertAdminUser(email, firstName): User`
- `updateLastActive(userId: number): void`
- `getUserStats(userId: number): { today_count, all_time_count, rank }` — rank computed as COUNT of users with higher all-time count + 1
- `getLeaderboard(fullNames: boolean): LeaderboardEntry[]` — if fullNames=false: return `first_name[0] + '.' + last_name[0] + '.'`; if fullNames=true: return full names. Query from review_decisions JOIN users, COUNT by user.
- `getAdminStats(): AdminStats` — queue counts, decision breakdown, today's activity by user (full names), new plant rerun count, IDK-flagged count
- `getAdminLog(page, limit, filters): { rows: CompletionLogRow[], total: number }` — paginated, filterable
- `getIdkFlagged(): QueueItem[]` — WHERE status='flagged_idk' OR (queue='classify' AND idk_count >= 3)
- `getAllUsers(): User[]`

**Import operations**:
- `bulkInsertQueueItems(items: Partial<QueueItem>[]): number` — transaction, INSERT OR IGNORE
- `bulkInsertPlants(plants: Plant[]): number` — transaction, INSERT OR REPLACE
- `getImportCounts(): { plants, swipe, classify, total }`

**Files created**: `server/lib/dal.ts`

**Verification**: Unit test key methods against in-memory DB (tested in T23). Manual: insert test user, IDK an item twice from same user → count only increments once; at 3 unique users, item moves to classify queue.

---

### T10 — Data Import Script

| Field | Value |
|-------|-------|
| **ID** | T10 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09 |
| **Parallel with** | T11, T12, T13 |

**Objective**: Build the standalone import script that seeds the admin user, reads Phase 4/4B JSON files, computes sort keys, generates thumbnails, and populates SQLite.

**This task is largely unchanged from the previous design** except:
- Step 0 (NEW): Create admin user from env vars before queue import
  - `dal.upsertAdminUser(config.ADMIN_EMAIL, 'Admin')`
  - Log "Admin user seeded: {email}"
- `locked_by` is `null` (INTEGER, not a string) in all inserted records
- Export `runImport(options)` for programmatic use by admin API

**Source JSON files** (all in `content/parsed/`):
- `phase4b_inferences.json` → key `inferences`, 6,518 items → queue='swipe', with inferred_plant_id/confidence/reasoning
- `phase4_image_manifest.json` → key `files`, 15,403 items → filter plant_id != null → 5,031 records → queue='swipe', confidence='auto'
- `phase4b_still_unclassified.json` → key `files`, 8,361 items → queue='classify'
- `phase4b_new_plants.json` → key `plants`, 72 items → write to `server/data/csv-candidates.json`
- `plant_registry.json` → key `plants`, 140 items → populate plants table

**Sort key computation**: group swipe items by suggested_plant_id; rank plant groups by best confidence (high=1,medium=2,low=3,auto=4); sort_key = `{group_rank_padded}:{plant_id}:{confidence_rank}:{image_path}`. Classify sort_key = `classify:{first_dir}:{image_path}`.

**Thumbnail generation**: Sharp `.resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 80 })` → `{data_dir}/.thumbnails/{relative_dest}`. Skip if exists. Log every 500.

**Final counts expected**: 140 plants, 11,549 swipe items, 8,361 classify items (19,910 total).

**Files created**: `server/scripts/import.ts`, `server/data/csv-candidates.json` (at runtime)

**Verification**: `npm run import -- --skip-thumbnails` with IMAGE_MOUNT_PATH set. Confirm counts match.

---

### T11 — Queue API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T11 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T05 (auth middleware must be applied before these routes work) |
| **Parallel with** | T10, T12, T13 |

**Objective**: Implement the 3 queue management endpoints. User identity comes from `req.user` (session), not a query parameter.

**Actions** (replace 501 stubs in `server/routes/queue.ts`):

1. **`GET /api/queue/next?type=swipe|classify`**:
   - `requireAuth` already applied at router level in server/index.ts
   - Validate `type` is 'swipe' or 'classify' (400 if not)
   - Call `dal.getNextPendingItem(type, req.user.id)`
   - If null: return `200 { item: null, remaining: 0 }`
   - Augment item: JOIN plants table to get `current_plant_name` and `suggested_plant_name`
   - Return `200 { item: augmented_item, remaining: count }`

2. **`GET /api/queue/stats`**:
   - Call `dal.getQueueStats()`
   - Return `200 { stats }`

3. **`POST /api/queue/:id/release`**:
   - Validate id is integer (400 if not)
   - Call `dal.releaseItem(id)`
   - Return `200 { success: true }`

**Files modified**: `server/routes/queue.ts`

---

### T12 — Review Action API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T12 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T05 |
| **Parallel with** | T10, T11, T13 |

**Objective**: Implement the 5 review action endpoints. All derive `user_id` from `req.user.id` (no `reviewer` in request body).

**Actions** (replace 501 stubs in `server/routes/review.ts`):

1. **`POST /api/review/confirm`** — body: `{ image_path }` → `dal.confirmItem(image_path, req.user.id)` → `200 { success: true }`

2. **`POST /api/review/reject`** — body: `{ image_path }` → `dal.rejectItem(image_path, req.user.id)` → `200 { success: true }`

3. **`POST /api/review/classify`** — body: `{ image_path, plant_id }`:
   - Verify plant_id exists in `plants` OR `new_plant_requests` (404 if not found)
   - `dal.classifyItem(image_path, plant_id, req.user.id)` → `200 { success: true }`

4. **`POST /api/review/discard`** — body: `{ image_path, category, notes? }`:
   - Validate category ∈ {event, graphics, travel, duplicate, poor_quality} (400 if invalid)
   - `dal.discardItem(image_path, category, notes || null, req.user.id)` → `200 { success: true }`

5. **`POST /api/review/idk`** — body: `{ image_path }`:
   - `const result = dal.idkItem(image_path, req.user.id)`
   - Return `200 { idk_count: result.idk_count, escalated: result.escalated }`
   - Frontend uses `escalated` to optionally show a toast ("This image has been escalated for expert review")

**Files modified**: `server/routes/review.ts`

---

### T13 — Plants, Admin, and User Stats API Endpoints

| Field | Value |
|-------|-------|
| **ID** | T13 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T09, T05 |
| **Parallel with** | T10, T11, T12 |

**Objective**: Implement plant search, reference images, new plant creation, all admin endpoints, the public leaderboard endpoint, and current user stats.

**Actions**:

**`server/routes/plants.ts`**:
1. `GET /api/plants?search=` — `dal.searchPlants(query)` (min 2 chars) or `dal.getAllPlants()` → `200 { plants }`
2. `GET /api/plants/:id/reference-images` — read plant images dir, Fisher-Yates shuffle, return up to 6 → `200 { images: [{ path, thumbnail }] }`
3. `POST /api/plants/new` — body: `{ common_name, botanical_name?, category?, aliases? }` → generate slug, check duplicates (409 if exists), `dal.createNewPlantRequest(data, req.user.id)` → `201 { plant }`
4. `GET /api/plants/csv-candidates?search=` — load cached `server/data/csv-candidates.json`, filter by search → `200 { candidates }`

**`server/routes/admin.ts`** (all require `requireAdmin`):
5. `GET /api/admin/stats` — `dal.getAdminStats()` → `200 { stats }`
6. `GET /api/admin/leaderboard` — `dal.getLeaderboard(true)` (full names) → `200 { leaderboard }`
7. `GET /api/admin/log?page=&limit=&action=&user_id=&date_from=&date_to=` — `dal.getAdminLog(page, limit, filters)` → `200 { rows, total, page, limit }`
8. `GET /api/admin/idk-flagged` — `dal.getIdkFlagged()` → `200 { images }`
9. `GET /api/admin/users` — `dal.getAllUsers()` → `200 { users }`
10. `POST /api/admin/import` — trigger async import, return `202 { status: 'started' }`
11. `GET /api/admin/import-status` — return module-level import progress state

**`server/routes/leaderboard.ts`** (requires `requireAuth`):
12. `GET /api/leaderboard` — `dal.getLeaderboard(false)` (initials only) → `200 { leaderboard }`

**`server/routes/me.ts`** (requires `requireAuth`):
13. `GET /api/me/stats` — `dal.getUserStats(req.user.id)` → `200 { today_count, all_time_count, rank }`

**Files modified**: `server/routes/plants.ts`, `server/routes/admin.ts`, `server/routes/leaderboard.ts`, `server/routes/me.ts`

---

## Stage 4: UI Components (Parallel after T03 + T14)

---

### T14 — ShadCN Component Requirements Analysis

| Field | Value |
|-------|-------|
| **ID** | T14 |
| **Agent** | `main-session` |
| **Dependencies** | T03 |

**Objective**: Analyze all 5 screens (Login/Register, Swipe, Classify, Leaderboard, Admin Dashboard) and install any remaining ShadCN components not already added in T03.

**Actions**:
1. Review PRD UI/UX section for all screens
2. Install any missing components:
   ```bash
   npx shadcn@latest add table scroll-area popover
   ```
3. Create `review-ui/design-docs/component-requirements.md` documenting:
   - Component tree per screen
   - Custom components needed: `AuthGuard`, `SwipeCard`, `PlantSearch`, `QuickPicks`, `DiscardDialog`, `NewPlantDialog`, `CompletionLogTable`, `IdkFlaggedList`
   - State management: React Context for `AuthContext` (user, loading, logout), prop-drilling for page state
   - Role-based routing: admin tab hidden from reviewers
   - Mobile-first touch target minimums (44px)

---

### T15 — Shared Components and Auth Infrastructure

| Field | Value |
|-------|-------|
| **ID** | T15 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14 |
| **Parallel with** | T16, T17, T18, T19, T20 |

**Objective**: Build the layout shell, auth context, route guards, role-aware navigation, and shared image components.

**Actions**:

1. **`src/contexts/AuthContext.tsx`**:
   - On mount: call `GET /api/auth/me` to check session
   - State: `user: User | null`, `isLoading: boolean`
   - Provides: `user`, `isLoading`, `logout()` (calls POST /api/auth/logout, clears user, navigates to /login)
   - `AuthProvider` wraps the entire app

2. **`src/components/auth/AuthGuard.tsx`**:
   - If `isLoading`: show full-page skeleton
   - If `!user`: redirect to `/login`
   - Otherwise: render children
   - Props: `children: ReactNode`

3. **`src/components/auth/AdminGuard.tsx`**:
   - Same as AuthGuard but also checks `user.role === 'admin'`
   - If not admin: redirect to `/swipe`

4. **`src/components/layout/AppShell.tsx`**:
   - Header: "HTFG Image Review" (left), user's `first_name` (right)
   - Fixed bottom navigation (see BottomNav)
   - Accepts `title`, `subtitle` props

5. **`src/components/layout/BottomNav.tsx`**:
   - Tabs: Swipe (`/swipe`), Classify (`/classify`), Leaderboard (`/leaderboard`)
   - If `user.role === 'admin'`: show fourth tab Admin (`/admin`)
   - Active state via `useLocation`
   - Min height 48px

6. **`src/components/images/LazyImage.tsx`** and **`ReferencePhotoGrid.tsx`** — same as previous design

7. **`src/components/ui/ConfidenceBadge.tsx`** — high/medium/low/auto variants

8. **`src/hooks/useCurrentUser.ts`** — shorthand for `useContext(AuthContext).user`

9. **`src/types/api.ts`** — TypeScript interfaces matching all API responses: `User`, `QueueItem` (with `idk_count`), `QueueStats`, `Plant`, `CsvCandidate`, `ReferenceImage`, `LeaderboardEntry`, `UserStats`, `AdminStats`, `CompletionLogRow`

**Files created**: All above files

---

### T16 — Login and Registration Screens

| Field | Value |
|-------|-------|
| **ID** | T16 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14, T06 (auth endpoints must be stubbed/available) |
| **Parallel with** | T15, T17, T18, T19, T20 |

**Objective**: Build the Login, Registration, and Admin Login screens with magic link flow.

**Actions**:

1. **`src/pages/LoginPage.tsx`** (`/login`):
   - ShadCN Card centered on screen (no AppShell — unauthenticated)
   - "HTFG Image Review" title
   - Email input + "Send Login Link" button
   - On submit: POST `/api/auth/login`
   - Transitions to `CheckEmailPage` on success
   - "Need an account? Register" link to `/register`
   - Error state: "No account found for this email. Register first?"

2. **`src/pages/RegisterPage.tsx`** (`/register`):
   - Same centered card
   - Fields: Email, First Name, Last Name
   - "Create Account & Send Login Link" button
   - On submit: POST `/api/auth/register`
   - Transitions to `CheckEmailPage` on success
   - "Already have an account? Sign in" link to `/login`
   - Error state: "Email already registered"

3. **`src/pages/CheckEmailPage.tsx`** (shown after login or register):
   - Large mail icon, "Check your email!" heading
   - "We sent a login link to {email}. The link expires in 15 minutes."
   - "Resend email" link (re-triggers the login/register request)
   - This is a client-side state transition (no route needed), or `/check-email?email=...`

4. **`src/pages/AdminLoginPage.tsx`** (`/admin/login`):
   - Separate card: "Admin Login"
   - Email + Password fields
   - On submit: POST `/api/auth/admin/login`
   - On success: navigate to `/admin`
   - Error state: "Invalid credentials"

5. **Loading state** during all auth form submissions: disable form, show spinner on button

**Files created**: `src/pages/LoginPage.tsx`, `src/pages/RegisterPage.tsx`, `src/pages/CheckEmailPage.tsx`, `src/pages/AdminLoginPage.tsx`

---

### T17 — Swipe Confirmation Screen

| Field | Value |
|-------|-------|
| **ID** | T17 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14, T15 |
| **Parallel with** | T16, T18, T19, T20 |

**Objective**: Build the Swipe Confirmation screen with gesture handling, IDK button, card transitions, and detail mode.

**Actions** (same as previous T11, with one addition):

1. **`src/pages/SwipePage.tsx`** — wrapped in AppShell + AuthGuard
2. **`src/components/swipe/SwipeCard.tsx`** — same gesture handling; note: `swipeUp` → detail mode
3. **`src/components/swipe/SwipeActions.tsx`** — **ADD IDK BUTTON**:
   - Three buttons: REJECT (left), IDK (center, muted), CONFIRM (right)
   - IDK button: gray/muted styling, "? IDK" label, question-mark icon
   - On IDK: call `onIdk()` callback
   - On IDK response with `escalated: true`: show Sonner toast "Image escalated to expert review"
4. **`src/components/swipe/DetailPanel.tsx`** — same as previous design

**Files created**: `src/pages/SwipePage.tsx`, `src/components/swipe/SwipeCard.tsx`, `src/components/swipe/SwipeActions.tsx`, `src/components/swipe/DetailPanel.tsx`

---

### T18 — Classify Screen

| Field | Value |
|-------|-------|
| **ID** | T18 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14, T15 |
| **Parallel with** | T16, T17, T19, T20 |

**Objective**: Build the Classify screen with enhanced autocomplete (prefix-ranked, botanical/alias matching), quick picks from `review_decisions`, and dialogs.

**Changes from previous design**:
- Plant search autocomplete now explicitly shows **prefix matches before substring matches** (the API handles this ordering — UI just renders results in received order)
- Quick picks source: derive from `review_decisions` records (`GET /api/me/stats` provides recently classified plants), cache in localStorage for instant display
- No other functional changes

**Files created**: `src/pages/ClassifyPage.tsx`, `src/components/classify/PlantSearch.tsx`, `src/components/classify/QuickPicks.tsx`, `src/components/classify/DiscardDialog.tsx`, `src/components/classify/NewPlantDialog.tsx`, `src/components/classify/ClassifyActions.tsx`, `src/hooks/useRecentPlants.ts`

(See previous T12 for full detail — this task is the same except for the quick picks source clarification above.)

---

### T19 — Leaderboard Screen

| Field | Value |
|-------|-------|
| **ID** | T19 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14, T15 |
| **Parallel with** | T16, T17, T18, T20 |

**Objective**: Build the public Leaderboard screen (replaces the old Dashboard). Visible to all authenticated users; shows initials only.

**Actions**:

1. **`src/pages/LeaderboardPage.tsx`** (`/leaderboard`):
   - Wrapped in AppShell + AuthGuard
   - Fetches from `GET /api/leaderboard` and `GET /api/me/stats` on mount
   - 30-second polling on leaderboard data
   - Shows overall queue progress, the current user's personal stats, and the ranked leaderboard

2. **`src/components/leaderboard/OverallProgress.tsx`**:
   - ShadCN Progress bar showing overall completion percentage
   - "{completed} / {total} reviewed" text

3. **`src/components/leaderboard/MyStats.tsx`**:
   - "Your Stats" card
   - Today: {count} reviewed
   - All time: {count} reviewed
   - Rank: #{rank}

4. **`src/components/leaderboard/LeaderboardTable.tsx`**:
   - "Top Reviewers (All Time)" heading
   - Numbered list with rank, initials (e.g., "K.L."), count
   - Current user highlighted (show "You" instead of initials when it's the logged-in user)
   - Top 3: subtle gold/silver/bronze styling

**Files created**: `src/pages/LeaderboardPage.tsx`, `src/components/leaderboard/OverallProgress.tsx`, `src/components/leaderboard/MyStats.tsx`, `src/components/leaderboard/LeaderboardTable.tsx`

---

### T20 — Admin Dashboard Screen

| Field | Value |
|-------|-------|
| **ID** | T20 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T14, T15, T13 (admin API endpoints must be stubbed) |
| **Parallel with** | T16, T17, T18, T19 |

**Objective**: Build the Admin Dashboard screen with full-name leaderboard, queue stats, IDK escalation queue, completion log, and re-run alert. Protected by AdminGuard.

**Actions**:

1. **`src/pages/AdminDashboardPage.tsx`** (`/admin`):
   - Wrapped in AppShell + AdminGuard
   - Tabs (ShadCN Tabs): "Overview", "Completion Log", "IDK Flagged", "Users"
   - Fetches `GET /api/admin/stats` on mount, 30s polling

2. **`src/components/admin/QueueStatusCards.tsx`**:
   - Two side-by-side cards: Swipe Queue and Classify Queue
   - Each: progress bar, count text, percentage

3. **`src/components/admin/DecisionBreakdown.tsx`**:
   - Same as leaderboard screen but with IDK row added:
     - Confirmed, Rejected, Classified, Discarded, **IDK escalated**

4. **`src/components/admin/FullNameLeaderboard.tsx`**:
   - Same structure as LeaderboardTable but shows full first + last name
   - Fetches from `GET /api/admin/leaderboard`

5. **`src/components/admin/TodayActivity.tsx`**:
   - Per-reviewer today's review count (full names)

6. **`src/components/admin/RerunBanner.tsx`**:
   - Amber banner when new_plant_rerun_count >= 5
   - "{count}/5 new plants toward re-run threshold" info text when < 5

7. **`src/components/admin/IdkFlaggedSection.tsx`**:
   - "Needs Expert Review: {count}" alert box with link to IDK Flagged tab
   - IDK Flagged tab renders list of images with: thumbnail, suggested plant name, idk_count, "Classify Now" button

8. **`src/components/admin/CompletionLog.tsx`**:
   - ShadCN Table with columns: Thumbnail, Image Path, Action, Reviewer (full name), Plant, Timestamp
   - Filter controls: date range pickers, reviewer dropdown, action type dropdown
   - Pagination (ShadCN-style prev/next with page count)
   - Fetches `GET /api/admin/log?page=&limit=50&...`

9. **`src/components/admin/UsersTable.tsx`**:
   - Table of all users: email, name, role, reviews today, reviews all-time, last active
   - Fetches `GET /api/admin/users`

**Files created**: All above files

---

## Stage 5: Integration, Testing, and Polish

---

### T21 — API Client Layer

| Field | Value |
|-------|-------|
| **ID** | T21 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T11, T12, T13, T15 (for types) |

**Objective**: Create a typed fetch wrapper for all API endpoints. All auth is via session cookie (no `reviewer` params).

**Actions**:

Create `src/lib/api.ts` and `src/lib/ApiError.ts`:

```typescript
// Auth
export async function registerUser(email, firstName, lastName): Promise<void>
export async function loginUser(email): Promise<void>
export async function logoutUser(): Promise<void>
export async function getMe(): Promise<User>
export async function adminLogin(email, password): Promise<User>

// Queue (no reviewer param — from session)
export async function getNextQueueItem(type: 'swipe' | 'classify'): Promise<{ item: QueueItem | null, remaining: number }>
export async function getQueueStats(): Promise<QueueStats>
export async function releaseQueueItem(id: number): Promise<void>

// Review (no reviewer param)
export async function confirmReview(imagePath: string): Promise<void>
export async function rejectReview(imagePath: string): Promise<void>
export async function classifyReview(imagePath: string, plantId: string): Promise<void>
export async function discardReview(imagePath: string, category: string, notes: string | null): Promise<void>
export async function idkReview(imagePath: string): Promise<{ idk_count: number, escalated: boolean }>

// Plants
export async function searchPlants(query: string): Promise<Plant[]>
export async function getReferenceImages(plantId: string): Promise<{ path, thumbnail }[]>
export async function createNewPlant(data: NewPlantData): Promise<{ id, common_name }>
export async function searchCsvCandidates(query: string): Promise<CsvCandidate[]>

// Stats & Leaderboard
export async function getLeaderboard(): Promise<LeaderboardEntry[]>
export async function getMyStats(): Promise<UserStats>

// Admin
export async function getAdminStats(): Promise<AdminStats>
export async function getAdminLeaderboard(): Promise<LeaderboardEntry[]>
export async function getAdminLog(params): Promise<{ rows, total }>
export async function getIdkFlagged(): Promise<QueueItem[]>
export async function getAdminUsers(): Promise<User[]>
export async function triggerImport(): Promise<void>
export async function getImportStatus(): Promise<ImportStatus>
```

`ApiError` class: `status: number`, `message: string`. `fetchApi` throws it on non-2xx or network error.

**Files created**: `src/lib/api.ts`, `src/lib/ApiError.ts`

---

### T22 — Routing and State Wiring

| Field | Value |
|-------|-------|
| **ID** | T22 |
| **Agent** | `main-session` |
| **Dependencies** | T21, T15, T16, T17, T18, T19, T20 |

**Objective**: Wire React Router, auth context, and all pages to real API. Full end-to-end data flow.

**Actions**:

1. **`src/App.tsx`**:
   - Wrap everything in `<AuthProvider>`, `<BrowserRouter>`, `<Toaster />`
   - Routes:
     - `/login` → `<LoginPage />` (unauthenticated only; if logged in, redirect to /swipe)
     - `/register` → `<RegisterPage />` (same)
     - `/admin/login` → `<AdminLoginPage />`
     - `/swipe` → `<AuthGuard><SwipePage /></AuthGuard>`
     - `/classify` → `<AuthGuard><ClassifyPage /></AuthGuard>`
     - `/leaderboard` → `<AuthGuard><LeaderboardPage /></AuthGuard>`
     - `/admin` → `<AdminGuard><AdminDashboardPage /></AdminGuard>`
     - `/` → `<Navigate to="/swipe" replace />`

2. Wire `SwipePage.tsx`:
   - `api.getNextQueueItem('swipe')` on mount and after each decision
   - `api.confirmReview(item.image_path)` on confirm
   - `api.rejectReview(item.image_path)` on reject
   - `api.idkReview(item.image_path)` on IDK; if `escalated=true` show toast
   - Error toast on API failure with retry button

3. Wire `ClassifyPage.tsx`:
   - `api.getNextQueueItem('classify')` for items
   - `api.searchPlants(query)` in PlantSearch
   - `api.classifyReview(...)` on assign; update recent plants; fetch next
   - `api.discardReview(...)` on discard; fetch next
   - `api.createNewPlant(...)` then `api.classifyReview(...)` on new plant
   - `api.releaseQueueItem(item.id)` on skip

4. Wire `LeaderboardPage.tsx`:
   - `api.getLeaderboard()` + `api.getMyStats()` on mount and 30s interval

5. Wire `AdminDashboardPage.tsx`:
   - `api.getAdminStats()`, `api.getAdminLeaderboard()` on mount, 30s interval
   - `api.getAdminLog(params)` on tab open and filter change
   - `api.getIdkFlagged()` on IDK tab open

6. Manual end-to-end test:
   - Register → magic link email → click link → redirected to /swipe
   - Swipe confirm/reject/idk works
   - IDK escalation at 3 votes
   - Classify screen, plant search, new plant, discard
   - Leaderboard shows initials
   - Admin login → admin dashboard → full names, completion log, IDK flagged

**Files modified**: `src/App.tsx`, `src/pages/SwipePage.tsx`, `src/pages/ClassifyPage.tsx`, `src/pages/LeaderboardPage.tsx`, `src/pages/AdminDashboardPage.tsx`

---

### T23 — Backend API Tests

| Field | Value |
|-------|-------|
| **ID** | T23 |
| **Agent** | `test-writer` |
| **Dependencies** | T11, T12, T13 |
| **Parallel with** | T21, T22 |

**Objective**: Write Vitest + Supertest integration tests using in-memory SQLite. Focus on auth flow, IDK escalation, and admin access control.

**Critical context**: HTFG Review UI. Express + better-sqlite3 (no NocoDB). In-memory `:memory:` DB. Mock `emailService` to avoid real SMTP calls.

**Test setup** (`server/__tests__/setup.ts`):
- In-memory DB with schema
- Seed: 3 users (2 reviewers, 1 admin), 10 swipe items, 5 classify items, 5 plants
- Mock `server/services/email.ts` with `vi.mock`
- Create helper: `createTestSession(userId)` → inserts session, returns cookie string

**Test files**:

**`auth.test.ts`**:
- POST /register → creates user, calls sendMagicLink
- POST /login with unknown email → 404
- GET /verify/:token → creates session, sets cookie
- GET /verify with expired token → redirects to /login?error=expired
- GET /verify with used token → error
- POST /logout → deletes session
- GET /me with valid session → returns user
- GET /me without session → 401
- POST /admin/login with correct creds → creates admin session
- POST /admin/login with wrong creds → 401

**`queue.test.ts`**:
- GET /next without session → 401
- GET /next with reviewer session → returns item with status in_progress
- Two reviewers get different items (soft lock)
- Stale lock (> 5 min) is overridden
- GET /stats returns correct counts
- POST /:id/release → item returns to pending

**`review.test.ts`**:
- All endpoints return 401 without session
- Confirm marks completed, creates decision with user_id
- Reject marks completed, creates classify queue entry
- Classify with unknown plant → 404
- Discard with invalid category → 400
- IDK: first vote from user A → idk_count=1
- IDK: second vote from same user A → idk_count still 1 (no-op)
- IDK: votes from 3 unique users → idk_count=3, item moves to classify queue with flagged_idk

**`admin.test.ts`**:
- GET /admin/stats with reviewer session → 403
- GET /admin/stats with admin session → 200 with full stats
- GET /admin/log returns paginated results
- GET /admin/idk-flagged returns only flagged items

**`dal.test.ts`**:
- Items returned in sort_key order
- `idkItem` deduplicates by user_id
- `idkItem` escalates at idk_count=3
- `bulkInsertQueueItems` is idempotent
- `searchPlants` ranks prefix matches first

**Files created**: `server/__tests__/setup.ts`, `server/__tests__/auth.test.ts`, `server/__tests__/queue.test.ts`, `server/__tests__/review.test.ts`, `server/__tests__/admin.test.ts`, `server/__tests__/dal.test.ts`, `vitest.config.ts`

**Verification**: `npx vitest run server/` — all pass.

---

### T24 — Frontend Component Tests

| Field | Value |
|-------|-------|
| **ID** | T24 |
| **Agent** | `test-writer` |
| **Dependencies** | T22 |
| **Parallel with** | T25 |

**Objective**: React Testing Library tests for key components. Mock auth context and API calls.

**New/updated tests vs. previous design**:

**`LoginPage.test.tsx`**: renders email input; submit calls api.loginUser; shows "check email" on success; shows error on 404

**`RegisterPage.test.tsx`**: validates all 3 fields required; submit calls api.registerUser; error on duplicate email

**`AdminLoginPage.test.tsx`**: shows email + password fields; submit calls api.adminLogin; redirects to /admin on success

**`SwipeCard.test.tsx`**: renders image, plant name, ConfidenceBadge, IDK button; IDK calls onIdk; buttons disabled during submission

**`SwipeActions.test.tsx`**: renders 3 buttons (reject, idk, confirm); all fire callbacks; all disabled when isSubmitting

**`AuthGuard.test.tsx`**: shows skeleton while loading; redirects to /login when unauthenticated; renders children when authenticated

**`AdminGuard.test.tsx`**: redirects reviewer to /swipe; renders children for admin

**`BottomNav.test.tsx`**: shows 3 tabs for reviewer; shows 4 tabs (with Admin) for admin

**`LeaderboardTable.test.tsx`**: shows initials "K.L."; highlights current user as "You"; gold/silver/bronze styling on top 3

**`CompletionLog.test.tsx`**: renders table rows; pagination controls work; filter inputs trigger API calls

(All from previous design also apply: DiscardDialog, NewPlantDialog, PlantSearch, useRecentPlants)

**Files created**: All test files in `src/components/__tests__/` and `src/hooks/__tests__/`

---

### T25 — UX Polish Pass

| Field | Value |
|-------|-------|
| **ID** | T25 |
| **Agent** | `backend-api-developer` |
| **Dependencies** | T22 |
| **Parallel with** | T24 |

**Objective**: Polish transitions, loading states, error handling, empty states, and auth edge cases across all screens.

**Additional focus vs. previous design**:

**Auth edge cases**:
- Magic link already used: `/login?error=expired` shows "This login link has expired or already been used. Request a new one."
- Session expired mid-session (API returns 401): `AuthContext` catches 401 from any API call, clears user, navigates to `/login` with "Your session has expired" toast
- Admin tries to access `/admin` without being logged in: AdminGuard redirects to `/admin/login` (not `/login`)

**IDK confirmation**: After IDK tap, briefly show the image card shaking (subtle CSS animation) before advancing to next card

**Other loading/error/empty states**: same as previous design (image skeleton, API error toasts, empty queue celebratory states, touch targets, transitions)

**Files modified**: Various `src/components/` and `src/pages/` files, `src/index.css`

---

### T26 — Docker Configuration

| Field | Value |
|-------|-------|
| **ID** | T26 |
| **Agent** | `main-session` |
| **Dependencies** | T02 |
| **Note** | Can start right after T02 — does not need UI or data layer |

**Objective**: Production Dockerfile and docker-compose.yml with all new environment variables.

**Actions**:

1. Create `review-ui/Dockerfile`:
   ```dockerfile
   FROM node:20-alpine AS build
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build

   FROM node:20-slim
   RUN apt-get update && apt-get install -y libvips-dev && rm -rf /var/lib/apt/lists/*
   WORKDIR /app
   COPY --from=build /app/dist ./dist
   COPY --from=build /app/package*.json ./
   RUN npm ci --omit=dev
   RUN mkdir -p /data/db
   EXPOSE 3000
   ENV NODE_ENV=production
   CMD ["node", "dist/server/index.js"]
   ```
   Note: Use `node:20-slim` (Debian) for Sharp compatibility — Alpine builds often fail with Sharp native binaries.

2. Create `review-ui/docker-compose.yml`:
   ```yaml
   services:
     review-ui:
       build: .
       ports:
         - "3000:3000"
       volumes:
         - d:/Sandbox/Homegrown/htfg_fruit/content/parsed:/data/images:ro
         - ./data/db:/data/db
       environment:
         - IMAGE_MOUNT_PATH=/data/images
         - DB_PATH=/data/db/review.db
         - PORT=3000
         - APP_URL=http://localhost:3000
         - COOKIE_SECRET=change-me-to-a-random-secret
         - ADMIN_EMAIL=admin@example.com
         - ADMIN_PASSWORD=change-me
         - SMTP_HOST=smtp.example.com
         - SMTP_PORT=587
         - SMTP_SECURE=true
         - SMTP_USER=authuser@example.com
         - SMTP_PASS=change-me
         - SMTP_FROM=noreply@hawaiifruit.net
         - REMINDER_INACTIVE_DAYS=3
   ```

3. Create `.dockerignore`, update `vite.config.ts` `build.outDir: '../dist/client'`

**Files created**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

---

## Stage 6: Data Population and Verification

---

### T27 — Production Data Import

| Field | Value |
|-------|-------|
| **ID** | T27 |
| **Agent** | `main-session` |
| **Dependencies** | T10, T26 |

**Objective**: Seed admin user, run import against real Phase 4/4B JSON files, generate thumbnails.

**Actions**:

1. Local run (faster):
   ```bash
   cd "d:/Sandbox/Homegrown/htfg_fruit/review-ui"
   IMAGE_MOUNT_PATH="d:/Sandbox/Homegrown/htfg_fruit/content/parsed" \
   DB_PATH="./data/db/review.db" \
   ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="change-me" \
   npm run import
   ```
   OR via Docker admin API after `docker compose up`.

2. Admin user is seeded by the import script automatically from env vars.

3. Monitor thumbnail generation (~30 min for 15,403 images). `--skip-thumbnails` flag available for testing DB-only import.

**Verification**: Import completes. DB exists at DB_PATH. `.thumbnails/` directory exists.

---

### T28 — Count Verification and Smoke Test

| Field | Value |
|-------|-------|
| **ID** | T28 |
| **Agent** | `main-session` |
| **Dependencies** | T27 |

**Objective**: Verify all counts, test full auth flow end-to-end, confirm SMTP connectivity, verify multi-reviewer concurrency.

**Actions**:

1. **Verify DB counts**:
   ```bash
   curl http://localhost:3000/api/admin/import-status
   ```
   Expected: 140 plants, 11,549 swipe items, 8,361 classify items, 1 admin user

2. **Test full auth flow**:
   - Navigate to `http://localhost:3000` → redirected to `/login`
   - Enter email → "Check your email" screen appears
   - If SMTP configured: email arrives with working magic link
   - If SMTP not configured: extract token from `magic_links` DB table directly, construct URL manually
   - Click link → session cookie set → redirected to `/swipe`

3. **Verify admin login**:
   - Navigate to `/admin/login`, enter ADMIN_EMAIL + ADMIN_PASSWORD
   - Verify redirected to `/admin` with full-name leaderboard, completion log visible

4. **Verify full review flow** (browser):
   - Confirm, reject, and IDK images in swipe queue
   - At 3 IDK votes on same image (using two tabs + admin): confirm escalation
   - Navigate to classify: rejected item appears
   - Assign plant, discard as event
   - Admin dashboard: counts update, IDK-flagged section shows escalated image

5. **Verify concurrency**:
   - Two browser tabs with different user accounts → different queue items served (soft lock)

6. **Verify SMTP** (if configured):
   - Trigger inactivity reminder cron manually, confirm email delivered

**Verification**: All counts match. Auth flow works. Admin features work. Multi-reviewer concurrency works.

---

## Parallelism Summary

| Group | Tasks | Max Concurrent | Prerequisite |
|-------|-------|----------------|-------------|
| A | T02, T03 | 2 | T01 done |
| B | T05, T07, T09, T10 | 4 | T04 done (T07 needs T02) |
| C | T06, T08 | 2 | T07 done |
| D | T11, T12, T13 | 3 | T09 + T05 done |
| E | T15, T16, T17, T18, T19, T20 | 6 | T14 done (T16 also needs T06) |
| F | T23, T26 | 2 | Group D / T02 |
| G | T24, T25 | 2 | T22 done |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Sharp native binaries fail in Docker Alpine | Blocks thumbnails + Docker build | Medium | Use `node:20-slim` (Debian) in production stage — specified in T26. Test Docker build early (T26 can start after T02). |
| SMTP not available in dev environment | Magic link auth unusable during development | High | Email service logs a warning and skips send if SMTP not configured. Add a dev bypass: print magic link URL to console when SMTP_HOST is empty. |
| Inference `path` doesn't match manifest `source` for some records | Import misses images (null dest/size) | Low | Log all unmatched paths. Continue with null dest/size. Verify during T10. |
| react-swipeable gesture detection unreliable on iOS Safari | Poor swipe UX | Medium | Button fallbacks for all swipe actions (confirm/reject/idk) are built into SwipeActions. Test on real device. |
| SQLite SQLITE_BUSY with 5 concurrent reviewers | Review actions fail intermittently | Low | WAL mode handles concurrent reads. Writes serialized by SQLite. Add single 100ms retry on SQLITE_BUSY if observed. |
| `phase4_image_manifest.json` dest paths include `content/parsed/` prefix | Double-prefix in thumbnail/image serving paths | Medium | Strip `content/parsed/` from dest when building file paths in import script. Verify during T10. |
| node-cron daily summary runs at wrong timezone | Emails sent at unexpected time | Low | Document that cron runs in container timezone (UTC). Set DAILY_SUMMARY_HOUR env var. Users may need to configure TZ env if they want local-time scheduling. |

---

## Appendix: Source Data Field Reference

### `phase4b_inferences.json`
Top-level key: `inferences` (6,518 items). Fields: `path`, `inferred_plant_id`, `confidence` (high/medium/low), `match_type`, `matched_term`, `matched_against`, `reasoning`

### `phase4b_still_unclassified.json`
Top-level key: `files` (8,361 items). Fields: `path`, `directories` (string array), `filename`

### `phase4_image_manifest.json`
Top-level key: `files` (15,403 items). Fields: `source`, `dest`, `plant_id` (or null), `size` (bytes), `status`. 5,031 records have non-null `plant_id`.

### `plant_registry.json`
Top-level key: `plants` (140 items). Fields: `id`, `common_name`, `botanical_names` (array), `aliases` (array), `category`

### `phase4b_new_plants.json`
Top-level key: `plants` (72 items). Fields: `provisional_id`, `fruit_type`, `scientific_name`, `genus`, `sample_varieties` (array)

### Cross-Reference Keys
- `phase4b_inferences[].path` === `phase4_image_manifest[].source`
- `phase4b_still_unclassified[].path` === `phase4_image_manifest[].source`
- `phase4b_inferences[].inferred_plant_id` === `plant_registry[].id`
- `phase4_image_manifest[].plant_id` === `plant_registry[].id`
